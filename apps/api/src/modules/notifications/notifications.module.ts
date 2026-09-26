import { Module } from "@nestjs/common";

import { AppConfigModule } from "../../config/app-config.module";
import { SharedModule } from "../shared";
import { MESSAGING_CHANNEL } from "./domain/messaging-channel";
import { MemberInvitedEventHandler } from "./events/member-invited.handler";
import { SmtpEmailChannel } from "./infra/smtp-email.channel";

/**
 * Wiring for the `notifications` module (ULTRAPLAN 1.5 — first task this module exists for;
 * ADR-0013, system-design.md §"notifications"). `MESSAGING_CHANNEL` is bound to
 * `SmtpEmailChannel` here and ONLY here — no other module ever injects this token directly
 * (system-design.md: "nenhum módulo injeta o canal de mensagens de `notifications` direto"),
 * they react to the domain events this module already consumes instead.
 *
 * `FakeChannel` (ADR-0013's third adapter, "para dev/testes") is deliberately NOT wired
 * here — a test overrides this binding via
 * `Test.createTestingModule(...).overrideProvider(MESSAGING_CHANNEL).useValue(new FakeChannel())`,
 * which needs no branch in this module's own providers list (and keeps "which channel a real
 * boot uses" a single, unconditional answer: `SmtpEmailChannel`, dev and prod alike — only
 * `AppConfigService.smtpUrl`'s actual value differs between them).
 */
@Module({
  imports: [AppConfigModule, SharedModule],
  providers: [
    { provide: MESSAGING_CHANNEL, useClass: SmtpEmailChannel },
    MemberInvitedEventHandler,
  ],
})
export class NotificationsModule {}
