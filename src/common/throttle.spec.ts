import 'reflect-metadata';
// Les constantes de clés ne sont pas ré-exportées par l'index du paquet.
import {
  THROTTLER_LIMIT,
  THROTTLER_TTL,
} from '@nestjs/throttler/dist/throttler.constants';
import { AuthController } from '../auth/auth.controller';
import { BlogController } from '../blog/blog.controller';
import { CvController } from '../cv/cv.controller';
import { RuntimeConfigController } from '../runtime-config/runtime-config.controller';
import { ProjectsController } from '../projects/projects.controller';
import { AUTH_ATTEMPT_THROTTLE, PUBLIC_READ_THROTTLE } from './throttle';

type Ctor = abstract new (...args: never[]) => object;

// Le throttler pose ses métadonnées sur la fonction du handler, pas sur la classe.
const handler = (ctor: Ctor, name: string): object =>
  Object.getOwnPropertyDescriptor(ctor.prototype as object, name)
    ?.value as object;

const limitOf = (target: object): number | undefined =>
  Reflect.getMetadata(`${THROTTLER_LIMIT}default`, target) as
    | number
    | undefined;
const ttlOf = (target: object): number | undefined =>
  Reflect.getMetadata(`${THROTTLER_TTL}default`, target) as number | undefined;

describe('public read throttle', () => {
  it.each([
    ['GET /projects', ProjectsController, 'findAll'],
    ['GET /projects/:id', ProjectsController, 'findOne'],
    ['GET /blog/posts', BlogController, 'findAllPublished'],
    ['GET /blog/posts/:slug', BlogController, 'findBySlug'],
    ['GET /config', RuntimeConfigController, 'get'],
    ['GET /cv', CvController, 'findOne'],
    ['GET /cv/download', CvController, 'download'],
    ['GET /auth/me', AuthController, 'me'],
  ] as const)('%s allows 120 requests per minute', (_route, ctor, name) => {
    expect(limitOf(handler(ctor, name))).toBe(
      PUBLIC_READ_THROTTLE.default.limit,
    );
    expect(ttlOf(handler(ctor, name))).toBe(60_000);
  });

  it.each([
    ['POST /projects', ProjectsController, 'create'],
    ['POST /blog/posts', BlogController, 'create'],
    ['POST /blog/posts/:slug/like', BlogController, 'like'],
  ] as const)('%s keeps the global limit', (_route, ctor, name) => {
    expect(limitOf(handler(ctor, name))).toBeUndefined();
  });

  it.each([
    ['POST /auth/login', AuthController, 'login'],
    ['POST /auth/2fa/verify', AuthController, 'verifyTwoFactor'],
  ] as const)('%s allows 5 attempts per minute', (_route, ctor, name) => {
    expect(limitOf(handler(ctor, name))).toBe(
      AUTH_ATTEMPT_THROTTLE.default.limit,
    );
    expect(ttlOf(handler(ctor, name))).toBe(60_000);
  });
});
