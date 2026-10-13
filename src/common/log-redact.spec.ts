import pino from 'pino';
import { LOG_REDACT_PATHS, SENSITIVE_BODY_FIELDS } from './log-redact';

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
