import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { StorageModule } from './storage/storage.module';
import { ProjectsModule } from './projects/projects.module';
import { MailerModule } from './mailer/mailer.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
import * as Sentry from '@sentry/nestjs';
import { ContactModule } from './contact/contact.module';
import { CvModule } from './cv/cv.module';
import { ScheduleModule } from '@nestjs/schedule';
import { AnalyticsModule } from './analytics/analytics.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: ['.env'],
    }),
    AppConfigModule,
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.logLevel,
          transport: config.isDevelopment
            ? {
                target: 'pino-pretty',
                options: { singleLine: true, colorize: true },
              }
            : undefined,
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.newPassword',
            'req.body.currentPassword',
            'req.body.code',
            'req.body.token',
            'req.body.refreshToken',
          ],
          autoLogging: {
            ignore: (req: { url?: string }) => req.url === '/api/health',
          },
          customProps: () => ({ context: 'HTTP' }),
          serializers: {
            req: (req: { id?: string; method?: string; url?: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
            }),
          },
          hooks: {
            logMethod(args, method, level) {
              if (level >= 50) {
                const [first, second] = args as [unknown, string?];
                const msg =
                  typeof first === 'string' ? first : (second ?? 'pino-log');
                Sentry.captureMessage(msg, {
                  level: level >= 50 ? 'error' : 'warning',
                  extra:
                    typeof first === 'object' && first !== null
                      ? { context: first }
                      : undefined,
                });
              }
              method.apply(this, args);
            },
          },
        },
      }),
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    StorageModule,
    ProjectsModule,
    MailerModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
    ContactModule,
    CvModule,
    ScheduleModule.forRoot(),
    AnalyticsModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
