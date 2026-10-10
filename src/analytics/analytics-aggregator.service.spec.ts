import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { AnalyticsAggregatorService } from './analytics-aggregator.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import * as aggregates from './analytics-aggregates';
import type { DayAggregates } from './analytics-aggregates';

/** Jours `[J-29, J-2]` d'un cron exécuté le 2026-04-26 : du 2026-03-28 au 2026-04-24. */
const backfillWindow = (): string[] =>
  Array.from({ length: 28 }, (_, i) =>
    new Date(Date.UTC(2026, 2, 28 + i)).toISOString().slice(0, 10),
  );
const measuredRows = (dates: string[]) => dates.map((date) => ({ date }));

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

  // 3 requêtes : faits par visite (db.execute), compteurs d'événements (select … where),
  // conversions déjà vues (db.execute).
  const mockAggregateValues = (
    overrides: { sessions?: number; pages?: number } = {},
  ) => {
    const sessions = overrides.sessions ?? 2;
    const pages = overrides.pages ?? 1;
    db.execute
      .mockResolvedValueOnce(
        Array.from({ length: sessions }, (_, i) => ({
          pages,
          duration_sum: i === 0 ? 40 : null,
          duration_samples: i === 0 ? 1 : 0,
          engaged: false,
        })),
      )
      .mockResolvedValueOnce([{ measured: false }]);
    db.where.mockResolvedValueOnce([
      { projectClicks: 8, articleViews: 4, cvDownloads: 2, ctaClicks: 1 },
    ]);
  };

  describe('aggregateYesterday', () => {
    it('calcule les agrégats J-1 et UPSERT daily_stat', async () => {
      mockAggregateValues();
      db.where.mockResolvedValueOnce(measuredRows(backfillWindow()));
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
          visitors: 2,
          pageviews: 2,
          bounces: 2,
        }),
      );
    });

    it('purge raw events > 30j (DELETE sur page_view + analytics_event)', async () => {
      mockAggregateValues();
      db.where.mockResolvedValueOnce(measuredRows(backfillWindow()));
      db.where.mockResolvedValueOnce(undefined); // delete page_view
      db.where.mockResolvedValueOnce(undefined); // delete analytics_event

      await service.aggregateYesterday();

      expect(db.delete).toHaveBeenCalledTimes(2);
    });
  });

  describe('manualRun', () => {
    it('agrège la date passée (pas J-1)', async () => {
      mockAggregateValues({ sessions: 200, pages: 3 });

      await service.manualRun(new Date('2026-04-20T12:00:00Z'));

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          date: '2026-04-20',
          visitors: 200,
          pageviews: 600,
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

  describe('spec 020 : colonnes mesurées', () => {
    it('Given a day with one long and one short single-page visit, When aggregated, Then engagement, measured duration and NULL conversions are written', async () => {
      mockAggregateValues();

      await service.manualRun(new Date('2026-04-20T12:00:00Z'));

      const written = {
        durationSamples: 1,
        engagedSessions: 1,
        realBounces: 1,
        contactSubmits: null,
        contactClicks: null,
        profileClicks: null,
        demoClicks: null,
        contactSectionViews: null,
      };
      expect(db.values).toHaveBeenCalledWith(expect.objectContaining(written));
      const [upsert] = db.onConflictDoUpdate.mock.calls[0] as [
        { set: Record<string, unknown> },
      ];
      expect(upsert.set).toEqual(expect.objectContaining(written));
    });
  });

  describe('spec 020 : rattrapage des jours non mesurés', () => {
    const DAY: DayAggregates = {
      visitors: 1,
      pageviews: 1,
      sessions: 1,
      bounces: 1,
      totalDuration: 0,
      durationSamples: 0,
      engagedSessions: 0,
      realBounces: 1,
      projectClicks: 0,
      articleViews: 0,
      cvDownloads: 0,
      ctaClicks: 0,
      contactSubmits: null,
      contactClicks: null,
      profileClicks: null,
      demoClicks: null,
      contactSectionViews: null,
    };
    let compute: jest.SpyInstance;
    const aggregatedDays = () =>
      compute.mock.calls.map(([, start]) =>
        (start as Date).toISOString().slice(0, 10),
      );

    beforeEach(() => {
      compute = jest
        .spyOn(aggregates, 'computeAggregates')
        .mockResolvedValue(DAY);
      db.returning.mockResolvedValue([{ date: 'written' }]);
    });

    afterEach(() => compute.mockRestore());

    it('Given three days of [J-29, J-2] without engagement, When the cron runs, Then J-1 then those days are aggregated, oldest first', async () => {
      const unmeasured = ['2026-03-28', '2026-04-05', '2026-04-24'];
      db.where.mockResolvedValueOnce(
        measuredRows(backfillWindow().filter((d) => !unmeasured.includes(d))),
      );

      await service.aggregateYesterday();

      expect(aggregatedDays()).toEqual(['2026-04-25', ...unmeasured]);
      expect(db.insert).toHaveBeenCalledTimes(4);
    });

    it('Given a day of the window with no daily_stat row at all, When the cron runs, Then it is aggregated too', async () => {
      db.where.mockResolvedValueOnce(
        measuredRows(backfillWindow().filter((d) => d !== '2026-04-10')),
      );

      await service.aggregateYesterday();

      expect(aggregatedDays()).toEqual(['2026-04-25', '2026-04-10']);
    });

    it('Given every day already measured, When the cron runs, Then only J-1 is aggregated (idempotent)', async () => {
      db.where.mockResolvedValueOnce(measuredRows(backfillWindow()));

      await service.aggregateYesterday();

      expect(aggregatedDays()).toEqual(['2026-04-25']);
    });

    it('Given unmeasured days, When the cron runs, Then the backfill happens before the purge of raw events', async () => {
      db.where.mockResolvedValueOnce(measuredRows([]));

      await service.aggregateYesterday();

      expect(compute).toHaveBeenCalledTimes(29);
      const lastAggregation = Math.max(...compute.mock.invocationCallOrder);
      const firstPurge = Math.min(...db.delete.mock.invocationCallOrder);
      expect(lastAggregation).toBeLessThan(firstPurge);
    });

    it('Given a legacy row (sessions 7) whose raw data is gone, When backfilled, Then the historical totals are never rewritten', async () => {
      // Reproduction de la revue : brut incomplet ⇒ le recalcul donne 0 visite.
      compute
        .mockResolvedValueOnce(DAY) // J-1
        .mockResolvedValueOnce({
          ...DAY,
          sessions: 0,
          visitors: 0,
          pageviews: 0,
        });
      db.where.mockResolvedValueOnce(
        measuredRows(backfillWindow().filter((d) => d !== '2026-04-10')),
      );

      await service.aggregateYesterday();

      const [, backfill] = db.onConflictDoUpdate.mock.calls as [
        unknown,
        [{ set: Record<string, unknown>; setWhere?: SQL }],
      ];
      const { set, setWhere } = backfill[0];
      expect(Object.keys(set).sort()).toEqual(
        [
          'contactClicks',
          'contactSectionViews',
          'contactSubmits',
          'demoClicks',
          'durationSamples',
          'engagedSessions',
          'profileClicks',
          'realBounces',
          'updatedAt',
        ].sort(),
      );
      expect(setWhere).toBeDefined();
      expect(
        new PgDialect({ casing: 'snake_case' }).sqlToQuery(setWhere!),
      ).toMatchObject({ sql: '"daily_stat"."sessions" = $1', params: [0] });
    });

    it('Given J-1, When aggregated, Then its row is fully written (pas de garde sur J-1)', async () => {
      db.where.mockResolvedValueOnce(measuredRows(backfillWindow()));

      await service.aggregateYesterday();

      const [[yesterday]] = db.onConflictDoUpdate.mock.calls as [
        [{ set: Record<string, unknown>; setWhere?: SQL }],
      ];
      expect(yesterday.set).toEqual(
        expect.objectContaining({ sessions: 1, pageviews: 1 }),
      );
      expect(yesterday.setWhere).toBeUndefined();
    });

    it('Given a legacy row kept because its visits differ, When backfilled, Then a warning names the day', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      db.where.mockResolvedValueOnce(
        measuredRows(backfillWindow().filter((d) => d !== '2026-04-10')),
      );
      db.returning.mockResolvedValueOnce([]);

      await service.aggregateYesterday();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('2026-04-10'));
      warn.mockRestore();
    });

    it('Given manualRun, When called, Then no backfill happens', async () => {
      await service.manualRun(new Date('2026-04-20T12:00:00Z'));

      expect(aggregatedDays()).toEqual(['2026-04-20']);
      expect(db.select).not.toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('émet une log line au succès', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log');
      mockAggregateValues();
      db.where.mockResolvedValueOnce(measuredRows(backfillWindow()));
      db.where.mockResolvedValueOnce(undefined);
      db.where.mockResolvedValueOnce(undefined);

      await service.aggregateYesterday();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Aggregated 2026-04-25'),
      );
    });
  });
});
