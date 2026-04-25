import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { databaseProviders } from './database.providers';
import { DRIZZLE, POSTGRES_CLIENT } from './drizzle.constants';
import type postgres from 'postgres';

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [...databaseProviders],
  exports: [DRIZZLE],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(
    @Inject(POSTGRES_CLIENT)
    private readonly client: ReturnType<typeof postgres>,
  ) {}

  async onModuleDestroy() {
    await this.client.end({ timeout: 5 });
  }
}
