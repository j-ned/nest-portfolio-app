# Fondations du backend NestJS — Design

| | |
|---|---|
| **Date** | 2026-04-25 |
| **Statut** | Approuvé (sections), en attente de relecture finale |
| **Périmètre** | Sous-projet "Fondations" du chantier de migration Hono → NestJS |
| **Projet cible** | `/home/jned/WebstormProjects/J-Ned/nest-portfolio-app` |
| **Frontend consommateur** | `/home/jned/WebstormProjects/J-Ned/angular-portfolio-app` |
| **Modèle de bonnes pratiques** | `/home/jned/WebstormProjects/Prompt Hub/prompt-hub-backend` |

---

## 1. Contexte & motivation

Le frontend Angular `angular-portfolio-app` consomme actuellement un backend Hono.js (~49 endpoints, 13 entités métier, JWT+2FA, S3, mailer, analytics). L'objectif est de **réécrire ce backend en NestJS** dans le projet `nest-portfolio-app` (aujourd'hui un scaffolding NestJS 11 vide), en suivant les bonnes pratiques observées dans `prompt-hub-backend`.

Le chantier global est trop volumineux pour un seul cycle spec → plan → implémentation. Il a été décomposé en sous-projets indépendants :

1. **Fondations** *(ce document)*
2. Auth (Users + JWT + 2FA + cookies)
3. Profile public (Profile, Hero, SocialLinks, Diplomas, Technologies, Expertises, ServicePricing)
4. Projects (CRUD + upload image S3)
5. Contact (messages + mailer)
6. Bookings (réservations + slots + mail)
7. CV (upload S3 + download)
8. Analytics (page views + agrégats)

Chaque sous-projet aura son propre spec, son propre plan, son propre cycle.

Pendant la migration, le backend Hono actuel reste actif et **utilise une base de données séparée** ; le NestJS est construit contre une base PostgreSQL dédiée (port 55432, container Podman isolé). Aucune synchronisation de données n'est nécessaire pendant cette phase.

## 2. Scope

### Inclus dans ce sous-projet

- Squelette NestJS 11 organisé selon les conventions de `prompt-hub-backend` (structure feature-first aplanie, conventions de nommage)
- Configuration via `@nestjs/config` avec **validation Zod** au boot
- Couche persistance **Drizzle ORM + PostgreSQL** (driver `postgres-js`)
- Migrations gérées via `drizzle-kit`
- Container PostgreSQL local via **Podman compose** (rootless, port 55432)
- Logger structuré **Pino** (`nestjs-pino`) — JSON en prod, pretty en dev
- **`ValidationPipe` global** strict (whitelist + forbidNonWhitelisted + transform)
- **Exception filter global** unifiant le format d'erreur JSON
- Swagger/OpenAPI sur `/docs`
- Endpoint `GET /health` qui ping la DB via `SELECT 1`
- Test unitaire sur `HealthController`
- README détaillé documentant les choix d'architecture
- Scripts pnpm pour l'onboarding (`pnpm install && cp .env.example .env && pnpm dev`)

### Explicitement exclus

