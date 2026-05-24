import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppConfigService } from '../config/app-config.service';

type SentryRuntimeConfig = {
  dsn: string;
  environment: string;
  release: string;
};

type RuntimeConfigResponse = {
  sentry: SentryRuntimeConfig;
};

@ApiTags('Runtime config')
@Controller('config')
export class RuntimeConfigController {
  constructor(private readonly config: AppConfigService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({
    summary:
      'Public runtime configuration for the browser bundle (Sentry DSN, env, release)',
  })
  @ApiResponse({ status: 200 })
  get(): RuntimeConfigResponse {
    return {
      sentry: {
        dsn: this.config.sentryFrontendDsn ?? '',
        environment: this.config.nodeEnv,
        release: this.config.sentryRelease ?? '',
      },
    };
  }
}
