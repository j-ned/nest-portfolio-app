import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (u) => u.startsWith('postgres://') || u.startsWith('postgresql://'),
      { message: 'DATABASE_URL must be a postgres:// URL' },
    ),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .optional(),

  // Auth
  JWT_SECRET: z
    .string()
    .min(32, { message: 'JWT_SECRET must be at least 32 characters' }),
  JWT_EXPIRES_IN: z.string().default('7d'),
  /**
   * Domaine du cookie d'auth. Utiliser un point devant pour partager entre subdomains
   * (ex: `.nedellec-julien.fr` couvre `nedellec-julien.fr` ET `api.nedellec-julien.fr`). Sans cette valeur le cookie
   * n'est valide que pour l'origine exacte de l'API, ce qui peut être bloqué par les
   * browsers en mode strict (Firefox Total Cookie Protection, Chrome 3rd-party isolation).
   * En dev local laisser vide → cookie attaché à `localhost`.
   */
  COOKIE_DOMAIN: z.string().optional(),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_INITIAL_PASSWORD: z
    .string()
    .min(12, {
      message:
        'ADMIN_INITIAL_PASSWORD must be at least 12 characters when provided',
    })
    .optional(),
  TOTP_APP_NAME: z.string().default('J-Ned Portfolio'),

  /**
   * Origines autorisées par CORS (requêtes credentials), séparées par des virgules.
   * Prod: `https://nedellec-julien.fr,https://www.nedellec-julien.fr`.
   * Dev local: `http://localhost:4200` (défaut).
   */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:4200')
    .transform((v) =>
      v
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  // S3 Storage
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(4),
  S3_SECRET_KEY: z.string().min(8),

  // Mailer (SMTP)
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  SMTP_FROM: z.string().email(),

  // Observability (Sentry) — all optional, empty DSN keeps Sentry disabled
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_RELEASE: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  // Browser DSN exposed via GET /api/config (separate Sentry project from backend).
  // Public by design (ships in the browser bundle once fetched).
  SENTRY_FRONTEND_DSN: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;
