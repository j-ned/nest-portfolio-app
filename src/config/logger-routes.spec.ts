import { Writable } from 'node:stream';
import { All, Controller, type INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LoggerModule, type Params } from 'nestjs-pino';
import request from 'supertest';
import type { App } from 'supertest/types';
import { LOGGER_ROUTES } from './logger-routes';

@Controller()
class ProbeController {
  @All()
  root(): string {
    return 'root';
  }

  @All('*path')
  any(): string {
    return 'any';
  }
}

const PATHS = ['/api', '/api/', '/api/projects', '/api/a/b/c', '/docs', '/'];

type Run = { loggedUrls: string[]; legacyWarnings: string[] };

/** Monte une app au préfixe `api` (comme main.ts) et relève les URLs journalisées par pino-http. */
async function run(forRoutes: Params['forRoutes']): Promise<Run> {
  const loggedUrls: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      const line = JSON.parse(chunk.toString()) as { req?: { url?: string } };
      if (line.req?.url) loggedUrls.push(line.req.url);
      callback();
    },
  });
  const legacyWarnings: string[] = [];
  const warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(function (this: Logger, message: unknown) {
      if (
        (this as unknown as { context?: string }).context ===
        'LegacyRouteConverter'
      ) {
        legacyWarnings.push(String(message));
      }
    });

  const module = await Test.createTestingModule({
    imports: [LoggerModule.forRoot({ pinoHttp: [{}, stream], forRoutes })],
    controllers: [ProbeController],
  }).compile();
  const app: INestApplication<App> = module.createNestApplication({
    logger: false,
  });
  app.setGlobalPrefix('api');
  await app.init();
  for (const path of PATHS) {
    await request(app.getHttpServer()).get(path);
  }
  await app.close();
  warn.mockRestore();
  return { loggedUrls: [...new Set(loggedUrls)].sort(), legacyWarnings };
}

describe('LOGGER_ROUTES', () => {
  it('Given the global prefix api, When the app starts, Then no LegacyRouteConverter warning', async () => {
    const { legacyWarnings } = await run(LOGGER_ROUTES);

    expect(legacyWarnings).toEqual([]);
  });

  it('Given requests in and out of /api, When served, Then only the subpaths of /api/ are logged (not /api itself, as before)', async () => {
    const { loggedUrls } = await run(LOGGER_ROUTES);

    expect(loggedUrls).toEqual(['/api/', '/api/a/b/c', '/api/projects']);
  });

  it('Given the library default, When compared, Then the same paths are covered (the default warned)', async () => {
    const legacy = await run(undefined);
    const current = await run(LOGGER_ROUTES);

    expect(legacy.legacyWarnings.length).toBeGreaterThan(0);
    expect(current.loggedUrls).toEqual(legacy.loggedUrls);
  });
});