- **Aucun module métier** (pas de Users, pas de Projects, pas d'Auth, etc.)
- Pas de tests e2e (le harnais `test/jest-e2e.json` reste présent mais aucun `*.e2e-spec.ts`)
- Pas de Dockerfile de production
- Pas de CI/CD (GitHub Actions, etc.)
- Pas d'endpoint `/ready` séparé (ajout possible plus tard si déploiement K8s)
- Pas de `helmet`, `compression`, `@nestjs/throttler` (ajout dans des sous-projets ultérieurs si besoin)
- Pas de migration de données depuis la DB Hono (sera traité en fin de chantier)

## 3. Architecture & graphe de modules

```
┌──────────────────────────────────────────────────────────────┐
│ AppModule (root)                                             │
│                                                              │
│  imports:                                                    │
│   ├── ConfigModule.forRoot({ isGlobal, validate: Zod })      │
│   ├── AppConfigModule         → AppConfigService (typé)      │
│   ├── LoggerModule (nestjs-pino)               ← @Global     │
│   ├── DatabaseModule                            ← @Global    │
│   │     provides: DRIZZLE token → drizzle(postgres-js)       │
│   └── HealthModule                                           │
│         └── HealthController GET /health                     │
│             - inject DRIZZLE                                 │
│             - SELECT 1 → status/db/uptime/version            │
│                                                              │
│  globals (main.ts):                                          │
│   - bufferLogs + useLogger(pino)                             │
│   - ValidationPipe (whitelist, forbidNonWhitelisted,         │
│       transform, enableImplicitConversion)                   │
│   - HttpExceptionFilter (path + timestamp)                   │
│   - SwaggerModule.setup('docs', …)                           │
│   - enableShutdownHooks()                                    │
└──────────────────────────────────────────────────────────────┘
```

**Principes :**

- **`DatabaseModule` et `LoggerModule` sont `@Global`** → calque exact du `StorageModule` de `prompt-hub-backend`. Les modules métier futurs n'auront ni à importer la DB ni à importer le logger.
- **`DRIZZLE` est exposé comme injection token (Symbol)** plutôt qu'une classe. C'est le pattern Drizzle+NestJS recommandé : la connexion Drizzle n'a pas de méthodes propres, c'est juste un client retourné par une factory.
- **`AppConfigService` est un wrapper typé** sur `ConfigService<Env, true>` qui expose des getters explicites (`databaseUrl`, `port`, `nodeEnv`, etc.). Évite la verbosité de `config.get('FOO', { infer: true })` répétée partout.
- **`HealthController` n'a pas de service séparé** : la logique tient en 5 lignes. Calque prompt-hub.

## 4. Arborescence du projet

```
nest-portfolio-app/
├── compose.yaml                    # Postgres dédié (Podman rootless, port 55432)
├── drizzle.config.ts               # Config drizzle-kit
├── .env.example                    # Variables documentées
├── .env                            # Local, gitignored
├── .gitignore
├── .nvmrc                          # Node 22
├── .prettierrc / eslint.config.mjs # Conventions identiques à prompt-hub
├── nest-cli.json
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json / tsconfig.build.json
├── README.md
│
├── docs/superpowers/specs/         # Specs de design (ce document)
│
├── drizzle/                        # Migrations SQL générées (commitées)
│   └── .gitkeep                    # Rempli quand un module ajoute un schéma
│
├── src/
│   ├── main.ts                     # Bootstrap
│   ├── app.module.ts               # Root
│   │
│   ├── config/
│   │   ├── env.schema.ts           # Zod schema des env vars
│   │   ├── env.validation.ts       # validateEnv() pour ConfigModule
│   │   ├── app-config.service.ts   # Wrapper typé
│   │   └── app-config.module.ts
│   │
│   ├── database/
│   │   ├── database.module.ts      # @Global, fournit DRIZZLE
│   │   ├── database.providers.ts   # Factory postgres-js + drizzle()
│   │   ├── drizzle.constants.ts    # export const DRIZZLE = Symbol(...)
│   │   ├── drizzle.types.ts        # type Database = PostgresJsDatabase<...>
│   │   └── schema/
│   │       └── index.ts            # Barrel vide au départ
│   │
│   ├── common/
│   │   └── filters/
│   │       └── http-exception.filter.ts
│   │
│   └── health/
│       ├── health.module.ts
│       ├── health.controller.ts
│       └── health.controller.spec.ts
│
└── test/
    └── jest-e2e.json               # Présent mais inutilisé dans cette itération
```

**Écarts vs `prompt-hub-backend` (justifiés) :**

- `config/` n'existe pas dans prompt-hub (qui lit `process.env` directement). Justifié par le besoin de validation au boot.
- `database/` remplace `storage/` (sémantique plus juste avec un vrai SGBD).
- `common/filters/` introduit dès maintenant pour le filter d'exception transverse. Pas de `common/decorators/`, `common/pipes/`, etc. tant qu'aucun fichier ne le justifie (on évite la sur-organisation prématurée).
- `drizzle/` à la racine (et non sous `src/`) : convention drizzle-kit standard, évite la compilation tsc des fichiers SQL.

## 5. Configuration & validation des variables d'environnement

### Variables d'env (Fondations)

| Variable | Type / format | Défaut | Rôle |
|---|---|---|---|
| `NODE_ENV` | `'development' \| 'production' \| 'test'` | `development` | Pilote logger format, Drizzle logger, etc. |
| `PORT` | int 1–65535 | `3000` | Port HTTP |
| `DATABASE_URL` | URL `postgres://…` | *(requis)* | Connexion Drizzle |
| `LOG_LEVEL` | `'fatal' \| 'error' \| 'warn' \| 'info' \| 'debug' \| 'trace'` | `debug` si dev, `info` sinon | Niveau Pino |

Les sous-projets futurs étendront ce schéma (Auth → `JWT_SECRET`, etc.).

### `src/config/env.schema.ts`

```typescript
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().refine(
    (u) => u.startsWith('postgres://') || u.startsWith('postgresql://'),
    { message: 'DATABASE_URL must be a postgres:// URL' },
  ),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
});

export type Env = z.infer<typeof envSchema>;
```

### `src/config/env.validation.ts`

```typescript
import { envSchema } from './env.schema';

export function validateEnv(raw: Record<string, unknown>) {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${formatted}`);
  }
  return {
    ...result.data,
    LOG_LEVEL: result.data.LOG_LEVEL ?? (result.data.NODE_ENV === 'development' ? 'debug' : 'info'),
  };
}
```

### `src/config/app-config.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get nodeEnv() { return this.config.get('NODE_ENV', { infer: true }); }
  get isProduction() { return this.nodeEnv === 'production'; }
  get isDevelopment() { return this.nodeEnv === 'development'; }
  get isTest() { return this.nodeEnv === 'test'; }
  get port() { return this.config.get('PORT', { infer: true }); }
  get databaseUrl() { return this.config.get('DATABASE_URL', { infer: true }); }
  get logLevel() { return this.config.get('LOG_LEVEL', { infer: true }); }
}
```

### `src/config/app-config.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { AppConfigService } from './app-config.service';

