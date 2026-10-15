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

  it('Given une autre route, Then le chemin reste lisible dans le corps', () => {
    const { host, res } = httpHost('/api/booking/slots?from=2026-10-01');

    new HttpExceptionFilter().catch(new NotFoundException('Not Found'), host);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/booking/slots?from=2026-10-01' }),
    );
  });
});
