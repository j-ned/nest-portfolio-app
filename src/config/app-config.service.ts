import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get nodeEnv() {
    return this.config.get('NODE_ENV', { infer: true });
  }
  get isProduction() {
    return this.nodeEnv === 'production';
  }
  get isDevelopment() {
    return this.nodeEnv === 'development';
  }
  get isTest() {
    return this.nodeEnv === 'test';
  }
  get port() {
    return this.config.get('PORT', { infer: true });
  }
  get databaseUrl() {
    return this.config.get('DATABASE_URL', { infer: true });
  }
  get logLevel() {
    return this.config.get('LOG_LEVEL', { infer: true });
  }

  get jwtSecret() {
    return this.config.get('JWT_SECRET', { infer: true });
  }
  get jwtExpiresIn() {
    return this.config.get('JWT_EXPIRES_IN', { infer: true });
  }
  get cookieDomain() {
    return this.config.get('COOKIE_DOMAIN', { infer: true });
  }
  get adminEmail() {
    return this.config.get('ADMIN_EMAIL', { infer: true });
  }
  get adminInitialPassword() {
    return this.config.get('ADMIN_INITIAL_PASSWORD', { infer: true });
  }
  get totpAppName() {
    return this.config.get('TOTP_APP_NAME', { infer: true });
  }

  get s3Endpoint() {
    return this.config.get('S3_ENDPOINT', { infer: true });
  }
  get s3Region() {
    return this.config.get('S3_REGION', { infer: true });
  }
  get s3AccessKey() {
    return this.config.get('S3_ACCESS_KEY', { infer: true });
  }
  get s3SecretKey() {
    return this.config.get('S3_SECRET_KEY', { infer: true });
  }

  get smtpHost() {
    return this.config.get('SMTP_HOST', { infer: true });
  }
  get smtpPort() {
    return this.config.get('SMTP_PORT', { infer: true });
  }
  get smtpSecure() {
    return this.config.get('SMTP_SECURE', { infer: true });
  }
  get smtpUser() {
    return this.config.get('SMTP_USER', { infer: true });
  }
  get smtpPass() {
    return this.config.get('SMTP_PASS', { infer: true });
  }
  get smtpFrom() {
    return this.config.get('SMTP_FROM', { infer: true });
  }

  get sentryRelease() {
    return this.config.get('SENTRY_RELEASE', { infer: true });
  }
  get sentryFrontendDsn() {
    return this.config.get('SENTRY_FRONTEND_DSN', { infer: true });
  }
}