@Module({
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
```

### Importation dans `app.module.ts`

```typescript
ConfigModule.forRoot({
  isGlobal: true,
  validate: validateEnv,
  envFilePath: ['.env'],
})
```

### `.env.example`

```bash
# Environnement (development | production | test)
NODE_ENV=development

# Port HTTP du backend NestJS
PORT=3000

# Connexion Postgres dédié au NestJS (port 55432, isolé du Hono)
DATABASE_URL=postgres://portfolio:portfolio@localhost:55432/portfolio_nest

# Niveau de log Pino. Défaut auto: debug en dev, info en prod.
# LOG_LEVEL=info
```

### Comportement au boot

- `.env` manquant : ConfigModule continue (utilisera `process.env`), Zod échouera sur `DATABASE_URL` requis → message clair → exit.
- `DATABASE_URL` mal formé : Zod throw au boot → exit avec listing des erreurs.
- Variable inconnue dans `.env` : ignorée silencieusement.

## 6. Couche base de données

### `compose.yaml`

```yaml
services:
  postgres:
    image: docker.io/postgres:17-alpine
    container_name: portfolio-nest-db
    restart: unless-stopped
    ports:
      - "55432:5432"
    environment:
      POSTGRES_USER: portfolio
      POSTGRES_PASSWORD: portfolio
      POSTGRES_DB: portfolio_nest
    volumes:
      - portfolio_nest_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U portfolio -d portfolio_nest"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  portfolio_nest_pgdata:
```

> Credentials triviaux assumés : c'est du dev local, jamais en prod. `.env.example` documente clairement qu'il faut changer en prod.

### Driver : `postgres-js`

```bash
pnpm add drizzle-orm postgres
pnpm add -D drizzle-kit
```

### `drizzle.config.ts`

```typescript
import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

export default defineConfig({
  out: './drizzle',
  schema: './src/database/schema/index.ts',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
  casing: 'snake_case',
  verbose: true,
  strict: true,
});
```

### `src/database/drizzle.constants.ts`

```typescript
export const DRIZZLE = Symbol('DRIZZLE');
```

### `src/database/schema/index.ts`

```typescript
// Barrel central. Chaque module ajoutera sa table ici.
// Exemple futur : export * from './users';
export const schema = {} as const;
```

### `src/database/database.providers.ts`

```typescript
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
```

### `src/database/drizzle.types.ts`

```typescript
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { schema } from './schema';

export type Database = PostgresJsDatabase<typeof schema>;
```

### `src/database/database.module.ts`

```typescript
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
```

### Workflow migrations

| Script | Commande | Usage |
|---|---|---|
| `db:generate` | `drizzle-kit generate` | Diff schema vs précédent → génère `drizzle/NNNN_*.sql` |
| `db:migrate` | `drizzle-kit migrate` | Applique les migrations en attente (idempotent) |
| `db:studio` | `drizzle-kit studio` | UI web pour explorer la DB |

Pour les Fondations : aucune migration générée (le schéma est vide). Vérification que `pnpm db:generate` n'erreur pas et ne produit aucun fichier. La première migration apparaîtra avec le module Auth.

## 7. Health module

### `src/health/health.controller.ts`

```typescript
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly bootedAt = Date.now();

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  @Get()
  @ApiOperation({ summary: 'Liveness + DB connectivity check' })
  @ApiResponse({ status: 200, description: 'Service up; check db.status field' })
  async check() {
    const start = Date.now();
    let dbStatus: 'up' | 'down' = 'down';
    let dbLatencyMs: number | null = null;
    try {
      await this.db.execute(sql`SELECT 1`);
      dbStatus = 'up';
      dbLatencyMs = Date.now() - start;
    } catch {
      // Volontairement silencieux : on retourne status:'degraded' plutôt que 503
      // pour distinguer "app vivante / DB KO" d'un service totalement injoignable.
    }
    return {
      status: dbStatus === 'up' ? 'ok' : 'degraded',
      db: { status: dbStatus, latencyMs: dbLatencyMs },
      uptime: Math.round((Date.now() - this.bootedAt) / 1000),
      version: process.env.npm_package_version ?? 'dev',
      timestamp: new Date().toISOString(),
    };
  }
}
```

### `src/health/health.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

### Test unitaire

`src/health/health.controller.spec.ts` mock le provider `DRIZZLE` :

- Cas 1 : le mock résout `SELECT 1` → assert `status: 'ok'`, `db.status: 'up'`, `db.latencyMs` est un nombre, `uptime >= 0`, `version` défini.
- Cas 2 : le mock rejette → assert `status: 'degraded'`, `db.status: 'down'`, `db.latencyMs: null`.

Style calqué sur `app.controller.spec.ts` de `prompt-hub-backend` : `Test.createTestingModule({ controllers: [HealthController], providers: [{ provide: DRIZZLE, useValue: mockDb }] }).compile()`.

## 8. Bootstrap & couches transverses

### `src/common/filters/http-exception.filter.ts`

```typescript
import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorPayload {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const baseError = exception instanceof HttpException
      ? exception.getResponse()
      : { message: 'Internal server error', error: 'Internal Server Error' };

    const errorBody = typeof baseError === 'string'
      ? { message: baseError, error: HttpStatus[status] ?? 'Error' }
      : (baseError as { message?: string | string[]; error?: string });

    const payload: ErrorPayload = {
      statusCode: status,
      error: errorBody.error ?? HttpStatus[status] ?? 'Error',
      message: errorBody.message ?? 'Unexpected error',
      path: req.url,
      timestamp: new Date().toISOString(),
    };

    if (status >= 500) {
      this.logger.error(
        { err: exception, path: req.url, method: req.method },
        `Unhandled ${status} on ${req.method} ${req.url}`,
      );
    }
    res.status(status).json(payload);
  }
}
```

### `src/main.ts`

```typescript
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppConfigService } from './config/app-config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get(AppConfigService);

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));
  app.useGlobalFilters(new HttpExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Portfolio API')
    .setDescription('NestJS backend for J-Ned portfolio')
    .setVersion(process.env.npm_package_version ?? 'dev')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  app.enableShutdownHooks();
  await app.listen(config.port);
  app.get(Logger).log(`Listening on http://localhost:${config.port} (docs: /docs)`);
}
void bootstrap();
```

### `LoggerModule` (Pino) dans `app.module.ts`

```typescript
LoggerModule.forRootAsync({
  imports: [AppConfigModule],
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) => ({
    pinoHttp: {
      level: config.logLevel,
      transport: config.isDevelopment
        ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
        : undefined,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      autoLogging: { ignore: (req) => req.url === '/health' },
      customProps: () => ({ context: 'HTTP' }),
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      },
    },
  }),
}),
```

### `app.module.ts` final

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env'] }),
    AppConfigModule,
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.logLevel,
          transport: config.isDevelopment
            ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
            : undefined,
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          autoLogging: { ignore: (req) => req.url === '/health' },
          customProps: () => ({ context: 'HTTP' }),
          serializers: {
            req: (req) => ({ id: req.id, method: req.method, url: req.url }),
          },
        },
      }),
    }),
    DatabaseModule,
    HealthModule,
  ],
})
export class AppModule {}
```

