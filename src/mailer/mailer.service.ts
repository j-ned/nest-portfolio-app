import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Transporter } from 'nodemailer';
import { AppConfigService } from '../config/app-config.service';
import { MAIL_TRANSPORTER } from './mailer.constants';
import { maskEmail } from './mailer.utils';

const MAX_RETRIES = 3;

/** Invitation calendrier, envoyée en une seule alternative `text/calendar` (iMIP, RFC 6047). */
/** Méthode iTIP (RFC 5546) de la partie `text/calendar` jointe à un email. */
export type CalendarMethod = 'REQUEST' | 'PUBLISH' | 'CANCEL';

export type IcalEvent = {
  method: CalendarMethod;
  content: string;
};

export type SendMailOptions = {
  to: string;
  subject: string;
  html: string;
  icalEvent?: IcalEvent;
};

const maskRecipientsIn = (text: string, recipients: string): string =>
  recipients
    .split(',')
    .map((address) => address.trim())
    .filter((address) => address !== '')
    .reduce(
      (masked, address) => masked.replaceAll(address, maskEmail(address)),
      text,
    );

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(
    @Inject(MAIL_TRANSPORTER) private readonly transporter: Transporter,
    private readonly cfg: AppConfigService,
  ) {}

  async sendMail({
    to,
    subject,
    html,
    icalEvent,
  }: SendMailOptions): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.transporter.sendMail({
          from: this.cfg.smtpFrom,
          to,
          subject,
          html,
          // Pas d'option `icalEvent` : nodemailer y ajoute une pièce `application/ics`, et les
          // clients affichent alors deux invitations pour un même événement.
          ...(icalEvent && {
            alternatives: [
              {
                contentType: `text/calendar; charset=utf-8; method=${icalEvent.method}`,
                content: icalEvent.content,
              },
            ],
          }),
        });
        return;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    // Le log d'erreur remonte à Sentry : ni l'adresse en clair, ni la réponse SMTP qui la cite.
    const trace =
      lastError instanceof Error ? lastError.stack : String(lastError);
    this.logger.error(
      `Failed to send email to ${maskEmail(to)} after ${MAX_RETRIES} attempts`,
      trace && maskRecipientsIn(trace, to),
    );
    throw lastError;
  }
}
