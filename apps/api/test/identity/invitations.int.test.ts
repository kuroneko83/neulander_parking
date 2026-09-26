/**
 * Integration tests for ULTRAPLAN 1.5 (convite de membros): `POST /v1/orgs/:orgId/members`,
 * `GET /v1/invitations/:token`, `POST /v1/invitations/:token/accept`, and the full
 * `identity.member_invited.v1` outbox → BullMQ → `DomainEventsProcessor` → `notifications` →
 * `MessagingChannel` chain (ADR-0017). Supertest against a real Nest application and the
 * real Postgres/Redis from `infra/docker/compose.yml`, same style as
 * `test/identity/auth.int.test.ts`/`test/shared/outbox.int.test.ts`:
 *
 *   docker compose -f infra/docker/compose.yml up -d postgres redis
 *
 * `MESSAGING_CHANNEL` is overridden with `FakeChannel` for the whole suite (standard Nest
 * testing pattern — see `notifications.module.ts`'s own doc comment on why that binding,
 * not an env branch, is how a test swaps the real `SmtpEmailChannel` out) so every invite in
 * this file can assert on the e-mail `notifications` sent without a real Mailpit round trip,
 * and so the actual plaintext accept token (never returned by any endpoint) can be recovered
 * from the captured e-mail — exactly how a real invitee would get it.
 */
import { getQueueToken } from "@nestjs/bullmq";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Queue } from "bullmq";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../../src/app.module";
import { applyGlobalHttpConfig } from "../../src/configure-app";
import type { Database } from "../../src/database/database.module";
import { DATABASE_CONNECTION } from "../../src/database/database.module";
import { DEMO_SEED_EMAILS, DEMO_SEED_PASSWORD, seedIdentity } from "../../src/modules/identity";
import { invitations, memberships, refreshTokens, users } from "../../src/modules/identity/infra/schema";
import { MESSAGING_CHANNEL } from "../../src/modules/notifications/domain/messaging-channel";
import { FakeChannel } from "../../src/modules/notifications/infra/fake.channel";
import {
  CLOCK,
  DOMAIN_EVENTS_QUEUE,
  DomainEventsProcessor,
  FakeClock,
  OutboxRelayProcessor,
} from "../../src/modules/shared";
import { outboxEvents } from "../../src/modules/shared/infra/schema";

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payloadSegment] = token.split(".");
  if (!payloadSegment) {
    throw new Error(`Não parece um JWT: "${token}"`);
  }
  return JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

const MEMBER_INVITED_EVENT_TYPE = "identity.member_invited.v1";

