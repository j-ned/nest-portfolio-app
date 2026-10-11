import { RequestMethod } from '@nestjs/common';
import type { Params } from 'nestjs-pino';

/**
 * Routes du middleware HTTP de nestjs-pino : `/api/` et ses sous-chemins, pas `/api` nu.
 * nestjs-pino 4 prenait par défaut `path: '*'`, refusé par path-to-regexp v8 (Express 5) et
 * converti par Nest avec un warn `LegacyRouteConverter` ; `/{*path}` donnait les mêmes routes
 * sans warn. nestjs-pino 5 a changé son défaut pour `{/*splat}`, qui ne prévient plus mais
 * journalise aussi `/api` nu : on garde ces routes explicites pour ne rien changer aux logs.
 */
export const LOGGER_ROUTES: NonNullable<Params['forRoutes']> = [
  { path: '/{*path}', method: RequestMethod.ALL },
];
