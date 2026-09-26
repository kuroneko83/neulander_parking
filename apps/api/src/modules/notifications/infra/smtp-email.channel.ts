import { Injectable, OnModuleDestroy } from "@nestjs/common";
import * as nodemailer from "nodemailer";

import { AppConfigService } from "../../../config/app-config.service";
import type { MessagingChannel, OutboundMessage, SendResult } from "../domain/messaging-channel";

/**
 * `MessagingChannel` adapter over SMTP via `nodemailer` (ADR-0013: "`SmtpEmailChannel` para
 * Mailpit em dev"). In production this same class points at a real SMTP endpoint (Amazon
 * SES also exposes SMTP credentials, not just its own API — `AppConfigService.smtpUrl`
 * resolves to whichever `SMTP_URL`/`SMTP_DEV_URL` is configured, no code branch here needs
 * to know which); the "always Mailpit" assumption lives only in `.env.example`'s default
 * for `SMTP_DEV_URL`, not in this class.
 *
 * The transport is created once, in the constructor, and reused for every `send()` call —
 * `nodemailer.createTransport()` doesn't open a connection eagerly (SMTP pooling/connection
 * happens lazily on the first `sendMail()`), so constructing this provider never fails just
 * because Mailpit/the configured SMTP server happens to be unreachable at boot time.
 */
@Injectable()
export class SmtpEmailChannel implements MessagingChannel, OnModuleDestroy {
  readonly kind = "email";
  private readonly transporter: nodemailer.Transporter;

  constructor(private readonly appConfig: AppConfigService) {
    this.transporter = nodemailer.createTransport(this.appConfig.smtpUrl);
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const info = await this.transporter.sendMail({
      from: this.appConfig.emailFrom,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments?.map((attachment) => ({
        filename: attachment.filename,
        contentType: attachment.contentType,
        content: attachment.content,
      })),
    });

    return { providerMessageId: typeof info.messageId === "string" ? info.messageId : null };
  }

  onModuleDestroy(): void {
    this.transporter.close();
  }
}
