import './instrument';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { Application } from 'express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppConfigService } from './config/app-config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // Pour que req.ip lise X-Forwarded-For derrière un reverse proxy (Caddy/Nginx)
  (app.getHttpAdapter().getInstance() as Application).set('trust proxy', 1);
  app.useLogger(app.get(Logger));

  const config = app.get(AppConfigService);

  app.use(cookieParser());

  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.corsOrigins, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Portfolio API')
    .setDescription('NestJS backend for J-Ned portfolio')
    .setVersion(process.env.npm_package_version ?? 'dev')
    .build();
  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  app.enableShutdownHooks();
  await app.listen(config.port);
  app
    .get(Logger)
    .log(`Listening on http://localhost:${config.port} (docs: /docs)`);
}
void bootstrap();
