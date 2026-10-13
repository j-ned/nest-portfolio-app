import { createHash, randomBytes } from 'node:crypto';

/** Empreinte stockée du jeton d'annulation : SHA-256 hexadécimal (64 caractères). */
export const hashCancelToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/**
 * Jeton d'annulation de 32 octets aléatoires en base64url (43 caractères) et son empreinte. Seule
 * l'empreinte est stockée ; le jeton en clair ne vit que dans le lien envoyé au visiteur (ADR-0026).
 */
export function createCancelToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashCancelToken(token) };
}
