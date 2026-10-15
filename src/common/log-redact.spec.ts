import pino from 'pino';
import {
  LOG_REDACT_PATHS,
  SENSITIVE_BODY_FIELDS,
  redactUrl,
  serializeRequest,
} from './log-redact';

const FEED_TOKEN = 'XYJXH9MoGdppkZYT0jI3g2rP-qFcqKBWL0budyMj488';
const FEED_URL = `/api/booking/feed/${FEED_TOKEN}.ics`;
const REDACTED_FEED_URL = '/api/booking/feed/[Filtered]';

const logLineOf = (entry: Record<string, unknown>): string => {
  const lines: string[] = [];
  pino(
    { redact: [...LOG_REDACT_PATHS] },
    { write: (line: string) => lines.push(line) },
  ).info(entry, 'request');
  return lines.join('');
};

describe('LOG_REDACT_PATHS', () => {
  const body = (field: string, value: string) => ({
    req: { body: { [field]: value } },
  });

  it.each([
    ['req.body.phone', body('phone', '+33 6 12 34 56 78'), '+33 6 12 34 56 78'],
    [
      'req.body.email',
      body('email', 'camille@example.com'),
      'camille@example.com',
    ],
    ['req.body.token', body('token', 'secret-cancel'), 'secret-cancel'],
    ['req.body.password', body('password', 'secret-pw'), 'secret-pw'],
    ['req.body.newPassword', body('newPassword', 'secret-new'), 'secret-new'],
    [
      'req.body.currentPassword',
      body('currentPassword', 'secret-current'),
      'secret-current',
    ],
    ['req.body.code', body('code', 'secret-otp'), 'secret-otp'],
    [
      'req.body.refreshToken',
      body('refreshToken', 'secret-refresh'),
      'secret-refresh',
    ],
    [
      'req.headers.authorization',
      { req: { headers: { authorization: 'Bearer secret-jwt' } } },
      'secret-jwt',
    ],
    [
      'req.headers.cookie',
      { req: { headers: { cookie: 'session=secret-cookie' } } },
      'secret-cookie',
    ],
    [
      'res.headers["set-cookie"]',
      { res: { headers: { 'set-cookie': 'session=secret-set-cookie' } } },
      'secret-set-cookie',
    ],
  ])('masque %s', (_path, entry: Record<string, unknown>, secret) => {
    const line = logLineOf(entry);

    expect(line).not.toContain(secret);
    expect(line).toContain('[Redacted]');
  });

  it.each([...SENSITIVE_BODY_FIELDS])(
    'masque req.body.%s, dérivé de la liste partagée avec Sentry',
    (field) => {
      const line = logLineOf(body(field, `secret-${field}-value`));

      expect(line).not.toContain(`secret-${field}-value`);
      expect(line).toContain('[Redacted]');
    },
  );

  it('laisse lisibles les champs non sensibles de la requête', () => {
    const line = logLineOf({
      req: { url: '/api/booking/bookings', body: { format: 'phone' } },
    });

    expect(line).toContain('/api/booking/bookings');
    expect(line).toContain('"format":"phone"');
    expect(line).not.toContain('[Redacted]');
  });
});

describe('redactUrl', () => {
  it.each([
    [FEED_URL],
    [`${FEED_URL}?x=1`],
    ['/api/booking/feed/abc.ics'],
    ['/api/booking/feed/abc%2Fdef.ics'],
    [`/api/booking/feed/${FEED_TOKEN}.txt`],
  ])('Given le chemin du flux %s, Then le jeton est masqué', (url) => {
    expect(redactUrl(url)).toBe(REDACTED_FEED_URL);
  });

  it.each([
    ['/api/booking/feed-subscription'],
    ['/api/booking/slots'],
    ['/api/booking/bookings?from=2026-10-01'],
    ['/api/health'],
  ])('Given une autre route %s, Then elle reste inchangée', (url) => {
    expect(redactUrl(url)).toBe(url);
  });

  it('Given aucune URL, Then undefined', () => {
    expect(redactUrl(undefined)).toBeUndefined();
  });
});

describe('serializeRequest', () => {
  it('Given une requête du flux, Then seuls id, méthode et URL masquée sont gardés', () => {
    const req = {
      id: 'req-1',
      method: 'GET',
      url: `${FEED_URL}?x=1`,
      headers: { 'user-agent': 'iOS/18.0 dataaccessd/1.0' },
    };

    expect(serializeRequest(req)).toEqual({
      id: 'req-1',
      method: 'GET',
      url: REDACTED_FEED_URL,
    });
  });

  it('Given une autre route, Then son URL reste lisible', () => {
    expect(
      serializeRequest({
        id: 'req-2',
        method: 'POST',
        url: '/api/booking/bookings',
      }),
    ).toEqual({ id: 'req-2', method: 'POST', url: '/api/booking/bookings' });
  });

  it('Given le sérialiseur branché sur pino, Then la ligne de log ne porte pas le jeton', () => {
    const lines: string[] = [];
    pino(
      { serializers: { req: serializeRequest } },
      { write: (line: string) => lines.push(line) },
    ).info({ req: { id: 'req-3', method: 'GET', url: FEED_URL } }, 'request');
    const line = lines.join('');

    expect(line).not.toContain(FEED_TOKEN);
    expect(line).toContain(`"url":"${REDACTED_FEED_URL}"`);
  });
});