## 9. Developer eXperience

### `package.json` — scripts

```json
{
  "scripts": {
    "build": "nest build",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "lint": "eslint \"{src,test}/**/*.ts\" --fix",

    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main",
    "dev": "nest start --watch",

    "db:up": "podman compose up -d postgres",
    "db:down": "podman compose down",
    "db:reset": "podman compose down -v && pnpm db:up && pnpm db:wait && pnpm db:migrate",
    "db:wait": "until podman exec portfolio-nest-db pg_isready -U portfolio -d portfolio_nest > /dev/null 2>&1; do sleep 0.5; done",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",

    "test": "jest",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage",
    "test:e2e": "jest --config ./test/jest-e2e.json",

    "predev": "pnpm db:up && pnpm db:wait"
  }
}
```

### Dépendances de production à ajouter

```bash
pnpm add @nestjs/config @nestjs/swagger \
  drizzle-orm postgres \
  zod nestjs-pino pino pino-http
```

### Dépendances de dev à ajouter

```bash
pnpm add -D drizzle-kit pino-pretty @types/pg
```

### `.gitignore` — ajouts

```
.env
.env.local
/dist
/node_modules
/coverage
```

> Le dossier `drizzle/` (migrations SQL + `meta/_journal.json`) est **commité** : sans ça, les autres devs / la CI ne peuvent pas migrer.

