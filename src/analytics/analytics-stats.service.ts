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
  endOfUtcDay,
  formatUtcDate,
  startOfUtcDay,
  subDays,
  subMinutes,
} from '../common/utils';
import { computeAggregates } from './analytics-aggregates';
import { type OverviewDay, summarizeOverview } from './analytics-overview';
import {
  DateRangeQueryDto,
  EventsQueryDto,
  MetricsQueryDto,
} from './dto/date-range-query.dto';

type DateBounds = {
  start: Date;
  end: Date;
  fromDateStr: string;
  toDateStr: string;
  isTodayIncluded: boolean;
};

/** Profondeur des tables brutes (purge du cron) : au-delà, seuls les totaux journaliers existent. */
const RAW_RETENTION_DAYS = 30;

@Injectable()
export class AnalyticsStatsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Jours complets lus dans `daily_stat` (qui couvre toute l'histoire, contrairement aux tables
   * brutes purgées à 30 jours) + aujourd'hui calculé en direct si la plage l'inclut.
   */
  async overview(query: DateRangeQueryDto) {
    const { fromDateStr, toDateStr } = this.bounds(query);
    const now = new Date();
    const today = formatUtcDate(now);
    const lastStoredDay =
      toDateStr < today ? toDateStr : formatUtcDate(subDays(now, 1));

    const days: OverviewDay[] =
      fromDateStr <= lastStoredDay
        ? await this.db
            .select()
            .from(dailyStat)
            .where(
              and(
                gte(dailyStat.date, fromDateStr),
                lte(dailyStat.date, lastStoredDay),
              ),
            )
            .orderBy(asc(dailyStat.date))
        : [];

    if (fromDateStr <= today && toDateStr >= today) {
      const live = await computeAggregates(
        this.db,
        startOfUtcDay(now),
        endOfUtcDay(now),
      );
      days.push({ date: today, ...live });
    }

    const oldestRawDay = formatUtcDate(subDays(now, RAW_RETENTION_DAYS));
    return summarizeOverview(
      days,
      fromDateStr > oldestRawDay ? fromDateStr : oldestRawDay,
    );
  }

  async chart(query: DateRangeQueryDto) {
    const { start, end, isTodayIncluded } = this.bounds(query);
    const today = formatUtcDate(new Date());

    const fromDateStr = formatUtcDate(start);
    const toDateStr = formatUtcDate(end);

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
      const todayStart = startOfUtcDay(new Date());
      const todayEnd = endOfUtcDay(new Date());
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

  /** Top N par visite : une visite de cinq pages compte une fois, pas cinq. */
  async metrics(query: MetricsQueryDto) {
    const { start, end } = this.bounds(query);
    const limit = query.limit ?? 20;

    if (query.type === 'referrer') {
      return this.referrersByVisit(start, end, limit);
    }

    const col = pageView[query.type];
    const visits = countDistinct(pageView.sessionHash);
    return this.db
      .select({ name: col, count: visits })
      .from(pageView)
      .where(
        and(
          isNotNull(col),
          gte(pageView.createdAt, start),
          lt(pageView.createdAt, end),
        ),
      )
      .groupBy(col)
      .orderBy(desc(visits))
      .limit(limit);
  }

  /**
   * Une ligne par visite : sa première provenance externe de la journée, sinon `''` (accès
   * direct, compté). Le front envoie le referrer d'arrivée à chaque page vue d'une SPA : le
   * compter par page gonflait les sources des visites longues.
   */
  private async referrersByVisit(start: Date, end: Date, limit: number) {
    const rows = await this.db.execute<{ name: string; count: number }>(sql`
      WITH visit AS (
        SELECT COALESCE(
          (array_agg(${pageView.referrer} ORDER BY ${pageView.createdAt})
            FILTER (WHERE ${pageView.referrer} IS NOT NULL))[1],
          ''
        ) AS name
        FROM ${pageView}
        WHERE ${pageView.createdAt} >= ${start.toISOString()}
          AND ${pageView.createdAt} < ${end.toISOString()}
        GROUP BY ${pageView.sessionHash}
      )
      SELECT name, COUNT(*)::int AS count
      FROM visit
      GROUP BY name
      ORDER BY count DESC, name
      LIMIT ${limit}
    `);
    return rows.map((r) => ({ name: r.name, count: Number(r.count) }));
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

  async articlesRead(query: DateRangeQueryDto) {
    return this.entityCounts('article_read', query);
  }

  // `entityId` porte l'emplacement du CTA (`home_hero_projects`) : le regroupement
  // par entité donne directement le taux de clic par emplacement.
  async cta(query: DateRangeQueryDto) {
    return this.entityCounts('cta_click', query);
  }

  private async entityCounts(
    eventType: 'project_click' | 'article_view' | 'article_read' | 'cta_click',
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

  // `entityId` porte l'emplacement (`contact_submit`) ou le canal (`outbound_click`).
  async events(query: EventsQueryDto) {
    const { start, end } = this.bounds(query);

    return this.db
      .select({ entityId: analyticsEvent.entityId, count: count() })
      .from(analyticsEvent)
      .where(
        and(
          eq(analyticsEvent.eventType, query.type),
          gte(analyticsEvent.createdAt, start),
          lt(analyticsEvent.createdAt, end),
        ),
      )
      .groupBy(analyticsEvent.entityId)
      .orderBy(desc(count()))
      .limit(query.limit ?? 20);
  }

  async cvDownloads(query: DateRangeQueryDto) {
    const { start, end } = this.bounds(query);

    // Timeline: hardcoded 30 derniers jours, indépendant du query
    const timelineEnd = endOfUtcDay(new Date());
    const timelineStart = startOfUtcDay(subDays(new Date(), 30));

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
    const today = formatUtcDate(now);
    const fromStr = query.startDate ?? formatUtcDate(subDays(now, 30));
    const toStr = query.endDate ?? today;

    const start = startOfUtcDay(new Date(`${fromStr}T00:00:00Z`));
    const end = endOfUtcDay(new Date(`${toStr}T00:00:00Z`));

    return {
      start,
      end,
      fromDateStr: fromStr,
      toDateStr: toStr,
      isTodayIncluded: toStr === today,
    };
  }
}
