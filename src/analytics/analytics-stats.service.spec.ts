import { Test, TestingModule } from '@nestjs/testing';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { AnalyticsStatsService } from './analytics-stats.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import * as aggregates from './analytics-aggregates';
import type { DayAggregates } from './analytics-aggregates';

const render = (fragment: unknown) =>
  new PgDialect({ casing: 'snake_case' }).sqlToQuery(fragment as SQL);

/** Ligne `daily_stat` ; les colonnes de la spec 020 sont `NULL` par défaut (jour non mesuré). */
const storedDay = (
  date: string,
  overrides: Record<string, number | null> = {},
) => ({
  date,
  visitors: 10,
  pageviews: 20,
  sessions: 10,
  bounces: 5,
  totalDuration: 400,
  projectClicks: 1,
  articleViews: 1,
  cvDownloads: 1,
  ctaClicks: 1,
  durationSamples: null,
  engagedSessions: null,
  realBounces: null,
  contactSubmits: null,
  contactClicks: null,
  profileClicks: null,
  demoClicks: null,
  contactSectionViews: null,
  ...overrides,
});

const LIVE_TODAY: DayAggregates = {
  visitors: 4,
  pageviews: 6,
  sessions: 4,
  bounces: 3,
  totalDuration: 90,
  durationSamples: 3,
  engagedSessions: 2,
  realBounces: 2,
  projectClicks: 0,
  articleViews: 0,
  cvDownloads: 0,
  ctaClicks: 2,
  contactSubmits: 1,
  contactClicks: 1,
  profileClicks: 0,
  demoClicks: 0,
  contactSectionViews: 1,
};

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
    let compute: jest.SpyInstance;

    beforeEach(() => {
      compute = jest
        .spyOn(aggregates, 'computeAggregates')
        .mockResolvedValue(LIVE_TODAY);
    });

    afterEach(() => compute.mockRestore());

    it('Given a 90-day range ending yesterday, When read, Then it sums daily_stat and computes nothing live', async () => {
      db.orderBy.mockResolvedValueOnce([
        storedDay('2026-01-27'),
        storedDay('2026-04-25', { sessions: 30, visitors: 30, bounces: 15 }),
      ]);

      const result = await service.overview({
        startDate: '2026-01-27',
        endDate: '2026-04-25',
      });

      expect(compute).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        visitors: 40,
        sessions: 40,
        pageviews: 40,
        bounces: 20,
        bounceRate: 50,
        projectClicks: 2,
        articleViews: 2,
        cvDownloads: 2,
        ctaClicks: 2,
      });
    });

    it('Given a range including today, When read, Then today is computed live and added to the stored days', async () => {
      db.orderBy.mockResolvedValueOnce([storedDay('2026-04-25')]);

      const result = await service.overview({
        startDate: '2026-04-25',
        endDate: '2026-04-26',
      });

      expect(compute).toHaveBeenCalledTimes(1);
      const [, start, end] = compute.mock.calls[0] as [unknown, Date, Date];
      expect(start.toISOString()).toBe('2026-04-26T00:00:00.000Z');
      expect(end.toISOString()).toBe('2026-04-26T23:59:59.999Z');
      expect(result).toMatchObject({
        visitors: 14,
        sessions: 14,
        pageviews: 26,
        bounces: 8,
        ctaClicks: 3,
      });
    });

    it('Given a range of today only, When read, Then daily_stat is not queried', async () => {
      const result = await service.overview({
        startDate: '2026-04-26',
        endDate: '2026-04-26',
      });

      expect(db.select).not.toHaveBeenCalled();
      expect(result.sessions).toBe(4);
    });

    it('Given unmeasured and measured days, When read, Then engagement and duration use the measured days only, numerator and denominator', async () => {
      db.orderBy.mockResolvedValueOnce([
        storedDay('2026-04-01', {
          sessions: 100,
          pageviews: 300,
          totalDuration: 5000,
        }),
        storedDay('2026-04-02', {
          sessions: 10,
          pageviews: 25,
          totalDuration: 600,
          durationSamples: 20,
          engagedSessions: 4,
          realBounces: 6,
        }),
      ]);

      const result = await service.overview({
        startDate: '2026-04-01',
        endDate: '2026-04-02',
      });

      expect(result.avgDuration).toBe(30); // 600 / 20 pages mesurées
      expect(result.durationCoverage).toBe(80); // 20 / 25
      expect(result.engagement).toEqual({
        measuredSince: '2026-04-02',
        measuredSessions: 10,
        engagedSessions: 4,
        realBounces: 6,
        realBounceRate: 60,
        engagementRate: 40,
        thresholdSeconds: 30,
      });
    });

    it('Given conversions measured from the second day, When read, Then they are summed from that day with its date', async () => {
      db.orderBy.mockResolvedValueOnce([
        storedDay('2026-04-24', { engagedSessions: 3, realBounces: 7 }),
        storedDay('2026-04-25', {
          engagedSessions: 5,
          realBounces: 5,
          contactSubmits: 0,
          contactClicks: 2,
          profileClicks: 1,
          demoClicks: 3,
          contactSectionViews: 4,
        }),
      ]);

      const result = await service.overview({
        startDate: '2026-04-24',
        endDate: '2026-04-26',
      });

      expect(result.engagement.measuredSince).toBe('2026-04-24');
      expect(result.conversions).toEqual({
        measuredSince: '2026-04-25',
        contactSubmits: 1,
        contactClicks: 3,
        profileClicks: 1,
        demoClicks: 3,
        contactSectionViews: 5,
      });
    });

    it('Given no measured day, When read, Then rates are 0 and measuredSince is null', async () => {
      db.orderBy.mockResolvedValueOnce([storedDay('2026-04-20')]);

      const result = await service.overview({
        startDate: '2026-04-20',
        endDate: '2026-04-21',
      });

      expect(result.avgDuration).toBe(0);
      expect(result.durationCoverage).toBe(0);
      expect(result.engagement).toMatchObject({
        measuredSince: null,
        measuredSessions: 0,
        realBounceRate: 0,
        engagementRate: 0,
      });
      expect(result.conversions.measuredSince).toBeNull();
    });

    it.each([
      ['2026-01-27', '2026-03-27'],
      ['2026-04-20', '2026-04-20'],
    ])(
      'Given startDate %s, When read, Then detailSince is %s (au plus 30 jours de détail brut)',
      async (startDate, detailSince) => {
        db.orderBy.mockResolvedValueOnce([]);

        const result = await service.overview({ startDate });

        expect(result.detailSince).toBe(detailSince);
      },
    );

    it('Given rates with decimals, When read, Then they are rounded to 2 decimals and engagement = 100 - real bounce', async () => {
      db.orderBy.mockResolvedValueOnce([
        storedDay('2026-04-20', {
          sessions: 3,
          engagedSessions: 2,
          realBounces: 1,
        }),
      ]);

      const result = await service.overview({
        startDate: '2026-04-20',
        endDate: '2026-04-20',
      });

      expect(result.engagement.realBounceRate).toBe(33.33);
      expect(result.engagement.engagementRate).toBe(66.67);
    });
  });

  describe('chart', () => {
    it('retourne les rows daily_stat triées', async () => {
      const rows = [
        { date: '2026-04-24', visitors: 80, pageviews: 200 },
        { date: '2026-04-25', visitors: 100, pageviews: 250 },
      ];
      db.orderBy.mockResolvedValueOnce(rows);

      const result = await service.chart({
        startDate: '2026-04-24',
        endDate: '2026-04-25',
      });

      expect(result).toEqual(rows);
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
        startDate: '2026-04-25',
        endDate: '2026-04-26', // today
      });

      expect(result).toHaveLength(2);
      expect(result[1]).toEqual({
        date: '2026-04-26',
        visitors: 12,
        pageviews: 30,
      });
    });
  });

  describe('metrics', () => {
    it.each(['url', 'browser', 'os', 'country'] as const)(
      'Given type=%s, When read, Then each visit counts once (countDistinct sur session_hash)',
      async (type) => {
        const rows = [{ name: 'x', count: 3 }];
        db.limit.mockResolvedValueOnce(rows);

        const result = await service.metrics({ type, limit: 10 });

        expect(result).toEqual(rows);
        const [selection] = db.select.mock.calls[0] as [{ count: unknown }];
        expect(render(selection.count).sql).toBe(
          'count(distinct "page_view"."session_hash")',
        );
      },
    );

    it('limit par défaut = 20', async () => {
      db.limit.mockResolvedValueOnce([]);

      await service.metrics({ type: 'browser' });

      expect(db.limit).toHaveBeenCalledWith(20);
    });

    it('Given type=referrer, When read, Then one row per visit with its first external referrer, direct access as an empty name', async () => {
      const rows = [
        { name: '', count: 12 },
        { name: 'google.com', count: 5 },
      ];
      db.execute.mockResolvedValueOnce(rows);

      const result = await service.metrics({ type: 'referrer', limit: 5 });

      expect(result).toEqual(rows);
      expect(db.select).not.toHaveBeenCalled();
      const [statement] = db.execute.mock.calls[0] as [unknown];
      const query = render(statement);
      expect(query.sql).toMatch(/GROUP BY\s+"page_view"."session_hash"/);
      expect(query.sql).toContain('COALESCE(');
      expect(query.sql).toContain("''");
      expect(query.params).toContain(5);
    });
  });

  describe('events', () => {
    it.each(['contact_submit', 'outbound_click'] as const)(
      'Given type=%s, When read, Then counts are grouped by entityId, top N',
      async (type) => {
        const rows = [
          { entityId: 'home', count: 3 },
          { entityId: 'offer_site-vitrine', count: 1 },
        ];
        db.limit.mockResolvedValueOnce(rows);

        const result = await service.events({ type, limit: 5 });

        expect(result).toEqual(rows);
        expect(db.limit).toHaveBeenCalledWith(5);
        const [condition] = db.where.mock.calls[0] as [unknown];
        expect(render(condition).params).toContain(type);
      },
    );
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

      expect(result).toEqual(rows);
      expect(db.limit).toHaveBeenCalledWith(5);
    });

    it("cta() filtre event_type='cta_click' et group by entity", async () => {
      const rows = [
        {
          entityId: 'home_hero_projects',
          entityTitle: 'Voir les projets',
          count: 42,
        },
      ];
      db.limit.mockResolvedValueOnce(rows);

      const result = await service.cta({ limit: 5 });

      expect(result).toEqual(rows);
      expect(db.limit).toHaveBeenCalledWith(5);
    });

    it("articlesRead() filtre event_type='article_read' et group by entity", async () => {
      const rows = [{ entityId: 'post-1', entityTitle: 'Baz', count: 3 }];
      db.limit.mockResolvedValueOnce(rows);

      const result = await service.articlesRead({ limit: 5 });

      expect(result).toEqual(rows);
      expect(db.limit).toHaveBeenCalledWith(5);
    });
  });

  describe('cvDownloads', () => {
    it('count + timeline 30 jours', async () => {
      // 2 queries : count(*) + groupBy date
      // count: select.from.where (terminator)
      // timeline: select.from.where.groupBy.orderBy (terminator)
      db.where
        .mockResolvedValueOnce([{ value: 42 }]) // count terminator (1st .where call)
        .mockReturnValueOnce(db); // timeline .where (2nd .where call, returns builder)
      db.orderBy.mockResolvedValueOnce([
        { date: '2026-04-25', count: 3 },
        { date: '2026-04-24', count: 2 },
      ]); // timeline terminator

      const result = await service.cvDownloads({});

      expect(result.count).toBe(42);
      expect(result.timeline).toHaveLength(2);
    });
  });
});
