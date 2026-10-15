import { Logger } from '@nestjs/common';
import { envSchema } from './env.schema';

export const BOOKING_FEED_SECRET_MIN_LENGTH = 32;

export function validateEnv(raw: Record<string, unknown>) {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${formatted}`);
  }
  const { BOOKING_FEED_SECRET, ...data } = result.data;
  return {
    ...data,
    LOG_LEVEL:
      data.LOG_LEVEL ?? (data.NODE_ENV === 'development' ? 'debug' : 'info'),
    ...bookingFeedSecret(BOOKING_FEED_SECRET),
  };
}

/**
 * Une faute de frappe dans Dokploy ne coupe ni l'API ni les réservations (décision du 2026-10-15) :
 * une valeur trop courte vaut absente, et l'avertissement nomme la variable sans jamais citer sa valeur.
 */
const bookingFeedSecret = (
  secret: string | undefined,
): { BOOKING_FEED_SECRET?: string } => {
  if (secret === undefined) return {};
  if (secret.length < BOOKING_FEED_SECRET_MIN_LENGTH) {
    new Logger('Env').warn(
      `BOOKING_FEED_SECRET ignored: it must be at least ${BOOKING_FEED_SECRET_MIN_LENGTH} characters. Calendar subscription stays unconfigured.`,
    );
    return {};
  }
  return { BOOKING_FEED_SECRET: secret };
};
