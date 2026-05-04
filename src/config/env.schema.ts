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
   * (ex: `.j-ned.dev` couvre `j-ned.dev` ET `api.j-ned.dev`). Sans cette valeur le cookie
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

  // S3 Storage
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(4),
  S3_SECRET_KEY: z.string().min(8),
  S3_PUBLIC_URL: z.string().url().optional(),

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

  // Contact
  CONTACT_EMAIL: z.string().email(),
  CONTACT_PHONE: z.string().min(1),
  CONTACT_LOCATION: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;
