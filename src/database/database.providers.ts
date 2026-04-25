import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Provider } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { DRIZZLE } from './drizzle.constants';
import { schema } from './schema';

export const databaseProviders: Provider[] = [
  {
    provide: DRIZZLE,
    inject: [AppConfigService],
    useFactory: (config: AppConfigService) => {
      const client = postgres(config.databaseUrl, {
        max: 10,
        idle_timeout: 20,
        connect_timeout: 10,
        prepare: true,
      });
      return drizzle(client, {
        schema,
        casing: 'snake_case',
        logger: !config.isProduction,
      });
    },
  },
];
