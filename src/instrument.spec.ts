import type { IncomingMessage } from 'node:http';
import type * as SentryModule from '@sentry/nestjs';

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

  const ignoreIncomingRequests = () => {
    process.env.SENTRY_DSN = 'https://public@o0.ingest.sentry.io/0';
    let sentry: typeof SentryModule | undefined;
    jest.isolateModules(() => {
      sentry = jest.requireMock<typeof SentryModule>('@sentry/nestjs');
      jest.requireActual('./instrument');
    });
    if (!sentry) throw new Error('@sentry/nestjs non chargé');
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
});
