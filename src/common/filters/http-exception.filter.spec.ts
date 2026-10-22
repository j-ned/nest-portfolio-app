import { type ArgumentsHost, Logger, NotFoundException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

const FEED_TOKEN = 'XYJXH9MoGdppkZYT0jI3g2rP-qFcqKBWL0budyMj488';
const FEED_URL = `/api/booking/feed/${FEED_TOKEN}.ics?x=1`;
const REDACTED_FEED_URL = '/api/booking/feed/[Filtered]';

const httpHost = (url: string) => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ url, method: 'GET' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, res };
};

describe('HttpExceptionFilter', () => {
  let logError: jest.SpyInstance;

  beforeEach(() => {
    logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    logError.mockRestore();
  });

  it('Given un 404 sur le flux, Then le corps porte le chemin masqué', () => {
    const { host, res } = httpHost(FEED_URL);

    new HttpExceptionFilter().catch(new NotFoundException('Not Found'), host);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 404,
      error: 'Not Found',
      message: 'Not Found',
      path: REDACTED_FEED_URL,
      timestamp: expect.any(String) as string,
    });
  });

  it('Given une erreur 500 sur le flux, Then le log porte le chemin masqué, dans l’objet comme dans le message', () => {
    const { host } = httpHost(FEED_URL);
    const boom = new Error('boom');

    new HttpExceptionFilter().catch(boom, host);

    expect(logError).toHaveBeenCalledWith(
      { err: boom, path: REDACTED_FEED_URL, method: 'GET' },
      `Unhandled 500 on GET ${REDACTED_FEED_URL}`,
    );
    expect(JSON.stringify(logError.mock.calls)).not.toContain(FEED_TOKEN);
  });

  it('Given un 500 sur une URL à query string, Then le log ne garde que le chemin', () => {
    const { host } = httpHost('/api/projects?email=a@b.c&token=xyz#top');
    const boom = new Error('boom');

    new HttpExceptionFilter().catch(boom, host);

    expect(logError).toHaveBeenCalledWith(
      { err: boom, path: '/api/projects', method: 'GET' },
      'Unhandled 500 on GET /api/projects',
    );
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/a@b\.c|xyz/);
  });

  it('Given une autre route, Then le chemin reste lisible dans le corps', () => {
    const { host, res } = httpHost('/api/booking/slots?from=2026-10-01');

    new HttpExceptionFilter().catch(new NotFoundException('Not Found'), host);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/booking/slots?from=2026-10-01' }),
    );
  });
});

describe('HttpExceptionFilter sur les variantes du chemin du flux', () => {
  let logError: jest.SpyInstance;

  beforeEach(() => {
    logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    logError.mockRestore();
  });

  it.each([
    `/api/BOOKING/feed/${FEED_TOKEN}.ics`,
    `/api/booking/Feed/${FEED_TOKEN}.ics`,
    `/api/booking/feed/${FEED_TOKEN}.ICS`,
    `/api//booking/feed/${FEED_TOKEN}.ics`,
    `/api/booking/%66eed/${FEED_TOKEN}.ics`,
  ])(
    'Given %s, Then ni le corps 404 ni le log 500 ne portent le jeton',
    (url) => {
      const notFound = httpHost(url);
      new HttpExceptionFilter().catch(
        new NotFoundException('Not Found'),
        notFound.host,
      );
      new HttpExceptionFilter().catch(new Error('boom'), httpHost(url).host);

      expect(JSON.stringify(notFound.res.json.mock.calls)).not.toContain(
        FEED_TOKEN,
      );
      expect(JSON.stringify(logError.mock.calls)).not.toContain(FEED_TOKEN);
    },
  );
});

/** Erreur au format `http-errors` (body-parser, Express) : statut porté par `status` ou `statusCode`. */
const httpError = (props: Record<string, unknown>, message = 'raw message') =>
  Object.assign(new Error(message), props);

describe('HttpExceptionFilter sur les erreurs http-errors (body-parser)', () => {
  let logError: jest.SpyInstance;

  beforeEach(() => {
    logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    logError.mockRestore();
  });

  it.each([
    [
      'corps trop gros',
      httpError(
        {
          status: 413,
          statusCode: 413,
          expose: true,
          type: 'entity.too.large',
        },
        'request entity too large',
      ),
      413,
      'Payload Too Large',
      'request entity too large',
    ],
    [
      'encodage non supporté (statusCode seul)',
      httpError(
        { statusCode: 415, expose: true },
        'unsupported content encoding',
      ),
      415,
      'Unsupported Media Type',
      'unsupported content encoding',
    ],
    [
      '4xx non exposable',
      httpError({ status: 400, expose: false }, 'internal detail'),
      400,
      'Bad Request',
      'Bad Request',
    ],
  ])(
    'Given une erreur %s, Then son statut 4xx est respecté avec un message sûr, sans log d’erreur',
    (_label, error, status, label, message) => {
      const { host, res } = httpHost('/api/contact/messages');

      new HttpExceptionFilter().catch(error, host);

      expect(res.status).toHaveBeenCalledWith(status);
      expect(res.json).toHaveBeenCalledWith({
        statusCode: status,
        error: label,
        message,
        path: '/api/contact/messages',
        timestamp: expect.any(String) as string,
      });
      expect(logError).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['5xx', httpError({ status: 503, expose: false }, 'upstream secret')],
    ['statut non numérique', httpError({ status: '413' })],
    ['statut hors erreur client', httpError({ status: 302 })],
  ])(
    'Given une erreur au statut %s, Then c’est un 500 générique, journalisé',
    (_label, error) => {
      const { host, res } = httpHost('/api/x');

      new HttpExceptionFilter().catch(error, host);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Internal server error',
        }),
      );
      expect(logError).toHaveBeenCalled();
    },
  );
});
