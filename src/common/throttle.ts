import { Throttle } from '@nestjs/throttler';

/**
 * Lectures publiques (projets, articles) : 120 req/min au lieu des 10 du garde global.
 * Le build du front (prérendu de chaque page + sitemap + RSS) en consomme une quinzaine en
 * moins d'une minute ; sous la limite globale un 429 faisait publier un site sans pages projet.
 * Les écritures restent sous la limite globale (10/min) ou la leur (contact : 5/min).
 */
export const PUBLIC_READ_THROTTLE = {
  default: { limit: 120, ttl: 60_000 },
} as const;

export const PublicReadThrottle = () => Throttle(PUBLIC_READ_THROTTLE);
