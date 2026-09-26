/**
 * `MessagingChannel` port (ADR-0013: "porta `MessagingChannel` no módulo `notifications`
 * ... adapters: `SesEmailChannel`/`SmtpEmailChannel`, `WhatsAppCloudChannel`, `FakeChannel`
 * para dev/testes"; system-design.md §"notifications": "e-mail (porta `MessagingChannel`
 * ...)"). Pure TS — no Nest/nodemailer import here, `domain/` stays framework-free
 * (CLAUDE.md rule 2); `infra/smtp-email.channel.ts` and `infra/fake.channel.ts` are the
 * adapters that `implements` this.
 *
 * ULTRAPLAN 1.5 only builds the e-mail side (`kind: "email"`) — `kind` is still part of the
 * port now (rather than added later) because ADR-0013 already commits to a second adapter,
 * `WhatsAppCloudChannel` (Fase 5), behind the SAME port; a caller that later needs to pick
 * a channel by kind (e.g. `reporting`'s daily report, Fase 5.14, sending the same content to
 * both) already has a stable field to switch on instead of that being a Fase 5 contract
 * change.
 */
export type MessagingChannelKind = "email" | "whatsapp";

/** A file attached to an outbound message (e.g. the daily report PDF, Fase 5) — not used by
 * ULTRAPLAN 1.5's member-invite e-mail, but part of the port's shape now per ADR-0013's own
 * description of what a channel sends ("PDF como documento"). */
export interface OutboundMessageAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface OutboundMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: OutboundMessageAttachment[];
}

export interface SendResult {
  /** The provider's own id for the sent message (e.g. nodemailer's `messageId`,
   * WhatsApp Cloud API's `wamid`) — `null` when the adapter has none to report (e.g.
   * `FakeChannel`, which never talks to a real provider). Not persisted anywhere yet
   * (`notification_deliveries`, Fase 5) — kept on the port's return type now so that table's
   * write doesn't need a signature change later. */
  providerMessageId: string | null;
}

export interface MessagingChannel {
  readonly kind: MessagingChannelKind;
  send(message: OutboundMessage): Promise<SendResult>;
}

/** DI token — bound to a concrete adapter ONLY inside `NotificationsModule` (`system-design.md`:
 * "envio de e-mail/WhatsApp **só** por esse caminho — nenhum módulo injeta o canal de
 * mensagens de `notifications` direto"). Not re-exported by this module's `index.ts` for
 * that exact reason; a test that needs to override the binding (`FakeChannel`) imports this
 * token directly from this file, which the module-boundary eslint rule doesn't restrict for
 * test code (see `eslint.boundaries.mjs`'s own `ignores`/`files` scoping to `src/**`, not
 * `test/**`). */
export const MESSAGING_CHANNEL = Symbol("MESSAGING_CHANNEL");
