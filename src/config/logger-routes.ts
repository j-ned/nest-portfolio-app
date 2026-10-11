import { RequestMethod } from '@nestjs/common';
import type { Params } from 'nestjs-pino';

/**
 * Routes du middleware HTTP de nestjs-pino. Le défaut de la lib (`path: '*'`) devient
 * `/api/*` sous le préfixe global : syntaxe refusée par path-to-regexp v8 (Express 5), que
 * Nest convertit en `/api/{*path}` en journalisant un warn `LegacyRouteConverter` par
 * middleware. `/{*path}` produit directement ce chemin, donc les mêmes routes : `/api/` et
 * ses sous-chemins ; `/api` nu ne l'était pas et ne l'est toujours pas.
 */
export const LOGGER_ROUTES: NonNullable<Params['forRoutes']> = [
  { path: '/{*path}', method: RequestMethod.ALL },
];
