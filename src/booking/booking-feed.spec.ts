import type { AppConfigService } from '../config/app-config.service';
import type { MailerService } from '../mailer/mailer.service';
import { BOOKING_FEED, parseFeedFile, toFeedEvent } from './booking-feed';
import { BookingNotifier } from './booking-notifier.service';
import { aBooking } from './booking-test-builders';
import { toIcsFeed } from './to-ics';

const TOKEN = 'XYJXH9MoGdppkZYT0jI3g2rP-qFcqKBWL0budyMj488';
const SITE_URL = 'https://nedellec-julien.fr';
const VIDEO_URL = 'https://meet.jit.si/nedellec-abcdefgh12345678';

const VIDEO_WITH_PHONE_AND_COMPANY = aBooking({
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  startsAt: new Date('2026-11-04T10:00:00Z'),
  endsAt: new Date('2026-11-04T10:30:00Z'),
  createdAt: new Date('2026-10-20T07:15:00Z'),
  name: 'Marie Dupont',
  email: 'marie@example.com',
  phone: '+33 6 12 34 56 78',
  company: 'Société Exemple',
  message: 'Refonte de notre application Angular.',
  format: 'video',
  videoUrl: VIDEO_URL,
});
const PHONE_WITHOUT_COMPANY = aBooking({
  ...VIDEO_WITH_PHONE_AND_COMPANY,
  format: 'phone',
  videoUrl: null,
  company: null,
});
const VIDEO_WITHOUT_PHONE = aBooking({
  ...VIDEO_WITH_PHONE_AND_COMPANY,
  phone: null,
  company: null,
});

const unfold = (ics: string): string => ics.replace(/\r\n[ \t]/g, '');
const feedLine = (ics: string, name: string): string | undefined =>
  unfold(ics)
    .split('\r\n')
    .find((line) => line.startsWith(name));
const feedOf = (...events: ReturnType<typeof toFeedEvent>[]): string =>
  toIcsFeed({
    name: BOOKING_FEED.calendarName,
    refreshMinutes: BOOKING_FEED.refreshMinutes,
    events,
  });

describe('BOOKING_FEED', () => {
  it('Given le flux, Then un nom de calendrier et un rafraîchissement de 15 minutes', () => {
    expect(BOOKING_FEED).toEqual({
      refreshMinutes: 15,
      calendarName: 'Rendez-vous nedellec-julien.fr',
    });
  });
});

describe('parseFeedFile', () => {
  it('Given 43 caractères base64url suivis de .ics, Then le jeton', () => {
    expect(parseFeedFile(`${TOKEN}.ics`)).toBe(TOKEN);
  });

  it.each([
    ['42 caractères', `${TOKEN.slice(0, 42)}.ics`],
    ['44 caractères', `${TOKEN}A.ics`],
    ['un suffixe en majuscules', `${TOKEN}.ICS`],
    ['aucun suffixe', TOKEN],
    ['un +', `+${TOKEN.slice(1)}.ics`],
    ['un /', `/${TOKEN.slice(1)}.ics`],
    ['un =', `${TOKEN.slice(0, 42)}=.ics`],
    ['une chaîne vide', ''],
    ['un double suffixe', `${TOKEN}.ics.ics`],
    ['un préfixe de chemin', `x/${TOKEN}.ics`],
  ])('Given %s, Then null', (_case, file) => {
    expect(parseFeedFile(file)).toBeNull();
  });
});