### README — plan

Sections obligatoires :

1. **Quickstart** : Node 22, pnpm, Podman → `pnpm install && cp .env.example .env && pnpm dev`
2. **Architecture** : vue d'ensemble + pourquoi feature-first aplanie (réf. prompt-hub) + pourquoi `@Global` pour Database
3. **Configuration** : table des env vars + validation Zod + wrapper typé
4. **Base de données** : Drizzle vs Prisma/TypeORM, postgres-js vs pg, workflow migrations, port 55432 (isolé du Hono)
5. **Logging** : Pino structuré, redaction, niveaux
6. **Erreurs** : format unifié `{statusCode, error, message, path, timestamp}`
7. **Validation HTTP** : ValidationPipe global avec whitelist + forbidNonWhitelisted + transform
8. **Tests** : convention prompt-hub, pas d'e2e dans cette itération
9. **Scripts pnpm** : tableau complet
10. **Migration depuis le backend Hono** : DB séparée, ordre des sous-projets, lien vers ce spec
11. **Décisions d'architecture (ADR léger)** : liste résumée des choix non-évidents

## 10. Décisions d'architecture (résumé)

| # | Décision | Pourquoi |
|---|---|---|
| ADR-1 | DB Postgres dédiée au NestJS (port 55432) | Isolation totale du Hono pendant la migration ; aucun risque de corruption mutuelle |
| ADR-2 | Driver `postgres-js` plutôt que `pg` | Recommandé par Drizzle, plus performant, plus léger |
| ADR-3 | `casing: 'snake_case'` Drizzle | Convention SQL standard, conversion auto vers camelCase en TS |
| ADR-4 | Validation env via Zod (pas class-validator) | Tourne hors contexte Nest au boot, API fonctionnelle, idiomatique avec Drizzle |
| ADR-5 | Wrapper `AppConfigService` typé | Évite la verbosité de `config.get('FOO', { infer: true })` partout |
| ADR-6 | `@Global` pour `DatabaseModule` et `LoggerModule` | Calque pattern `StorageModule` de prompt-hub ; évite imports répétés dans tous les modules métier |
| ADR-7 | `DRIZZLE` exposé comme injection token (Symbol) | Pattern Drizzle+NestJS recommandé ; pas une classe car pas de méthodes propres |
| ADR-8 | `ValidationPipe` avec `forbidNonWhitelisted: true` (vs prompt-hub) | Détection immédiate des champs inattendus → bug frontend visible tôt |
| ADR-9 | `transform + enableImplicitConversion` | `@Param('id')` typé `number` est auto-converti depuis l'URL |
| ADR-10 | Exception filter custom global (vs prompt-hub) | Ajoute `path` + `timestamp` aux erreurs (utile pour debug en prod) ; ne change pas la sémantique |
| ADR-11 | Pino (`nestjs-pino`) plutôt que logger NestJS par défaut | JSON structuré en prod, pretty en dev, redaction des secrets |
| ADR-12 | `/health` répond 200 `degraded` si DB KO (et non 503) | Distingue "app vivante / DB plantée" d'un service injoignable ; revoir si déploiement K8s |
| ADR-13 | Pas d'`/ready` séparé, pas de helmet/throttler/compression | Hors scope minimaliste défini en Q3 ; ajout dans sous-projets ultérieurs |
| ADR-14 | Pas de tests e2e dans cette itération | Hors scope minimaliste ; harnais `test/jest-e2e.json` conservé pour réutilisation |
| ADR-15 | Container DB via Podman compose (rootless) | Préférence utilisateur (Docker-Podman dans son stack) ; portable |
| ADR-16 | Postgres 17-alpine (épinglé) | Reproductibilité ; image légère ; version stable récente |

