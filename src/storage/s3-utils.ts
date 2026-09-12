import { createHash } from 'node:crypto';
import type { StorageService } from './storage.service';

/**
 * Deletes an S3 object only if `key` is a non-empty string.
 *
 * Centralises the "media slot may be empty" check shared by projects and
 * profile uploads. DeleteObject is already idempotent server-side, but the
 * guard saves a network round-trip and keeps callers terse.
 */
export async function deleteS3IfExists(
  storage: StorageService,
  bucket: string,
  key: string | null | undefined,
): Promise<void> {
  if (!key) return;
  await storage.delete(bucket, key);
}

/** Suffixe de la carte de partage (JPEG 1200×630) dérivée d'un objet image : `blog/<id>.avif.share.jpg`. */
const SHARE_CARD_SUFFIX = '.share.jpg';

export function shareCardKey(key: string): string {
  return `${key}${SHARE_CARD_SUFFIX}`;
}

export function isShareCardKey(key: string): boolean {
  return key.endsWith(SHARE_CARD_SUFFIX);
}
