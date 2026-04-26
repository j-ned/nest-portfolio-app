import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsStatsService } from './analytics-stats.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';

describe('AnalyticsStatsService', () => {
  let service: AnalyticsStatsService;
  let db: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    db = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [AnalyticsStatsService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    service = module.get(AnalyticsStatsService);
    jest.useFakeTimers().setSystemTime(new Date('2026-04-26T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('overview', () => {
    it('agrège les 8 champs depuis page_view + analytics_event', async () => {
      // 8 sub-queries en parallèle. Le mock builder retourne des terminators :
      // - countDistinct sessionHash (visitors)        → [{ value: 100 }]
      // - count(*) page_view (pageviews)              → [{ value: 250 }]
      // - countDistinct sessionHash (sessions, dup)   → [{ value: 100 }]
      // - bounces (subquery HAVING count=1)           → [{ value: 30 }]
      // - sum(duration) totalDuration                 → [{ value: 12000 }]
      // - count event_type='project_click'            → [{ value: 15 }]
      // - count event_type='article_view'             → [{ value: 8 }]
      // - count event_type='cv_download'              → [{ value: 5 }]
      db.where
        .mockResolvedValueOnce([{ value: 100 }]) // visitors
        .mockResolvedValueOnce([{ value: 250 }]) // pageviews
        .mockResolvedValueOnce([{ value: 100 }]) // sessions
        .mockResolvedValueOnce([{ value: 30 }]) // bounces
        .mockResolvedValueOnce([{ value: 12000 }]) // totalDuration
        .mockResolvedValueOnce([{ value: 15 }]) // projectClicks
        .mockResolvedValueOnce([{ value: 8 }]) // articleViews
        .mockResolvedValueOnce([{ value: 5 }]); // cvDownloads

      const result = await service.overview({});

      expect(result.totalVisitors).toBe(100);
      expect(result.totalPageviews).toBe(250);
      expect(result.totalSessions).toBe(100);
      expect(result.bounceRate).toBe(30); // 30/100 = 30%
      expect(result.avgDuration).toBe(48); // 12000/250 = 48
      expect(result.projectClicks).toBe(15);
      expect(result.articleViews).toBe(8);
      expect(result.cvDownloads).toBe(5);
    });

    it('bounceRate = 0 quand pas de sessions', async () => {
      db.where
        .mockResolvedValueOnce([{ value: 0 }]) // visitors
        .mockResolvedValueOnce([{ value: 0 }]) // pageviews
        .mockResolvedValueOnce([{ value: 0 }]) // sessions
        .mockResolvedValueOnce([{ value: 0 }]) // bounces
        .mockResolvedValueOnce([{ value: null }]) // totalDuration
        .mockResolvedValueOnce([{ value: 0 }])
        .mockResolvedValueOnce([{ value: 0 }])
        .mockResolvedValueOnce([{ value: 0 }]);

      const result = await service.overview({});
      expect(result.bounceRate).toBe(0);
      expect(result.avgDuration).toBe(0);
    });
  });

  describe('chart', () => {
    it('retourne les rows daily_stat triées', async () => {
      const rows = [
        { date: '2026-04-25', visitors: 100, pageviews: 250 },
        { date: '2026-04-24', visitors: 80, pageviews: 200 },
      ];
      db.orderBy.mockResolvedValueOnce(rows);

      const result = await service.chart({
        from: '2026-04-24',
        to: '2026-04-25',
      });

      expect(result.data).toEqual(rows);
    });

    it('si to=today, append une row live calculée depuis page_view', async () => {
      const histRows = [{ date: '2026-04-25', visitors: 50, pageviews: 100 }];
      // History: .where() returns builder so .orderBy() can be called next
      db.where.mockReturnValueOnce(db);
      db.orderBy.mockResolvedValueOnce(histRows);
      // Live agg today : visitors + pageviews (each chain ends in .where())
      db.where
        .mockResolvedValueOnce([{ value: 12 }])
        .mockResolvedValueOnce([{ value: 30 }]);

      const result = await service.chart({
        from: '2026-04-25',
        to: '2026-04-26', // today
      });

      expect(result.data).toHaveLength(2);
      expect(result.data[1]).toEqual({
        date: '2026-04-26',
        visitors: 12,
        pageviews: 30,
      });
    });
  });

  describe('metrics', () => {
    it('top N par type, exclut NULL', async () => {
      const rows = [
        { value: '/home', count: 50 },
        { value: '/projects', count: 30 },
      ];
      db.limit.mockResolvedValueOnce(rows);

      const result = await service.metrics({ type: 'url', limit: 10 });

      expect(result.type).toBe('url');
      expect(result.data).toEqual(rows);
    });

    it('limit par défaut = 20', async () => {
      db.limit.mockResolvedValueOnce([]);

      await service.metrics({ type: 'browser' });

      expect(db.limit).toHaveBeenCalledWith(20);
    });
  });

  describe('active', () => {
    it('count + top URLs des 5 dernières minutes', async () => {
      // 2 sub-queries : countDistinct + groupBy URLs
      db.where.mockResolvedValueOnce([{ value: 7 }]); // count
      db.limit.mockResolvedValueOnce([
        { url: '/home', count: 4 },
        { url: '/projects', count: 3 },
      ]);

      const result = await service.active();

      expect(result.count).toBe(7);
      expect(result.pages).toHaveLength(2);
      expect(result.pages[0].url).toBe('/home');
    });
  });

  describe('projects / articles', () => {
    it("projects() filtre event_type='project_click' et group by entity", async () => {
      const rows = [
        { entityId: 'proj-1', entityTitle: 'Foo', count: 10 },
        { entityId: 'proj-2', entityTitle: 'Bar', count: 5 },
      ];
      db.limit.mockResolvedValueOnce(rows);

      const result = await service.projects({ limit: 5 });

      expect(result.data).toEqual(rows);
      expect(db.limit).toHaveBeenCalledWith(5);
    });
  });

  describe('cvDownloads', () => {
    it('total + timeline 30 jours', async () => {
      // 2 queries : count(*) + groupBy date
      db.where.mockResolvedValueOnce([{ value: 42 }]); // total
      db.orderBy.mockResolvedValueOnce([
        { date: '2026-04-25', count: 3 },
        { date: '2026-04-24', count: 2 },
      ]);

      const result = await service.cvDownloads({});

      expect(result.total).toBe(42);
      expect(result.timeline).toHaveLength(2);
    });
  });
});
