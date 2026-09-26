import { Injectable } from "@nestjs/common";

import type { MessagingChannel, OutboundMessage, SendResult } from "../domain/messaging-channel";

/**
 * In-memory `MessagingChannel` (ADR-0013: "`FakeChannel` para dev/testes"). Records every
 * message it's asked to send in `sent` instead of talking to any real transport — used by
 * integration tests that need to assert what a domain event caused `notifications` to send,
 * without depending on a real Mailpit/SMTP round trip. Bound in place of `SmtpEmailChannel`
 * via `Test.createTestingModule(...).overrideProvider(MESSAGING_CHANNEL).useValue(...)`
 * (standard Nest testing pattern) — `NotificationsModule` itself never binds this class,
 * per ADR-0013/system-design.md's own "FakeChannel para dev/testes" split from the real
 * adapter it always wires in production/dev.
 */
@Injectable()
export class FakeChannel implements MessagingChannel {
  readonly kind = "email";
  readonly sent: OutboundMessage[] = [];

  send(message: OutboundMessage): Promise<SendResult> {
    this.sent.push(message);
    return Promise.resolve({ providerMessageId: null });
  }
}
