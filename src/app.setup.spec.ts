import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { setupApp } from './app.setup';

@Controller('things')
class ThingsController {
  @Get()
  list(): string[] {
    return [];
  }
}

const ERROR_KEYS = ['error', 'message', 'path', 'statusCode', 'timestamp'];

/** Monte une app avec la configuration HTTP réelle de main.ts (préfixe, filtre, Swagger, replis). */
async function createApp(
  isProduction: boolean,
): Promise<INestApplication<App>> {
  const module = await Test.createTestingModule({
    controllers: [ThingsController],
  }).compile();
  const app = module.createNestApplication<INestApplication<App>>({
    logger: false,
  });
  await setupApp(app, {
    corsOrigins: ['http://localhost:4200'],
    isProduction,
  });
  return app;
}

describe('setupApp', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createApp(false);
  });

  afterAll(async () => {
    await app.close();
  });

  it('Given a known route under /api, When requested, Then it is served', async () => {
    const res = await request(app.getHttpServer()).get('/api/things');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it.each(['/api/nope?x=1', '/api', '/random', '/', '/docsx?x=1'])(
    'Given the unknown route %s, When requested, Then the 404 is the API JSON error body',
    async (path) => {
      const res = await request(app.getHttpServer()).get(path);

      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(Object.keys(res.body as object).sort()).toEqual(ERROR_KEYS);
      expect(res.body).toMatchObject({
        statusCode: 404,
        error: 'Not Found',
        message: `Cannot GET ${path}`,
        path,
      });
    },
  );

  it.each(['/api/things', '/random'])(
    'Given malformed JSON sent to %s, When parsed, Then the 400 is the API JSON error body',
    async (path) => {
      const res = await request(app.getHttpServer())
        .post(path)
        .set('content-type', 'application/json')
        .send('{bad');

      expect(res.status).toBe(400);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(Object.keys(res.body as object).sort()).toEqual(ERROR_KEYS);
      expect(res.body).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
        path,
      });
    },
  );

  it('Given a non-production app, When /docs is requested, Then Swagger UI is served', async () => {
    const res = await request(app.getHttpServer()).get('/docs');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    const asset = await request(app.getHttpServer()).get(
      '/docs/swagger-ui.css',
    );
    expect(asset.status).toBe(200);
    expect(asset.headers['content-type']).toMatch(/^text\/css/);
  });

  it('Given a production app, When /docs is requested, Then it is the API JSON 404', async () => {
    const prod = await createApp(true);
    try {
      const res = await request(prod.getHttpServer()).get('/docs');

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ statusCode: 404, path: '/docs' });
    } finally {
      await prod.close();
    }
  });
});
