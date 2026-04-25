import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { schema } from './schema';

export type Database = PostgresJsDatabase<typeof schema>;
