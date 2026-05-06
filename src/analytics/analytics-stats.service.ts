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
import {
  pageView,
  analyticsEvent,
  dailyStat,
} from '../database/schema/analytics';
import {
  endOfDay,
  formatDate,
  startOfDay,
  subDays,
  subMinutes,
} from '../common/utils';
import { computeAggregates } from './analytics-aggregates';
import { DateRangeQueryDto, MetricsQueryDto } from './dto/date-range-query.dto';

interface DateBounds {
  start: Date;
  end: Date;
  toDateStr: string;
  isTodayIncluded: boolean;
}

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
      totalVisitors: a.visitors,
      totalPageviews: a.pageviews,
      totalSessions: a.sessions,
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

    const histRows = await this.db
      .select({
        date: dailyStat.date,
        visitors: dailyStat.visitors,
        pageviews: dailyStat.pageviews,
      })
      .from(dailyStat)
      .where(whereClause)
      .orderBy(asc(dailyStat.date));

    const data = histRows;

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

    return { data };
  }

  async metrics(query: MetricsQueryDto) {
    const { start, end } = this.bounds(query);
    const limit = query.limit ?? 20;

    const col = pageView[query.type as keyof typeof pageView] as never;

    const rows = await this.db
      .select({
        value: col,
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

    return { type: query.type, data: rows };
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

    const rows = await this.db
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

    return { data: rows };
  }

  async cvDownloads(query: DateRangeQueryDto) {
    const { start, end } = this.bounds(query);

    // Timeline: hardcoded 30 derniers jours, indépendant du query
    const timelineEnd = endOfDay(new Date());
    const timelineStart = startOfDay(subDays(new Date(), 30));

    const [[totalRow], timeline] = await Promise.all([
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
      total: Number(totalRow?.value ?? 0),
      timeline,
    };
  }

  private bounds(query: DateRangeQueryDto): DateBounds {
    const now = new Date();
    const today = formatDate(now);
    const fromStr = query.from ?? formatDate(subDays(now, 30));
    const toStr = query.to ?? today;

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
