import type { ErrorEvent } from '@sentry/nestjs';
import { SENSITIVE_BODY_FIELDS } from './log-redact';
import { sentryBeforeSend } from './sentry-before-send';

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