describe("invitations: invite/preview/accept + identity.member_invited.v1 -> notifications (real Postgres/Redis from compose)", () => {
  let app: INestApplication;
  let db: Database;
  let queue: Queue;
  let outboxRelay: OutboxRelayProcessor;
  let domainEventsProcessor: DomainEventsProcessor;
  let fakeChannel: FakeChannel;

  let organizationId: string;
  let ownerToken: string;
  let managerToken: string;
  let operatorToken: string;

  const emailsToCleanUp: string[] = [];
  const invitationIdsToCleanUp: string[] = [];

  beforeAll(async () => {
    fakeChannel = new FakeChannel();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGING_CHANNEL)
      .useValue(fakeChannel)
      .compile();
    app = moduleRef.createNestApplication();
    applyGlobalHttpConfig(app);
    await app.init();

    db = app.get(DATABASE_CONNECTION);
    queue = app.get<Queue>(getQueueToken(DOMAIN_EVENTS_QUEUE));
    outboxRelay = app.get(OutboxRelayProcessor);
    domainEventsProcessor = app.get(DomainEventsProcessor);

    await seedIdentity(db);

    const [, ownerEmail, managerEmail, operatorEmail] = DEMO_SEED_EMAILS;

    const ownerLogin = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email: ownerEmail, password: DEMO_SEED_PASSWORD });
    ownerToken = (ownerLogin.body as { accessToken: string }).accessToken;
    const ownerClaims = decodeJwtPayload(ownerToken) as {
      roles: { organizationId: string }[];
    };
    organizationId = ownerClaims.roles[0]?.organizationId ?? "";

    const managerLogin = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email: managerEmail, password: DEMO_SEED_PASSWORD });
    managerToken = (managerLogin.body as { accessToken: string }).accessToken;

    const operatorLogin = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email: operatorEmail, password: DEMO_SEED_PASSWORD });
    operatorToken = (operatorLogin.body as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    for (const invitationId of invitationIdsToCleanUp) {
      await db.delete(outboxEvents).where(eq(outboxEvents.aggregateId, invitationId));
    }
    for (const email of emailsToCleanUp) {
      await db.delete(invitations).where(eq(invitations.email, email));
      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
      if (user) {
        await db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id));
        await db.delete(memberships).where(eq(memberships.userId, user.id));
        await db.delete(users).where(eq(users.id, user.id));
      }
    }
    await app.close();
  });

  function uniqueInviteeEmail(label: string): string {
    const email = `invite-int-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
    emailsToCleanUp.push(email);
    return email;
  }

  /**
   * Invites `email` as `role`, then drives the REAL async chain this task builds
   * end-to-end (ADR-0017's own recommended deterministic pattern: `pollOnce()` + a single
   * manual `process()` call, no timer/worker race) and recovers the plaintext accept token
   * from the e-mail `notifications` actually sent — never from a DB backdoor — exactly what
   * a real invitee would get.
   */
  async function inviteAndCaptureToken(params: {
    accessToken: string;
    email: string;
    role: "owner" | "manager" | "operator";
  }): Promise<{ token: string; invitationId: string }> {
    const inviteResponse = await request(app.getHttpServer())
      .post(`/v1/orgs/${organizationId}/members`)
      .set("Authorization", `Bearer ${params.accessToken}`)
      .send({ email: params.email, role: params.role });
    expect(inviteResponse.status).toBe(201);

    const invitationId = (inviteResponse.body as { id: string }).id;
    invitationIdsToCleanUp.push(invitationId);

    const published = await outboxRelay.pollOnce();
    expect(published).toBeGreaterThan(0);

    const [eventRow] = await db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(and(eq(outboxEvents.aggregateId, invitationId), eq(outboxEvents.type, MEMBER_INVITED_EVENT_TYPE)));
    expect(eventRow).toBeDefined();

    const job = await queue.getJob(eventRow!.id);
    expect(job).toBeDefined();
    await domainEventsProcessor.process(job!);

    const sentMessage = fakeChannel.sent.find((message) => message.to === params.email);
    expect(sentMessage).toBeDefined();

    const match = /accept-invite\/([a-f0-9]{64})/.exec(sentMessage!.text);
    expect(match).not.toBeNull();

    return { token: match![1]!, invitationId };
  }

  describe("POST /v1/orgs/:orgId/members", () => {
    it("201s, creates a pending invitation and NEVER returns the token", async () => {
      const email = uniqueInviteeEmail("invite-ok");

      const response = await request(app.getHttpServer())
        .post(`/v1/orgs/${organizationId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email, role: "manager" });

      expect(response.status).toBe(201);
      invitationIdsToCleanUp.push((response.body as { id: string }).id);
      expect(response.body).toMatchObject({ organizationId, email, role: "manager", parkingLotIds: [] });
      expect("token" in response.body).toBe(false);
      expect("tokenHash" in response.body).toBe(false);
    });

    it("403s with INVITE_ROLE_NOT_ALLOWED when a manager tries to invite an owner", async () => {
      const email = uniqueInviteeEmail("manager-invites-owner");

      const response = await request(app.getHttpServer())
        .post(`/v1/orgs/${organizationId}/members`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ email, role: "owner" });

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ code: "INVITE_ROLE_NOT_ALLOWED" });
    });

    it("a manager CAN invite another manager or an operator", async () => {
      const email = uniqueInviteeEmail("manager-invites-manager");

      const response = await request(app.getHttpServer())
        .post(`/v1/orgs/${organizationId}/members`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ email, role: "manager" });

      expect(response.status).toBe(201);
      invitationIdsToCleanUp.push((response.body as { id: string }).id);
    });

    it("403s an operator trying to invite anyone (RolesGuard blocks the route entirely)", async () => {
      const email = uniqueInviteeEmail("operator-invites");

      const response = await request(app.getHttpServer())
        .post(`/v1/orgs/${organizationId}/members`)
        .set("Authorization", `Bearer ${operatorToken}`)
        .send({ email, role: "operator" });

      expect(response.status).toBe(403);
    });

    it("400s with PARKING_LOT_SCOPE_UNAVAILABLE for a non-empty parkingLotIds", async () => {
      const email = uniqueInviteeEmail("scoped-invite");

      const response = await request(app.getHttpServer())
        .post(`/v1/orgs/${organizationId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email, role: "operator", parkingLotIds: ["01933b6a-1a00-7000-8000-000000000001"] });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: "PARKING_LOT_SCOPE_UNAVAILABLE" });
    });

    it("409s with INVITATION_ALREADY_PENDING for a second invite to the same still-pending e-mail", async () => {
      const email = uniqueInviteeEmail("duplicate-pending");

      const first = await request(app.getHttpServer())
        .post(`/v1/orgs/${organizationId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email, role: "operator" });
      expect(first.status).toBe(201);
      invitationIdsToCleanUp.push((first.body as { id: string }).id);

      const second = await request(app.getHttpServer())
        .post(`/v1/orgs/${organizationId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email, role: "operator" });

      expect(second.status).toBe(409);
      expect(second.body).toMatchObject({ code: "INVITATION_ALREADY_PENDING" });
    });

    it("409s with MEMBER_ALREADY_EXISTS when inviting an e-mail that's already a member", async () => {
      const [, ownerEmail] = DEMO_SEED_EMAILS;

      const response = await request(app.getHttpServer())
        .post(`/v1/orgs/${organizationId}/members`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ email: ownerEmail, role: "manager" });

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: "MEMBER_ALREADY_EXISTS" });
    });

    it("401s without an Authorization header", async () => {
      const response = await request(app.getHttpServer())
        .post(`/v1/orgs/${organizationId}/members`)
        .send({ email: uniqueInviteeEmail("no-auth"), role: "operator" });

      expect(response.status).toBe(401);
    });
  });

  describe("identity.member_invited.v1 -> notifications -> MessagingChannel (outbox + BullMQ, ADR-0017)", () => {
    it("sends exactly one e-mail with the organization name, role and a working accept URL", async () => {
      const email = uniqueInviteeEmail("email-flow");

      const { token } = await inviteAndCaptureToken({ accessToken: ownerToken, email, role: "operator" });

      const sentMessage = fakeChannel.sent.find((message) => message.to === email);
      expect(sentMessage).toBeDefined();
      expect(sentMessage?.subject).toContain("Neulander Parking");
      expect(sentMessage?.text).toContain("Operador");
      expect(sentMessage?.text).toContain(`accept-invite/${token}`);
    });
  });

  describe("GET /v1/invitations/:token", () => {
    it("returns the preview for a valid, pending token — userExists false for a brand-new e-mail", async () => {
      const email = uniqueInviteeEmail("preview-new-user");
      const { token } = await inviteAndCaptureToken({ accessToken: ownerToken, email, role: "manager" });

      const response = await request(app.getHttpServer()).get(`/v1/invitations/${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ role: "manager", email, userExists: false });
      expect(typeof response.body.organizationName).toBe("string");
    });

    it("userExists is true when the invited e-mail already has an account", async () => {
      // Can't invite an existing member (409 MEMBER_ALREADY_EXISTS) — but preview only
      // needs a REAL invitations row whose e-mail happens to match an existing user, and
      // that combination is otherwise reachable (e.g. the invitee registers a driver
      // account between being invited and opening the link). Simulate it directly instead
      // of re-deriving the whole "someone registered after being invited" flow.
      const email = uniqueInviteeEmail("preview-existing-user");
      const registerResponse = await request(app.getHttpServer())
        .post("/v1/auth/register")
        .send({ email, password: "correct horse battery staple", name: "Convidado Teste" });
      expect(registerResponse.status).toBe(201);

      const { token } = await inviteAndCaptureToken({ accessToken: ownerToken, email, role: "operator" });

      const response = await request(app.getHttpServer()).get(`/v1/invitations/${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ userExists: true });
    });

    it("404s with INVITATION_NOT_FOUND for a token that was never issued", async () => {
      const response = await request(app.getHttpServer()).get(
        `/v1/invitations/${"0".repeat(64)}`,
      );

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: "INVITATION_NOT_FOUND" });
    });

    it("404s (same generic error) for an EXPIRED invitation — never distinguishes from unknown", async () => {
      const fakeClock = new FakeClock();
      const fakeChannelForClockApp = new FakeChannel();
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(MESSAGING_CHANNEL)
        .useValue(fakeChannelForClockApp)
        .overrideProvider(CLOCK)
        .useValue(fakeClock)
        .compile();
      const appWithFakeClock = moduleRef.createNestApplication();
      applyGlobalHttpConfig(appWithFakeClock);
      await appWithFakeClock.init();

      try {
        const clockOutboxRelay = appWithFakeClock.get(OutboxRelayProcessor);
        const clockDomainEventsProcessor = appWithFakeClock.get(DomainEventsProcessor);
        const clockQueue = appWithFakeClock.get<Queue>(getQueueToken(DOMAIN_EVENTS_QUEUE));
        const clockDb = appWithFakeClock.get<Database>(DATABASE_CONNECTION);

        const email = uniqueInviteeEmail("preview-expired");
        const inviteResponse = await request(appWithFakeClock.getHttpServer())
          .post(`/v1/orgs/${organizationId}/members`)
          .set("Authorization", `Bearer ${ownerToken}`)
          .send({ email, role: "operator" });
        expect(inviteResponse.status).toBe(201);
        const invitationId = (inviteResponse.body as { id: string }).id;
        invitationIdsToCleanUp.push(invitationId);

        await clockOutboxRelay.pollOnce();
        const [eventRow] = await clockDb
          .select({ id: outboxEvents.id })
          .from(outboxEvents)
          .where(
            and(eq(outboxEvents.aggregateId, invitationId), eq(outboxEvents.type, MEMBER_INVITED_EVENT_TYPE)),
          );
        const job = await clockQueue.getJob(eventRow!.id);
        await clockDomainEventsProcessor.process(job!);

        const sentMessage = fakeChannelForClockApp.sent.find((message) => message.to === email);
        const match = /accept-invite\/([a-f0-9]{64})/.exec(sentMessage!.text);
        const token = match![1]!;

        // 8 days forward — past the 7-day TTL (data-model.md).
        fakeClock.advance(8 * 24 * 60 * 60 * 1000);

        const response = await request(appWithFakeClock.getHttpServer()).get(
          `/v1/invitations/${token}`,
        );

        expect(response.status).toBe(404);
        expect(response.body).toMatchObject({ code: "INVITATION_NOT_FOUND" });
      } finally {
        await appWithFakeClock.close();
      }
    });
  });

  describe("POST /v1/invitations/:token/accept", () => {
    it("404s with INVITATION_NOT_FOUND for an unknown token", async () => {
      const response = await request(app.getHttpServer())
        .post(`/v1/invitations/${"0".repeat(64)}/accept`)
        .send({});

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: "INVITATION_NOT_FOUND" });
    });

    it("400s with INVITATION_ACCEPT_MISSING_CREDENTIALS when the e-mail has no account and the body is empty", async () => {
      const email = uniqueInviteeEmail("accept-missing-credentials");
      const { token } = await inviteAndCaptureToken({ accessToken: ownerToken, email, role: "operator" });

      const response = await request(app.getHttpServer())
        .post(`/v1/invitations/${token}/accept`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: "INVITATION_ACCEPT_MISSING_CREDENTIALS" });
    });

    it("201s, creates the user + membership and returns a working TokenPair, for a brand-new e-mail", async () => {
      const email = uniqueInviteeEmail("accept-new-user");
      const { token } = await inviteAndCaptureToken({ accessToken: ownerToken, email, role: "manager" });

      const response = await request(app.getHttpServer())
        .post(`/v1/invitations/${token}/accept`)
        .send({ name: "Nova Gestora", password: "correct horse battery staple" });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String) });

      const [user] = await db.select().from(users).where(eq(users.email, email));
      expect(user).toBeDefined();
      expect(user?.name).toBe("Nova Gestora");

      const [membership] = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, user!.id)));
      expect(membership).toBeDefined();
      expect(membership?.role).toBe("manager");

      const claims = decodeJwtPayload((response.body as { accessToken: string }).accessToken) as {
        roles: { organizationId: string; role: string }[];
      };
      expect(claims.roles).toEqual([{ organizationId, role: "manager", parkingLotIds: [] }]);

      // The freshly created account can log in normally afterwards.
      const login = await request(app.getHttpServer())
        .post("/v1/auth/login")
        .send({ email, password: "correct horse battery staple" });
      expect(login.status).toBe(200);
    });

    it("204s (no token pair) and creates only the membership, for an e-mail that already has an account", async () => {
      const email = uniqueInviteeEmail("accept-existing-user");
      const password = "correct horse battery staple";
      const registerResponse = await request(app.getHttpServer())
        .post("/v1/auth/register")
        .send({ email, password, name: "Já Tinha Conta" });
      expect(registerResponse.status).toBe(201);

      const { token } = await inviteAndCaptureToken({ accessToken: ownerToken, email, role: "operator" });

      const response = await request(app.getHttpServer()).post(`/v1/invitations/${token}/accept`).send({});

      expect(response.status).toBe(204);
      expect(response.body).toEqual({});

      const userId = (registerResponse.body as { id: string }).id;
      const [membership] = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)));
      expect(membership).toBeDefined();
      expect(membership?.role).toBe("operator");
    });

    it("410s with INVITATION_EXPIRED for a real invitation whose TTL has passed", async () => {
      const fakeClock = new FakeClock();
      const fakeChannelForClockApp = new FakeChannel();
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(MESSAGING_CHANNEL)
        .useValue(fakeChannelForClockApp)
        .overrideProvider(CLOCK)
        .useValue(fakeClock)
        .compile();
      const appWithFakeClock = moduleRef.createNestApplication();
      applyGlobalHttpConfig(appWithFakeClock);
      await appWithFakeClock.init();

      try {
        const clockOutboxRelay = appWithFakeClock.get(OutboxRelayProcessor);
        const clockDomainEventsProcessor = appWithFakeClock.get(DomainEventsProcessor);
        const clockQueue = appWithFakeClock.get<Queue>(getQueueToken(DOMAIN_EVENTS_QUEUE));
        const clockDb = appWithFakeClock.get<Database>(DATABASE_CONNECTION);

        const email = uniqueInviteeEmail("accept-expired");
        const inviteResponse = await request(appWithFakeClock.getHttpServer())
          .post(`/v1/orgs/${organizationId}/members`)
          .set("Authorization", `Bearer ${ownerToken}`)
          .send({ email, role: "operator" });
        expect(inviteResponse.status).toBe(201);
        const invitationId = (inviteResponse.body as { id: string }).id;
        invitationIdsToCleanUp.push(invitationId);

        await clockOutboxRelay.pollOnce();
        const [eventRow] = await clockDb
          .select({ id: outboxEvents.id })
          .from(outboxEvents)
          .where(and(eq(outboxEvents.aggregateId, invitationId), eq(outboxEvents.type, MEMBER_INVITED_EVENT_TYPE)));
        const job = await clockQueue.getJob(eventRow!.id);
        await clockDomainEventsProcessor.process(job!);

        const sentMessage = fakeChannelForClockApp.sent.find((message) => message.to === email);
        const match = /accept-invite\/([a-f0-9]{64})/.exec(sentMessage!.text);
        const token = match![1]!;

        // 8 days forward — past the 7-day TTL (data-model.md).
        fakeClock.advance(8 * 24 * 60 * 60 * 1000);

        const response = await request(appWithFakeClock.getHttpServer())
          .post(`/v1/invitations/${token}/accept`)
          .send({ name: "Tarde Demais", password: "correct horse battery staple" });

        expect(response.status).toBe(410);
        expect(response.body).toMatchObject({ code: "INVITATION_EXPIRED" });
      } finally {
        await appWithFakeClock.close();
      }
    });

    it("replay of the same token after acceptance is idempotent — 204, no duplicate membership", async () => {
      const email = uniqueInviteeEmail("accept-replay");
      const { token } = await inviteAndCaptureToken({ accessToken: ownerToken, email, role: "operator" });

      const first = await request(app.getHttpServer())
        .post(`/v1/invitations/${token}/accept`)
        .send({ name: "Replay Teste", password: "correct horse battery staple" });
      expect(first.status).toBe(201);

      const second = await request(app.getHttpServer())
        .post(`/v1/invitations/${token}/accept`)
        .send({ name: "Replay Teste", password: "correct horse battery staple" });
      expect(second.status).toBe(204);
      expect(second.body).toEqual({});

      const [user] = await db.select().from(users).where(eq(users.email, email));
      const membershipRows = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, user!.id)));
      expect(membershipRows).toHaveLength(1);
    });
  });
});
