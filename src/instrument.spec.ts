import type { IncomingMessage } from 'node:http';
import type * as SentryModule from '@sentry/nestjs';
import type * as BeforeSendModule from './common/sentry-before-send';

jest.mock('dotenv/config', () => ({}));
jest.mock('@sentry/nestjs', () => ({
  init: jest.fn(),
  httpIntegration: jest.fn(() => ({ name: 'Http' })),
}));

describe('instrument', () => {
  const previousDsn = process.env.SENTRY_DSN;

  afterEach(() => {
    if (previousDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = previousDsn;
  });

  const loadInstrument = () => {
    process.env.SENTRY_DSN = 'https://public@o0.ingest.sentry.io/0';
    let sentry: typeof SentryModule | undefined;
    let hooks: typeof BeforeSendModule | undefined;
    jest.isolateModules(() => {
      sentry = jest.requireMock<typeof SentryModule>('@sentry/nestjs');
      jest.requireActual('./instrument');
      hooks = jest.requireActual<typeof BeforeSendModule>(
        './common/sentry-before-send',
      );
    });
    if (!sentry || !hooks) throw new Error('instrument non chargé');
    return { sentry, hooks };
  };

  const ignoreIncomingRequests = () => {
    const { sentry } = loadInstrument();
    const options = jest.mocked(sentry.httpIntegration).mock.calls[0]?.[0];
    const ignore = options?.ignoreIncomingRequests;
    if (!ignore) throw new Error('ignoreIncomingRequests absent');
    return (url: string) => ignore(url, {} as IncomingMessage);
  };

  it.each([
    ['/api/health', true],
    ['/api/booking/feed/XYJXH9MoGdppkZYT0jI3g2rP-qFcqKBWL0budyMj488.ics', true],
    ['/api/booking/slots', false],
    ['/api/booking/feed-subscription', false],
  ])(
    'Given Sentry initialisé, Then la requête entrante %s est exclue du traçage : %s',
    (url, ignored) => {
      expect(ignoreIncomingRequests()(url)).toBe(ignored);
    },
  );

  it('Given Sentry initialisé, Then toute collecte de données personnelles est fermée catégorie par catégorie', () => {
    const { sentry } = loadInstrument();
    const options = jest.mocked(sentry.init).mock.calls[0]?.[0];

    expect(options).not.toHaveProperty('sendDefaultPii');
    expect(options?.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['user-agent'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    });
  });

  it('Given Sentry initialisé, Then les erreurs passent par sentryBeforeSend', () => {
    const { sentry, hooks } = loadInstrument();
    const options = jest.mocked(sentry.init).mock.calls[0]?.[0];

    expect(options?.beforeSend).toBe(hooks.sentryBeforeSend);
  });

  it('Given Sentry initialisé, Then les transactions sont envoyées entières (static) : la v11 ignorerait beforeSendTransaction en streaming', () => {
    const { sentry } = loadInstrument();
    const options = jest.mocked(sentry.init).mock.calls[0]?.[0];

    expect(options?.traceLifecycle).toBe('static');
  });

  it('Given Sentry initialisé, Then les transactions passent par sentryBeforeSendTransaction', () => {
    const { sentry, hooks } = loadInstrument();
    const options = jest.mocked(sentry.init).mock.calls[0]?.[0];

    expect(options?.beforeSendTransaction).toEqual(expect.any(Function));
    expect(options?.beforeSendTransaction).toBe(
      hooks.sentryBeforeSendTransaction,
    );
  });

  it('Given Sentry initialisé, Then une transaction du flux d’agenda est écartée avant envoi', () => {
    const { sentry } = loadInstrument();
    const hook = jest.mocked(sentry.init).mock.calls[0]?.[0]
      ?.beforeSendTransaction;
    if (!hook) throw new Error('beforeSendTransaction absent');

    expect(
      hook(
        {
          type: 'transaction',
          transaction: 'GET /api/booking/feed/:file',
          request: {
            url: 'https://api.nedellec-julien.fr/api/booking/feed/XYJXH9MoGdppkZYT0jI3g2rP-qFcqKBWL0budyMj488.ics',
          },
        },
        {},
      ),
    ).toBeNull();
  });
});
