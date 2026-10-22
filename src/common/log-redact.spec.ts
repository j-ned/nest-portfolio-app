import { DrizzleQueryError } from 'drizzle-orm';
import pino from 'pino';
import {
  LOG_REDACT_PATHS,
  SENSITIVE_BODY_FIELDS,
  redactLogArguments,
  redactQueryParams,
  redactUrl,
  serializeError,
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

describe('masquage du jeton du flux, variantes du chemin', () => {
  const VARIANTS = [
    `/api/BOOKING/feed/${FEED_TOKEN}.ics`,
    `/api/booking/Feed/${FEED_TOKEN}.ics`,
    `/api/booking/feed/${FEED_TOKEN}.ICS`,
    `/api//booking/feed/${FEED_TOKEN}.ics`,
    `/api/booking/%66eed/${FEED_TOKEN}.ics`,
    `/api/booking/%66eed/${FEED_TOKEN}%2Eics?x=1`,
    `https://api.nedellec-julien.fr/api/Booking/FEED/${FEED_TOKEN}.ics`,
  ];

  it.each(VARIANTS)(
    'Given %s, Then redactUrl ne laisse pas le jeton',
    (url) => {
      const redacted = redactUrl(url);

      expect(redacted).not.toContain(FEED_TOKEN);
      expect(redacted).toContain('[Filtered]');
    },
  );

  it.each(VARIANTS)(
    'Given %s, Then la ligne pino du sérialiseur ne porte pas le jeton',
    (url) => {
      const lines: string[] = [];
      pino(
        { serializers: { req: serializeRequest } },
        { write: (line: string) => lines.push(line) },
      ).info({ req: { id: 'req-4', method: 'GET', url } }, 'request');

      expect(lines.join('')).not.toContain(FEED_TOKEN);
    },
  );

  it.each([
    ['/api/booking/slots?token=abc'],
    ['/api/booking/bookings/3f1c7a52-9d7e-4c35-8a39-1b2f2a0e6d11/cancel'],
    [`/api/booking/${'a'.repeat(42)}.ics`],
  ])('Given %s, sans forme de jeton, Then elle reste inchangée', (url) => {
    expect(redactUrl(url)).toBe(url);
  });
});

describe('serializeRequest, query string et en-têtes', () => {
  it.each([
    ['/api/projects?email=a@b.c&token=xyz', '/api/projects'],
    ['/api/projects#email=a@b.c', '/api/projects'],
    [
      '/api/blog/posts/mon-article?utm_source=x#top',
      '/api/blog/posts/mon-article',
    ],
    [`${FEED_URL}?email=a@b.c`, REDACTED_FEED_URL],
  ])('Given %s, Then seul le chemin est journalisé (%s)', (url, expected) => {
    expect(serializeRequest({ id: 'r', method: 'GET', url }).url).toBe(
      expected,
    );
  });

  it('Given une requête telle que pino-http la passe, Then ni en-têtes, ni IP, ni query ne sont gardés', () => {
    const req = {
      id: 'req-5',
      method: 'GET',
      url: '/api/projects?email=a@b.c',
      query: { email: 'a@b.c' },
      headers: {
        authorization: 'Bearer secret-jwt',
        cookie: 'session=secret-cookie',
        'x-forwarded-for': '203.0.113.7',
        'x-real-ip': '203.0.113.7',
      },
      remoteAddress: '203.0.113.7',
      remotePort: 51234,
    };

    expect(serializeRequest(req)).toEqual({
      id: 'req-5',
      method: 'GET',
      url: '/api/projects',
    });
  });
});

const PERSONAL_PARAMS = [
  'Camille Martin',
  'camille@example.com',
  'Bonjour,\nje t’écris pour un tour CN',
];
const QUERY =
  'insert into "contact_message" ("name", "email", "message") values ($1, $2, $3) returning "id"';

const drizzleError = (): DrizzleQueryError => {
  const cause = Object.assign(
    new Error('relation "contact_message" does not exist'),
    {
      name: 'PostgresError',
      code: '42P01',
      detail: 'Failing row contains (Camille Martin, camille@example.com).',
    },
  );
  return new DrizzleQueryError(QUERY, PERSONAL_PARAMS, cause);
};

const expectNoPersonalData = (text: string) => {
  for (const value of ['Camille Martin', 'camille@example.com', 'tour CN']) {
    expect(text).not.toContain(value);
  }
};

describe('redactQueryParams', () => {
  it('Given le message d’une DrizzleQueryError, Then les paramètres liés sont masqués, la requête gardée', () => {
    expect(redactQueryParams(drizzleError().message)).toBe(
      `Failed query: ${QUERY}\nparams: [Filtered]`,
    );
  });

  it('Given la pile d’une DrizzleQueryError, Then les paramètres sont masqués et les frames gardées', () => {
    const redacted = redactQueryParams(drizzleError().stack ?? '', 'stack');

    expectNoPersonalData(redacted);
    expect(redacted).toContain(`Failed query: ${QUERY}\nparams: [Filtered]`);
    expect(redacted).toMatch(/\n {4}at /);
  });

  it('Given un message dont une valeur imite une frame, Then tout ce qui suit params est masqué', () => {
    const message = `Failed query: ${QUERY}\nparams: Camille,Bonjour\n    at forgé\ncamille@example.com`;

    expect(redactQueryParams(message)).toBe(
      `Failed query: ${QUERY}\nparams: [Filtered]`,
    );
  });

  it('Given une DrizzleQueryError dont une valeur imite une frame, Then le sérialiseur la masque entière', () => {
    const forged = new DrizzleQueryError(
      QUERY,
      ['Camille Martin', 'Bonjour\n    at forgé\ncamille@example.com'],
      undefined,
    );

    expectNoPersonalData(JSON.stringify(serializeError(forged)));
  });

  it('Given un texte sans paramètres liés, Then il reste inchangé', () => {
    expect(redactQueryParams('relation "x" does not exist')).toBe(
      'relation "x" does not exist',
    );
  });
});

describe('serializeError', () => {
  const logLine = (entry: Record<string, unknown>): string => {
    const lines: string[] = [];
    pino(
      { serializers: { err: serializeError } },
      { write: (line: string) => lines.push(line) },
    ).error(entry, 'Unhandled 500 on POST /api/contact/messages');
    return lines.join('');
  };

  it('Given une DrizzleQueryError journalisée (filtre 5xx, cron), Then ni message, ni pile, ni champs ne portent les valeurs', () => {
    const line = logLine({ context: 'Scheduler', err: drizzleError() });
    const { err } = JSON.parse(line) as {
      err: {
        type: string;
        message: string;
        stack: string;
        query: string;
        params: unknown;
      };
    };

    expectNoPersonalData(line);
    expect(err.type).toBe('DrizzleQueryError');
    expect(err.query).toBe(QUERY);
    expect(err.params).toBe('[Filtered]');
    expect(err.message).toContain('params: [Filtered]');
    expect(err.stack).toMatch(/\n {4}at /);
    expect(err.message).toContain(
      'params: [Filtered]: relation "contact_message" does not exist',
    );
    expect(err.stack).toContain(
      'caused by: PostgresError: relation "contact_message" does not exist',
    );
  });

  it('Given une erreur Postgres journalisée seule, Then son détail (valeurs de la ligne) est masqué, le code gardé', () => {
    const line = logLine({ err: drizzleError().cause });

    expectNoPersonalData(line);
    expect(line).toContain('"code":"42P01"');
    expect(line).toContain('"detail":"[Filtered]"');
  });

  it('Given l’erreur déjà sérialisée par pino-http (wrapErrorSerializer), Then elle est aussi nettoyée', () => {
    const serialized = serializeError(pino.stdSerializers.err(drizzleError()));

    expectNoPersonalData(JSON.stringify(serialized));
    expect(serialized.query).toBe(QUERY);
  });

  it('Given le contrat Nest « message + pile en chaîne » (nestjs-pino recrée une Error), Then la pile est nettoyée', () => {
    const rebuilt = Object.assign(
      new Error('Failed to send contact mails for 42'),
      {
        stack: drizzleError().stack,
      },
    );

    const line = logLine({ context: 'ContactService', err: rebuilt });

    expectNoPersonalData(line);
    expect(line).toContain('Failed to send contact mails for 42');
    expect(line).toMatch(/\\n {4}at /);
  });

  it('Given une erreur ordinaire, Then elle reste lisible', () => {
    const line = logLine({ err: new Error('S3 indisponible') });

    expect(line).toContain('"message":"S3 indisponible"');
    expect(line).not.toContain('[Filtered]');
  });
});

describe('redactLogArguments', () => {
  it('Given un message chaîne qui recopie err.message, Then les paramètres liés sont masqués', () => {
    const message = `track failed: ${drizzleError().message}`;

    const [first, second] = redactLogArguments([{ context: 'X' }, message]);

    expect(first).toEqual({ context: 'X' });
    expectNoPersonalData(String(second));
    expect(second).toContain('params: [Filtered]');
  });

  it('Given des arguments sans paramètres liés, Then ils sont rendus tels quels', () => {
    const args = [{ context: 'HTTP' }, 'request completed', 42];

    expect(redactLogArguments(args)).toEqual(args);
  });
});
