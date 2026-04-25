# Fondations du backend NestJS — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mettre en place le squelette du backend NestJS `nest-portfolio-app` (config Zod, Drizzle + PostgreSQL en Podman, Pino, exception filter global, Swagger, endpoint `/health`) selon les conventions de `prompt-hub-backend`, sans aucun module métier.

**Architecture:** Cinq imports root (`ConfigModule`, `AppConfigModule`, `LoggerModule` `@Global`, `DatabaseModule` `@Global`, `HealthModule`). `DRIZZLE` injecté comme token Symbol. Validation env Zod au boot. Format d'erreur JSON unifié. PostgreSQL local en container Podman isolé sur port 55432.

**Tech Stack:** NestJS 11, TypeScript, Drizzle ORM (driver `postgres-js`), PostgreSQL 17, Zod, `nestjs-pino` + Pino, Swagger, `class-validator`, Jest, pnpm, Podman.

**Référence spec :** `docs/superpowers/specs/2026-04-25-fondations-nest-portfolio-design.md`

---

## File Structure

### Fichiers à créer

| Chemin | Rôle |
|---|---|
| `.nvmrc` | Pin Node 22 |
| `.env.example` | Template variables d'env documenté |
| `.env` | Local, gitignored, copie de `.env.example` |
| `compose.yaml` | Container Postgres dédié (Podman, port 55432) |
| `drizzle.config.ts` | Config drizzle-kit |
| `src/config/env.schema.ts` | Schéma Zod des variables d'env |
| `src/config/env.validation.ts` | `validateEnv()` invoqué par `ConfigModule.forRoot` |
| `src/config/app-config.service.ts` | Wrapper typé `AppConfigService` |
| `src/config/app-config.module.ts` | Module exposant `AppConfigService` |
| `src/database/drizzle.constants.ts` | `export const DRIZZLE = Symbol('DRIZZLE')` |
| `src/database/drizzle.types.ts` | `type Database = PostgresJsDatabase<typeof schema>` |
| `src/database/schema/index.ts` | Barrel central des schémas Drizzle (vide) |
| `src/database/database.providers.ts` | Factory `postgres-js` + `drizzle()` |
| `src/database/database.module.ts` | Module `@Global` exposant `DRIZZLE` |
| `src/common/filters/http-exception.filter.ts` | Filter global format unifié |
| `src/health/health.controller.ts` | `GET /health` |
| `src/health/health.module.ts` | Module |
| `src/health/health.controller.spec.ts` | Test unitaire mock DRIZZLE |
| `src/config/env.validation.spec.ts` | Test unitaire `validateEnv` |

### Fichiers à modifier

| Chemin | Modification |
|---|---|
| `package.json` | +scripts (`db:*`, `predev`, etc.), +deps prod, +deps dev |
| `src/app.module.ts` | Réécriture complète (5 imports root) |
| `src/main.ts` | Réécriture complète (bootstrap : Pino, ValidationPipe, filter, Swagger) |
| `README.md` | Réécriture complète (sections du spec §9) |
| `.gitignore` | Vérification (ajouter ce qui manque) |

### Fichiers à supprimer

| Chemin | Raison |
|---|---|
| `src/app.controller.ts` | Hello world du scaffold, plus utile |
| `src/app.service.ts` | Idem |
| `src/app.controller.spec.ts` | Idem |
| `test/app.e2e-spec.ts` | Référence `AppController` qu'on supprime ; pas d'e2e dans cette itération |

---

## Task 1: Commit du scaffold NestJS + Node version + .gitignore

**Files:**
- Create: `.nvmrc`
- Modify: `.gitignore` (vérification)
- Stage: tout le scaffold non suivi (`src/`, `test/`, `package.json`, etc.)

- [ ] **Step 1: Vérifier l'état git du repo**

```bash
git status
```

Expected: branche `master`, 1 commit (le spec), tous les fichiers du scaffold NestJS en untracked (`.gitignore`, `.prettierrc`, `README.md`, `eslint.config.mjs`, `nest-cli.json`, `package.json`, `pnpm-lock.yaml`, `src/`, `test/`, `tsconfig.build.json`, `tsconfig.json`).

- [ ] **Step 2: Créer `.nvmrc` à la racine**

Contenu :
```
22
```

- [ ] **Step 3: Vérifier que `.gitignore` couvre les besoins**

Lire `.gitignore` et confirmer qu'il contient au minimum :
- `/dist`
- `/node_modules`
- `/coverage`
- `.env`
- `.env.local`

Le scaffold NestJS standard couvre déjà tout ça. Si une ligne manque, l'ajouter.

- [ ] **Step 4: Stager et commiter le scaffold + `.nvmrc`**

```bash
git add .nvmrc .gitignore .prettierrc README.md eslint.config.mjs nest-cli.json package.json pnpm-lock.yaml src/ test/ tsconfig.build.json tsconfig.json
git status
```

Expected: tous les fichiers ci-dessus dans "Modifications qui seront validées".

