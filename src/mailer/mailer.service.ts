import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Transporter } from 'nodemailer';
import { AppConfigService } from '../config/app-config.service';
import { MAIL_TRANSPORTER } from './mailer.constants';

const MAX_RETRIES = 3;

export type SendMailOptions = {
  to: string;
  subject: string;
  html: string;
};

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(
    @Inject(MAIL_TRANSPORTER) private readonly transporter: Transporter,
    private readonly cfg: AppConfigService,
  ) {}

  async sendMail({ to, subject, html }: SendMailOptions): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.transporter.sendMail({
          from: this.cfg.smtpFrom,
          to,
          subject,
          html,
        });
        return;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    this.logger.error(
      `Failed to send email to ${to} after ${MAX_RETRIES} attempts`,
      lastError instanceof Error ? lastError.stack : String(lastError),
    );
    throw lastError;
  }
}
