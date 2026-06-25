import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  isNotNull,
  lt,
  lte,
  sql,
} from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { pageView, analyticsEvent, dailyStat } from '../database/schema';
import {
  endOfDay,
  formatDate,
  startOfDay,
  subDays,
  subMinutes,
} from '../common/utils';
import { computeAggregates } from './analytics-aggregates';
import { DateRangeQueryDto, MetricsQueryDto } from './dto/date-range-query.dto';

type DateBounds = {
  start: Date;
  end: Date;
  toDateStr: string;
  isTodayIncluded: boolean;
};

@Injectable()
export class AnalyticsStatsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async overview(query: DateRangeQueryDto) {
    const { start, end } = this.bounds(query);
    const a = await computeAggregates(this.db, start, end);

    const bounceRate =
      a.sessions > 0 ? Math.round((a.bounces / a.sessions) * 10000) / 100 : 0;
    const avgDuration =
      a.pageviews > 0 ? Math.round(a.totalDuration / a.pageviews) : 0;

    return {
      visitors: a.visitors,
      pageviews: a.pageviews,
      sessions: a.sessions,
      bounces: a.bounces,
      bounceRate,
      avgDuration,
      projectClicks: a.projectClicks,
      articleViews: a.articleViews,
      cvDownloads: a.cvDownloads,
    };
  }

  async chart(query: DateRangeQueryDto) {
    const { start, end, isTodayIncluded } = this.bounds(query);
    const today = formatDate(new Date());

    const fromDateStr = formatDate(start);
    const toDateStr = formatDate(end);

    const whereClause = isTodayIncluded
      ? and(gte(dailyStat.date, fromDateStr), lt(dailyStat.date, today))
      : and(gte(dailyStat.date, fromDateStr), lte(dailyStat.date, toDateStr));

    const data = await this.db
      .select({
        date: dailyStat.date,
        visitors: dailyStat.visitors,
        pageviews: dailyStat.pageviews,
      })
      .from(dailyStat)
      .where(whereClause)
      .orderBy(asc(dailyStat.date));

    if (isTodayIncluded && toDateStr === today) {
      const todayStart = startOfDay(new Date());
      const todayEnd = endOfDay(new Date());
      const [[v], [p]] = await Promise.all([
        this.db
          .select({ value: countDistinct(pageView.sessionHash) })
          .from(pageView)
          .where(
            and(
              gte(pageView.createdAt, todayStart),
              lt(pageView.createdAt, todayEnd),
            ),
          ),
        this.db
          .select({ value: count() })
          .from(pageView)
          .where(
            and(
              gte(pageView.createdAt, todayStart),
              lt(pageView.createdAt, todayEnd),
            ),
          ),
      ]);
      data.push({
        date: today,
        visitors: Number(v?.value ?? 0),
        pageviews: Number(p?.value ?? 0),
      });
    }

    return data;
  }

  async metrics(query: MetricsQueryDto) {
    const { start, end } = this.bounds(query);
    const limit = query.limit ?? 20;

    const col = pageView[query.type as keyof typeof pageView] as never;

    return this.db
      .select({
        name: col,
        count: count(),
      })
      .from(pageView)
      .where(
        and(
          isNotNull(col),
          gte(pageView.createdAt, start),
          lt(pageView.createdAt, end),
        ),
      )
      .groupBy(col)
      .orderBy(desc(count()))
      .limit(limit);
  }

  async active() {
    const cutoff = subMinutes(new Date(), 5);

    const [[c], pages] = await Promise.all([
      this.db
        .select({ value: countDistinct(pageView.sessionHash) })
        .from(pageView)
        .where(gte(pageView.createdAt, cutoff)),
      this.db
        .select({ url: pageView.url, count: count() })
        .from(pageView)
        .where(gte(pageView.createdAt, cutoff))
        .groupBy(pageView.url)
        .orderBy(desc(count()))
        .limit(20),
    ]);

    return { count: Number(c?.value ?? 0), pages };
  }

  async projects(query: DateRangeQueryDto) {
    return this.entityCounts('project_click', query);
  }

  async articles(query: DateRangeQueryDto) {
    return this.entityCounts('article_view', query);
  }

  private async entityCounts(
    eventType: 'project_click' | 'article_view',
    query: DateRangeQueryDto,
  ) {
    const { start, end } = this.bounds(query);
    const limit = query.limit ?? 20;

    return this.db
      .select({
        entityId: analyticsEvent.entityId,
        entityTitle: analyticsEvent.entityTitle,
        count: count(),
      })
      .from(analyticsEvent)
      .where(
        and(
          eq(analyticsEvent.eventType, eventType),
          gte(analyticsEvent.createdAt, start),
          lt(analyticsEvent.createdAt, end),
        ),
      )
      .groupBy(analyticsEvent.entityId, analyticsEvent.entityTitle)
      .orderBy(desc(count()))
      .limit(limit);
  }

  async cvDownloads(query: DateRangeQueryDto) {
    const { start, end } = this.bounds(query);

    // Timeline: hardcoded 30 derniers jours, indépendant du query
    const timelineEnd = endOfDay(new Date());
    const timelineStart = startOfDay(subDays(new Date(), 30));

    const [[countRow], timeline] = await Promise.all([
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
      this.db
        .select({
          date: sql<string>`DATE(${analyticsEvent.createdAt})`,
          count: count(),
        })
        .from(analyticsEvent)
        .where(
          and(
            eq(analyticsEvent.eventType, 'cv_download'),
            gte(analyticsEvent.createdAt, timelineStart),
            lt(analyticsEvent.createdAt, timelineEnd),
          ),
        )
        .groupBy(sql`DATE(${analyticsEvent.createdAt})`)
        .orderBy(desc(sql`DATE(${analyticsEvent.createdAt})`)),
    ]);

    return {
      count: Number(countRow?.value ?? 0),
      timeline,
    };
  }

  private bounds(query: DateRangeQueryDto): DateBounds {
    const now = new Date();
    const today = formatDate(now);
    const fromStr = query.startDate ?? formatDate(subDays(now, 30));
    const toStr = query.endDate ?? today;

    const start = startOfDay(new Date(`${fromStr}T00:00:00Z`));
    const end = endOfDay(new Date(`${toStr}T00:00:00Z`));

    return {
      start,
      end,
      toDateStr: toStr,
      isTodayIncluded: toStr === today,
    };
  }
}
