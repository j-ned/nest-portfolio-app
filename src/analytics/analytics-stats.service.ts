import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  isNotNull,
  lt,
  sql,
  sum,
} from 'drizzle-orm';
import { format, subDays, subMinutes, startOfDay, endOfDay } from 'date-fns';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  pageView,
  analyticsEvent,
  dailyStat,
} from '../database/schema/analytics';
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
            WHERE ${pageView.createdAt} >= ${start}
              AND ${pageView.createdAt} < ${end}
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

    const totalVisitors = Number(vRow?.value ?? 0);
    const totalPageviews = Number(pvRow?.value ?? 0);
    const totalSessions = Number(sRow?.value ?? 0);
    const bounces = Number(bRow?.value ?? 0);
    const totalDuration = Number(dRow?.value ?? 0);
    const projectClicks = Number(pcRow?.value ?? 0);
    const articleViews = Number(avRow?.value ?? 0);
    const cvDownloads = Number(cdRow?.value ?? 0);

    const bounceRate =
      totalSessions > 0
        ? Math.round((bounces / totalSessions) * 10000) / 100
        : 0;
    const avgDuration =
      totalPageviews > 0 ? Math.round(totalDuration / totalPageviews) : 0;

    return {
      totalVisitors,
      totalPageviews,
      totalSessions,
      bounceRate,
      avgDuration,
      projectClicks,
      articleViews,
      cvDownloads,
    };
  }

  async chart(query: DateRangeQueryDto) {
    const { start, end, toDateStr, isTodayIncluded } = this.bounds(query);
    const today = format(new Date(), 'yyyy-MM-dd');

    const fromDateStr = format(start, 'yyyy-MM-dd');
    const histEndDateStr = isTodayIncluded ? today : format(end, 'yyyy-MM-dd');

    const histRows = await this.db
      .select({
        date: dailyStat.date,
        visitors: dailyStat.visitors,
        pageviews: dailyStat.pageviews,
      })
      .from(dailyStat)
      .where(
        and(
          gte(dailyStat.date, fromDateStr),
          lt(dailyStat.date, histEndDateStr),
        ),
      )
      .orderBy(desc(dailyStat.date));

    const data = histRows.reverse(); // ASC

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
            gte(analyticsEvent.createdAt, start),
            lt(analyticsEvent.createdAt, end),
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
    const today = format(now, 'yyyy-MM-dd');
    const fromStr = query.from ?? format(subDays(now, 30), 'yyyy-MM-dd');
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
