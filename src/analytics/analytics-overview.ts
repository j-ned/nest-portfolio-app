import type { DailyStat } from '../database/schema';
import type { DayAggregates } from './analytics-aggregates';
import { ENGAGED_DURATION_SECONDS } from './engagement';

/** Un jour de la plage : ligne `daily_stat` (jour complet) ou agrégat en direct d'aujourd'hui. */
export type OverviewDay = { date: string } & (
  | DayAggregates
  | Omit<DailyStat, 'id' | 'createdAt' | 'updatedAt'>
);

const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0;

const sum = <T>(items: readonly T[], pick: (item: T) => number | null) =>
  items.reduce((total, item) => total + (pick(item) ?? 0), 0);

/**
 * Somme les jours de la plage. Une colonne nullable n'est sommée que sur les jours où elle est
 * mesurée, et divisée par le dénominateur de ces mêmes jours (ADR-0022 §4).
 */
export function summarizeOverview(
  days: readonly OverviewDay[],
  detailSince: string,
) {
  const sessions = sum(days, (d) => d.sessions);
  const bounces = sum(days, (d) => d.bounces);

  const timed = days.filter((d) => d.durationSamples !== null);
  const durationSamples = sum(timed, (d) => d.durationSamples);

  const engaged = days.filter((d) => d.engagedSessions !== null);
  const measuredSessions = sum(engaged, (d) => d.sessions);
  const realBounces = sum(engaged, (d) => d.realBounces);
  const realBounceRate = percent(realBounces, measuredSessions);

  const converted = days.filter((d) => d.contactSubmits !== null);

  return {
    // `visitors` reste égal à `sessions` (compatibilité) : une visite, pas un visiteur.
    visitors: sum(days, (d) => d.visitors),
    pageviews: sum(days, (d) => d.pageviews),
    sessions,
    bounces,
    bounceRate: percent(bounces, sessions),
    avgDuration:
      durationSamples > 0
        ? Math.round(sum(timed, (d) => d.totalDuration) / durationSamples)
        : 0,
    durationCoverage: percent(
      durationSamples,
      sum(timed, (d) => d.pageviews),
    ),
    detailSince,
    projectClicks: sum(days, (d) => d.projectClicks),
    articleViews: sum(days, (d) => d.articleViews),
    cvDownloads: sum(days, (d) => d.cvDownloads),
    ctaClicks: sum(days, (d) => d.ctaClicks),
    engagement: {
      measuredSince: engaged[0]?.date ?? null,
      measuredSessions,
      engagedSessions: sum(engaged, (d) => d.engagedSessions),
      realBounces,
      realBounceRate,
      engagementRate:
        measuredSessions > 0
          ? Math.round((100 - realBounceRate) * 100) / 100
          : 0,
      thresholdSeconds: ENGAGED_DURATION_SECONDS,
    },
    conversions: {
      measuredSince: converted[0]?.date ?? null,
      contactSubmits: sum(converted, (d) => d.contactSubmits),
      contactClicks: sum(converted, (d) => d.contactClicks),
      profileClicks: sum(converted, (d) => d.profileClicks),
      demoClicks: sum(converted, (d) => d.demoClicks),
      contactSectionViews: sum(converted, (d) => d.contactSectionViews),
    },
  };
}
