import { resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import type { Booking } from '../database/schema';
import { OWNER_EMAIL } from '../mailer/mailer.constants';
import { MailerService } from '../mailer/mailer.service';
import { loadTemplate, renderTemplate } from '../mailer/mailer.utils';
import { formatParisLong } from './paris-time';
import { type IcsMethod, toIcs } from './to-ics';

const TEMPLATES_DIR = resolve(__dirname, 'mail-templates');
const OWNER_NAME = 'Julien Nédellec';
const SUMMARY = 'Appel de cadrage · 30 min';

/** Moyen de joindre le rendez-vous : lien de visio ou numéro du visiteur. */
type Meeting = {
  label: string;
  href: string;
  value: string;
  hint: string;
  location: string;
};

/**
 * Emails et invitations d'un rendez-vous. Toujours appelé après le commit, en fire-and-forget
 * par l'appelant : un échec d'envoi est rejeté, jamais journalisé ici (le jeton d'annulation ne
 * doit apparaître que dans le corps de l'email du visiteur).
 */
@Injectable()
export class BookingNotifier {
  constructor(
    private readonly mailer: MailerService,
    private readonly config: AppConfigService,
  ) {}

  async bookingConfirmed(row: Booking, token: string): Promise<void> {
    const variables = this.commonVariables(row);
    await Promise.all([
      this.mailer.sendMail({
        to: row.email,
        subject: `Rendez-vous confirmé : ${variables.when}`,
        html: render('booking-confirmation.html', {
          ...variables,
          cancelUrl: `${this.siteUrl()}/rendez-vous/annulation#${token}`,
        }),
        icalEvent: this.invitation(row, 'REQUEST', { withAttendee: true }),
      }),
      this.mailer.sendMail({
        to: OWNER_EMAIL,
        subject: `Nouveau rendez-vous : ${row.name}, ${variables.when}`,
        html: render('booking-notification.html', {
          ...variables,
          email: row.email,
          company: row.company ?? '—',
          message: row.message,
        }),
        icalEvent: this.invitation(row, 'PUBLISH', { withAttendee: false }),
      }),
    ]);
  }

  /** Rédaction déclinée selon la partie qui annule ; le motif du propriétaire figure aux deux emails. */
  async bookingCancelled(row: Booking): Promise<void> {
    const variables = this.commonVariables(row);
    const byOwner = row.cancelledBy === 'owner';
    const reason = (byOwner && row.cancelReason) || '';
    const template = cancelledTemplate(reason !== '');
    await Promise.all([
      this.mailer.sendMail({
        to: row.email,
        subject: `Rendez-vous annulé : ${variables.when}`,
        html: renderTemplate(template, {
          ...variables,
          reason,
          greeting: `Bonjour ${row.name},`,
          intro: byOwner
            ? `Je dois malheureusement annuler notre rendez-vous. Il est retiré de votre agenda si vous l’y aviez ajouté. Vous pouvez réserver un autre créneau sur ${this.siteUrl()}/rendez-vous.`
            : 'Votre rendez-vous est bien annulé. Il est retiré de votre agenda si vous l’y aviez ajouté.',
        }),
        icalEvent: this.invitation(row, 'CANCEL', { withAttendee: true }),
      }),
      this.mailer.sendMail({
        to: OWNER_EMAIL,
        subject: `Rendez-vous annulé : ${row.name}, ${variables.when}`,
        html: renderTemplate(template, {
          ...variables,
          reason,
          greeting: 'Rendez-vous annulé',
          intro: byOwner
            ? `Vous avez annulé le rendez-vous de ${row.name} (${row.email}) ; un email d’annulation lui a été envoyé.`
            : `${row.name} (${row.email}) a annulé son rendez-vous.`,
        }),
        icalEvent: this.invitation(row, 'CANCEL', { withAttendee: false }),
      }),
    ]);
  }

  /** Rappel la veille, au visiteur seul : sans lien d'annulation (le jeton n'est pas conservé). */
  async bookingReminder(row: Booking): Promise<void> {
    const variables = this.commonVariables(row);
    await this.mailer.sendMail({
      to: row.email,
      subject: `Rappel de rendez-vous : ${variables.when}`,
      html: render('booking-reminder.html', variables),
    });
  }

  private siteUrl(): string {
    return this.config.publicSiteUrl.replace(/\/+$/, '');
  }

  private commonVariables(row: Booking) {
    const meeting = meetingOf(row);
    return {
      name: row.name,
      when: formatParisLong(row.startsAt),
      meetingLabel: meeting.label,
      meetingHref: meeting.href,
      meetingValue: meeting.value,
      meetingHint: meeting.hint,
      year: String(new Date().getFullYear()),
    };
  }

  /**
   * Même événement (même UID) pour les deux destinataires, horodaté à l'envoi. Le visiteur est
   * invité (`REQUEST`, participant nommé) ; le propriétaire, organisateur et destinataire à la
   * fois, reçoit l'événement publié (`PUBLISH`, sans participant) qu'un client accepte d'ajouter.
   */
  private invitation(
    row: Booking,
    method: IcsMethod,
    { withAttendee }: { withAttendee: boolean },
  ) {
    const meeting = meetingOf(row);
    return {
      method,
      content: toIcs({
        method,
        uid: row.id,
        stamp: new Date(),
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        summary: SUMMARY,
        description: `Appel de cadrage de 30 minutes entre ${OWNER_NAME} et ${row.name}.\n${meeting.label} : ${meeting.value}`,
        location: meeting.location,
        organizer: { name: OWNER_NAME, email: OWNER_EMAIL },
        ...(withAttendee && {
          attendee: { name: row.name, email: row.email },
        }),
      }),
    };
  }
}

const meetingOf = (row: Booking): Meeting => {
  if (row.format === 'video' && row.videoUrl) {
    return {
      label: 'Lien de visio',
      href: row.videoUrl,
      value: row.videoUrl,
      hint: 'À l’heure du rendez-vous, ouvrez ce lien dans votre navigateur : aucune installation n’est nécessaire.',
      location: row.videoUrl,
    };
  }
  const phone = row.phone ?? '';
  return {
    label: 'Téléphone',
    href: `tel:${phone.replace(/[^+0-9]/g, '')}`,
    value: phone,
    hint: 'Je vous appellerai à ce numéro à l’heure du rendez-vous.',
    location: `Téléphone : ${phone}`,
  };
};

const templateOf = (name: string): string =>
  loadTemplate(resolve(TEMPLATES_DIR, name));

const render = (name: string, variables: Record<string, string>): string =>
  renderTemplate(templateOf(name), variables);

/** Ligne « Motif » composée avant le rendu : le motif passe par l'échappement de `renderTemplate`. */
const cancelledTemplate = (withReason: boolean): string =>
  templateOf('booking-cancelled.html').replace(
    '{{reasonRow}}',
    withReason ? templateOf('booking-cancelled-reason.html').trim() : '',
  );