```bash
git commit -m "chore: scaffold NestJS 11 + Node 22 pin

Initial NestJS 11 scaffold (généré par nest new), avant configuration
des Fondations. Pin Node 22 via .nvmrc.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Vérifier le commit**

```bash
git log --oneline -3
```

Expected: 2 commits (spec + scaffold).

---

## Task 2: Installer les dépendances de production et de dev

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (par pnpm automatiquement)

- [ ] **Step 1: Installer les dépendances de production**

```bash
pnpm add @nestjs/config @nestjs/swagger drizzle-orm postgres zod nestjs-pino pino pino-http
```

Expected: pnpm résout, modifie `package.json` et `pnpm-lock.yaml`. Aucune erreur.

- [ ] **Step 2: Installer les dépendances de dev**

```bash
pnpm add -D drizzle-kit pino-pretty @types/pg
```

Expected: pnpm résout sans erreur.

- [ ] **Step 3: Vérifier que tout est cohérent**

```bash
pnpm install
pnpm build
```

Expected: `pnpm install` est idempotent (Already up to date). `pnpm build` produit `dist/` sans erreur (le scaffold par défaut compile encore).

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat(deps): ajout des dépendances Fondations

Prod: @nestjs/config, @nestjs/swagger, drizzle-orm, postgres, zod,
nestjs-pino, pino, pino-http
Dev: drizzle-kit, pino-pretty, @types/pg

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Module Configuration — schéma Zod et `validateEnv` (TDD)

**Files:**
- Create: `src/config/env.schema.ts`
- Create: `src/config/env.validation.ts`
- Test: `src/config/env.validation.spec.ts`

- [ ] **Step 1: Écrire les tests d'`validateEnv` AVANT l'implémentation**

Créer `src/config/env.validation.spec.ts` :

```typescript
import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const baseValid = {
    DATABASE_URL: 'postgres://u:p@localhost:55432/db',
  };

  it('parse une env valide minimaliste avec défauts', () => {
    const result = validateEnv(baseValid);
    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3000);
    expect(result.DATABASE_URL).toBe(baseValid.DATABASE_URL);
    expect(result.LOG_LEVEL).toBe('debug'); // défaut auto en dev
  });

  it('coerce PORT depuis une string', () => {
    const result = validateEnv({ ...baseValid, PORT: '4242' });
    expect(result.PORT).toBe(4242);
  });

  it('rejette PORT hors plage', () => {
    expect(() => validateEnv({ ...baseValid, PORT: '99999' })).toThrow(/PORT/);
  });

  it('rejette DATABASE_URL absente', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejette DATABASE_URL non-postgres', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://u:p@h/d' })).toThrow(/postgres/);
  });

  it('accepte postgresql:// (alias officiel)', () => {
    const result = validateEnv({ DATABASE_URL: 'postgresql://u:p@localhost:5432/d' });
    expect(result.DATABASE_URL).toBe('postgresql://u:p@localhost:5432/d');
  });

  it('utilise LOG_LEVEL=info par défaut en production', () => {
    const result = validateEnv({ ...baseValid, NODE_ENV: 'production' });
    expect(result.LOG_LEVEL).toBe('info');
  });

  it('respecte LOG_LEVEL fourni explicitement', () => {
    const result = validateEnv({ ...baseValid, LOG_LEVEL: 'warn' });
    expect(result.LOG_LEVEL).toBe('warn');
  });

  it('rejette LOG_LEVEL invalide', () => {
    expect(() => validateEnv({ ...baseValid, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

```bash
pnpm test src/config/env.validation.spec.ts
```

Expected: FAIL avec "Cannot find module './env.validation'" (le fichier n'existe pas encore).

- [ ] **Step 3: Implémenter `src/config/env.schema.ts`**

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

- [ ] **Step 4: Implémenter `src/config/env.validation.ts`**

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

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

```bash
pnpm test src/config/env.validation.spec.ts
```

Expected: PASS, 9 tests verts.

- [ ] **Step 6: Commit**

```bash
git add src/config/env.schema.ts src/config/env.validation.ts src/config/env.validation.spec.ts
git commit -m "feat(config): validation Zod des variables d'env

- envSchema avec coercion PORT, validation DATABASE_URL postgres,
  défauts intelligents pour LOG_LEVEL selon NODE_ENV
- validateEnv() throw avec message lisible si invalide
- 9 tests unitaires couvrent les cas nominaux et erreurs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `AppConfigService` + `AppConfigModule` + `.env.example`

**Files:**
- Create: `src/config/app-config.service.ts`
- Create: `src/config/app-config.module.ts`
- Create: `.env.example`

- [ ] **Step 1: Implémenter `src/config/app-config.service.ts`**

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

- [ ] **Step 2: Implémenter `src/config/app-config.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { AppConfigService } from './app-config.service';

@Module({
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
```

- [ ] **Step 3: Créer `.env.example` à la racine**

```bash
# Environnement (development | production | test)
NODE_ENV=development

# Port HTTP du backend NestJS
PORT=3000

# Connexion Postgres dédié au NestJS (port 55432, isolé du backend Hono)
DATABASE_URL=postgres://portfolio:portfolio@localhost:55432/portfolio_nest

# Niveau de log Pino. Défaut auto: debug en dev, info en prod.
# LOG_LEVEL=info
```

- [ ] **Step 4: Copier `.env.example` vers `.env` (local, gitignored)**

```bash
cp .env.example .env
cat .env
```

Expected: contenu identique à `.env.example`.

- [ ] **Step 5: Vérifier que TypeScript compile**

```bash
pnpm build
```

Expected: build OK (les nouveaux fichiers compilent ; ils ne sont pas encore importés ailleurs, donc dead code, mais valide).

- [ ] **Step 6: Commit**

```bash
git add src/config/app-config.service.ts src/config/app-config.module.ts .env.example
git commit -m "feat(config): wrapper AppConfigService typé + .env.example

Wrapper avec getters explicites (nodeEnv, port, databaseUrl, logLevel,
isProduction, isDevelopment, isTest) pour éviter la verbosité de
config.get('FOO', { infer: true }) répété partout.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Câbler `ConfigModule` + `AppConfigModule` dans `AppModule`, vérifier le boot

**Files:**
- Modify: `src/app.module.ts`

- [ ] **Step 1: Réécrire `src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './config/app-config.module';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env'] }),
    AppConfigModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

> Note : on garde temporairement `AppController`/`AppService` du scaffold ; ils seront supprimés à la Task 13.

- [ ] **Step 2: Démarrer l'app et vérifier le boot**

```bash
pnpm start
```

Expected: log `Nest application successfully started`, port 3000. **Si crash → lire le message d'erreur Zod.** Exemple si `.env` est OK : démarrage propre. `Ctrl+C` pour stopper.

- [ ] **Step 3: Vérifier la validation : booter avec une env invalide**

```bash
DATABASE_URL=invalid pnpm start 2>&1 | head -10
```

Expected: l'app crash au boot avec :
```
Error: Invalid environment variables:
  - DATABASE_URL: Invalid url
```
(ou message équivalent Zod). Pas de "Listening on port…".

- [ ] **Step 4: Vérifier la validation : booter sans DATABASE_URL**

```bash
mv .env .env.bak
pnpm start 2>&1 | head -10
mv .env.bak .env
```

Expected: crash avec `DATABASE_URL: Required`. Restaure `.env` ensuite.

- [ ] **Step 5: Commit**

```bash
git add src/app.module.ts
git commit -m "feat(config): câbler ConfigModule + AppConfigModule au boot

Validation Zod active : l'app crash avec un message lisible si une
variable d'env est manquante ou invalide. Vérifié manuellement avec
DATABASE_URL absent et avec format invalide.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Container PostgreSQL en Podman + scripts `db:up/db:down/db:wait`

**Files:**
- Create: `compose.yaml`
- Modify: `package.json` (ajout scripts)

- [ ] **Step 1: Créer `compose.yaml` à la racine**

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

- [ ] **Step 2: Ajouter les scripts `db:*` dans `package.json`**

Dans la section `scripts`, ajouter (en gardant les scripts existants) :

```json
"db:up": "podman compose up -d postgres",
"db:down": "podman compose down",
"db:reset": "podman compose down -v && pnpm db:up && pnpm db:wait && pnpm db:migrate",
"db:wait": "until podman exec portfolio-nest-db pg_isready -U portfolio -d portfolio_nest > /dev/null 2>&1; do sleep 0.5; done"
```

> Note : `db:reset` référence `db:migrate` qui sera ajouté à la Task 8. C'est OK : tant qu'on n'exécute pas `db:reset`, le script reste en attente.

- [ ] **Step 3: Démarrer le container Postgres**

```bash
pnpm db:up
```

Expected: pull de l'image (premier run), puis `Container portfolio-nest-db Started`. Aucune erreur.

- [ ] **Step 4: Attendre que Postgres soit prêt**

```bash
pnpm db:wait
```

Expected: termine en quelques secondes (max ~10s) sans output.

- [ ] **Step 5: Vérifier la connexion manuellement**

```bash
podman exec portfolio-nest-db psql -U portfolio -d portfolio_nest -c "SELECT version();"
```

Expected: une ligne avec `PostgreSQL 17.x …`.

- [ ] **Step 6: Commit**

```bash
git add compose.yaml package.json
git commit -m "feat(db): container Postgres dédié en Podman compose

- Postgres 17-alpine sur port 55432 (isolé du backend Hono)
- Volume nommé pour persistance
- Healthcheck pg_isready
- Scripts pnpm db:up, db:down, db:wait, db:reset

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Drizzle — constants, types, schema, providers, module, drizzle.config.ts, scripts

**Files:**
- Create: `src/database/drizzle.constants.ts`
- Create: `src/database/schema/index.ts`
- Create: `src/database/drizzle.types.ts`
- Create: `src/database/database.providers.ts`
- Create: `src/database/database.module.ts`
- Create: `drizzle.config.ts`
- Modify: `package.json` (ajout scripts `db:generate`, `db:migrate`, `db:studio`)
- Modify: `src/app.module.ts` (import `DatabaseModule`)

- [ ] **Step 1: Créer `src/database/drizzle.constants.ts`**

```typescript
export const DRIZZLE = Symbol('DRIZZLE');
```

- [ ] **Step 2: Créer `src/database/schema/index.ts`**

```typescript
// Barrel central. Chaque module ajoutera son schéma ici.
// Exemple futur : export * from './users';
export const schema = {} as const;
```

- [ ] **Step 3: Créer `src/database/drizzle.types.ts`**

```typescript
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { schema } from './schema';

export type Database = PostgresJsDatabase<typeof schema>;
```

- [ ] **Step 4: Créer `src/database/database.providers.ts`**

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

- [ ] **Step 5: Créer `src/database/database.module.ts`**

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

- [ ] **Step 6: Créer `drizzle.config.ts` à la racine**

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

> Note : `drizzle-kit` lit directement `process.env`. `dotenv/config` est importé pour charger `.env`. Pas besoin d'ajouter `dotenv` aux deps (transitif via `drizzle-kit`).

- [ ] **Step 7: Ajouter les scripts Drizzle dans `package.json`**

Dans `scripts`, ajouter :

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:studio": "drizzle-kit studio"
```

- [ ] **Step 8: Importer `DatabaseModule` dans `AppModule`**

Modifier `src/app.module.ts` pour ajouter l'import (le reste reste identique à la Task 5) :

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './config/app-config.module';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env'] }),
    AppConfigModule,
    DatabaseModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

- [ ] **Step 9: Vérifier que l'app démarre avec la connexion Drizzle**

```bash
pnpm db:up && pnpm db:wait && pnpm start 2>&1 | head -30
```

Expected: l'app démarre, le pool postgres-js s'initialise (lazy, aucune query au boot). Pas de message d'erreur DB.

- [ ] **Step 10: Vérifier que `db:generate` ne produit rien (schéma vide)**

```bash
pnpm db:generate
```

Expected: drizzle-kit lit le barrel vide, ne génère aucune migration. Output type : `No schema changes, nothing to migrate` ou équivalent.

- [ ] **Step 11: Commit**

```bash
git add src/database/ drizzle.config.ts package.json src/app.module.ts
git commit -m "feat(db): câblage Drizzle + DatabaseModule @Global

- DRIZZLE token (Symbol) injecté via factory postgres-js + drizzle()
- Pool: max=10, casing=snake_case, logger en dev uniquement
- DatabaseModule @Global (calque pattern StorageModule de prompt-hub)
- drizzle.config.ts + scripts db:generate, db:migrate, db:studio
- Boot OK avec connexion lazy ; db:generate ne produit rien (schéma vide)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Logger Pino (`nestjs-pino`) dans `AppModule`

**Files:**
- Modify: `src/app.module.ts` (ajouter `LoggerModule.forRootAsync`)

- [ ] **Step 1: Ajouter `LoggerModule` à `AppModule`**

Modifier `src/app.module.ts` :

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';

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
          autoLogging: { ignore: (req: { url?: string }) => req.url === '/health' },
          customProps: () => ({ context: 'HTTP' }),
          serializers: {
            req: (req: { id?: string; method?: string; url?: string }) => ({
              id: req.id, method: req.method, url: req.url,
            }),
          },
        },
      }),
    }),
    DatabaseModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

- [ ] **Step 2: Démarrer en mode dev et vérifier les logs pretty**

```bash
pnpm start:dev
```

Expected: logs colorés en lignes uniques (par exemple `[Nest] LOG ...`). Format différent du logger NestJS par défaut. `Ctrl+C` pour stopper.

- [ ] **Step 3: Démarrer en mode prod et vérifier les logs JSON**

```bash
NODE_ENV=production pnpm start 2>&1 | head -5
```

Expected: logs au format JSON (pas de couleurs, structure `{"level":30,"time":...,"msg":"..."}`). `Ctrl+C` pour stopper.

- [ ] **Step 4: Commit**

```bash
git add src/app.module.ts
git commit -m "feat(logger): Pino structuré via nestjs-pino

- pino-pretty en development, JSON en production/test
- Niveau pilotable via LOG_LEVEL (défaut: debug en dev, info en prod)
- Redaction Authorization et Cookie pour éviter les fuites de tokens
- /health ignoré pour ne pas polluer les logs
- Vérifié manuellement : pretty en dev, JSON en prod

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Exception filter global

**Files:**
- Create: `src/common/filters/http-exception.filter.ts`
- Modify: `src/main.ts` (câblage)

- [ ] **Step 1: Créer `src/common/filters/http-exception.filter.ts`**

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

- [ ] **Step 2: Câbler le filter dans `src/main.ts`**

Modifier `src/main.ts` (réécriture complète, on remplace le contenu par défaut du scaffold) :

```typescript
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppConfigService } from './config/app-config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get(AppConfigService);

  app.useGlobalFilters(new HttpExceptionFilter());

  app.enableShutdownHooks();
  await app.listen(config.port);
  app.get(Logger).log(`Listening on http://localhost:${config.port}`);
}
void bootstrap();
```

> Note : `ValidationPipe` et `Swagger` viendront à la Task 10.

- [ ] **Step 3: Démarrer l'app et tester une route inexistante**

```bash
pnpm start &
sleep 2
curl -s -i http://localhost:3000/route-inexistante | head -20
kill %1
wait 2>/dev/null
```

Expected: réponse HTTP 404 avec body JSON contenant `statusCode`, `error`, `message`, `path`, `timestamp`.

Exemple attendu :
```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Cannot GET /route-inexistante",
  "path": "/route-inexistante",
  "timestamp": "2026-04-25T..."
}
```

- [ ] **Step 4: Commit**

```bash
git add src/common/filters/http-exception.filter.ts src/main.ts
git commit -m "feat(common): exception filter global format unifié

Format JSON: { statusCode, error, message, path, timestamp }
- @Catch() sans argument: attrape HttpException ET non-HTTP errors
- Log error pour status >= 500 avec stack
- main.ts réécrit: bufferLogs, useLogger Pino, enableShutdownHooks

Vérifié: GET /route-inexistante → 404 avec body JSON enrichi.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: `ValidationPipe` global + Swagger sur `/docs`

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Compléter `src/main.ts` avec ValidationPipe et Swagger**

Réécrire `src/main.ts` :

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

- [ ] **Step 2: Démarrer et vérifier que `/docs` répond**

```bash
pnpm start &
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/docs
curl -s http://localhost:3000/docs-json | head -c 200
kill %1
wait 2>/dev/null
```

Expected:
- `/docs` retourne `200` (page Swagger UI HTML).
- `/docs-json` retourne du JSON OpenAPI commençant par `{"openapi":"3.0.0",…`.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat(bootstrap): ValidationPipe global + Swagger sur /docs

- ValidationPipe: whitelist + forbidNonWhitelisted + transform
  + enableImplicitConversion (auto-conversion Param string → number)
- Swagger UI sur /docs, JSON OpenAPI sur /docs-json
- Vérifié manuellement : /docs renvoie 200, /docs-json renvoie OpenAPI 3.0.0

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: `HealthController` (TDD) + `HealthModule`

**Files:**
- Create: `src/health/health.controller.ts`
- Create: `src/health/health.controller.spec.ts`
- Create: `src/health/health.module.ts`
- Modify: `src/app.module.ts` (ajouter `HealthModule`)

- [ ] **Step 1: Écrire le test `src/health/health.controller.spec.ts` AVANT l'implémentation**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { DRIZZLE } from '../database/drizzle.constants';

describe('HealthController', () => {
  let controller: HealthController;
  let dbExecute: jest.Mock;

  beforeEach(async () => {
    dbExecute = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: DRIZZLE, useValue: { execute: dbExecute } },
      ],
    }).compile();
    controller = module.get<HealthController>(HealthController);
  });

  it('retourne status:ok quand la DB répond', async () => {
    dbExecute.mockResolvedValueOnce([{ '?column?': 1 }]);
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.db.status).toBe('up');
    expect(typeof result.db.latencyMs).toBe('number');
    expect(result.db.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.uptime).toBe('number');
    expect(result.version).toBeDefined();
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('retourne status:degraded quand la DB échoue', async () => {
    dbExecute.mockRejectedValueOnce(new Error('connection refused'));
    const result = await controller.check();
    expect(result.status).toBe('degraded');
    expect(result.db.status).toBe('down');
    expect(result.db.latencyMs).toBeNull();
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
pnpm test src/health/health.controller.spec.ts
```

Expected: FAIL avec "Cannot find module './health.controller'".

- [ ] **Step 3: Implémenter `src/health/health.controller.ts`**

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
      // status:'degraded' renvoyé en 200 plutôt que 503 — distingue
      // "app vivante / DB plantée" d'un service injoignable.
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

- [ ] **Step 4: Implémenter `src/health/health.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

```bash
pnpm test src/health/health.controller.spec.ts
```

Expected: PASS, 2 tests verts.

- [ ] **Step 6: Importer `HealthModule` dans `AppModule`**

Réécrire `src/app.module.ts` (version complète, ajout de `HealthModule` à la fin des imports) :

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
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
          autoLogging: { ignore: (req: { url?: string }) => req.url === '/health' },
          customProps: () => ({ context: 'HTTP' }),
          serializers: {
            req: (req: { id?: string; method?: string; url?: string }) => ({
              id: req.id, method: req.method, url: req.url,
            }),
          },
        },
      }),
    }),
    DatabaseModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

> Note : `AppController`/`AppService` seront retirés à la Task 12 (final cleanup du scaffold).

- [ ] **Step 7: Tester `/health` end-to-end avec DB UP**

```bash
pnpm db:up && pnpm db:wait
pnpm start &
sleep 3
curl -s http://localhost:3000/health | jq
kill %1
wait 2>/dev/null
```

Expected:
```json
{
  "status": "ok",
  "db": { "status": "up", "latencyMs": <int >= 0> },
  "uptime": <int>,
  "version": "0.0.1",
  "timestamp": "2026-04-25T..."
}
```

Si `jq` n'est pas installé, omettre `| jq`.

- [ ] **Step 8: Tester `/health` end-to-end avec DB DOWN**

```bash
pnpm db:down
pnpm start &
sleep 3
curl -s http://localhost:3000/health | jq
kill %1
wait 2>/dev/null
pnpm db:up && pnpm db:wait  # restaurer pour la suite
```

Expected :
```json
{
  "status": "degraded",
  "db": { "status": "down", "latencyMs": null },
  ...
}
```

Avec un statut HTTP **200** (pas 503).

- [ ] **Step 9: Commit**

```bash
git add src/health/ src/app.module.ts
git commit -m "feat(health): endpoint GET /health + HealthModule

- check() exécute SELECT 1 via Drizzle, mesure la latency
- DB up → status:'ok', DB down → status:'degraded' (HTTP 200 dans
  les deux cas, distingue 'app vivante / DB KO' de 'service injoignable')
- 2 tests unitaires avec mock du provider DRIZZLE
- Vérifié manuellement: db:up → ok, db:down → degraded

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Nettoyage du scaffold par défaut + ajustements scripts

**Files:**
- Delete: `src/app.controller.ts`, `src/app.service.ts`, `src/app.controller.spec.ts`, `test/app.e2e-spec.ts`
- Modify: `src/app.module.ts` (retirer `AppController`/`AppService`)
- Modify: `package.json` (script `lint` ciblé sur `{src,test}` uniquement, ajout `predev` + `dev`)

- [ ] **Step 1: Supprimer les fichiers du scaffold par défaut**

```bash
rm src/app.controller.ts src/app.service.ts src/app.controller.spec.ts test/app.e2e-spec.ts
ls src/ test/
```

Expected:
```
src/  : app.module.ts  common  config  database  health  main.ts
test/ : jest-e2e.json
```

- [ ] **Step 2: Mettre à jour `src/app.module.ts` pour retirer `AppController` et `AppService`**

Réécrire `src/app.module.ts` (version finale) :

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
          autoLogging: { ignore: (req: { url?: string }) => req.url === '/health' },
          customProps: () => ({ context: 'HTTP' }),
          serializers: {
            req: (req: { id?: string; method?: string; url?: string }) => ({
              id: req.id, method: req.method, url: req.url,
            }),
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

- [ ] **Step 3: Mettre à jour les scripts dans `package.json`**

Modifier la section `scripts` :

- Remplacer `"lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix"` par `"lint": "eslint \"{src,test}/**/*.ts\" --fix"` (on n'a ni `apps/` ni `libs/`).
- Ajouter `"dev": "nest start --watch"` (alias pratique).
- Ajouter `"predev": "pnpm db:up && pnpm db:wait"` (lifecycle hook : se déclenche avant `pnpm dev`).

État final attendu de `scripts` :

```json
{
  "build": "nest build",
  "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
  "lint": "eslint \"{src,test}/**/*.ts\" --fix",
  "start": "nest start",
  "start:dev": "nest start --watch",
  "start:debug": "nest start --debug --watch",
  "start:prod": "node dist/main",
  "dev": "nest start --watch",
  "predev": "pnpm db:up && pnpm db:wait",
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
  "test:debug": "node --inspect-brk -r tsconfig-paths/register -r ts-node/register node_modules/.bin/jest --runInBand",
  "test:e2e": "jest --config ./test/jest-e2e.json"
}
```

- [ ] **Step 4: Vérifier que tout compile et passe**

```bash
pnpm build
pnpm test
pnpm lint
```

Expected : tout passe sans erreur ni warning. **2 tests** au total :
- `src/config/env.validation.spec.ts` (9 tests internes)
- `src/health/health.controller.spec.ts` (2 tests internes)

- [ ] **Step 5: Vérifier que `pnpm dev` enchaîne `db:up` puis l'app**

```bash
pnpm db:down  # repartir d'un état propre
pnpm dev &
sleep 8
curl -s http://localhost:3000/health
kill %1
wait 2>/dev/null
```

Expected: `predev` démarre Postgres, attend qu'il soit prêt, puis `dev` lance l'app. `/health` retourne `status: ok`.

- [ ] **Step 6: Commit**

```bash
git add src/app.module.ts package.json
git rm src/app.controller.ts src/app.service.ts src/app.controller.spec.ts test/app.e2e-spec.ts
git commit -m "chore: retirer le scaffold par défaut + finaliser scripts

- Suppression de AppController, AppService et leurs tests (hello world)
- Suppression du test e2e par défaut (référence AppController retiré ;
  pas de tests e2e dans cette itération, scope minimaliste)
- AppModule final: 5 imports (Config, AppConfig, Logger, Database, Health)
- Scripts: alias 'dev' avec hook predev (db:up + db:wait)
- Lint cible {src,test} (pas d'apps/libs)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Réécriture du `README.md`

**Files:**
- Modify: `README.md` (réécriture complète)

- [ ] **Step 1: Réécrire `README.md` à la racine**

Remplacer tout le contenu par :

````markdown
# Portfolio NestJS Backend

Backend NestJS du portfolio J-Ned. Sous-projet **"Fondations"** : squelette technique sans aucun module métier — la persistance est branchée, la config est validée, le logger est structuré, mais aucune entité applicative n'existe encore.

> Spec d'architecture détaillée : [`docs/superpowers/specs/2026-04-25-fondations-nest-portfolio-design.md`](docs/superpowers/specs/2026-04-25-fondations-nest-portfolio-design.md)
> Plan d'implémentation : [`docs/superpowers/plans/2026-04-25-fondations-nest-portfolio.md`](docs/superpowers/plans/2026-04-25-fondations-nest-portfolio.md)

## Quickstart

**Prérequis :** Node 22 (cf. `.nvmrc`), pnpm, Podman.

```bash
pnpm install
cp .env.example .env
pnpm dev          # Démarre Postgres en container puis l'app NestJS
```

Endpoints disponibles :

| URL | Description |
|---|---|
| `http://localhost:3000/health` | Healthcheck (renvoie `status: ok` si DB up) |
| `http://localhost:3000/docs` | Swagger UI |
| `http://localhost:3000/docs-json` | OpenAPI JSON |

## Architecture

Cinq imports root dans `AppModule` :

1. **`ConfigModule`** (`@nestjs/config`, global) — charge `.env` et invoque `validateEnv()`.
2. **`AppConfigModule`** — expose `AppConfigService`, wrapper typé sur `ConfigService`.
3. **`LoggerModule`** (`nestjs-pino`, global) — Pino structuré, `pino-pretty` en dev, JSON en prod.
4. **`DatabaseModule`** (`@Global`) — expose le token `DRIZZLE` (instance Drizzle connectée à Postgres).
5. **`HealthModule`** — controller `GET /health` avec ping DB.

Les deux modules `@Global` (Logger et Database) sont accessibles partout sans import explicite, sur le calque du pattern `StorageModule` de [`prompt-hub-backend`](../../Prompt%20Hub/prompt-hub-backend) — le projet de référence dont on hérite les conventions (structure feature-first aplanie, pas de `common/pipes/`/`filters/` prématuré, exceptions NestJS natives).

## Configuration

Toute la config passe par les variables d'env, validées au boot par Zod. **L'app crash immédiatement avec un message lisible** si une variable est manquante ou invalide.

| Variable | Type | Défaut | Rôle |
|---|---|---|---|
| `NODE_ENV` | `development` \| `production` \| `test` | `development` | Pilote le format des logs et le logger Drizzle |
| `PORT` | int 1-65535 | `3000` | Port HTTP |
| `DATABASE_URL` | URL `postgres://…` | *(requis)* | Connexion Drizzle |
| `LOG_LEVEL` | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` | `debug` en dev, `info` sinon | Niveau Pino |

## Base de données

PostgreSQL 17 dans un container Podman dédié (`portfolio-nest-db`), exposé sur **port 55432** pour ne pas entrer en conflit avec le backend Hono actuel qui utilise sa propre instance.

### Choix techniques

- **Drizzle ORM** : type-safe, génération SQL transparente, pas de runtime overhead. Préféré à Prisma (qui exige un client généré et compromet le typage du schéma) et à TypeORM (decorators-heavy, runtime metadata).
- **Driver `postgres-js`** plutôt que `pg` : recommandé par la doc Drizzle, plus performant, plus léger, zéro dépendance native.
- **`casing: 'snake_case'`** : convention Postgres standard. Drizzle convertit automatiquement vers `camelCase` en TypeScript.

### Workflow migrations

```bash
pnpm db:up              # Démarre le container Postgres
pnpm db:wait            # Attend que Postgres réponde
pnpm db:generate        # Génère une migration depuis le schéma TS
pnpm db:migrate         # Applique les migrations en attente
pnpm db:studio          # UI web (Drizzle Studio)
pnpm db:reset           # Wipe + recrée + migrations from scratch (dev only)
pnpm db:down            # Stoppe le container
```

Tant qu'aucun module métier n'a ajouté de schéma à `src/database/schema/index.ts`, `db:generate` ne produit rien.

## Logging

[`nestjs-pino`](https://github.com/iamolegga/nestjs-pino) — Pino sous le capot.

- **Dev** : sortie `pino-pretty` (lignes colorées, lisibles).
- **Prod / test** : JSON structuré (parsable par Loki, Datadog, Grafana, etc.).
- **Redaction** automatique des headers `Authorization` et `Cookie` pour éviter les fuites de tokens dans les logs.
- **`/health`** est ignoré par le logger HTTP (sinon il pollue les logs au rythme du pinger).

## Erreurs

Format JSON unifié émis par le filter global `HttpExceptionFilter` :

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Cannot GET /foo",
  "path": "/foo",
  "timestamp": "2026-04-25T13:42:00.000Z"
}
```

Les exceptions non-HTTP (bug code, panique Drizzle) sont capturées en 500 propre avec stack loggée en `error`.

## Validation HTTP

`ValidationPipe` global :
- `whitelist: true` — strippe les champs non déclarés dans le DTO.
- `forbidNonWhitelisted: true` — **renvoie 400 si le client envoie un champ inattendu** (détection précoce des bugs frontend).
- `transform: true` + `enableImplicitConversion: true` — `@Param('id')` typé `number` est auto-converti depuis l'URL.

Les DTOs futurs utiliseront `class-validator` + `@ApiProperty` (Swagger inline), comme dans `prompt-hub-backend`.

## Tests

- **Unitaires** : `*.spec.ts` à côté du code source. Convention prompt-hub.
- **E2E** : harnais `test/jest-e2e.json` présent mais aucun test e2e dans cette itération (scope minimaliste, ajout dans les sous-projets ultérieurs).

```bash
pnpm test           # Tous les tests unitaires
pnpm test:watch     # Mode watch
pnpm test:cov       # Avec coverage
pnpm test:e2e       # E2E (placeholder pour l'instant)
```

## Scripts pnpm — récap

| Script | Description |
|---|---|
| `pnpm dev` | Démarre Postgres + app en watch (hook `predev`) |
| `pnpm start:dev` | App seule en watch (DB déjà démarrée) |
| `pnpm start` / `pnpm start:prod` | Démarrage normal / production |
| `pnpm build` | Compile vers `dist/` |
| `pnpm lint` / `pnpm format` | ESLint / Prettier |
| `pnpm test` / `pnpm test:watch` / `pnpm test:cov` | Tests Jest |
| `pnpm db:up` / `pnpm db:down` / `pnpm db:wait` | Cycle Postgres |
| `pnpm db:reset` | Wipe + recrée + migrations |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:studio` | Drizzle Kit |

## Migration depuis le backend Hono

Le backend Hono actuel (`../angular-portfolio-app/backend`) reste actif pendant la construction de ce NestJS. Le portage se fait par sous-projets indépendants (un spec et un plan par sous-projet) :

1. **Fondations** *(en cours)*
2. Auth (Users + JWT + 2FA + cookies)
3. Profile public (Profile, Hero, SocialLinks, Diplomas, Technologies, Expertises, ServicePricing)
4. Projects (CRUD + upload image S3)
5. Contact (messages + mailer)
6. Bookings (réservations + slots + mail)
7. CV (upload S3 + download)
8. Analytics (page views + agrégats)

La DB du NestJS est **isolée** de celle du Hono (port 55432 vs port d'origine). Aucune sync de données pendant la migration. La copie des données réelles sera traitée à la fin.

## Décisions d'architecture (résumé)

Voir [le spec complet](docs/superpowers/specs/2026-04-25-fondations-nest-portfolio-design.md) — tableau détaillé de 16 ADR.

Les choix non-évidents :

- **DB Postgres dédiée au NestJS** (port 55432) : isolation totale du Hono pendant la migration.
- **`postgres-js` plutôt que `pg`** : recommandé Drizzle, plus performant.
- **`casing: snake_case`** Drizzle : convention SQL standard, conversion auto vers camelCase.
- **Validation env via Zod** (pas class-validator) : tourne hors contexte Nest au boot.
- **`@Global` pour Database et Logger** : calque pattern `StorageModule` de prompt-hub.
- **`DRIZZLE` injection token (Symbol)** : pattern Drizzle+NestJS recommandé.
- **`forbidNonWhitelisted: true`** : détection immédiate des champs inattendus (vs strip silencieux dans prompt-hub).
- **Exception filter custom** : ajoute `path` + `timestamp` (utile pour debug en prod).
- **Pino plutôt que logger NestJS par défaut** : structuré, redaction des secrets.
- **`/health` répond 200 `degraded` si DB KO** (et non 503) : distingue "app vivante / DB plantée" d'un service injoignable.
- **Container DB en Podman compose rootless** : préférence utilisateur, portable.
- **Postgres 17-alpine épinglé** : reproductibilité, image légère.

## Licence

UNLICENSED (privé).
````

- [ ] **Step 2: Vérifier que le README est lisible**

```bash
head -30 README.md
```

Expected: titre, paragraphe d'intro, lien vers spec/plan, début du Quickstart.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README complet — onboarding, architecture, ADR

Remplacement du README scaffold par défaut. Couvre Quickstart,
architecture (5 imports root), config (table env vars), DB (workflow
Drizzle + Podman), logging Pino, format d'erreur, validation HTTP,
tests, scripts pnpm, plan de migration depuis le Hono, et résumé ADR
avec lien vers le spec complet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Vérification finale — tous les critères de done du spec

**Files:** *(aucune modification, vérification uniquement)*

Cette task ne modifie rien : elle vérifie que les **13 critères de done** listés en §11 du spec sont satisfaits, dans l'ordre. Si un critère échoue, retourner aux tasks précédentes pour corriger.

- [ ] **Step 1: `pnpm install` est idempotent**

```bash
pnpm install
```

Expected: `Already up to date` ou message équivalent. Aucune erreur de résolution.

- [ ] **Step 2: `cp .env.example .env` produit un fichier valide qui passe la validation Zod**

```bash
cp .env.example .env.test-clean
diff .env.test-clean .env || true   # devraient être identiques au boot initial
rm .env.test-clean
```

Expected: les fichiers sont identiques (le user n'a pas modifié `.env` depuis Task 4). Sinon : juste vérifier que `.env.example` est valide en bootant avec.

- [ ] **Step 3: `pnpm db:up` démarre le container Postgres en moins de 10s**

```bash
pnpm db:down
time pnpm db:up
pnpm db:wait
```

Expected: `db:up` < 10s (peut être plus long au tout premier run avec pull image, mais ensuite < 5s). `db:wait` retourne sans timeout.

- [ ] **Step 4: `pnpm start:dev` démarre l'app sans erreur**

```bash
pnpm start:dev &
sleep 5
# Vérifier dans les logs qu'il y a "Listening on http://localhost:3000 (docs: /docs)"
kill %1
wait 2>/dev/null
```

Expected: log de listening présent, aucune erreur dans la sortie.

- [ ] **Step 5: `curl /health` retourne le payload attendu (DB up)**

```bash
pnpm start &
sleep 3
curl -s -w "\nHTTP %{http_code}\n" http://localhost:3000/health
kill %1
wait 2>/dev/null
```

Expected: HTTP 200, body avec `status:'ok'`, `db.status:'up'`, `db.latencyMs` numérique, `uptime` numérique, `version`, `timestamp` ISO.

- [ ] **Step 6: `curl /docs` retourne la page Swagger UI**

```bash
pnpm start &
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/docs
kill %1
wait 2>/dev/null
```

Expected: `200`.

- [ ] **Step 7: `/health` répond 200 `degraded` si DB KO**

```bash
pnpm db:down
pnpm start &
sleep 3
curl -s -w "\nHTTP %{http_code}\n" http://localhost:3000/health
kill %1
wait 2>/dev/null
pnpm db:up && pnpm db:wait
```

Expected: HTTP 200, body avec `status:'degraded'`, `db.status:'down'`, `db.latencyMs:null`.

- [ ] **Step 8: `pnpm test` passe**

```bash
pnpm test
```

Expected: 2 fichiers de test, 11 tests internes au total (9 env validation + 2 health), tous verts.

- [ ] **Step 9: `pnpm lint` ne rapporte aucune erreur**

```bash
pnpm lint
```

Expected: aucun message d'erreur ESLint.

- [ ] **Step 10: `pnpm build` produit `dist/` exécutable**

```bash
pnpm build
ls dist/
```

Expected: dossier `dist/` créé avec `main.js`, `app.module.js`, etc.

```bash
# Vérifier que dist/main est exécutable (smoke test, ne lancer que brièvement)
node dist/main &
sleep 3
curl -s http://localhost:3000/health
kill %1
wait 2>/dev/null
```

Expected: `/health` répond `status:'ok'` (avec DB up).

- [ ] **Step 11: `pnpm db:generate` ne produit aucune migration**

```bash
ls drizzle/ 2>/dev/null
pnpm db:generate
ls drizzle/ 2>/dev/null
```

Expected: avant et après identiques (dossier `drizzle/` vide ou inexistant). Output de `db:generate` du genre `No schema changes, nothing to migrate`.

- [ ] **Step 12: Le `README.md` couvre toutes les sections**

```bash
grep -E "^## " README.md
```

Expected: au moins ces sections : Quickstart, Architecture, Configuration, Base de données, Logging, Erreurs, Validation HTTP, Tests, Scripts pnpm, Migration depuis le backend Hono, Décisions d'architecture.

- [ ] **Step 13: Format d'erreur unifié vérifié manuellement**

```bash
pnpm start &
sleep 3
curl -s http://localhost:3000/route-inexistante | jq
kill %1
wait 2>/dev/null
```

Expected:
```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Cannot GET /route-inexistante",
  "path": "/route-inexistante",
  "timestamp": "..."
}
```

- [ ] **Step 14: Final commit (optionnel — uniquement si une vérification a révélé un fix mineur)**

Si tout est vert, ce step ne produit pas de commit. Sinon, corriger inline et commiter avec un message du type :

```bash
git add <fichiers>
git commit -m "fix: <description précise>

Découvert lors de la vérification finale du sous-projet Fondations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 15: Vérifier la log git finale**

```bash
git log --oneline
```

Expected (ordre approximatif) :
```
<hash> docs: README complet — onboarding, architecture, ADR
<hash> chore: retirer le scaffold par défaut + finaliser scripts
<hash> feat(health): endpoint GET /health + HealthModule
<hash> feat(bootstrap): ValidationPipe global + Swagger sur /docs
<hash> feat(common): exception filter global format unifié
<hash> feat(logger): Pino structuré via nestjs-pino
<hash> feat(db): câblage Drizzle + DatabaseModule @Global
<hash> feat(db): container Postgres dédié en Podman compose
<hash> feat(config): câbler ConfigModule + AppConfigModule au boot
<hash> feat(config): wrapper AppConfigService typé + .env.example
<hash> feat(config): validation Zod des variables d'env
<hash> feat(deps): ajout des dépendances Fondations
<hash> chore: scaffold NestJS 11 + Node 22 pin
<hash> docs(spec): design des Fondations du backend NestJS
```

14 commits, historique lisible, chaque commit a un sens propre.

---

## Récap final

À la fin de ce plan, le projet `nest-portfolio-app` est dans l'état suivant :

✅ Squelette NestJS configuré, sans aucun module métier
✅ Validation Zod des variables d'env au boot
✅ PostgreSQL 17 isolé dans un container Podman
✅ Drizzle ORM connecté, prêt à recevoir des schémas
✅ Logger Pino structuré
✅ Format d'erreur JSON unifié
✅ Swagger UI sur `/docs`
✅ `GET /health` qui ping la DB
✅ 11 tests unitaires verts (env + health)
✅ Build production fonctionnel
✅ README documenté avec ADR
✅ Onboarding nouveau dev en 3 commandes : `pnpm install && cp .env.example .env && pnpm dev`

**Prochaine étape** : nouveau cycle brainstorm → spec → plan pour le sous-projet **Auth** (Users + JWT + 2FA + cookies).
