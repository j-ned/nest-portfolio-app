import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, count, countDistinct, eq, gte, lt, sql, sum } from 'drizzle-orm';
import { subDays } from 'date-fns';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  pageView,
  analyticsEvent,
  dailyStat,
} from '../database/schema/analytics';

interface DayAggregates {
  visitors: number;
  pageviews: number;
  sessions: number;
  bounces: number;
  totalDuration: number;
  projectClicks: number;
  articleViews: number;
  cvDownloads: number;
}

@Injectable()
export class AnalyticsAggregatorService {
  private readonly logger = new Logger(AnalyticsAggregatorService.name);
  private static readonly RETENTION_DAYS = 30;

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  @Cron('0 0 * * *', { timeZone: 'UTC' })
  async aggregateYesterday(): Promise<void> {
    const yesterday = subDays(new Date(), 1);
    await this.runAggregation(yesterday);
    await this.purgeOldRawEvents();
  }

  async manualRun(date: Date): Promise<void> {
    await this.runAggregation(date);
  }

  private async runAggregation(day: Date): Promise<void> {
    // Use UTC bounds to avoid local-timezone skew (same pattern as Task 3)
    const dateStr = day.toISOString().slice(0, 10);
    const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

    const aggregates = await this.computeAggregates(dayStart, dayEnd);

    await this.db
      .insert(dailyStat)
      .values({ date: dateStr, ...aggregates })
      .onConflictDoUpdate({
        target: dailyStat.date,
        set: { ...aggregates, updatedAt: new Date() },
      });

    this.logger.log(
      `Aggregated ${dateStr}: ${aggregates.visitors} visitors, ${aggregates.pageviews} pv, ${aggregates.bounces} bounces`,
    );
  }

  private async computeAggregates(
    start: Date,
    end: Date,
  ): Promise<DayAggregates> {
    const [[vRow], [pvRow], [sRow], [bRow], [dRow], [pcRow], [avRow], [cdRow]] =
      await Promise.all([
        this.db
          .select({ value: countDistinct(pageView.sessionHash) })
          .from(pageView)
          .where(
            and(gte(pageView.createdAt, start), lt(pageView.createdAt, end)),
          ),
        this.db
          .select({ value: count() })
          .from(pageView)
          .where(
            and(gte(pageView.createdAt, start), lt(pageView.createdAt, end)),
          ),
        this.db
          .select({ value: countDistinct(pageView.sessionHash) })
          .from(pageView)
          .where(
            and(gte(pageView.createdAt, start), lt(pageView.createdAt, end)),
          ),
        this.db
          .select({
            value: sql<number>`(SELECT COUNT(*) FROM (
            SELECT ${pageView.sessionHash} FROM ${pageView}
            WHERE ${pageView.createdAt} >= ${sql.raw(`'${start.toISOString()}'`)}::timestamptz
              AND ${pageView.createdAt} < ${sql.raw(`'${end.toISOString()}'`)}::timestamptz
            GROUP BY ${pageView.sessionHash}
            HAVING COUNT(*) = 1
          ) AS bounced)`,
          })
          .from(pageView)
          .where(
            and(gte(pageView.createdAt, start), lt(pageView.createdAt, end)),
          ),
        this.db
          .select({ value: sum(pageView.duration) })
          .from(pageView)
          .where(
            and(gte(pageView.createdAt, start), lt(pageView.createdAt, end)),
          ),
        this.db
          .select({ value: count() })
          .from(analyticsEvent)
          .where(
            and(
              eq(analyticsEvent.eventType, 'project_click'),
              gte(analyticsEvent.createdAt, start),
              lt(analyticsEvent.createdAt, end),
            ),
          ),
        this.db
          .select({ value: count() })
          .from(analyticsEvent)
          .where(
            and(
              eq(analyticsEvent.eventType, 'article_view'),
              gte(analyticsEvent.createdAt, start),
              lt(analyticsEvent.createdAt, end),
            ),
          ),
        this.db
          .select({ value: count() })
          .from(analyticsEvent)
          .where(
            and(
              eq(analyticsEvent.eventType, 'cv_download'),
              gte(analyticsEvent.createdAt, start),
              lt(analyticsEvent.createdAt, end),
            ),
          ),
      ]);

    return {
      visitors: Number(vRow?.value ?? 0),
      pageviews: Number(pvRow?.value ?? 0),
      sessions: Number(sRow?.value ?? 0),
      bounces: Number(bRow?.value ?? 0),
      totalDuration: Number(dRow?.value ?? 0),
      projectClicks: Number(pcRow?.value ?? 0),
      articleViews: Number(avRow?.value ?? 0),
      cvDownloads: Number(cdRow?.value ?? 0),
    };
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
