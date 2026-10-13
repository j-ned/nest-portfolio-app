// Loaded BEFORE NestFactory.create - preload .env manually since @nestjs/config
// hasn't run yet at this point.
import 'dotenv/config';
import * as Sentry from '@sentry/nestjs';
import { sentryBeforeSend } from './common/sentry-before-send';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  const isProduction = process.env.NODE_ENV === 'production';

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    sendDefaultPii: false,
    integrations: [
      Sentry.httpIntegration({
        ignoreIncomingRequests: (url) => url.startsWith('/api/health'),
      }),
    ],
    tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
      ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
      : isProduction
        ? 0.2
        : 1.0,
    ignoreErrors: ['ThrottlerException'],
    beforeSend: sentryBeforeSend,
  });
}
