// noinspection SqlNoDataSourceInspection,SqlResolve
import { and, gte, inArray, lt, sql } from 'drizzle-orm';
import type { Database } from '../database/drizzle.types';
import { analyticsEvent, dailyStat, pageView } from '../database/schema';
import {
  ENGAGED_DURATION_SECONDS,
  ENGAGEMENT_EVENT_TYPES,
  OUTBOUND_GROUPS,
  V2_EVENT_TYPES,
} from './engagement';
import { type SessionFacts, summarizeSessions } from './session-facts';

/** Conversions d'une journée ; `null` tant qu'aucun événement v2 n'a jamais été vu (non mesuré). */
export type DayConversions = {
  contactSubmits: number | null;
  contactClicks: number | null;
  profileClicks: number | null;
  demoClicks: number | null;
  contactSectionViews: number | null;
};

export type DayAggregates = {
  visitors: number;
  pageviews: number;
  sessions: number;
  bounces: number;
  totalDuration: number;
  durationSamples: number;
  engagedSessions: number;
  realBounces: number;
  projectClicks: number;
  articleViews: number;
  cvDownloads: number;
  ctaClicks: number;
} & DayConversions;

type SessionFactsRow = {
  pages: number;
  duration_sum: number | null;
  duration_samples: number;
  engaged: boolean;
};

type EventCounts = {
  projectClicks: number;
  articleViews: number;
  cvDownloads: number;
  ctaClicks: number;
} & { [K in keyof DayConversions]: number };

const sqlList = (values: readonly string[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

/**
 * Une ligne par visite de la plage. Les pages sont comptées sans fragment : les lignes
 * `/offres/x#demande` déjà en base ne font pas une seconde page.
 *
 * postgres-js ne sait pas lier une `Date` dans un `sql` brut : les bornes passent en ISO et
 * Postgres les convertit en timestamptz.
 */
async function loadSessionFacts(
  db: Database,
  startIso: string,
  endIso: string,
): Promise<SessionFacts[]> {
  const rows = await db.execute<SessionFactsRow>(sql`
    SELECT
      COUNT(DISTINCT split_part(pv.url, '#', 1))::int AS pages,
      SUM(pv.duration)::int AS duration_sum,
      COUNT(pv.duration)::int AS duration_samples,
      EXISTS (
        SELECT 1 FROM ${analyticsEvent} ev
        WHERE ev.session_hash = pv.session_hash
          AND ev.event_type IN (${sqlList(ENGAGEMENT_EVENT_TYPES)})
          AND ev.created_at >= ${startIso}
          AND ev.created_at < ${endIso}
      ) AS engaged
    FROM ${pageView} pv
    WHERE pv.created_at >= ${startIso}
      AND pv.created_at < ${endIso}
    GROUP BY pv.session_hash
  `);
  return rows.map((r) => ({
    pages: Number(r.pages),
    durationSum: r.duration_sum === null ? null : Number(r.duration_sum),
    durationSamples: Number(r.duration_samples),
    engaged: Boolean(r.engaged),
  }));
}

async function countEvents(
  db: Database,
  start: Date,
  end: Date,
): Promise<EventCounts> {
  const ofType = (type: string) =>
    sql<number>`COUNT(*) FILTER (WHERE ${analyticsEvent.eventType} = ${type})::int`;
  const outbound = (channels: readonly string[]) =>
    sql<number>`COUNT(*) FILTER (WHERE ${analyticsEvent.eventType} = 'outbound_click' AND ${analyticsEvent.entityId} IN (${sqlList(channels)}))::int`;

  const [row] = await db
    .select({
      projectClicks: ofType('project_click'),
      articleViews: ofType('article_view'),
      cvDownloads: ofType('cv_download'),
      ctaClicks: ofType('cta_click'),
      contactSubmits: ofType('contact_submit'),
      contactClicks: outbound(OUTBOUND_GROUPS.contact),
      profileClicks: outbound(OUTBOUND_GROUPS.profile),
      demoClicks: outbound(OUTBOUND_GROUPS.demo),
      contactSectionViews: sql<number>`COUNT(*) FILTER (WHERE ${analyticsEvent.eventType} = 'section_view' AND ${analyticsEvent.entityId} = 'home_contact')::int`,
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
          'cta_click',
          ...V2_EVENT_TYPES,
        ]),
      ),
    );

  const n = (v: number | undefined) => Number(v ?? 0);
  return {
    projectClicks: n(row?.projectClicks),
    articleViews: n(row?.articleViews),
    cvDownloads: n(row?.cvDownloads),
    ctaClicks: n(row?.ctaClicks),
    contactSubmits: n(row?.contactSubmits),
    contactClicks: n(row?.contactClicks),
    profileClicks: n(row?.profileClicks),
    demoClicks: n(row?.demoClicks),
    contactSectionViews: n(row?.contactSectionViews),
  };
}

/**
 * Un événement v2 a-t-il déjà été vu au plus tard ce jour-là ? En brut (jours encore présents)
 * ou dans un total journalier antérieur déjà mesuré (jours purgés). Indépendant de l'ordre
 * d'agrégation des jours, sans date en dur.
 */
async function conversionsMeasured(
  db: Database,
  day: string,
  endIso: string,
): Promise<boolean> {
  const [row] = await db.execute<{ measured: boolean }>(sql`
    SELECT (
      EXISTS (
        SELECT 1 FROM ${analyticsEvent}
        WHERE ${analyticsEvent.eventType} IN (${sqlList(V2_EVENT_TYPES)})
          AND ${analyticsEvent.createdAt} < ${endIso}
      )
      OR EXISTS (
        SELECT 1 FROM ${dailyStat}
        WHERE ${dailyStat.date} < ${day}
          AND ${dailyStat.contactSubmits} IS NOT NULL
      )
    ) AS measured
  `);
  return Boolean(row?.measured);
}

export async function computeAggregates(
  db: Database,
  start: Date,
  end: Date,
): Promise<DayAggregates> {
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const [facts, events, measured] = await Promise.all([
    loadSessionFacts(db, startIso, endIso),
    countEvents(db, start, end),
    conversionsMeasured(db, startIso.slice(0, 10), endIso),
  ]);
  const summary = summarizeSessions(facts, ENGAGED_DURATION_SECONDS);
  const conversion = (value: number) => (measured ? value : null);

  return {
    // Une visite = une empreinte d'appareil sur la journée : `visitors` reste égal à `sessions`
    // pour compatibilité du DTO.
    visitors: summary.sessions,
    pageviews: summary.pageviews,
    sessions: summary.sessions,
    bounces: summary.bounces,
    totalDuration: summary.totalDuration,
    durationSamples: summary.durationSamples,
    engagedSessions: summary.engagedSessions,
    realBounces: summary.realBounces,
    projectClicks: events.projectClicks,
    articleViews: events.articleViews,
    cvDownloads: events.cvDownloads,
    ctaClicks: events.ctaClicks,
    contactSubmits: conversion(events.contactSubmits),
    contactClicks: conversion(events.contactClicks),
    profileClicks: conversion(events.profileClicks),
    demoClicks: conversion(events.demoClicks),
    contactSectionViews: conversion(events.contactSectionViews),
  };
}
