import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Provider } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { DRIZZLE, POSTGRES_CLIENT } from './drizzle.constants';
import { schema } from './schema';

export const databaseProviders: Provider[] = [
  {
    provide: POSTGRES_CLIENT,
    inject: [AppConfigService],
    useFactory: (config: AppConfigService) => {
      return postgres(config.databaseUrl, {
        max: 10,
        idle_timeout: 20,
        connect_timeout: 10,
        prepare: true,
      });
    },
  },
  {
    provide: DRIZZLE,
    inject: [POSTGRES_CLIENT, AppConfigService],
    useFactory: (
      client: ReturnType<typeof postgres>,
      config: AppConfigService,
    ) => {
      return drizzle(client, {
        schema,
        casing: 'snake_case',
        logger: !config.isProduction,
      });
    },
  },
];
