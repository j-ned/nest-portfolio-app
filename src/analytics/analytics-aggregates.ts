// noinspection SqlNoDataSourceInspection,SqlResolve
import { and, gte, inArray, lt, sql } from 'drizzle-orm';
import type { Database } from '../database/drizzle.types';
import { analyticsEvent, pageView } from '../database/schema';

export type DayAggregates = {
  visitors: number;
  pageviews: number;
  sessions: number;
  bounces: number;
  totalDuration: number;
  projectClicks: number;
  articleViews: number;
  cvDownloads: number;
};

type PageViewAggregateRow = {
  pageviews: number;
  total_duration: number;
  sessions: number;
  bounces: number;
};

export async function computeAggregates(
  db: Database,
  start: Date,
  end: Date,
): Promise<DayAggregates> {
  // postgres-js cannot bind a JS Date when it's interpolated inside a raw
  // sql`` template (it works through Drizzle helpers like gte/lt, but not in
  // a CTE we hand-craft). Pass ISO strings and let PG auto-cast to timestamptz.
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const [pageViewRows, eventRows] = await Promise.all([
    db.execute<PageViewAggregateRow>(sql`
      WITH session_counts AS (
        SELECT
          ${pageView.sessionHash} AS session_hash,
          COUNT(*) AS n,
          SUM(${pageView.duration}) AS dur
        FROM ${pageView}
        WHERE ${pageView.createdAt} >= ${startIso}
          AND ${pageView.createdAt} < ${endIso}
        GROUP BY ${pageView.sessionHash}
      )
      SELECT
        COALESCE(SUM(n), 0)::int AS pageviews,
        COALESCE(SUM(dur), 0)::int AS total_duration,
        COUNT(*)::int AS sessions,
        COUNT(*) FILTER (WHERE n = 1)::int AS bounces
      FROM session_counts
    `),
    db
      .select({
        projectClicks: sql<number>`COUNT(*) FILTER (WHERE ${analyticsEvent.eventType} = 'project_click')::int`,
        articleViews: sql<number>`COUNT(*) FILTER (WHERE ${analyticsEvent.eventType} = 'article_view')::int`,
        cvDownloads: sql<number>`COUNT(*) FILTER (WHERE ${analyticsEvent.eventType} = 'cv_download')::int`,
      })
      .from(analyticsEvent)
      .where(
        and(
          gte(analyticsEvent.createdAt, start),
          lt(analyticsEvent.createdAt, end),
          inArray(analyticsEvent.eventType, [
            'project_click',
            'article_view',
            'cv_download',
          ]),
        ),
      ),
  ]);

  const pv = pageViewRows[0];
  const ev = eventRows[0];

  // visitors == sessions (both = COUNT(DISTINCT session_hash) on same range).
  const sessions = Number(pv?.sessions ?? 0);

  return {
    visitors: sessions,
    pageviews: Number(pv?.pageviews ?? 0),
    sessions,
    bounces: Number(pv?.bounces ?? 0),
    totalDuration: Number(pv?.total_duration ?? 0),
    projectClicks: Number(ev?.projectClicks ?? 0),
    articleViews: Number(ev?.articleViews ?? 0),
    cvDownloads: Number(ev?.cvDownloads ?? 0),
  };
}
