import { Logger, UnprocessableEntityException } from '@nestjs/common';
import { timestamp } from 'drizzle-orm/pg-core';

export function fireAndForget(
  promise: Promise<unknown>,
  logger: Logger,
  context: string,
): void {
  promise.catch((err: unknown) => {
    logger.error(context, err instanceof Error ? err.stack : String(err));
  });
}

const DURATION_UNITS_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDurationMs(input: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)$/i.exec(input.trim());
  if (!match) throw new Error(`Invalid duration: "${input}"`);
  return Number(match[1]) * DURATION_UNITS_MS[match[2].toLowerCase()];
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export const subDays = (d: Date, days: number) =>
  new Date(d.getTime() - days * DAY_MS);

export const subMinutes = (d: Date, minutes: number) =>
  new Date(d.getTime() - minutes * MINUTE_MS);

export function formatDate(date: Date): string {
  // Local-timezone YYYY-MM-DD (matches date-fns format(d, 'yyyy-MM-dd')).
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics (NFD form)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const MIME_TO_EXT: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/avif': 'avif',
};

export function mimeToExt(mimetype: string): string {
  const ext = MIME_TO_EXT[mimetype];
  if (!ext) {
    throw new UnprocessableEntityException(
      `Unsupported file type: ${mimetype}`,
    );
  }
  return ext;
}

export function isUniqueViolation(err: unknown, columnHint?: string): boolean {
  // Walk the error cause chain (Drizzle wraps the raw pg error in a
  // DrizzleQueryError whose `.cause` holds the original PostgresError).
  let current: unknown = err;
  let depth = 0;
  while (current !== null && typeof current === 'object' && depth < 5) {
    const obj = current as {
      code?: string;
      constraint_name?: string;
      cause?: unknown;
    };
    if (obj.code === '23505') {
      if (!columnHint) return true;
      const constraint = obj.constraint_name ?? '';
      return constraint.includes(columnHint);
    }
    current = obj.cause;
    depth++;
  }
  return false;
}