describe('toFeedEvent', () => {
  it('Given une visio avec téléphone et société, Then l’événement complet : UID du rendez-vous, horodatage de création, toutes les lignes de contact', () => {
    expect(toFeedEvent(VIDEO_WITH_PHONE_AND_COMPANY, SITE_URL)).toEqual({
      uid: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      stamp: new Date('2026-10-20T07:15:00Z'),
      startsAt: new Date('2026-11-04T10:00:00Z'),
      endsAt: new Date('2026-11-04T10:30:00Z'),
      summary: 'Appel de cadrage · Marie Dupont',
      description: [
        'Appel de cadrage de 30 minutes avec Marie Dupont.',
        `Lien de visio : ${VIDEO_URL}`,
        'Email : marie@example.com',
        'Téléphone : +33 6 12 34 56 78',
        'Société : Société Exemple',
        'Message :',
        'Refonte de notre application Angular.',
        'Gérer : https://nedellec-julien.fr/admin/rendez-vous',
      ].join('\n'),
      location: VIDEO_URL,
    });
  });

  it('Given un rendez-vous par téléphone sans société, Then une seule ligne de téléphone et aucune ligne Société', () => {
    expect(toFeedEvent(PHONE_WITHOUT_COMPANY, SITE_URL).description).toBe(
      [
        'Appel de cadrage de 30 minutes avec Marie Dupont.',
        'Téléphone : +33 6 12 34 56 78',
        'Email : marie@example.com',
        'Message :',
        'Refonte de notre application Angular.',
        'Gérer : https://nedellec-julien.fr/admin/rendez-vous',
      ].join('\n'),
    );
  });

  it('Given une visio sans téléphone ni société, Then ni ligne Téléphone ni ligne Société', () => {
    expect(toFeedEvent(VIDEO_WITHOUT_PHONE, SITE_URL).description).toBe(
      [
        'Appel de cadrage de 30 minutes avec Marie Dupont.',
        `Lien de visio : ${VIDEO_URL}`,
        'Email : marie@example.com',
        'Message :',
        'Refonte de notre application Angular.',
        'Gérer : https://nedellec-julien.fr/admin/rendez-vous',
      ].join('\n'),
    );
  });

  it('Given un message sur trois lignes, Then la description du flux le porte échappé en \\n', () => {
    const row = aBooking({
      ...VIDEO_WITHOUT_PHONE,
      message: 'Ligne 1\nLigne 2\nLigne 3',
    });

    expect(feedLine(feedOf(toFeedEvent(row, SITE_URL)), 'DESCRIPTION:')).toBe(
      `DESCRIPTION:Appel de cadrage de 30 minutes avec Marie Dupont.\\nLien de visio : ${VIDEO_URL}\\nEmail : marie@example.com\\nMessage :\\nLigne 1\\nLigne 2\\nLigne 3\\nGérer : https://nedellec-julien.fr/admin/rendez-vous`,
    );
  });

  describe('horodatage stable', () => {
    afterEach(() => jest.useRealTimers());

    it('Given deux rendus à une minute d’écart, Then le même flux à l’octet', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-11-02T08:00:00Z'));
      const first = feedOf(toFeedEvent(VIDEO_WITH_PHONE_AND_COMPANY, SITE_URL));
      jest.setSystemTime(new Date('2026-11-02T08:01:00Z'));
      const second = feedOf(
        toFeedEvent(VIDEO_WITH_PHONE_AND_COMPANY, SITE_URL),
      );

      expect(second).toBe(first);
      expect(feedLine(first, 'DTSTAMP:')).toBe('DTSTAMP:20261020T071500Z');
    });
  });

  describe('lieu aligné sur l’invitation', () => {
    const invitationLocation = async (
      row: typeof VIDEO_WITH_PHONE_AND_COMPANY,
    ): Promise<string | undefined> => {
      const mailer = { sendMail: jest.fn().mockResolvedValue(undefined) };
      const notifier = new BookingNotifier(
        mailer as unknown as MailerService,
        { publicSiteUrl: SITE_URL } as AppConfigService,
      );
      await notifier.bookingConfirmed(row, TOKEN);
      const [[ownerMail]] = (
        mailer.sendMail.mock.calls as [{ icalEvent: { content: string } }][]
      ).filter(([mail]) => mail.icalEvent !== undefined);
      return feedLine(ownerMail.icalEvent.content, 'LOCATION:');
    };

    it.each([
      ['en visio', VIDEO_WITH_PHONE_AND_COMPANY],
      ['par téléphone', PHONE_WITHOUT_COMPANY],
    ])(
      'Given un rendez-vous %s, Then la ligne LOCATION du flux est celle de l’invitation',
      async (_case, row) => {
        const expected = await invitationLocation(row);

        expect(expected).toMatch(/^LOCATION:.+/);
        expect(feedLine(feedOf(toFeedEvent(row, SITE_URL)), 'LOCATION:')).toBe(
          expected,
        );
      },
    );
  });
});
