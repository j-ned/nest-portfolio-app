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
}
