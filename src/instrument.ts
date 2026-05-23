// Loaded BEFORE NestFactory.create — preload .env manually since @nestjs/config
// hasn't run yet at this point.
import 'dotenv/config';
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  const isProduction = process.env.NODE_ENV === 'production';

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    sendDefaultPii: false,
    integrations: [
      nodeProfilingIntegration(),
      Sentry.httpIntegration({
        ignoreIncomingRequests: (url) => url.startsWith('/api/health'),
      }),
    ],
    tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
      ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
      : isProduction
        ? 0.2
        : 1.0,
    profilesSampleRate: 1.0,
    ignoreErrors: ['ThrottlerException'],
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers['authorization'];
          delete event.request.headers['cookie'];
        }
        const data = event.request.data as Record<string, unknown> | undefined;
        if (data) {
          for (const k of [
            'password',
            'newPassword',
            'currentPassword',
            'code',
            'token',
            'refreshToken',
            'jwt',
          ]) {
            if (k in data) data[k] = '[Filtered]';
          }
        }
      }
      return event;
    },
  });
}
