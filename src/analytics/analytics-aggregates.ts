import { and, count, countDistinct, eq, gte, lt, sql, sum } from 'drizzle-orm';
import type { Database } from '../database/drizzle.types';
import { analyticsEvent, pageView } from '../database/schema/analytics';

export interface DayAggregates {
  visitors: number;
  pageviews: number;
  sessions: number;
  bounces: number;
  totalDuration: number;
  projectClicks: number;
  articleViews: number;
  cvDownloads: number;
}

export async function computeAggregates(
  db: Database,
  start: Date,
  end: Date,
): Promise<DayAggregates> {
  const dateRange = and(
    gte(pageView.createdAt, start),
    lt(pageView.createdAt, end),
  );
  const eventInRange = (type: string) =>
    and(
      eq(analyticsEvent.eventType, type),
      gte(analyticsEvent.createdAt, start),
      lt(analyticsEvent.createdAt, end),
    );

  const [
    [sessionsRow],
    [pageviewsRow],
    [bouncesRow],
    [durationRow],
    [projectClicksRow],
    [articleViewsRow],
    [cvDownloadsRow],
  ] = await Promise.all([
    db
      .select({ value: countDistinct(pageView.sessionHash) })
      .from(pageView)
      .where(dateRange),
    db.select({ value: count() }).from(pageView).where(dateRange),
    db
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
      .where(dateRange),
    db
      .select({ value: sum(pageView.duration) })
      .from(pageView)
      .where(dateRange),
    db
      .select({ value: count() })
      .from(analyticsEvent)
      .where(eventInRange('project_click')),
    db
      .select({ value: count() })
      .from(analyticsEvent)
      .where(eventInRange('article_view')),
    db
      .select({ value: count() })
      .from(analyticsEvent)
      .where(eventInRange('cv_download')),
  ]);

  // visitors == sessions (both = countDistinct(sessionHash) on same range).
  const sessions = Number(sessionsRow?.value ?? 0);

  return {
    visitors: sessions,
    pageviews: Number(pageviewsRow?.value ?? 0),
    sessions,
    bounces: Number(bouncesRow?.value ?? 0),
    totalDuration: Number(durationRow?.value ?? 0),
    projectClicks: Number(projectClicksRow?.value ?? 0),
    articleViews: Number(articleViewsRow?.value ?? 0),
    cvDownloads: Number(cvDownloadsRow?.value ?? 0),
  };
}
