import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Application } from 'express';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { registerOutOfPrefixFallback } from './common/filters/out-of-prefix-fallback';

export type AppSetupOptions = {
  readonly corsOrigins: string[];
  readonly isProduction: boolean;
};

/** Configuration HTTP de l'application (partagée par main.ts et les tests d'intégration), puis `init()`. */
export async function setupApp(
  app: INestApplication,
  { corsOrigins, isProduction }: AppSetupOptions,
): Promise<void> {
  // Pour que req.ip lise X-Forwarded-For derrière un reverse proxy (Caddy/Nginx)
  (app.getHttpAdapter().getInstance() as Application).set('trust proxy', 1);

  // En-têtes de sécurité. CSP désactivée : l'API ne sert que du JSON et Swagger UI (inline).
  // CORP `cross-origin` : les images de /api/storage sont chargées depuis le site (autre origine).
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());

  app.setGlobalPrefix('api');
  app.enableCors({ origin: corsOrigins, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  const exceptionFilter = new HttpExceptionFilter();
  app.useGlobalFilters(exceptionFilter);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Portfolio API')
    .setDescription('NestJS backend for J-Ned portfolio')
    .setVersion(process.env.npm_package_version ?? 'dev')
    .build();
  // Swagger UI hors production seulement : en prod, /docs publiait la carte complète de l'API.
  if (!isProduction) {
    SwaggerModule.setup(
      'docs',
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
    );
  }

  app.enableShutdownHooks();
  await app.init();
  registerOutOfPrefixFallback(app, exceptionFilter);
}
