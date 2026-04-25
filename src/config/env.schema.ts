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
  ADMIN_EMAIL: z.string().email(),
  ADMIN_INITIAL_PASSWORD: z.string().min(12, {
    message: 'ADMIN_INITIAL_PASSWORD must be at least 12 characters',
  }),
  TOTP_APP_NAME: z.string().default('J-Ned Portfolio'),
});

export type Env = z.infer<typeof envSchema>;
