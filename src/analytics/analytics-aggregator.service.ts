import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { and, eq, gte, isNotNull, lt, lte } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  analyticsEvent,
  dailyStat,
  pageView,
} from '../database/schema/analytics';
import { subDays } from '../common/utils';
import { type DayAggregates, computeAggregates } from './analytics-aggregates';

@Injectable()
export class AnalyticsAggregatorService {
  private readonly logger = new Logger(AnalyticsAggregatorService.name);
  private static readonly RETENTION_DAYS = 30;
  /** Jours encore entiers en brut au moment du cron, J-1 exclu (agrégé juste avant). */
  private static readonly BACKFILL_OLDEST_DAY = 29;
  private static readonly BACKFILL_NEWEST_DAY = 2;

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  @Sentry.SentryCron('analytics-aggregate-yesterday', {
    schedule: { type: 'crontab', value: '0 0 * * *' },
    timezone: 'UTC',
    checkinMargin: 5,
    maxRuntime: 30,
  })
  @Cron('0 0 * * *', { timeZone: 'UTC' })
  async aggregateYesterday(): Promise<void> {
    const now = new Date();
    await this.runAggregation(subDays(now, 1));
    await this.backfillUnmeasuredDays(now);
    await this.purgeOldRawEvents();
  }

  async manualRun(date: Date): Promise<void> {
    await this.runAggregation(date);
  }

  private async runAggregation(day: Date): Promise<void> {
    const { dateStr, aggregates } = await this.aggregateDay(day);

    await this.db
      .insert(dailyStat)
      .values({ date: dateStr, ...aggregates })
      .onConflictDoUpdate({
        target: dailyStat.date,
        set: { ...aggregates, updatedAt: new Date() },
      });

    this.logAggregated(dateStr, aggregates);
  }

  /**
   * Rattrapage d'un jour non mesuré. Une ligne absente est créée en entier ; sur une ligne
   * existante, seules les colonnes nullables de la spec 020 sont remplies, et seulement si le brut
   * redonne le même nombre de visites : un brut incomplet ne réécrit jamais un total historique.
   */
  private async backfillDay(day: Date): Promise<void> {
    const { dateStr, aggregates } = await this.aggregateDay(day);
    const measured = {
      durationSamples: aggregates.durationSamples,
      engagedSessions: aggregates.engagedSessions,
      realBounces: aggregates.realBounces,
      contactSubmits: aggregates.contactSubmits,
      contactClicks: aggregates.contactClicks,
      profileClicks: aggregates.profileClicks,
      demoClicks: aggregates.demoClicks,
      contactSectionViews: aggregates.contactSectionViews,
    };

    const written = await this.db
      .insert(dailyStat)
      .values({ date: dateStr, ...aggregates })
      .onConflictDoUpdate({
        target: dailyStat.date,
        set: { ...measured, updatedAt: new Date() },
        setWhere: eq(dailyStat.sessions, aggregates.sessions),
      })
      .returning({ date: dailyStat.date });

    if (written.length === 0) {
      this.logger.warn(
        `Backfill skipped ${dateStr}: stored visits differ from the ${aggregates.sessions} found in raw data, totals kept`,
      );
      return;
    }
    this.logAggregated(dateStr, aggregates);
  }

  private async aggregateDay(
    day: Date,
  ): Promise<{ dateStr: string; aggregates: DayAggregates }> {
    const dateStr = day.toISOString().slice(0, 10);
    const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);
    return {
      dateStr,
      aggregates: await computeAggregates(this.db, dayStart, dayEnd),
    };
  }

  private logAggregated(dateStr: string, aggregates: DayAggregates): void {
    this.logger.log(
      `Aggregated ${dateStr}: ${aggregates.sessions} visits, ${aggregates.pageviews} pv, ${aggregates.bounces} bounces, ${aggregates.realBounces} real bounces`,
    );
  }

  /**
   * Recalcule, avant la purge, les jours encore en brut dont l'engagement n'a jamais été mesuré
   * (ligne antérieure à la spec 020, ou absente). Idempotent : un jour mesuré n'est pas recalculé.
   */
  private async backfillUnmeasuredDays(now: Date): Promise<void> {
    const { BACKFILL_OLDEST_DAY, BACKFILL_NEWEST_DAY } =
      AnalyticsAggregatorService;
    const window = Array.from(
      { length: BACKFILL_OLDEST_DAY - BACKFILL_NEWEST_DAY + 1 },
      (_, i) =>
        subDays(now, BACKFILL_OLDEST_DAY - i)
          .toISOString()
          .slice(0, 10),
    );

    const measured = await this.db
      .select({ date: dailyStat.date })
      .from(dailyStat)
      .where(
        and(
          gte(dailyStat.date, window[0]),
          lte(dailyStat.date, window[window.length - 1]),
          isNotNull(dailyStat.engagedSessions),
        ),
      );
    const measuredDates = new Set(measured.map((row) => row.date));

    for (const day of window.filter((d) => !measuredDates.has(d))) {
      await this.backfillDay(new Date(`${day}T00:00:00.000Z`));
    }
  }

  private async purgeOldRawEvents(): Promise<void> {
    const cutoff = subDays(
      new Date(),
      AnalyticsAggregatorService.RETENTION_DAYS,
    );
    await this.db.delete(pageView).where(lt(pageView.createdAt, cutoff));
    await this.db
      .delete(analyticsEvent)
      .where(lt(analyticsEvent.createdAt, cutoff));
    this.logger.log(
      `Purged page_view + analytics_event older than ${cutoff.toISOString()}`,
    );
  }
}
