import { Global, Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { databaseProviders } from './database.providers';
import { DRIZZLE } from './drizzle.constants';

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [...databaseProviders],
  exports: [DRIZZLE],
})
export class DatabaseModule {}