## 11. Critères de "done"

Le sous-projet Fondations est terminé quand toutes ces conditions sont vraies :

1. `pnpm install` ne renvoie aucune erreur de résolution.
2. `cp .env.example .env` produit un fichier valide qui passe la validation Zod.
3. `pnpm db:up` démarre le container Postgres en moins de 10 s, et `pnpm db:wait` retourne sans timeout.
4. `pnpm start:dev` démarre l'app sans erreur, affiche le log `Listening on http://localhost:3000 (docs: /docs)`.
5. `curl http://localhost:3000/health` retourne `{ "status": "ok", "db": { "status": "up", "latencyMs": <int> }, "uptime": …, "version": …, "timestamp": … }` avec un statut HTTP 200.
6. `curl http://localhost:3000/docs` retourne la page Swagger UI.
7. Si on coupe la DB (`pnpm db:down`) puis on rappelle `/health`, on obtient `{ "status": "degraded", "db": { "status": "down", "latencyMs": null }, … }` avec un 200.
8. `pnpm test` passe (au moins le test unitaire `health.controller.spec.ts`).
9. `pnpm lint` ne rapporte aucune erreur.
10. `pnpm build` produit un `dist/` exécutable via `pnpm start:prod`.
11. `pnpm db:generate` ne produit aucune migration (le schéma est vide) et n'erreure pas.
12. Le `README.md` couvre toutes les sections listées en §9.
13. Le filter d'exception est testable manuellement : appeler une route inexistante (`GET /nope`) renvoie `{ statusCode: 404, error: 'Not Found', message: 'Cannot GET /nope', path: '/nope', timestamp: '…' }`.

## 12. Hors scope (suite des sous-projets)

Une fois ce sous-projet terminé, le suivant sera vraisemblablement **Auth** : Users + register/login/refresh + 2FA TOTP + cookies httpOnly + guards. Il étendra `env.schema.ts` (`JWT_SECRET`, `JWT_EXPIRES_IN`, etc.), ajoutera la première vraie migration Drizzle (`users`), et introduira le pattern `@CurrentUser()` decorator + `JwtAuthGuard` calqué sur prompt-hub.

L'ordre ultérieur reste à valider : Auth → Profile public → Projects → Contact → Bookings → CV → Analytics. Chaque sous-projet aura son propre spec dans `docs/superpowers/specs/`.
