import type { AnalyticsType, OutboundChannel } from './dto/track-event.dto';

/** Temps visible cumulé à partir duquel une visite d'une page est engagée (ADR-0022, validé le 2026-10-10). */
export const ENGAGED_DURATION_SECONDS = 30;

/**
 * Actions volontaires qui rendent une visite engagée. `article_view` et `page_duration` sont
 * automatiques : ils n'en sont pas.
 */
export const ENGAGEMENT_EVENT_TYPES = [
  'cta_click',
  'project_click',
  'article_read',
  'cv_download',
  'contact_submit',
  'outbound_click',
  'section_view',
] as const satisfies readonly AnalyticsType[];

/** Événements apparus avec la spec 020 : tant qu'aucun n'a été vu, les conversions ne sont pas mesurées. */
export const V2_EVENT_TYPES = [
  'contact_submit',
  'outbound_click',
  'section_view',
] as const satisfies readonly AnalyticsType[];

export const OUTBOUND_GROUPS = {
  contact: ['email', 'phone', 'malt', 'discord'],
  profile: ['linkedin', 'github'],
  demo: ['demo'],
} as const satisfies Record<string, readonly OutboundChannel[]>;
