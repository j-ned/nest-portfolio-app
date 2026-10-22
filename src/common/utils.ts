import { Logger } from '@nestjs/common';
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

// Jours UTC explicites : `daily_stat.date` et l'empreinte de session (`ip|ua|jour`) sont des
// jours UTC. Indépendant du fuseau du processus (`TZ`).
export const formatUtcDate = (date: Date): string =>
  date.toISOString().slice(0, 10);

export function startOfUtcDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function endOfUtcDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
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

/**
 * Erreur Postgres `code` dans la chaîne `cause` (Drizzle enveloppe l'erreur brute dans une
 * `DrizzleQueryError` dont `.cause` porte la `PostgresError`), sur une contrainte dont le nom
 * contient `hint` s'il est fourni.
 */
function hasPgViolation(err: unknown, code: string, hint?: string): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5; depth++) {
    if (current === null || typeof current !== 'object') return false;
    const fields = current as {
      code?: unknown;
      constraint_name?: unknown;
      cause?: unknown;
    };
    if (fields.code === code) {
      return (
        !hint ||
        (typeof fields.constraint_name === 'string' &&
          fields.constraint_name.includes(hint))
      );
    }
    current = fields.cause;
  }
  return false;
}

/** Violation d'unicité (`23505`), éventuellement sur une contrainte dont le nom contient `columnHint`. */
export const isUniqueViolation = (err: unknown, columnHint?: string): boolean =>
  hasPgViolation(err, '23505', columnHint);
