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

/** 8 hexa du SHA-256 : suffisant pour distinguer deux versions d'une même image. */
export function contentHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 8);
}
