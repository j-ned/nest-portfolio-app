import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { lt } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  analyticsEvent,
  dailyStat,
  pageView,
} from '../database/schema/analytics';
import { subDays } from '../common/utils';
import { computeAggregates } from './analytics-aggregates';

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
    const dateStr = day.toISOString().slice(0, 10);
    const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

    const aggregates = await computeAggregates(this.db, dayStart, dayEnd);

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
