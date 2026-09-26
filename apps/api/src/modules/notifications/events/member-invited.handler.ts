import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import type { DomainEvent } from "@neulander/contracts";
import { MemberInvitedPayloadSchema } from "@neulander/contracts";

import { AppConfigService } from "../../../config/app-config.service";
import { DomainEventBus, maskEmail } from "../../shared";
import { MESSAGING_CHANNEL, type MessagingChannel } from "../domain/messaging-channel";
import { renderMemberInviteEmail } from "../domain/templates/member-invite";

const EVENT_TYPE = "identity.member_invited.v1";

/**
 * Consumer of `identity.member_invited.v1` (ADR-0017's first real handler; api-and-events.md:
 * "identity.member_invited.v1 | identity | notifications (e-mail de convite)"). Registers
 * itself with `DomainEventBus` on `onModuleInit` — per ADR-0017 §2, exactly the pattern every
 * future consumer (`occupancy`, `reporting`, ...) reuses.
 *
 * Builds the accept URL from `WEB_APP_URL` + the event's own (plaintext) `token` — the ONLY
 * place in the codebase that ever reads that token back out of an event payload; nothing
 * about it is ever logged (see the doc comment on `payload.token`'s presence in
 * `MemberInvitedPayloadSchema`, and CLAUDE.md rule 10 for why `payload.email` is masked in
 * every log line here too).
 */
@Injectable()
export class MemberInvitedEventHandler implements OnModuleInit {
  private readonly logger = new Logger(MemberInvitedEventHandler.name);

  constructor(
    private readonly domainEventBus: DomainEventBus,
    @Inject(MESSAGING_CHANNEL) private readonly channel: MessagingChannel,
    private readonly appConfig: AppConfigService,
  ) {}

  onModuleInit(): void {
    this.domainEventBus.register(EVENT_TYPE, (event) => this.handle(event));
  }

  private async handle(event: DomainEvent): Promise<void> {
    const payload = MemberInvitedPayloadSchema.parse(event.payload);
    const acceptUrl = `${this.appConfig.webAppUrl}/accept-invite/${payload.token}`;

    const email = renderMemberInviteEmail({
      organizationName: payload.organizationName,
      role: payload.role,
      acceptUrl,
      expiresAt: new Date(payload.expiresAt),
    });

    await this.channel.send({
      to: payload.email,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    this.logger.log(
      `Convite enviado por e-mail para ${maskEmail(payload.email)} (evento ${event.id}).`,
    );
  }
}
