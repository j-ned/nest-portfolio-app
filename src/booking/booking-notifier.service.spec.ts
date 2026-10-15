import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppConfigService } from '../config/app-config.service';
import { MailerService } from '../mailer/mailer.service';
import { BookingNotifier } from './booking-notifier.service';
import { aBooking } from './booking-test-builders';

type SentMail = {
  to: string;
  subject: string;
  html: string;
  icalEvent?: { method: string; content: string };
};

const OWNER = 'contact@nedellec-julien.fr';
const TOKEN = 'Qm9va2luZ0NhbmNlbFRva2VuX0Zvcl9UZXN0c18wMTI';
const VIDEO_URL = 'https://meet.jit.si/nedellec-abcdefgh12345678';

const VIDEO_BOOKING = aBooking({
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  startsAt: new Date('2026-11-04T10:00:00Z'),
  endsAt: new Date('2026-11-04T10:30:00Z'),
  name: 'Camille Martin',
  email: 'camille@example.com',
  company: 'Société Exemple',
  message: 'Refonte de notre application Angular.',
  format: 'video',
  videoUrl: VIDEO_URL,
});
const PHONE_BOOKING = aBooking({
  ...VIDEO_BOOKING,
  format: 'phone',
  videoUrl: null,
  phone: '+33 6 12 34 56 78',
});
const CANCELLED_BY_VISITOR = aBooking({
  ...VIDEO_BOOKING,
  status: 'cancelled',
  cancelledAt: new Date('2026-11-02T08:00:00Z'),
  cancelledBy: 'visitor',
});

const CANCELLED_BY_OWNER = aBooking({
  ...CANCELLED_BY_VISITOR,
  cancelledBy: 'owner',
  cancelReason: 'Un imprévu de mon côté.',
});

const MANUAL_CALENDAR_NOTE =
  'Si votre agenda avait enregistré l’invitation, le rendez-vous en est retiré ; si vous l’y aviez ajouté à la main, supprimez-le.';

const introOf = (html: string | undefined): string | undefined =>
  /<p class="muted"[^>]*>([^<]*)<\/p>/.exec(html ?? '')?.[1];

const unfold = (ics: string): string => ics.replace(/\r\n[ \t]/g, '');
const icsLines = (mail: SentMail | undefined): string[] =>
  unfold(mail?.icalEvent?.content ?? '').split('\r\n');

