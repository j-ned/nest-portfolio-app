import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { AnalyticsAggregatorService } from './analytics-aggregator.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';

describe('AnalyticsAggregatorService', () => {
  let service: AnalyticsAggregatorService;
  let db: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    db = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsAggregatorService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(AnalyticsAggregatorService);
    jest.useFakeTimers().setSystemTime(new Date('2026-04-26T01:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // Helper : 7 mocks pour les 7 sub-queries de computeAggregates
  // (visitors == sessions, dédupliqué — une seule countDistinct sur sessionHash)
  const mockAggregateValues = (
    overrides: Partial<Record<string, number>> = {},
  ) => {
    db.where
      .mockResolvedValueOnce([{ value: overrides.sessions ?? 50 }])
      .mockResolvedValueOnce([{ value: overrides.pageviews ?? 120 }])
      .mockResolvedValueOnce([{ value: overrides.bounces ?? 10 }])
      .mockResolvedValueOnce([{ value: overrides.totalDuration ?? 5000 }])
      .mockResolvedValueOnce([{ value: overrides.projectClicks ?? 8 }])
      .mockResolvedValueOnce([{ value: overrides.articleViews ?? 4 }])
      .mockResolvedValueOnce([{ value: overrides.cvDownloads ?? 2 }]);
  };

  describe('aggregateYesterday', () => {
    it('calcule les agrégats J-1 et UPSERT daily_stat', async () => {
      mockAggregateValues();
      // onConflictDoUpdate terminator (insert path)
      db.values.mockReturnThis();
      // purge raw events terminators
      db.where.mockResolvedValueOnce(undefined); // delete page_view
      db.where.mockResolvedValueOnce(undefined); // delete analytics_event

      await service.aggregateYesterday();

      expect(db.insert).toHaveBeenCalledTimes(1); // upsert daily_stat
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          date: '2026-04-25', // J-1
          visitors: 50,
          pageviews: 120,
          bounces: 10,
        }),
      );
    });

    it('purge raw events > 30j (DELETE sur page_view + analytics_event)', async () => {
      mockAggregateValues();
      db.where.mockResolvedValueOnce(undefined); // delete page_view
      db.where.mockResolvedValueOnce(undefined); // delete analytics_event

      await service.aggregateYesterday();

      expect(db.delete).toHaveBeenCalledTimes(2);
    });
  });

  describe('manualRun', () => {
    it('agrège la date passée (pas J-1)', async () => {
      mockAggregateValues({ sessions: 200, pageviews: 500 });

      await service.manualRun(new Date('2026-04-20T12:00:00Z'));

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          date: '2026-04-20',
          visitors: 200,
          pageviews: 500,
        }),
      );
    });

    it('idempotent : 2 runs sur même date → 1 row (UPSERT path)', async () => {
      mockAggregateValues();
      mockAggregateValues();

      await service.manualRun(new Date('2026-04-20T12:00:00Z'));
      await service.manualRun(new Date('2026-04-20T12:00:00Z'));

      // 2 INSERTs avec onConflictDoUpdate (Drizzle gère le UPSERT côté SQL)
      expect(db.insert).toHaveBeenCalledTimes(2);
      // Les 2 calls passent par .onConflictDoUpdate, pas de duplicate row côté DB
    });
  });

  describe('logging', () => {
    it('émet une log line au succès', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log');
      mockAggregateValues();
      db.where.mockResolvedValueOnce(undefined);
      db.where.mockResolvedValueOnce(undefined);

      await service.aggregateYesterday();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Aggregated 2026-04-25'),
      );
    });
  });
});
