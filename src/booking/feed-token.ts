import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Jeton du flux d'agenda (ADR-0028) : dérivé du secret serveur et du sel en base, jamais stocké.
 * HMAC-SHA256 en base64url, soit 43 caractères.
 */
export function deriveFeedToken(secret: string, salt: string): string {
  return createHmac('sha256', secret)
    .update(`booking-feed:${salt}`)
    .digest('base64url');
}

/** Sel d'une génération de lien : 16 octets aléatoires en base64url, soit 22 caractères. */
export function createFeedSalt(): string {
  return randomBytes(16).toString('base64url');
}

/** Comparaison à temps constant ; des longueurs différentes sont refusées sans comparer. */
export function feedTokenMatches(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return (
    candidateBytes.length === expectedBytes.length &&
    timingSafeEqual(candidateBytes, expectedBytes)
  );
}
