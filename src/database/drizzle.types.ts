import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { schema } from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Connexion partagée ou transaction en cours : les lectures d'un service sous verrou passent par `tx`. */
export type DbExecutor = Database | Transaction;
