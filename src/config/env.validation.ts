import { envSchema } from './env.schema';

export function validateEnv(raw: Record<string, unknown>) {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${formatted}`);
  }
  const data = result.data;
  return {
    ...data,
    LOG_LEVEL:
      data.LOG_LEVEL ?? (data.NODE_ENV === 'development' ? 'debug' : 'info'),
  };
}
