import type { ErrorEvent } from '@sentry/nestjs';
import { SENSITIVE_BODY_FIELDS } from './log-redact';
import {
  isUntracedIncomingRequest,
  sentryBeforeSend,
} from './sentry-before-send';

const FEED_TOKEN = 'XYJXH9MoGdppkZYT0jI3g2rP-qFcqKBWL0budyMj488';
const API_ORIGIN = 'https://api.nedellec-julien.fr';
const feedEvent = (): ErrorEvent => ({
  type: undefined,
  transaction: `GET /api/booking/feed/${FEED_TOKEN}.ics`,
  request: {
    url: `${API_ORIGIN}/api/booking/feed/${FEED_TOKEN}.ics?x=1`,
    method: 'GET',
    query_string: 'x=1',
  },
});

const BOOKING_BODY = {
  startsAt: '2026-11-04T10:00:00.000Z',
  format: 'phone',
  name: 'Camille Martin',
  email: 'camille@example.com',
  phone: '+33 6 12 34 56 78',
  company: 'Société Exemple',
  message: 'Refonte de notre application Angular.',
  website: 'https://spam.test',
  token: 'secret-cancel-token',
};

const PERSONAL_VALUES = [
  BOOKING_BODY.name,
  BOOKING_BODY.email,
  BOOKING_BODY.phone,
  BOOKING_BODY.company,
  BOOKING_BODY.message,
  BOOKING_BODY.website,
  BOOKING_BODY.token,
];

const eventWithData = (data: unknown): ErrorEvent => ({
  type: undefined,
  request: { url: '/api/booking/bookings', method: 'POST', data },
});

describe('sentryBeforeSend', () => {
  it.each([
    'name',
    'email',
    'phone',
    'company',
    'message',
    'token',
    'website',
    'password',
    'newPassword',
    'currentPassword',
    'code',
    'refreshToken',
    'jwt',
  ])('la liste partagée des champs sensibles contient %s', (field) => {
    expect(SENSITIVE_BODY_FIELDS).toContain(field);
  });

  it('Given un corps objet porteur de données personnelles, Then chaque champ sensible est filtré et les autres restent lisibles', () => {
    const result = sentryBeforeSend(eventWithData({ ...BOOKING_BODY }));

    expect(result.request?.data).toEqual({
      startsAt: BOOKING_BODY.startsAt,
      format: 'phone',
      name: '[Filtered]',
      email: '[Filtered]',
      phone: '[Filtered]',
      company: '[Filtered]',
      message: '[Filtered]',
      website: '[Filtered]',
      token: '[Filtered]',
    });
  });

  it('Given un corps objet imbriqué, Then les champs sensibles sont filtrés à toute profondeur', () => {
    const result = sentryBeforeSend(
      eventWithData({
        contact: { email: 'camille@example.com' },
        items: [{ phone: '0612345678' }],
      }),
    );

    expect(result.request?.data).toEqual({
      contact: { email: '[Filtered]' },
      items: [{ phone: '[Filtered]' }],
    });
  });

  it('Given un corps en chaîne JSON, Then il reste une chaîne JSON, champs sensibles filtrés', () => {
    const result = sentryBeforeSend(
      eventWithData(JSON.stringify(BOOKING_BODY)),
    );

    const data = result.request?.data;
    expect(typeof data).toBe('string');
    for (const value of PERSONAL_VALUES) {
      expect(data).not.toContain(value);
    }
    expect(JSON.parse(data as string)).toEqual(
      expect.objectContaining({ format: 'phone', email: '[Filtered]' }),
    );
  });

  it('Given un corps en chaîne non JSON, Then il est filtré en entier', () => {
    const result = sentryBeforeSend(
      eventWithData(
        'name=Camille&email=camille%40example.com&phone=0612345678',
      ),
    );

    expect(result.request?.data).toBe('[Filtered]');
  });

  it('Given un événement sans requête, Then il est rendu tel quel', () => {
    const event: ErrorEvent = { type: undefined, message: 'boom' };

    expect(sentryBeforeSend(event)).toEqual({
      type: undefined,
      message: 'boom',
    });
  });

  it('Given une requête avec cookies et en-têtes d’authentification, Then ils sont retirés, les autres en-têtes gardés', () => {
    const result = sentryBeforeSend({
      type: undefined,
      request: {
        cookies: { session: 'secret-cookie' },
        headers: {
          authorization: 'Bearer secret-jwt',
          cookie: 'session=secret-cookie',
          'user-agent': 'jest',
        },
      },
    });

    expect(result.request?.cookies).toBeUndefined();
    expect(result.request?.headers).toEqual({ 'user-agent': 'jest' });
  });

  it('Given un événement, Then l’original n’est pas modifié', () => {
    const event = eventWithData({ ...BOOKING_BODY });

    sentryBeforeSend(event);

    expect(event.request?.data).toEqual(BOOKING_BODY);
  });
});

describe('sentryBeforeSend sur le flux d’agenda', () => {
  it('Given une requête du flux, Then request.url absolue est masquée après le préfixe du flux', () => {
    const result = sentryBeforeSend(feedEvent());

    expect(result.request?.url).toBe(
      `${API_ORIGIN}/api/booking/feed/[Filtered]`,
    );
  });

  it('Given une requête du flux, Then query_string est retirée', () => {
    const result = sentryBeforeSend(feedEvent());

    expect(result.request).not.toHaveProperty('query_string');
  });

  it('Given une requête du flux, Then la transaction est masquée', () => {
    const result = sentryBeforeSend(feedEvent());

    expect(result.transaction).toBe('GET /api/booking/feed/[Filtered]');
  });

  it('Given une requête du flux, Then le jeton n’apparaît nulle part dans l’événement', () => {
    expect(JSON.stringify(sentryBeforeSend(feedEvent()))).not.toContain(
      FEED_TOKEN,
    );
  });

  it('Given un événement sans requête dont la transaction vise le flux, Then la transaction est masquée', () => {
    const result = sentryBeforeSend({
      type: undefined,
      transaction: `GET /api/booking/feed/${FEED_TOKEN}.ics`,
    });

    expect(result.transaction).toBe('GET /api/booking/feed/[Filtered]');
  });

  it('Given une autre route, Then URL, query_string et transaction restent lisibles', () => {
    const result = sentryBeforeSend({
      type: undefined,
      transaction: 'GET /api/booking/slots',
      request: {
        url: `${API_ORIGIN}/api/booking/slots?from=2026-10-01`,
        method: 'GET',
        query_string: 'from=2026-10-01',
      },
    });

    expect(result.transaction).toBe('GET /api/booking/slots');
    expect(result.request?.url).toBe(
      `${API_ORIGIN}/api/booking/slots?from=2026-10-01`,
    );
    expect(result.request?.query_string).toBe('from=2026-10-01');
  });

  it('Given un événement du flux, Then l’original n’est pas modifié', () => {
    const event = feedEvent();

    sentryBeforeSend(event);

    expect(event).toEqual(feedEvent());
  });
});

describe('isUntracedIncomingRequest', () => {
  it.each([
    ['/api/health', true],
    [`/api/booking/feed/${FEED_TOKEN}.ics`, true],
    [`/api/booking/feed/${FEED_TOKEN}.ics?x=1`, true],
    ['/api/booking/feed/x', true],
    ['/api/booking/slots', false],
    ['/api/booking/feed-subscription', false],
  ])('Given %s, Then %s', (url, untraced) => {
    expect(isUntracedIncomingRequest(url)).toBe(untraced);
  });
});
