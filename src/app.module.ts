import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { ProfileModule } from './profile/profile.module';
import { HeroModule } from './hero/hero.module';
import { SocialLinksModule } from './social-links/social-links.module';
import { DiplomasModule } from './diplomas/diplomas.module';
import { TechnologiesModule } from './technologies/technologies.module';
import { ExpertisesModule } from './expertises/expertises.module';
import { ServicePricingModule } from './service-pricing/service-pricing.module';
import { StorageModule } from './storage/storage.module';
import { ProjectsModule } from './projects/projects.module';
import { MailerModule } from './mailer/mailer.module';

@Module({
  imports: [
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
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          autoLogging: {
            ignore: (req: { url?: string }) => req.url === '/health',
          },
          customProps: () => ({ context: 'HTTP' }),
          serializers: {
            req: (req: { id?: string; method?: string; url?: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
            }),
          },
        },
      }),
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    ProfileModule,
    HeroModule,
    SocialLinksModule,
    DiplomasModule,
    TechnologiesModule,
    ExpertisesModule,
    ServicePricingModule,
    StorageModule,
    ProjectsModule,
    MailerModule,
  ],
})
export class AppModule {}
