import './instrument';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { setupApp } from './app.setup';
import { AppConfigService } from './config/app-config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get(AppConfigService);
  await setupApp(app, {
    corsOrigins: config.corsOrigins,
    isProduction: config.isProduction,
  });

  await app.listen(config.port);
  app
    .get(Logger)
    .log(
      `Listening on http://localhost:${config.port}${config.isProduction ? '' : ' (docs: /docs)'}`,
    );
}
void bootstrap();
