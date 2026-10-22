# Portfolio NestJS Backend

Backend NestJS du portfolio J-Ned. Toutes les routes sont montées sous le préfixe global **`/api`** (`app.setGlobalPrefix('api')` dans `src/app.setup.ts`) - le Swagger UI fait exception, il reste à la racine (`/docs`, non préfixé). Toute route inconnue, sous `/api` ou hors préfixe, répond par la même erreur JSON (`HttpExceptionFilter`, repli `src/common/filters/out-of-prefix-fallback.ts` depuis NestJS 12).

## Quickstart

**Prérequis :** Node 24 (cf. `.nvmrc`), pnpm, Podman (ou Docker - `compose.yaml` est compatible).

```bash
pnpm install
cp .env.example .env    # si absent, voir la section Configuration pour la liste complète des variables
pnpm db:up && pnpm db:wait
pnpm db:migrate                       # applique les migrations Drizzle
pnpm db:seed                          # crée l'admin (idempotent, no-op si un user existe déjà)
pnpm start:dev                        # démarre l'app en watch
```

> `pnpm dev` (= alias de `start:dev`) a un hook `predev` qui démarre Postgres + Mailpit (`pnpm db:up && pnpm db:wait && pnpm mail:up`). Le container MinIO n'est **pas** démarré par ce hook - le démarrer manuellement (`podman compose up -d minio minio-init`, cf. `compose.yaml`) si les features S3 (Projects/CV) sont testées en local.

Endpoints disponibles une fois démarré :

