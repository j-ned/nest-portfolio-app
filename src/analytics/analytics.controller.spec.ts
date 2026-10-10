import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsStatsService } from './analytics-stats.service';
import { AnalyticsTrackerService } from './analytics-tracker.service';

/** Contrôleur monté avec la même ValidationPipe que main.ts ; services et JWT remplacés. */
describe('AnalyticsController (HTTP)', () => {
  let app: INestApplication<App>;
  const stats = { events: jest.fn() };
  const tracker = { track: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        { provide: AnalyticsStatsService, useValue: stats },
        { provide: AnalyticsTrackerService, useValue: tracker },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => jest.clearAllMocks());

  describe('GET stats/events', () => {
    it('is guarded by JwtAuthGuard', () => {
      const handler = Object.getOwnPropertyDescriptor(
        AnalyticsController.prototype,
        'events',
      )?.value as object | undefined;
      expect(handler).toBeDefined();
      expect(Reflect.getMetadata(GUARDS_METADATA, handler!)).toContain(
        JwtAuthGuard,
      );
    });

    it.each(['contact_submit', 'outbound_click'])(
      'Given type=%s, When requested, Then 200 with the counts',
      async (type) => {
        const rows = [{ entityId: 'email', count: 2 }];
        stats.events.mockResolvedValueOnce(rows);

        const res = await request(app.getHttpServer())
          .get('/analytics/stats/events')
          .query({ type, startDate: '2026-10-01', limit: 5 });

        expect(res.status).toBe(200);
        expect(res.body).toEqual(rows);
        expect(stats.events).toHaveBeenCalledWith(
          expect.objectContaining({ type, startDate: '2026-10-01', limit: 5 }),
        );
      },
    );

    it.each([['page_view'], ['cta_click'], ['']])(
      'Given type=%s (hors liste), When requested, Then 400 without calling the service',
      async (type) => {
        const res = await request(app.getHttpServer())
          .get('/analytics/stats/events')
          .query({ type });

        expect(res.status).toBe(400);
        expect(stats.events).not.toHaveBeenCalled();
      },
    );
  });

  describe('POST track (allow-list)', () => {
    it('Given an outbound_click on a known channel, When posted, Then 204 and tracked', async () => {
      const res = await request(app.getHttpServer())
        .post('/analytics/track')
        .send({
          type: 'outbound_click',
          entityId: 'linkedin',
          entityTitle: '/',
        });

      expect(res.status).toBe(204);
      expect(tracker.track).toHaveBeenCalledTimes(1);
    });

    it.each([
      [{ type: 'outbound_click', entityId: 'twitter' }],
      [{ type: 'contact_submit', entityId: 'Home' }],
      [{ type: 'section_view', entityId: 'footer' }],
      [{ type: 'form_content', entityId: 'x' }],
    ])('Given %o, When posted, Then 400 and nothing tracked', async (body) => {
      const res = await request(app.getHttpServer())
        .post('/analytics/track')
        .send(body);

      expect(res.status).toBe(400);
      expect(tracker.track).not.toHaveBeenCalled();
    });
  });
});
