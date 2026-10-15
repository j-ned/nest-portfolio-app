import type { ErrorEvent } from '@sentry/nestjs';
import { SENSITIVE_BODY_FIELDS } from './log-redact';
import {
  isUntracedIncomingRequest,
  sentryBeforeSend,
  sentryBeforeSendTransaction,
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

type TransactionEvent = Parameters<typeof sentryBeforeSendTransaction>[0];

const API_HOST = 'http://127.0.0.1:3911';

/**
 * Transaction de la forme reçue par un collecteur local (`@sentry/nestjs` 10.73) : racine
 * `request_context.nestjs` nommée par la route, URL concrète dans `request.url` et `contexts.trace.data`.
 */
const routeTransaction = (
  path: string,
  route = '/api/booking/feed/:file',
): TransactionEvent => ({
  type: 'transaction',
  transaction: `GET ${route}`,
  transaction_info: { source: 'route' },
  start_timestamp: 1792086472.134322,
  timestamp: 1792086472.1519701,
  platform: 'node',
  request: {
    headers: { host: '127.0.0.1:3911', 'user-agent': 'curl/8.18.0' },
    method: 'GET',
    url: `${API_HOST}${path}`,
    cookies: {},
  },
  contexts: {
    trace: {
      span_id: '8c565e26256cb90f',
      trace_id: 'cb4751767b904372927103c96848089f',
      op: 'request_context.nestjs',
      status: 'ok',
      origin: 'auto.http.otel.nestjs',
      data: {
        'sentry.op': 'request_context.nestjs',
        'sentry.source': 'route',
        'http.route': route,
        'http.method': 'GET',
        'http.url': path,
        url: path.split('?')[0],
      },
    },
  },
  spans: [
    {
      span_id: '9c84c22f3f763fec',
      parent_span_id: '8c565e26256cb90f',
      trace_id: 'cb4751767b904372927103c96848089f',
      start_timestamp: 1792086472.3473303,
      timestamp: 1792086488.4008744,
      op: 'handler.nestjs',
      description: 'getFeed',
      data: { 'sentry.op': 'handler.nestjs', 'nestjs.callback': 'getFeed' },
    },
  ],
});

/** Variante sans route reconnue par Nest : racine `http.server`, URL concrète dans le nom et les attributs `url.*`. */
const serverTransaction = (path: string): TransactionEvent => ({
  type: 'transaction',
  transaction: `GET ${path}`,
  request: { method: 'GET', url: `${API_HOST}${path}` },
  contexts: {
    trace: {
      span_id: 'a',
      trace_id: 'b',
      op: 'http.server',
      data: {
        'sentry.op': 'http.server',
        'url.full': `${API_HOST}${path}`,
        'url.path': path,
        'http.target': path,
      },
    },
  },
});

/** Transaction ouverte par le filtre d'exceptions : son nom ne dit rien de la route, seule l'URL la trahit. */
const filterTransaction = (path: string): TransactionEvent => ({
  type: 'transaction',
  transaction: 'HttpExceptionFilter',
  request: { method: 'GET', url: `${API_HOST}${path}` },
  contexts: {
    trace: {
      span_id: 'c',
      trace_id: 'd',
      op: 'middleware.nestjs',
      data: { 'sentry.op': 'middleware.nestjs' },
    },
  },
});

const FEED_PATH_VARIANTS = [
  `/api/booking/feed/${FEED_TOKEN}.ics`,
  `/api/booking/feed/${FEED_TOKEN}.ics?x=1`,
  `/api/booking/feed/${FEED_TOKEN}.ICS`,
  `/api/BOOKING/feed/${FEED_TOKEN}.ics`,
  `/api/booking/Feed/${FEED_TOKEN}.ics`,
  `/api//booking/feed/${FEED_TOKEN}.ics`,
  `/api/booking/%66eed/${FEED_TOKEN}.ics`,
];

describe('sentryBeforeSendTransaction', () => {
  it.each(FEED_PATH_VARIANTS)(
    'Given une transaction de route du flux sur %s, Then elle est écartée',
    (path) => {
      expect(sentryBeforeSendTransaction(routeTransaction(path))).toBeNull();
    },
  );

  it.each(FEED_PATH_VARIANTS)(
    'Given une transaction http.server sur %s, Then elle est écartée',
    (path) => {
      expect(sentryBeforeSendTransaction(serverTransaction(path))).toBeNull();
    },
  );

  it.each(FEED_PATH_VARIANTS)(
    'Given une transaction du filtre d’exceptions sur %s, Then elle est écartée',
    (path) => {
      expect(sentryBeforeSendTransaction(filterTransaction(path))).toBeNull();
    },
  );

  it('Given une transaction dont seule une donnée de trace désigne le flux, Then elle est écartée', () => {
    const event = filterTransaction('/api/booking/slots');
    const trace = event.contexts?.trace;
    if (!trace) throw new Error('trace absente');
    trace.data = {
      ...trace.data,
      'http.url': `/api/booking/feed/${FEED_TOKEN}.ics`,
    };

    expect(sentryBeforeSendTransaction(event)).toBeNull();
  });

  it('Given une autre transaction qui cite le jeton dans un span, Then elle passe avec le jeton masqué', () => {
    const event = filterTransaction('/api/booking/slots');
    event.spans = [
      {
        span_id: 'e',
        trace_id: 'd',
        start_timestamp: 1,
        description: `GET ${API_HOST}/api/booking/feed/${FEED_TOKEN}.ics`,
        data: { 'http.url': `${API_HOST}/api/booking/feed/${FEED_TOKEN}.ics` },
      },
    ];

    const result = sentryBeforeSendTransaction(event);

    expect(result).not.toBeNull();
    expect(JSON.stringify(result)).not.toContain(FEED_TOKEN);
    expect(result?.spans?.[0]?.description).toBe(
      `GET ${API_HOST}/api/booking/feed/[Filtered]`,
    );
  });

  it.each([
    [
      'route',
      routeTransaction(
        '/api/booking/slots?from=2026-10-01',
        '/api/booking/slots',
      ),
    ],
    ['http.server', serverTransaction('/api/booking/feed-subscription')],
    ['filtre', filterTransaction('/api/health')],
  ])(
    'Given une transaction %s d’une autre route, Then elle passe intacte',
    (_kind, event) => {
      const expected = structuredClone(event);

      expect(sentryBeforeSendTransaction(event)).toEqual(expected);
    },
  );

  it('Given une transaction portant des métadonnées internes circulaires (scopes), Then elle passe sans erreur et les métadonnées gardent leur référence', () => {
    const scope: Record<string, unknown> = { name: 'isolation' };
    scope.self = scope;
    const event = {
      ...filterTransaction('/api/booking/slots'),
      sdkProcessingMetadata: { scope },
    };

    const result = sentryBeforeSendTransaction(event);

    expect(result?.sdkProcessingMetadata).toBe(event.sdkProcessingMetadata);
  });

  it('Given une transaction, Then l’original n’est pas modifié', () => {
    const event = filterTransaction('/api/booking/slots');
    event.spans = [
      {
        span_id: 'e',
        trace_id: 'd',
        start_timestamp: 1,
        description: `/api/booking/feed/${FEED_TOKEN}.ics`,
        data: {},
      },
    ];
    const before = structuredClone(event);

    sentryBeforeSendTransaction(event);

    expect(event).toEqual(before);
  });
});

describe('sentryBeforeSend sur les variantes du chemin du flux', () => {
  it.each(FEED_PATH_VARIANTS)(
    'Given un événement d’erreur sur %s, Then le jeton n’apparaît nulle part',
    (path) => {
      const result = sentryBeforeSend({
        type: undefined,
        transaction: `GET ${path}`,
        request: {
          url: `${API_HOST}${path}`,
          method: 'GET',
          query_string: 'x=1',
        },
      });

      expect(JSON.stringify(result)).not.toContain(FEED_TOKEN);
    },
  );
});

describe('isUntracedIncomingRequest sur les variantes du chemin du flux', () => {
  it.each(FEED_PATH_VARIANTS)(
    'Given %s, Then la requête n’est pas tracée',
    (path) => {
      expect(isUntracedIncomingRequest(path)).toBe(true);
    },
  );
});