| URL                                | Description                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `http://localhost:3000/api/health` | Healthcheck (200 avec `status: "ok"` ou `"degraded"` selon l'état DB - jamais 503) |
| `http://localhost:3000/api/config` | Config publique pour le frontend (Sentry DSN/env/release)                          |
| `http://localhost:3000/docs`       | Swagger UI (**pas** sous `/api`)                                                   |
| `http://localhost:3000/docs-json`  | OpenAPI JSON                                                                       |

## Architecture

Modules importés dans `AppModule` (`src/app.module.ts`), dans l'ordre :

1. **`SentryModule`** (`@sentry/nestjs`) - init au tout début de `main.ts` via `src/instrument.ts` (avant `NestFactory.create`, car `@nestjs/config` n'a pas encore tourné). `SentryGlobalFilter` capture toutes les exceptions non gérées via `APP_FILTER`.
2. **`ConfigModule`** (`@nestjs/config`, global) - charge `.env` et invoque `validateEnv()` (Zod).
3. **`AppConfigModule`** - expose `AppConfigService`, wrapper typé sur `ConfigService`.
4. **`LoggerModule`** (`nestjs-pino`, global) - Pino structuré ; en plus du logging, un hook `logMethod` renvoie tout log `level >= 50` (error) vers `Sentry.captureMessage` (sauf s'il s'agit déjà d'une exception capturée par `SentryGlobalFilter`, pour éviter le doublon).
5. **`DatabaseModule`** (`@Global`) - expose le token `DRIZZLE` (instance Drizzle connectée à Postgres).
6. **`HealthModule`** - `GET /api/health` avec ping DB.
7. **`AuthModule`** - users, JWT, 2FA TOTP.
8. **`StorageModule`** (`@Global`) - `StorageService` (S3) + `StorageController` (proxy public).
9. **`ProjectsModule`** - CRUD projets + upload image.
10. **`BlogModule`** - CRUD admin des articles de blog + endpoints publics (liste/détail/like), lus à la requête par le front (aucune écriture ne déclenche de rebuild).
11. **`ProfileModule`** - contenu de la page Parcours (`/about`) : document unique versionné + portrait, lu à la requête par le front (aucune écriture ne déclenche de rebuild).
12. **`MailerModule`** (`@Global`) - `MailerService` (SMTP).
13. **`ThrottlerModule`** (global, `APP_GUARD`) - 10 req/60s par défaut, overridable par endpoint via `@Throttle()`.
14. **`ContactModule`** - formulaire de contact public + gestion admin.
15. **`ScheduleModule`** (`@nestjs/schedule`) - support des `@Cron()`.
16. **`CvModule`** - upload/download du CV.
17. **`AnalyticsModule`** - tracking + stats + rollup cron.
18. **`RuntimeConfigModule`** - `GET /api/config`.

Les modules `@Global` (`DatabaseModule`, `StorageModule`, `MailerModule`, `LoggerModule`) sont injectables partout sans import explicite.

## Configuration

Toute la config passe par les variables d'env, validées au boot par Zod (`src/config/env.schema.ts`). **L'app crash immédiatement avec un message lisible** si une variable requise est manquante ou invalide.

| Variable                    | Type                                               | Défaut                       | Rôle                                                                                                                                                                                                                                                                                          |
| --------------------------- | -------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                  | `development` \| `production` \| `test`            | `development`                | Pilote le format des logs, le sample rate Sentry                                                                                                                                                                                                                                              |
| `PORT`                      | int 1-65535                                        | `3000`                       | Port HTTP                                                                                                                                                                                                                                                                                     |
| `DATABASE_URL`              | URL `postgres://...`                               | _(requis)_                   | Connexion Drizzle                                                                                                                                                                                                                                                                             |
| `LOG_LEVEL`                 | `fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace` | `debug` en dev, `info` sinon | Niveau Pino                                                                                                                                                                                                                                                                                   |
| `JWT_SECRET`                | string, 32+ chars                                  | _(requis)_                   | Signature JWT                                                                                                                                                                                                                                                                                 |
| `JWT_EXPIRES_IN`            | string                                             | `7d`                         | Durée de vie du JWT                                                                                                                                                                                                                                                                           |
| `COOKIE_DOMAIN`             | string                                             | _(vide → `localhost`)_       | Domaine du cookie httpOnly (`.example.fr` pour partager entre sous-domaines)                                                                                                                                                                                                                  |
| `ADMIN_EMAIL`               | email                                              | _(optionnel)_                | Requis uniquement pour `pnpm db:seed`                                                                                                                                                                                                                                                         |
| `ADMIN_INITIAL_PASSWORD`    | string, 12+ chars                                  | _(optionnel)_                | Requis uniquement pour `pnpm db:seed`                                                                                                                                                                                                                                                         |
| `TOTP_APP_NAME`             | string                                             | `J-Ned Portfolio`            | Nom affiché dans l'app authenticator                                                                                                                                                                                                                                                          |
| `CORS_ORIGINS`              | CSV                                                | `http://localhost:4200`      | Origines autorisées (credentials)                                                                                                                                                                                                                                                             |
| `S3_ENDPOINT`               | URL                                                | _(requis)_                   | Endpoint S3-compatible (MinIO/R2)                                                                                                                                                                                                                                                             |
| `S3_REGION`                 | string                                             | _(requis)_                   | Région S3                                                                                                                                                                                                                                                                                     |
| `S3_ACCESS_KEY`             | string, 4+ chars                                   | _(requis)_                   | Access key S3                                                                                                                                                                                                                                                                                 |
| `S3_SECRET_KEY`             | string, 8+ chars                                   | _(requis)_                   | Secret key S3                                                                                                                                                                                                                                                                                 |
| `SMTP_HOST`                 | string                                             | _(requis)_                   | Hôte SMTP                                                                                                                                                                                                                                                                                     |
| `SMTP_PORT`                 | int 1-65535                                        | `587`                        | Port SMTP                                                                                                                                                                                                                                                                                     |
| `SMTP_SECURE`               | `"true"`\|`"1"` → bool                             | `false`                      | TLS direct (port 465)                                                                                                                                                                                                                                                                         |
| `SMTP_USER`                 | string                                             | _(requis)_                   | User SMTP                                                                                                                                                                                                                                                                                     |
| `SMTP_PASS`                 | string                                             | _(requis)_                   | Password SMTP                                                                                                                                                                                                                                                                                 |
| `SMTP_FROM`                 | email                                              | _(requis)_                   | Expéditeur des mails                                                                                                                                                                                                                                                                          |
| `SENTRY_DSN`                | URL                                                | _(optionnel)_                | DSN backend ; vide = Sentry désactivé                                                                                                                                                                                                                                                         |
| `SENTRY_RELEASE`            | string                                             | _(optionnel)_                | Tag de release Sentry                                                                                                                                                                                                                                                                         |
| `SENTRY_TRACES_SAMPLE_RATE` | float 0-1                                          | `0.2` prod / `1.0` dev       | Sample rate tracing                                                                                                                                                                                                                                                                           |
| `SENTRY_FRONTEND_DSN`       | URL                                                | _(optionnel)_                | DSN d'un **projet Sentry distinct** pour le frontend, exposé publiquement via `GET /api/config`                                                                                                                                                                                               |

`S3_*` et `SMTP_*` sont **requis sans défaut** - impossible de démarrer l'app sans Storage et Mailer configurés, même si on ne les utilise pas en dev.

## Base de données

PostgreSQL 17-alpine dans un container Podman/Docker dédié (`portfolio-nest-db`, `compose.yaml`), exposé sur le **port 55432** (isolation vs d'autres backends locaux).

### Choix techniques

- **Drizzle ORM**, driver `postgres-js` (recommandé par la doc Drizzle, zéro dépendance native).
- **`casing: 'snake_case'`** dans `drizzle.config.ts` : convention Postgres standard, conversion auto vers `camelCase` côté TS.

### Schéma actuel (`src/database/schema/`)

Une table par module métier réellement implémenté : `users`, `project`, `project_image`, `contact_message`, `cv_file`, `blog_post`, `profile_content` (une seule ligne), plus les tables analytics (`page_view`, `analytics_event`, `daily_stat`).

### Workflow migrations

```bash
pnpm db:up              # Démarre le container Postgres
pnpm db:wait             # Attend que Postgres réponde (poll pg_isready)
pnpm db:generate        # Génère une migration depuis le schéma TS
pnpm db:migrate         # Applique les migrations en attente
pnpm db:studio          # UI web (Drizzle Studio)
pnpm db:reset           # Wipe + recrée + migrations + seed (dev only)
pnpm db:down            # Stoppe le container
```

## Logging

[`nestjs-pino`](https://github.com/iamolegga/nestjs-pino).

- **Dev** : sortie `pino-pretty`.
- **Prod/test** : JSON structuré.
- **Redaction** automatique (liste unique `LOG_REDACT_PATHS`, `src/common/log-redact.ts`) : `authorization`, `cookie`, `set-cookie`, et dans le body `password`, `newPassword`, `currentPassword`, `code`, `token`, `refreshToken`, `phone`, `email`.
- **Jeton du flux d'agenda** (abonnement retiré avec la prise de rendez-vous, spec 029 du front : les agendas déjà abonnés continuent d'appeler l'URL, jeton compris, et reçoivent un 404) : le sérialiseur `req` (`serializeRequest`) ne garde que `id`, `method` et l'URL passée à `redactUrl`, qui remplace tout ce qui suit `/api/booking/feed/` par `[Filtered]` (insensible à la casse, comme le routage Express) et, en renfort, tout segment à la forme du jeton (43 caractères base64url puis `.ics`) : `//`, segment encodé (`%66eed`) ou route mal formée ne le laissent pas passer. Le `path` des corps d'erreur et le log des 5xx de `HttpExceptionFilter` passent par la même fonction.
- **`/api/health`** est ignoré par le logger HTTP (évite de polluer les logs au rythme du pinger/healthcheck Docker).
- Tout log `error` (level ≥ 50) est aussi envoyé à Sentry via `Sentry.captureMessage`, sauf s'il s'agit déjà d'une exception capturée par le filter global (anti-doublon).

## Erreurs

Format JSON unifié émis par `HttpExceptionFilter` (`src/common/filters/http-exception.filter.ts`) :

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Cannot GET /api/foo",
  "path": "/api/foo",
  "timestamp": "2026-04-25T13:42:00.000Z"
}
```

`SentryGlobalFilter` (posé en `APP_FILTER`, avant `HttpExceptionFilter`) capture toute exception non gérée vers Sentry.

## Auth

Admin unique pré-seedé (pas de `/register`), JWT en cookie httpOnly, 2FA TOTP avec 10 backup codes hashés Argon2.

**Setup initial** :

```bash
pnpm db:seed     # crée l'admin avec ADMIN_EMAIL + ADMIN_INITIAL_PASSWORD (idempotent - no-op si des users existent déjà)
```

**9 endpoints sous `/api/auth`** :

| Méthode | Chemin                              | Auth | Rôle                                                                                             |
| ------- | ----------------------------------- | ---- | ------------------------------------------------------------------------------------------------ |
| POST    | `/auth/login`                       | ❌   | Login email + password. Renvoie un JWT (cookie) si pas de 2FA, sinon un `challengeToken` (5 min) |
| POST    | `/auth/2fa/verify`                  | ❌   | Complète le login 2FA (`challengeToken` + `code` TOTP ou `backupCode`)                           |
| POST    | `/auth/logout`                      | ✅   | Clear cookie                                                                                     |
| GET     | `/auth/me`                          | ✅   | Infos user courant                                                                               |
| POST    | `/auth/change-password`             | ✅   | Change le mot de passe                                                                           |
| POST    | `/auth/2fa/generate`                | ✅   | Génère secret + QR code (n'active pas encore)                                                    |
| POST    | `/auth/2fa/enable`                  | ✅   | Active 2FA après vérif code, renvoie 10 backup codes one-time                                    |
| POST    | `/auth/2fa/disable`                 | ✅   | Désactive 2FA (requiert password courant)                                                        |
| POST    | `/auth/2fa/regenerate-backup-codes` | ✅   | Régénère les 10 backup codes (requiert password courant)                                         |

**Décisions clés** :

- JWT unique (7j par défaut), un seul cookie httpOnly `token`, pas de refresh token (compromis assumé pour un backend mono-admin - un vrai couple access/refresh roté serait overkill ici).
- Algorithme JWT épinglé explicitement (`HS256`) au sign comme au verify - anti confusion d'algorithme.
- **Révocation via `tokenVersion`** : colonne `users.token_version` (int), embarquée dans le payload JWT à l'émission. Incrémentée par `UsersService` sur `updatePassword`/`enableTwoFactor`/`disableTwoFactor`. `JwtStrategy.validate` rejette tout JWT dont le `tokenVersion` ne correspond pas à celui en DB - un changement de mot de passe (ou `pnpm db:change-password`) invalide immédiatement tous les tokens déjà émis, sans avoir besoin d'un vrai refresh token.
- Argon2id pour le hash password et les backup codes.
- `JwtStrategy` rejette tout JWT avec `scope === '2fa-challenge'` - un challenge token ne peut jamais servir de session (défense en profondeur).
- Pas de rate limiting dédié sur `/auth/login` au-delà du throttle global (10/60s).

**Consommer l'auth dans un module** :

```typescript
@UseGuards(JwtAuthGuard)
@Post('something')
create(@CurrentUser() user: User, @Body() dto: CreateSomethingDto) { /* ... */ }
```

## Validation HTTP

`ValidationPipe` global (`src/app.setup.ts`) :

- `whitelist: true` - strippe les champs non déclarés dans le DTO.
- `forbidNonWhitelisted: true` - **400 si le client envoie un champ inattendu** (détection précoce de bugs frontend).
- `transform: true` + `enableImplicitConversion: true` - `@Param('id')` typé `number` est auto-converti depuis l'URL.

## Tests

- **Unitaires** : `*.spec.ts` à côté du code source, runner Jest (config inline dans `package.json`, `rootDir: src`). NestJS 12 est publié en ESM pur : comme le template officiel Nest 12 CommonJS, Jest tourne sous `node --experimental-vm-modules` (support `require(esm)` de Jest, Node ≥ 24.9), avertissement `ExperimentalWarning` masqué.
- **Intégration HTTP** : `src/app.setup.spec.ts` monte la configuration HTTP réelle (`setupApp`) et vérifie les erreurs JSON, Swagger et les replis.
- **E2E** : harnais `test/jest-e2e.json` présent mais aucun test e2e écrit : `pnpm test:e2e` sort en 1 (« No tests found »).

```bash
pnpm test           # Tous les tests unitaires
pnpm test:watch     # Mode watch
pnpm test:cov       # Avec coverage
pnpm test:e2e       # E2E (harnais vide, sort en 1)
```

## Scripts pnpm - récap

Liste réelle (`package.json`) - pas de script `s3:*` (démarrer MinIO à la main via `podman compose up -d minio minio-init`) :

| Script                                                              | Description                                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm start`                                                        | `nest start` (une fois)                                                                                                  |
| `pnpm start:dev` / `pnpm dev`                                       | `nest start --watch` (`dev` déclenche le hook `predev`, voir Quickstart)                                                 |
| `pnpm start:debug`                                                  | Watch + `--debug` (inspector Node)                                                                                       |
| `pnpm start:prod`                                                   | `node dist/main` (nécessite `pnpm build` avant)                                                                          |
| `pnpm build`                                                        | `nest build` → `dist/`                                                                                                   |
| `pnpm lint` / `pnpm format`                                         | ESLint (`--fix`) / Prettier                                                                                              |
| `pnpm lint:check` / `format:check` / `typecheck`                    | Vérifications sans écriture : ESLint, Prettier, `tsc --noEmit` (specs comprises). Ce que joue la CI                      |
| `pnpm test` / `test:watch` / `test:cov` / `test:e2e` / `test:debug` | Jest (sous `--experimental-vm-modules`, cf. Tests)                                                                       |
| `pnpm db:up` / `db:down` / `db:wait`                                | Cycle container Postgres (`podman compose`)                                                                              |
| `pnpm db:generate` / `db:migrate` / `db:studio`                     | Drizzle Kit                                                                                                              |
| `pnpm db:seed`                                                      | Crée l'admin (idempotent, `ADMIN_EMAIL`/`ADMIN_INITIAL_PASSWORD`)                                                        |
| `pnpm db:change-password <email> <newPassword>`                     | Change le mot de passe d'un user directement en DB (newPassword 12+ chars) - utile en cas de perte d'accès, bypass l'API |
| `pnpm db:reset`                                                     | Wipe volume + recrée + migrate + seed (dev only)                                                                         |
| `pnpm mail:up`                                                      | Démarre le container Mailpit                                                                                             |
| `pnpm sentry:sourcemaps`                                            | Upload des sourcemaps vers Sentry (`scripts/upload-sentry-sourcemaps.mjs`)                                               |
| `pnpm sentry:check-instrumentation`                                | Vérifie que Sentry trace `@Injectable`, `@Catch`, `@Cron` (`scripts/check-sentry-instrumentation.cjs`, après `pnpm build`) |

**CI** (`.github/workflows/ci.yml`, à chaque PR et sur `master`) : `install --frozen-lockfile`, `lint:check`, `format:check`, `typecheck`, `pnpm test` **avec** les tests d'intégration (service `postgres:17-alpine`, base jetable `PROFILE_IT_DATABASE_URL`), `build`, puis le build de l'image Docker tel que Dokploy l'exécute (sans push).

## S3 Storage

Module d'infrastructure S3-compatible, consommé par Projects, Blog, Profile et CV.

**Délais** (`src/storage/s3-client.ts`, `S3_TIMEOUTS`) : connexion 5 s, requête 30 s avec `throwOnRequestTimeout` (le SDK n'impose aucune borne par défaut et ne ferait qu'un warning), 3 tentatives au plus. 30 s couvrent le plus gros envoi (CV, 10 Mo) dès ~3 Mbit/s montants ; un stockage bloqué donne une erreur au lieu de tenir la requête, et le verrou du portrait, indéfiniment.

**Stack** : `@aws-sdk/client-s3` v3. Dev local : container MinIO (`compose.yaml`, ports 9000 API / 9001 console, bucket `portfolio-storage` initialisé en anonymous-read par le service `minio-init`). Prod : Cloudflare R2 (visé, non figé dans le code - juste un endpoint S3-compatible).

**API (`StorageService`)** :

| Méthode        | Signature                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upload`       | `(bucket, key, body: Buffer, contentType): Promise<void>`                                                                                                  |
| `get`          | `(bucket, key): Promise<S3ObjectStream>` (stream + contentType + contentLength ; 404 si absent)                                                            |
| `delete`       | `(bucket, key): Promise<void>` (idempotent)                                                                                                                |
| `getPublicUrl` | `(bucket, key): string` - retourne **`/storage/{bucket}/{key}`**, un chemin relatif servi par `StorageController` (proxy NestJS), _pas_ une URL S3 directe |

**`StorageController`** : `GET /storage/:bucket/*splat` - **hors du préfixe `/api`** (comme `/docs`), stream l'objet S3 avec ses `Content-Type`/`Content-Length` d'origine. Le proxy existe car R2 nécessite soit un Custom Domain (DNS géré par Cloudflare, pas encore le cas), soit ce détour applicatif - le proxy détient les credentials et sert les objets publics sans exposer le bucket directement.

**`StorageModule` est `@Global`**.

## Projects

CRUD admin des projets affichés sur le portfolio.

**Schéma** : table `project` (uuid, `slug` unique, `category`, `featured`, `order`, `image` (key S3), etc.).

**6 endpoints sous `/api/projects`** :

| Méthode | Chemin                | Auth | Rôle                                                                                                                                                                                                      |
| ------- | --------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET     | `/projects`           | ❌   | Liste publique. Filtres `?category=`, `?featured=true`. Tri `order ASC, createdAt DESC`.                                                                                                                  |
| GET     | `/projects/:id`       | ❌   | 404 si absent.                                                                                                                                                                                            |
| POST    | `/projects`           | ✅   | Crée. Slug auto-généré depuis `title`. 409 si collision de slug.                                                                                                                                          |
| PATCH   | `/projects/:id`       | ✅   | Met à jour. Re-slugifie si `title` change. `image: null` supprime l'image S3 (via `@Equals(null)` - pas de valeur arbitraire acceptée).                                                                   |
| DELETE  | `/projects/:id`       | ✅   | Supprime le projet + son image S3 si présente.                                                                                                                                                            |
| POST    | `/projects/:id/image` | ✅   | Upload multipart (`file`, max 5MB, MIME whitelist `image/webp\|jpeg\|png\|avif`, 422 si invalide). Converti en **AVIF ≤ 1600 px** (`sharp`) avant stockage, clé `<id>-<sha8>.avif` (cache immuable 1 an). |

**Lifecycle S3** : key = `projects/<id>.<ext>`. Ordre upload → update DB → cleanup ancienne clé (jamais l'inverse, pour ne jamais laisser une référence DB cassée). Les réponses API exposent une URL proxy (`getPublicUrl`), jamais la key S3 brute.

## Blog

CRUD admin des articles de blog + endpoints publics de consultation/like. Le front lit les articles à la requête (rendu serveur, spec front 022) : une écriture admin est visible dès la requête suivante, sans rebuild.

**Schéma** : table `blog_post` (uuid, `slug` unique, `excerpt`, `contentMarkdown`, `coverImage` (key S3), `tags` (array), `status: 'draft' | 'published'`, `likesCount`, `publishedAt`).

**8 endpoints sous `/api/blog/posts`** :

| Méthode | Chemin                   | Auth | Rôle                                                                                                                                                                                     |
| ------- | ------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET     | `/blog/posts`            | ❌   | Liste publique des articles publiés, triés par `publishedAt DESC`.                                                                                                                       |
| GET     | `/blog/posts/admin`      | ✅   | Liste complète (drafts inclus), triée par `createdAt DESC`.                                                                                                                              |
| GET     | `/blog/posts/:slug`      | ❌   | Détail public d'un article **publié**. 404 sur un slug draft/dépublié/inconnu (pas de fuite de contenu non publié).                                                                      |
| POST    | `/blog/posts`            | ✅   | Crée. Slug auto-généré depuis `title`. 409 si collision de slug.                                                                                                                         |
| PATCH   | `/blog/posts/:id`        | ✅   | Met à jour. Slug **figé** une fois l'article publié (ne se re-génère plus au changement de titre - casserait l'URL publique/le thread Giscus). `coverImage: null` supprime l'image S3.   |
| DELETE  | `/blog/posts/:id`        | ✅   | Supprime l'article + son image S3.                                                                                                                                                       |
| POST    | `/blog/posts/:id/image`  | ✅   | Upload multipart (`file`, max 5MB, MIME whitelist `image/webp\|jpeg\|png\|avif`). Converti en **AVIF ≤ 1600 px** (`sharp`) avant stockage, clé `<id>-<sha8>.avif` (cache immuable 1 an). |
| POST    | `/blog/posts/:slug/like` | ❌   | Incrémente le compteur de likes d'un article **publié** (public, pas d'auth). 404 sur un slug draft/dépublié/inconnu.                                                                    |

**Lifecycle S3** : identique à Projects (key `blog/<id>.<ext>`, ordre upload → update DB → cleanup ancienne clé).

## Profile (page Parcours)

Contenu de `/about` édité depuis l'admin (spec front 021, ADR-0023 du front) : **un document unique** versionné, lu à la requête par le front (rendu serveur, spec front 022 : aucune écriture ne déclenche de rebuild), l'identité (phrase d'accroche commune, nom, ville, réseaux) restant dans le code du front.

**Schéma** : table `profile_content`, une seule ligne (`id = 'main'`, `CHECK`) : `content jsonb` (biographie, traits, résumé et liste « ce que je fais », technos, résumé et liste des formations, motivation), `version integer`, `portrait_key` et `previous_portrait_key` (hors version), `updated_at`. Contenu initial versé par la migration `0021_profile_seed.sql` (généré depuis le contenu statique du front, égal à `src/profile/profile.seed.ts`, vérifié par test).

| Méthode | Chemin              | Auth | Rôle                                                                                                                                                                                                                                                                                                                             |
| ------- | ------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET     | `/profile`          | ❌   | Document à plat + `version`, `updatedAt`, `portrait` (URL proxy ou `null` = portrait par défaut du front). 120 req/min.                                                                                                                                                                                                          |
| PUT     | `/profile`          | ✅   | Remplace le document entier (`UpdateProfileDto` + `version` lue). Document identique à la `version` courante ⇒ 200 sans écriture ; version périmée ⇒ **409** ; 400 sur clé inconnue, borne (`PROFILE_LIMITS`), liste vide, `id` non UUID ou dupliqué, icône hors `^[a-z0-9-]{1,40}$`, texte blanc ou contenant du balisage HTML. |
| POST    | `/profile/portrait` | ✅   | Multipart `file` (max 5 Mo, `image/webp\|jpeg\|png\|avif`, 422 sinon). Recadré en **AVIF 640×800** (`ImageOptimizer.toPortrait`, `position: attention`), clé `profile/portrait-<sha8>.avif`. 200 + document. Envois simultanés sérialisés (verrou de ligne).                                                                     |
| DELETE  | `/profile/portrait` | ✅   | Retour au portrait par défaut. 204 (sans portrait : 204 sans écriture).                                                                                                                                                                                                                                                          |

**Lifecycle S3 du portrait** : une page `/about` déjà servie (onglet ouvert, cache HTTP) cite encore l'ancienne clé ; la supprimer à l'envoi casserait son image LCP. Chaque changement (envoi ou retrait) fait donc glisser les clés - courante → `previous_portrait_key` - et ne supprime que l'**avant-dernière** clé : au plus un fichier en trop dans le bucket, jamais une image citée absente.

**Sérialisation** : toute opération portrait tient le verrou de la ligne (`SELECT … FOR UPDATE` dans une transaction) : raccourci « même fichier », envoi S3 et `UPDATE` sous le même verrou, puis, après le `COMMIT`, suppression de l'objet devenu inutile dans une seconde transaction verrouillée qui ne supprime que si la ligne ne cite la clé ni comme courante ni comme précédente. La clé étant adressée par contenu, seule une opération portrait peut la réintroduire, envoi compris, et elle attend le verrou : une suppression décidée sous verrou ne retire jamais un objet cité. Deux envois simultanés s'appliquent l'un après l'autre (pas de 409). Envoi ou `UPDATE` en échec ⇒ rollback, puis l'objet envoyé est supprimé s'il n'est pas cité. Échec S3 du nettoyage ⇒ journalisé avec la clé (`S3 orphan …`), l'écriture reste validée, jamais une 500. **Durées bornées** : chaque transaction sur la ligne (opérations portrait **et** `PUT` texte) commence par `SET LOCAL lock_timeout = '5s'` ; au-delà, Postgres annule l'attente (`55P03`) et l'API répond **503** (« réessayez dans quelques secondes »), au lieu de garder une connexion du pool (10, partagé avec la lecture publique) indéfiniment. Le `PUT` texte ne prend pas le verrou `FOR UPDATE` et n'écrit jamais les colonnes du portrait (hors versionnage), mais son `UPDATE` attend derrière une opération portrait en cours : cette attente est bornée de la même façon. La lecture publique (`GET /profile`, `SELECT` simple) n'attend jamais le verrou. La détention du verrou est bornée par les délais du client S3 (`S3_TIMEOUTS`, ci-dessous). Test d'intégration sur Postgres réel : `PROFILE_IT_DATABASE_URL=… pnpm test -- profile-portrait.integration` (ignoré sans cette variable).

## Mailer

Module d'infrastructure SMTP (`nodemailer`), consommé par Contact.

**Dev local** : container Mailpit (`compose.yaml`, SMTP catch-all port 1025, UI web port 8025) - à démarrer manuellement (`podman compose up -d mailpit`, cf. avertissement Quickstart).
**Prod** : SMTP utilisateur classique (`SMTP_*`).

**API (`MailerService`)** : `sendMail({ to, subject, html }): Promise<void>` - 3 tentatives, backoff linéaire 1s/2s/3s, throw l'erreur finale après épuisement (loggée avec stack).

**Helpers** (`src/mailer/mailer.utils.ts`) : `loadTemplate(absolutePath)` (lecture fichier), `renderTemplate(html, vars)` (remplacement `{{var}}` naïf, pas d'échappement HTML - les templates sont internes, pas de contenu utilisateur non filtré injecté tel quel).

**`MailerModule` est `@Global`**.

## Contact

Formulaire de contact public + gestion admin des messages.

**Schéma** : table `contact_message` (uuid, `name`, `email`, `subject`, `message`, `read: boolean`, `createdAt`).

**6 endpoints sous `/api/contact`** :

| Méthode | Chemin                            | Auth | Rôle                                                                                                                                                                                    |
| ------- | --------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST    | `/contact/messages`               | ❌   | Soumission publique. **Throttle 5/60s** (override du throttle global 10/60s). Insère en DB, puis 2 mails fire-and-forget (notification admin + confirmation visiteur). 201 avec la row. |
| GET     | `/contact/messages`               | ✅   | Liste paginée (`?page&limit`), tri `createdAt DESC`.                                                                                                                                    |
| GET     | `/contact/messages/unread-count`  | ✅   | Compteur de messages non lus.                                                                                                                                                           |
| PATCH   | `/contact/messages/mark-all-read` | ✅   | Marque tous les messages non lus comme lus, renvoie `{ count }`.                                                                                                                        |
| PATCH   | `/contact/messages/:id/read`      | ✅   | Marque un message comme lu.                                                                                                                                                             |
| DELETE  | `/contact/messages/:id`           | ✅   | Suppression hard.                                                                                                                                                                       |

**Stratégie mails** : fire-and-forget après le `db.insert` (helper `fireAndForget` dans `src/common/utils.ts`) - le visiteur reçoit 201 dès la persistance garantie ; un échec SMTP (3 retries épuisés) est loggé mais invisible côté visiteur, le message reste consultable côté admin.

**Destinataire admin codé en dur** : `OWNER_EMAIL = 'contact@nedellec-julien.fr'` dans `src/mailer/mailer.constants.ts` (utilisé par le contact) - pas de variable d'env dédiée. `SMTP_FROM` reste l'expéditeur (rôle distinct).

**Templates** : `src/contact/mail-templates/contact-notification.html` (admin) et `contact-confirmation.html` (visiteur). Variables : `{{name}}`, `{{email}}`, `{{subject}}`, `{{message}}`.

## CV

Gestion du CV téléchargeable (pattern singleton - 1 row max en DB).

**Schéma** : table `cv_file` (uuid, `fileName`, `fileKey` unique, `fileSize`, `mimeType`, `uploadedAt`, `updatedAt`).

**4 endpoints sous `/api/cv`** :

| Méthode | Chemin         | Auth | Rôle                                                                                                                       |
| ------- | -------------- | ---- | -------------------------------------------------------------------------------------------------------------------------- |
| POST    | `/cv/upload`   | ✅   | Upload multipart (`file`, `application/pdf` strict). Upsert sur key fixe `cv/cv.pdf` (`onConflictDoUpdate` sur `fileKey`). |
| GET     | `/cv`          | ❌   | Métadonnées du CV courant, ou `null`.                                                                                      |
| GET     | `/cv/download` | ❌   | Stream backend du PDF, `Content-Disposition: attachment; filename="<original>"`. 404 si aucun CV.                          |
| DELETE  | `/cv`          | ✅   | Supprime DB row puis S3 (ordre inverse de Projects - DB d'abord, S3 ensuite).                                              |

**Pourquoi un proxy backend pour le download** : préserve le nom de fichier original uploadé par l'admin (pas la clé S3 `cv.pdf`).

## Analytics

Collecte de page-views/events custom du portfolio public + agrégation quotidienne via cron.

**3 tables** :

- `page_view` (raw, purgé après 30j)
- `analytics_event` (events custom : `project_click`, `article_view`, `cv_download`, purgé après 30j)
- `daily_stat` (rollup quotidien, conservé indéfiniment, unique sur `date`)

**8 endpoints sous `/api/analytics`** :

| Méthode | Chemin                                                              | Auth | Rôle                                                                                                        |
| ------- | ------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------- |
| POST    | `/analytics/track`                                                  | ❌   | Track page-view ou event custom. Fire-and-forget, 204. **Throttle 10/sec/IP**. Filtre les bots via `isbot`. |
| GET     | `/analytics/stats/overview`                                         | ✅   | Totaux (visitors, pv, sessions, bounceRate, avgDuration, eventCounts) sur une date range.                   |
| GET     | `/analytics/stats/chart`                                            | ✅   | Time-series quotidien (`daily_stat` + agrégation live pour aujourd'hui).                                    |
| GET     | `/analytics/stats/metrics?type=url\|referrer\|browser\|country\|os` | ✅   | Top N par dimension.                                                                                        |
| GET     | `/analytics/stats/active`                                           | ✅   | Sessions actives (5 dernières minutes).                                                                     |
| GET     | `/analytics/stats/projects`                                         | ✅   | Top projets cliqués.                                                                                        |
| GET     | `/analytics/stats/articles`                                         | ✅   | Top articles vus.                                                                                           |
| GET     | `/analytics/stats/cv-downloads`                                     | ✅   | Total + timeline 30j.                                                                                       |

**Privacy** : pas de cookies posés/lus ; IP utilisée uniquement pour hash de session + lookup pays, jamais persistée ; User-Agent jamais persisté brut (parsé en `browser`/`os`) ; session hash = `SHA256(IP + UA + YYYY-MM-DD UTC)`, non réversible, change chaque jour ; bots filtrés à l'entrée.

**Cron** : `@Cron('0 0 * * *', { timeZone: 'UTC' })` dans `AnalyticsAggregatorService` - agrège J-1 dans `daily_stat` (upsert idempotent), purge `page_view` + `analytics_event` de plus de 30 jours.

**`app.set('trust proxy', 1)`** activé dans `src/app.setup.ts` pour lire `X-Forwarded-For` correctement derrière un reverse proxy.

## Observabilité (Sentry)

`@sentry/nestjs` (error tracking uniquement, pas de profiling CPU - overkill pour le trafic d'un portfolio), initialisé dans `src/instrument.ts` (importé en tout premier dans `main.ts`, avant même `NestFactory.create`, car `@nestjs/config` n'a pas encore chargé `.env`).

- **Désactivé si `SENTRY_DSN` est vide** - pas de crash, juste no-op.
- `sendDefaultPii: false`, `beforeSend` filtre systématiquement cookies, headers `authorization`/`cookie`, et les champs sensibles du body (`password`, `newPassword`, `currentPassword`, `code`, `token`, `refreshToken`, `jwt`).
- **Jeton du flux d'agenda** (`src/common/sentry-before-send.ts`) : les requêtes du flux sont exclues du span `http.server` (`ignoreIncomingRequests`), mais Nest ouvre quand même une transaction racine (`request_context.nestjs`, ou celle du filtre d'exceptions) qui porte l'URL concrète. `beforeSendTransaction` **écarte** donc toute transaction dont le nom, `request.url` ou une URL de `contexts.trace.data` désigne le flux, et masque par `redactUrl` toute URL du flux restante dans les autres (requête, données de trace, spans). `beforeSend` masque `request.url`, `transaction` et retire `query_string` des événements d'erreur. Toute nouvelle route portant un secret dans son chemin doit être ajoutée à `redactUrl`.
- `tracesSampleRate` : 20% en prod, 100% en dev (ou override via `SENTRY_TRACES_SAMPLE_RATE`).
- `ThrottlerException` est ignorée (pas de bruit Sentry sur un simple rate-limit).
- **`GET /api/config`** expose un DSN Sentry **distinct** (`SENTRY_FRONTEND_DSN`) pour le frontend Angular - projet Sentry séparé du backend, volontairement public (il ship dans le bundle browser une fois fetché).
- `pnpm sentry:sourcemaps` (`scripts/upload-sentry-sourcemaps.mjs`) : upload des sourcemaps vers Sentry en CI/CD.
- `pnpm sentry:check-instrumentation` (`scripts/check-sentry-instrumentation.cjs`, après `pnpm build`) : décore des classes témoins avec les vrais `@Injectable`, `@Catch`, `@Cron` après `dist/instrument.js` et vérifie les marques posées par Sentry ; exit 1 si l'un n'est pas tracé.

## Docker

`Dockerfile` en 3 stages (builder → prod-deps → runner), base `node:24-alpine`, `pnpm@10.33.2` via corepack.

- Image finale : non-root (`USER node`), PID 1 géré par `tini` (graceful shutdown NestJS sur `SIGTERM`).
- `HEALTHCHECK` sur `http://localhost:3000/api/health`.
- `CMD` : `pnpm db:migrate && node dist/main.js` - migrations Drizzle idempotentes appliquées à chaque démarrage du container, puis boot de l'app.
- `docker-compose.yaml` / `compose.yaml` local sert uniquement au dev (Postgres + MinIO + Mailpit) - pas d'image applicative buildée par ce compose.

## État réel

Modules réellement présents et livrés : Fondations, Auth, S3 Storage, Projects, Blog, Profile, Mailer, Contact, CV, Analytics, Runtime Config.

## Licence

Le **code** est publié sous licence [MIT](LICENSE). Le **contenu éditorial** servi par l'API (articles, fiches projets, CV, visuels, templates de mail) reste sous **tous droits réservés** et n'est pas couvert par la licence MIT.