describe('BookingNotifier', () => {
  let notifier: BookingNotifier;
  let mailer: { sendMail: jest.Mock };
  let config: { publicSiteUrl: string };
  let logged: jest.SpyInstance[];

  const sent = (): SentMail[] =>
    (mailer.sendMail.mock.calls as [SentMail][]).map(([mail]) => mail);
  const mailTo = (to: string): SentMail | undefined =>
    sent().find((mail) => mail.to === to);
  const loggedText = (): string =>
    logged
      .flatMap((spy) => spy.mock.calls as unknown[][])
      .map((args) => JSON.stringify(args))
      .join('\n');

  beforeEach(async () => {
    mailer = { sendMail: jest.fn().mockResolvedValue(undefined) };
    config = { publicSiteUrl: 'https://nedellec-julien.fr' };
    const module = await Test.createTestingModule({
      providers: [
        BookingNotifier,
        { provide: MailerService, useValue: mailer },
        { provide: AppConfigService, useValue: config },
      ],
    }).compile();
    notifier = module.get(BookingNotifier);
    logged = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
      (level) =>
        jest.spyOn(Logger.prototype, level).mockImplementation(() => {}),
    );
    jest.useFakeTimers().setSystemTime(new Date('2026-11-02T08:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('bookingConfirmed', () => {
    it('Given une réservation, Then deux emails : le visiteur et le propriétaire', async () => {
      await notifier.bookingConfirmed(VIDEO_BOOKING, TOKEN);

      expect(
        sent()
          .map((mail) => mail.to)
          .sort(),
      ).toEqual(['camille@example.com', OWNER]);
    });

    it.each([
      [
        'heure d’hiver',
        '2026-11-04T10:00:00Z',
        'mercredi 4 novembre 2026 à 11:00',
      ],
      ['heure d’été', '2026-10-19T07:00:00Z', 'lundi 19 octobre 2026 à 09:00'],
    ])(
      'Given un rendez-vous en %s, Then les deux emails datent le rendez-vous en français à l’heure de Paris',
      async (_case, startsAt, label) => {
        const start = new Date(startsAt);
        await notifier.bookingConfirmed(
          aBooking({
            ...VIDEO_BOOKING,
            startsAt: start,
            endsAt: new Date(start.getTime() + 30 * 60_000),
          }),
          TOKEN,
        );

        for (const to of ['camille@example.com', OWNER]) {
          expect(mailTo(to)?.subject).toContain(label);
          expect(mailTo(to)?.html).toContain(label);
        }
      },
    );

    it('Given une réservation, Then le visiteur reçoit le lien d’annulation avec le jeton dans le fragment', async () => {
      await notifier.bookingConfirmed(VIDEO_BOOKING, TOKEN);

      expect(mailTo('camille@example.com')?.html).toContain(
        `https://nedellec-julien.fr/rendez-vous/annulation#${TOKEN}`,
      );
    });

    it('Given une origine publique configurée avec barre finale, Then le lien d’annulation ne la double pas', async () => {
      config.publicSiteUrl = 'https://site.example.test/';

      await notifier.bookingConfirmed(VIDEO_BOOKING, TOKEN);

      expect(mailTo('camille@example.com')?.html).toContain(
        `https://site.example.test/rendez-vous/annulation#${TOKEN}`,
      );
    });

    it('Given une réservation, Then le jeton n’est ni dans l’email du propriétaire, ni dans aucune invitation, ni dans les logs', async () => {
      await notifier.bookingConfirmed(VIDEO_BOOKING, TOKEN);

      expect(mailTo(OWNER)?.html).not.toContain(TOKEN);
      expect(mailTo(OWNER)?.subject).not.toContain(TOKEN);
      for (const mail of sent()) {
        expect(mail.icalEvent?.content).not.toContain(TOKEN);
      }
      expect(loggedText()).not.toContain(TOKEN);
    });

    it('Given un envoi qui échoue, Then l’échec remonte à l’appelant sans que le jeton soit journalisé', async () => {
      const failure = new Error('SMTP down');
      mailer.sendMail.mockRejectedValue(failure);

      await expect(
        notifier.bookingConfirmed(VIDEO_BOOKING, TOKEN),
      ).rejects.toBe(failure);
      expect(loggedText()).not.toContain(TOKEN);
    });

    it('Given une réservation en visio, Then le lien de visio figure dans les deux emails et en LOCATION des invitations', async () => {
      await notifier.bookingConfirmed(VIDEO_BOOKING, TOKEN);

      for (const to of ['camille@example.com', OWNER]) {
        expect(mailTo(to)?.html).toContain(VIDEO_URL);
        expect(icsLines(mailTo(to))).toContain(`LOCATION:${VIDEO_URL}`);
      }
    });

    it('Given une réservation par téléphone, Then le numéro figure dans les deux emails et en LOCATION, sans lien de visio', async () => {
      await notifier.bookingConfirmed(PHONE_BOOKING, TOKEN);

      for (const to of ['camille@example.com', OWNER]) {
        const mail = mailTo(to);
        expect(mail?.html).toContain('+33 6 12 34 56 78');
        expect(mail?.html).not.toContain('meet.jit.si');
        const location = icsLines(mail).find((line) =>
          line.startsWith('LOCATION:'),
        );
        expect(location).toContain('+33 6 12 34 56 78');
      }
    });

    it('Given une réservation, Then le propriétaire reçoit les coordonnées et le message du visiteur', async () => {
      await notifier.bookingConfirmed(PHONE_BOOKING, TOKEN);

      const html = mailTo(OWNER)?.html ?? '';
      for (const value of [
        'Camille Martin',
        'camille@example.com',
        '+33 6 12 34 56 78',
        'Société Exemple',
        'Refonte de notre application Angular.',
      ]) {
        expect(html).toContain(value);
      }
    });

    it('Given des saisies contenant du HTML, Then elles sont échappées dans les deux emails', async () => {
      await notifier.bookingConfirmed(
        aBooking({
          ...VIDEO_BOOKING,
          name: 'Camille <b>Martin</b>',
          company: '<img src=x onerror=alert(1)>',
          message: '<a href="https://evil.test">cliquez</a>',
        }),
        TOKEN,
      );

      for (const mail of sent()) {
        expect(mail.html).not.toContain('<b>Martin</b>');
        expect(mail.html).not.toContain('<img src=x');
        expect(mail.html).not.toContain('<a href="https://evil.test">');
      }
      expect(mailTo(OWNER)?.html).toContain(
        'Camille &lt;b&gt;Martin&lt;/b&gt;',
      );
      expect(mailTo(OWNER)?.html).toContain(
        '&lt;a href=&quot;https://evil.test&quot;&gt;cliquez&lt;/a&gt;',
      );
    });

    it('Given une réservation, Then le visiteur reçoit une invitation REQUEST, SEQUENCE 0, UID = id, horaires UTC, organisateur et participant', async () => {
      await notifier.bookingConfirmed(VIDEO_BOOKING, TOKEN);

      const mail = mailTo('camille@example.com');
      expect(mail?.icalEvent?.method).toBe('REQUEST');
      const lines = icsLines(mail);
      expect(lines).toEqual(
        expect.arrayContaining([
          'METHOD:REQUEST',
          'SEQUENCE:0',
          'UID:dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          'DTSTAMP:20261102T080000Z',
          'DTSTART:20261104T100000Z',
          'DTEND:20261104T103000Z',
        ]),
      );
      const organizer = lines.find((line) => line.startsWith('ORGANIZER'));
      const attendee = lines.find((line) => line.startsWith('ATTENDEE'));
      expect(organizer?.endsWith(`:mailto:${OWNER}`)).toBe(true);
      expect(attendee).toContain('CN=Camille Martin');
      expect(attendee?.endsWith(':mailto:camille@example.com')).toBe(true);
      expect(lines.find((line) => line.startsWith('SUMMARY:'))).toContain(
        'Appel de cadrage',
      );
    });

    it('Given une réservation, Then le propriétaire reçoit l’événement publié : PUBLISH, même UID et horaires, organisateur, sans participant ni RSVP', async () => {
      await notifier.bookingConfirmed(VIDEO_BOOKING, TOKEN);

      const mail = mailTo(OWNER);
      expect(mail?.icalEvent?.method).toBe('PUBLISH');
      const lines = icsLines(mail);
      expect(lines).toEqual(
        expect.arrayContaining([
          'METHOD:PUBLISH',
          'SEQUENCE:0',
          'STATUS:CONFIRMED',
          'UID:dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          'DTSTART:20261104T100000Z',
          'DTEND:20261104T103000Z',
          `LOCATION:${VIDEO_URL}`,
        ]),
      );
      expect(
        lines
          .find((line) => line.startsWith('ORGANIZER'))
          ?.endsWith(`:mailto:${OWNER}`),
      ).toBe(true);
      expect(lines.filter((line) => line.startsWith('ATTENDEE'))).toEqual([]);
      expect(lines.join('\n')).not.toContain('RSVP');
    });
  });

  describe('bookingCancelled', () => {
    it('Given une annulation par le visiteur, Then le visiteur et le propriétaire sont prévenus, date de Paris en français', async () => {
      await notifier.bookingCancelled(CANCELLED_BY_VISITOR);

      expect(
        sent()
          .map((mail) => mail.to)
          .sort(),
      ).toEqual(['camille@example.com', OWNER]);
      for (const mail of sent()) {
        expect(mail.subject).toContain('mercredi 4 novembre 2026 à 11:00');
        expect(mail.html).toContain('mercredi 4 novembre 2026 à 11:00');
      }
      expect(mailTo(OWNER)?.html).toContain('Camille Martin');
    });

    it('Given une annulation, Then chaque email porte une invitation CANCEL, SEQUENCE 1, STATUS CANCELLED, même UID et mêmes horaires', async () => {
      await notifier.bookingCancelled(CANCELLED_BY_VISITOR);

      for (const mail of sent()) {
        expect(mail.icalEvent?.method).toBe('CANCEL');
        expect(icsLines(mail)).toEqual(
          expect.arrayContaining([
            'METHOD:CANCEL',
            'SEQUENCE:1',
            'STATUS:CANCELLED',
            'UID:dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            'DTSTART:20261104T100000Z',
            'DTEND:20261104T103000Z',
          ]),
        );
      }
    });

    it.each([
      ['le visiteur', CANCELLED_BY_VISITOR],
      ['le propriétaire', CANCELLED_BY_OWNER],
    ])(
      'Given une annulation par %s, Then le visiteur reçoit un CANCEL qui le nomme en ATTENDEE',
      async (_case, row) => {
        await notifier.bookingCancelled(row);

        const mail = mailTo('camille@example.com');
        expect(mail?.icalEvent?.method).toBe('CANCEL');
        const attendees = icsLines(mail).filter((line) =>
          line.startsWith('ATTENDEE'),
        );
        expect(attendees).toHaveLength(1);
        expect(attendees[0].endsWith(':mailto:camille@example.com')).toBe(true);
      },
    );

    it.each([
      ['le visiteur', CANCELLED_BY_VISITOR],
      ['le propriétaire', CANCELLED_BY_OWNER],
    ])(
      'Given une annulation par %s, Then le propriétaire reçoit le retrait de l’événement publié : CANCEL du même UID, SEQUENCE supérieure, sans participant ni RSVP',
      async (_case, row) => {
        await notifier.bookingConfirmed(VIDEO_BOOKING, TOKEN);
        const published = icsLines(mailTo(OWNER));
        mailer.sendMail.mockClear();

        await notifier.bookingCancelled(row);

        const mail = mailTo(OWNER);
        expect(mail?.icalEvent?.method).toBe('CANCEL');
        const lines = icsLines(mail);
        expect(lines).toEqual(
          expect.arrayContaining(['METHOD:CANCEL', 'STATUS:CANCELLED']),
        );
        const uidOf = (ics: string[]) =>
          ics.find((line) => line.startsWith('UID:'));
        const sequenceOf = (ics: string[]) =>
          Number(ics.find((line) => line.startsWith('SEQUENCE:'))?.slice(9));
        expect(uidOf(lines)).toBe(uidOf(published));
        expect(published).toContain('METHOD:PUBLISH');
        expect(sequenceOf(lines)).toBeGreaterThan(sequenceOf(published));
        expect(
          lines
            .find((line) => line.startsWith('ORGANIZER'))
            ?.endsWith(`:mailto:${OWNER}`),
        ).toBe(true);
        expect(lines.filter((line) => line.startsWith('ATTENDEE'))).toEqual([]);
        expect(lines.join('\n')).not.toContain('RSVP');
      },
    );

    it('Given une annulation, Then aucun email ne contient de lien d’annulation', async () => {
      await notifier.bookingCancelled(CANCELLED_BY_VISITOR);

      for (const mail of sent()) {
        expect(mail.html).not.toContain('/rendez-vous/annulation');
      }
    });

    it('Given un nom contenant du HTML, Then il est échappé dans l’email du propriétaire', async () => {
      await notifier.bookingCancelled(
        aBooking({ ...CANCELLED_BY_VISITOR, name: 'Camille <b>Martin</b>' }),
      );

      expect(mailTo(OWNER)?.html).not.toContain('<b>Martin</b>');
      expect(mailTo(OWNER)?.html).toContain(
        'Camille &lt;b&gt;Martin&lt;/b&gt;',
      );
    });
  });
  describe('bookingCancelled par le propriétaire', () => {
    const htmlOf = async (row: ReturnType<typeof aBooking>, to: string) => {
      mailer.sendMail.mockClear();
      await notifier.bookingCancelled(row);
      return mailTo(to)?.html ?? '';
    };

    it('Given une annulation par le propriétaire, Then le visiteur et le propriétaire reçoivent chacun une invitation CANCEL du même UID', async () => {
      await notifier.bookingCancelled(CANCELLED_BY_OWNER);

      expect(
        sent()
          .map((mail) => mail.to)
          .sort(),
      ).toEqual(['camille@example.com', OWNER]);
      for (const mail of sent()) {
        expect(mail.icalEvent?.method).toBe('CANCEL');
        expect(icsLines(mail)).toEqual(
          expect.arrayContaining([
            'METHOD:CANCEL',
            'SEQUENCE:1',
            'STATUS:CANCELLED',
            'UID:dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          ]),
        );
        expect(mail.subject).toContain('mercredi 4 novembre 2026 à 11:00');
      }
    });

    it('Given un motif, Then il figure dans l’email du visiteur et dans celui du propriétaire', async () => {
      await notifier.bookingCancelled(CANCELLED_BY_OWNER);

      for (const to of ['camille@example.com', OWNER]) {
        expect(mailTo(to)?.html).toContain('Motif');
        expect(mailTo(to)?.html).toContain('Un imprévu de mon côté.');
      }
    });

    it('Given un motif contenant du HTML, Then il est échappé dans les deux emails', async () => {
      await notifier.bookingCancelled(
        aBooking({
          ...CANCELLED_BY_OWNER,
          cancelReason: '<a href="https://evil.test">urgent</a>',
        }),
      );

      for (const mail of sent()) {
        expect(mail.html).not.toContain('<a href="https://evil.test">');
        expect(mail.html).toContain(
          '&lt;a href=&quot;https://evil.test&quot;&gt;urgent&lt;/a&gt;',
        );
      }
    });

    it('Given une annulation par le propriétaire sans motif, Then aucun email ne parle de motif', async () => {
      await notifier.bookingCancelled(
        aBooking({ ...CANCELLED_BY_OWNER, cancelReason: null }),
      );

      for (const mail of sent()) {
        expect(mail.html).not.toContain('Motif');
      }
    });

    it('Given une annulation par le visiteur, Then aucun email ne parle de motif', async () => {
      await notifier.bookingCancelled(CANCELLED_BY_VISITOR);

      for (const mail of sent()) {
        expect(mail.html).not.toContain('Motif');
      }
    });

    it.each(['camille@example.com', OWNER])(
      'Given la même annulation sans motif par l’une ou l’autre partie, Then l’email à %s n’est pas rédigé de la même façon',
      async (to) => {
        const byVisitor = await htmlOf(CANCELLED_BY_VISITOR, to);
        const byOwner = await htmlOf(
          aBooking({ ...CANCELLED_BY_OWNER, cancelReason: null }),
          to,
        );

        expect(byOwner).not.toBe('');
        expect(byOwner).not.toEqual(byVisitor);
      },
    );

    it('Given une annulation par le propriétaire, Then son email ne l’attribue pas au visiteur', async () => {
      await notifier.bookingCancelled(CANCELLED_BY_OWNER);

      expect(mailTo(OWNER)?.html).not.toContain('a annulé son rendez-vous');
      expect(mailTo(OWNER)?.html).toContain('Camille Martin');
    });

    it('Given une annulation par le propriétaire, Then aucun email ne contient de lien d’annulation', async () => {
      await notifier.bookingCancelled(CANCELLED_BY_OWNER);

      for (const mail of sent()) {
        expect(mail.html).not.toContain('/rendez-vous/annulation');
      }
    });
  });

  describe('bookingCancelled, introductions', () => {
    it.each([
      [
        'le visiteur',
        CANCELLED_BY_VISITOR,
        `Votre rendez-vous est bien annulé. ${MANUAL_CALENDAR_NOTE}`,
      ],
      [
        'le propriétaire',
        CANCELLED_BY_OWNER,
        `Je dois malheureusement annuler notre rendez-vous. ${MANUAL_CALENDAR_NOTE} Vous pouvez réserver un autre créneau sur https://nedellec-julien.fr/rendez-vous.`,
      ],
    ])(
      'Given une annulation par %s, Then l’introduction du visiteur lui dit de supprimer une copie ajoutée à la main',
      async (_case, row, intro) => {
        await notifier.bookingCancelled(row);

        expect(introOf(mailTo('camille@example.com')?.html)).toBe(intro);
      },
    );

    it.each([
      [
        'le visiteur',
        CANCELLED_BY_VISITOR,
        'Camille Martin (camille@example.com) a annulé son rendez-vous.',
      ],
      [
        'le propriétaire',
        CANCELLED_BY_OWNER,
        'Vous avez annulé le rendez-vous de Camille Martin (camille@example.com) ; un email d’annulation lui a été envoyé.',
      ],
    ])(
      'Given une annulation par %s, Then l’introduction du propriétaire est inchangée',
      async (_case, row, intro) => {
        await notifier.bookingCancelled(row);

        expect(introOf(mailTo(OWNER)?.html)).toBe(intro);
      },
    );
  });

  describe('bookingReminder', () => {
    const REMINDED = aBooking({
      ...VIDEO_BOOKING,
      reminderSentAt: new Date('2026-11-03T10:00:00Z'),
    });

    it('Given un rendez-vous à rappeler, Then un seul email part, au visiteur', async () => {
      await notifier.bookingReminder(REMINDED);

      expect(sent().map((mail) => mail.to)).toEqual(['camille@example.com']);
    });

    it.each([
      [
        'heure d’hiver',
        '2026-11-04T10:00:00Z',
        'mercredi 4 novembre 2026 à 11:00',
      ],
      ['heure d’été', '2026-10-19T07:00:00Z', 'lundi 19 octobre 2026 à 09:00'],
    ])(
      'Given un rendez-vous en %s, Then le rappel le date en français à l’heure de Paris',
      async (_case, startsAt, label) => {
        const start = new Date(startsAt);
        await notifier.bookingReminder(
          aBooking({
            ...REMINDED,
            startsAt: start,
            endsAt: new Date(start.getTime() + 30 * 60_000),
          }),
        );

        expect(sent()[0]?.subject).toContain(label);
        expect(sent()[0]?.html).toContain(label);
      },
    );

    it('Given un rendez-vous en visio, Then le rappel donne le lien de visio', async () => {
      await notifier.bookingReminder(REMINDED);

      expect(sent()[0]?.html).toContain(VIDEO_URL);
    });

    it('Given un rendez-vous par téléphone, Then le rappel donne le numéro, sans lien de visio', async () => {
      await notifier.bookingReminder(
        aBooking({ ...PHONE_BOOKING, reminderSentAt: REMINDED.reminderSentAt }),
      );

      expect(sent()[0]?.html).toContain('+33 6 12 34 56 78');
      expect(sent()[0]?.html).not.toContain('meet.jit.si');
    });

    it('Given un rendez-vous à rappeler, Then le rappel ne contient ni lien d’annulation ni l’empreinte du jeton', async () => {
      await notifier.bookingReminder(REMINDED);

      const mail = sent()[0];
      expect(mail?.html).not.toContain('/rendez-vous/annulation');
      for (const text of [
        mail?.html,
        mail?.subject,
        mail?.icalEvent?.content,
      ]) {
        expect(text ?? '').not.toContain(REMINDED.cancelTokenHash);
      }
    });

    it('Given un nom contenant du HTML, Then il est échappé dans le rappel', async () => {
      await notifier.bookingReminder(
        aBooking({ ...REMINDED, name: 'Camille <b>Martin</b>' }),
      );

      expect(sent()[0]?.html).not.toContain('<b>Martin</b>');
      expect(sent()[0]?.html).toContain('Camille &lt;b&gt;Martin&lt;/b&gt;');
    });

    it('Given un envoi qui échoue, Then l’échec remonte à l’appelant', async () => {
      const failure = new Error('SMTP down');
      mailer.sendMail.mockRejectedValue(failure);

      await expect(notifier.bookingReminder(REMINDED)).rejects.toBe(failure);
    });
  });
});
