# Portfolio NestJS Backend

Backend NestJS du portfolio J-Ned. Toutes les routes sont montées sous le préfixe global **`/api`** (`app.setGlobalPrefix('api')` dans `src/main.ts`) - le Swagger UI fait exception, il reste à la racine (`/docs`, non préfixé).

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
10. **`BlogModule`** - CRUD admin des articles de blog + endpoints publics (liste/détail/like). Déclenche le webhook `DOKPLOY_DEPLOY_WEBHOOK_URL` pour rebuild le site statique quand le contenu publié change.
11. **`MailerModule`** (`@Global`) - `MailerService` (SMTP).
12. **`ThrottlerModule`** (global, `APP_GUARD`) - 10 req/60s par défaut, overridable par endpoint via `@Throttle()`.
13. **`ContactModule`** - formulaire de contact public + gestion admin.
14. **`ScheduleModule`** (`@nestjs/schedule`) - support des `@Cron()`.
15. **`CvModule`** - upload/download du CV.
16. **`AnalyticsModule`** - tracking + stats + rollup cron.
17. **`RuntimeConfigModule`** - `GET /api/config`.

Les modules `@Global` (`DatabaseModule`, `StorageModule`, `MailerModule`, `LoggerModule`) sont injectables partout sans import explicite.

## Configuration

Toute la config passe par les variables d'env, validées au boot par Zod (`src/config/env.schema.ts`). **L'app crash immédiatement avec un message lisible** si une variable requise est manquante ou invalide.

| Variable                    | Type                                               | Défaut                       | Rôle                                                                                            |
| --------------------------- | -------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `NODE_ENV`                  | `development` \| `production` \| `test`            | `development`                | Pilote le format des logs, le sample rate Sentry                                                |
| `PORT`                      | int 1-65535                                        | `3000`                       | Port HTTP                                                                                       |
| `DATABASE_URL`              | URL `postgres://...`                               | _(requis)_                   | Connexion Drizzle                                                                               |
| `LOG_LEVEL`                 | `fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace` | `debug` en dev, `info` sinon | Niveau Pino                                                                                     |
| `JWT_SECRET`                | string, 32+ chars                                  | _(requis)_                   | Signature JWT                                                                                   |
| `JWT_EXPIRES_IN`            | string                                             | `7d`                         | Durée de vie du JWT                                                                             |
| `COOKIE_DOMAIN`             | string                                             | _(vide → `localhost`)_       | Domaine du cookie httpOnly (`.example.fr` pour partager entre sous-domaines)                    |
| `ADMIN_EMAIL`               | email                                              | _(optionnel)_                | Requis uniquement pour `pnpm db:seed`                                                           |
| `ADMIN_INITIAL_PASSWORD`    | string, 12+ chars                                  | _(optionnel)_                | Requis uniquement pour `pnpm db:seed`                                                           |
| `TOTP_APP_NAME`             | string                                             | `J-Ned Portfolio`            | Nom affiché dans l'app authenticator                                                            |
| `CORS_ORIGINS`              | CSV                                                | `http://localhost:4200`      | Origines autorisées (credentials)                                                               |
| `DOKPLOY_DEPLOY_WEBHOOK_URL` | URL                                                | _(optionnel)_                 | Webhook de rebuild Dokploy du site statique, appelé fire-and-forget par `BlogModule` (vide = no-op) |
| `S3_ENDPOINT`               | URL                                                | _(requis)_                   | Endpoint S3-compatible (MinIO/R2)                                                               |
| `S3_REGION`                 | string                                             | _(requis)_                   | Région S3                                                                                       |
| `S3_ACCESS_KEY`             | string, 4+ chars                                   | _(requis)_                   | Access key S3                                                                                   |
| `S3_SECRET_KEY`             | string, 8+ chars                                   | _(requis)_                   | Secret key S3                                                                                   |
| `SMTP_HOST`                 | string                                             | _(requis)_                   | Hôte SMTP                                                                                       |
| `SMTP_PORT`                 | int 1-65535                                        | `587`                        | Port SMTP                                                                                       |
| `SMTP_SECURE`               | `"true"`\|`"1"` → bool                             | `false`                      | TLS direct (port 465)                                                                           |
| `SMTP_USER`                 | string                                             | _(requis)_                   | User SMTP                                                                                       |
| `SMTP_PASS`                 | string                                             | _(requis)_                   | Password SMTP                                                                                   |
| `SMTP_FROM`                 | email                                              | _(requis)_                   | Expéditeur des mails                                                                            |
| `SENTRY_DSN`                | URL                                                | _(optionnel)_                | DSN backend ; vide = Sentry désactivé                                                           |
| `SENTRY_RELEASE`            | string                                             | _(optionnel)_                | Tag de release Sentry                                                                           |
| `SENTRY_TRACES_SAMPLE_RATE` | float 0-1                                          | `0.2` prod / `1.0` dev       | Sample rate tracing                                                                             |
| `SENTRY_FRONTEND_DSN`       | URL                                                | _(optionnel)_                | DSN d'un **projet Sentry distinct** pour le frontend, exposé publiquement via `GET /api/config` |

`S3_*` et `SMTP_*` sont **requis sans défaut** - impossible de démarrer l'app sans Storage et Mailer configurés, même si on ne les utilise pas en dev.

## Base de données

PostgreSQL 17-alpine dans un container Podman/Docker dédié (`portfolio-nest-db`, `compose.yaml`), exposé sur le **port 55432** (isolation vs d'autres backends locaux).

### Choix techniques

- **Drizzle ORM**, driver `postgres-js` (recommandé par la doc Drizzle, zéro dépendance native).
- **`casing: 'snake_case'`** dans `drizzle.config.ts` : convention Postgres standard, conversion auto vers `camelCase` côté TS.

### Schéma actuel (`src/database/schema/`)

5 tables, une par module métier réellement implémenté : `users`, `project`, `contact_message`, `cv_file`, `blog_post`, plus les tables analytics (`page_view`, `analytics_event`, `daily_stat`).

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
- **Redaction** automatique : `authorization`, `cookie`, et dans le body `password`, `newPassword`, `currentPassword`, `code`, `token`, `refreshToken`.
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

`ValidationPipe` global (`src/main.ts`) :

- `whitelist: true` - strippe les champs non déclarés dans le DTO.
- `forbidNonWhitelisted: true` - **400 si le client envoie un champ inattendu** (détection précoce de bugs frontend).
- `transform: true` + `enableImplicitConversion: true` - `@Param('id')` typé `number` est auto-converti depuis l'URL.

## Tests

- **Unitaires** : `*.spec.ts` à côté du code source, runner Jest (config inline dans `package.json`, `rootDir: src`).
- **E2E** : harnais `test/jest-e2e.json` présent, `pnpm test:e2e` exécutable, mais aucun test e2e écrit à ce jour.

```bash
pnpm test           # Tous les tests unitaires
pnpm test:watch     # Mode watch
pnpm test:cov       # Avec coverage
pnpm test:e2e       # E2E (harnais vide)
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
| `pnpm test` / `test:watch` / `test:cov` / `test:e2e` / `test:debug` | Jest                                                                                                                     |
| `pnpm db:up` / `db:down` / `db:wait`                                | Cycle container Postgres (`podman compose`)                                                                              |
| `pnpm db:generate` / `db:migrate` / `db:studio`                     | Drizzle Kit                                                                                                              |
| `pnpm db:seed`                                                      | Crée l'admin (idempotent, `ADMIN_EMAIL`/`ADMIN_INITIAL_PASSWORD`)                                                        |
| `pnpm db:change-password <email> <newPassword>`                     | Change le mot de passe d'un user directement en DB (newPassword 12+ chars) - utile en cas de perte d'accès, bypass l'API |
| `pnpm db:reset`                                                     | Wipe volume + recrée + migrate + seed (dev only)                                                                         |
| `pnpm mail:up`                                                      | Démarre le container Mailpit                                                                                             |
| `pnpm sentry:sourcemaps`                                            | Upload des sourcemaps vers Sentry (`scripts/upload-sentry-sourcemaps.mjs`)                                               |

## S3 Storage

Module d'infrastructure S3-compatible, consommé par Projects et CV.

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

| Méthode | Chemin                | Auth | Rôle                                                                                                                                    |
| ------- | --------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| GET     | `/projects`           | ❌   | Liste publique. Filtres `?category=`, `?featured=true`. Tri `order ASC, createdAt DESC`.                                                |
| GET     | `/projects/:id`       | ❌   | 404 si absent.                                                                                                                          |
| POST    | `/projects`           | ✅   | Crée. Slug auto-généré depuis `title`. 409 si collision de slug.                                                                        |
| PATCH   | `/projects/:id`       | ✅   | Met à jour. Re-slugifie si `title` change. `image: null` supprime l'image S3 (via `@Equals(null)` - pas de valeur arbitraire acceptée). |
| DELETE  | `/projects/:id`       | ✅   | Supprime le projet + son image S3 si présente.                                                                                          |
| POST    | `/projects/:id/image` | ✅   | Upload multipart (`file`, max 5MB, MIME whitelist `image/webp\|jpeg\|png\|avif`, 422 si invalide). Converti en **AVIF ≤ 1600 px** (`sharp`) avant stockage, clé `<id>-<sha8>.avif` (cache immuable 1 an).                                      |

**Lifecycle S3** : key = `projects/<id>.<ext>`. Ordre upload → update DB → cleanup ancienne clé (jamais l'inverse, pour ne jamais laisser une référence DB cassée). Les réponses API exposent une URL proxy (`getPublicUrl`), jamais la key S3 brute.

## Blog

CRUD admin des articles de blog + endpoints publics de consultation/like. Le site public consomme les articles au build (pages `/blog` prerendered, pas de SSR par requête) - toute mutation qui change ce qui doit être visible déclenche donc un rebuild Dokploy.

**Schéma** : table `blog_post` (uuid, `slug` unique, `excerpt`, `contentMarkdown`, `coverImage` (key S3), `tags` (array), `status: 'draft' | 'published'`, `likesCount`, `publishedAt`).

**8 endpoints sous `/api/blog/posts`** :

| Méthode | Chemin                   | Auth | Rôle                                                                                                                                            |
| ------- | ------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET     | `/blog/posts`            | ❌   | Liste publique des articles publiés, triés par `publishedAt DESC`.                                                                             |
| GET     | `/blog/posts/admin`      | ✅   | Liste complète (drafts inclus), triée par `createdAt DESC`.                                                                                     |
| GET     | `/blog/posts/:slug`      | ❌   | Détail public d'un article **publié**. 404 sur un slug draft/dépublié/inconnu (pas de fuite de contenu non publié).                            |
| POST    | `/blog/posts`            | ✅   | Crée. Slug auto-généré depuis `title`. 409 si collision de slug.                                                                                |
| PATCH   | `/blog/posts/:id`        | ✅   | Met à jour. Slug **figé** une fois l'article publié (ne se re-génère plus au changement de titre - casserait l'URL publique/le thread Giscus). `coverImage: null` supprime l'image S3.  |
| DELETE  | `/blog/posts/:id`        | ✅   | Supprime l'article + son image S3.                                                                                                             |
| POST    | `/blog/posts/:id/image`  | ✅   | Upload multipart (`file`, max 5MB, MIME whitelist `image/webp\|jpeg\|png\|avif`). Converti en **AVIF ≤ 1600 px** (`sharp`) avant stockage, clé `<id>-<sha8>.avif` (cache immuable 1 an).                                                              |
| POST    | `/blog/posts/:slug/like` | ❌   | Incrémente le compteur de likes d'un article **publié** (public, pas d'auth). 404 sur un slug draft/dépublié/inconnu.                          |

**Lifecycle S3** : identique à Projects (key `blog/<id>.<ext>`, ordre upload → update DB → cleanup ancienne clé).

**Rebuild Dokploy** : `DOKPLOY_DEPLOY_WEBHOOK_URL` (optionnel, no-op si absent) est appelé fire-and-forget (`fetch` avec timeout 5s ; réponse non-2xx ou timeout loggés en erreur) à chaque mutation qui change le rendu du site public - publication (création ou transition draft→published), édition d'un article déjà publié, dépublication, ou suppression d'un article publié. **Setup manuel requis** : créer un webhook de rebuild dans le dashboard Dokploy de l'app statique du portfolio, puis coller son URL dans `DOKPLOY_DEPLOY_WEBHOOK_URL`.

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

**Destinataire admin codé en dur** : `CONTACT_RECIPIENT = 'contact@nedellec-julien.fr'` dans `src/contact/contact.service.ts` - pas de variable d'env dédiée. `SMTP_FROM` reste l'expéditeur (rôle distinct).

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

**`app.set('trust proxy', 1)`** activé dans `main.ts` pour lire `X-Forwarded-For` correctement derrière un reverse proxy.

## Observabilité (Sentry)

`@sentry/nestjs` (error tracking uniquement, pas de profiling CPU - overkill pour le trafic d'un portfolio), initialisé dans `src/instrument.ts` (importé en tout premier dans `main.ts`, avant même `NestFactory.create`, car `@nestjs/config` n'a pas encore chargé `.env`).

- **Désactivé si `SENTRY_DSN` est vide** - pas de crash, juste no-op.
- `sendDefaultPii: false`, `beforeSend` filtre systématiquement cookies, headers `authorization`/`cookie`, et les champs sensibles du body (`password`, `newPassword`, `currentPassword`, `code`, `token`, `refreshToken`, `jwt`).
- `tracesSampleRate` : 20% en prod, 100% en dev (ou override via `SENTRY_TRACES_SAMPLE_RATE`).
- `ThrottlerException` est ignorée (pas de bruit Sentry sur un simple rate-limit).
- **`GET /api/config`** expose un DSN Sentry **distinct** (`SENTRY_FRONTEND_DSN`) pour le frontend Angular - projet Sentry séparé du backend, volontairement public (il ship dans le bundle browser une fois fetché).
- `pnpm sentry:sourcemaps` (`scripts/upload-sentry-sourcemaps.mjs`) : upload des sourcemaps vers Sentry en CI/CD.

## Docker

`Dockerfile` en 3 stages (builder → prod-deps → runner), base `node:24-alpine`, `pnpm@10.33.2` via corepack.

- Image finale : non-root (`USER node`), PID 1 géré par `tini` (graceful shutdown NestJS sur `SIGTERM`).
- `HEALTHCHECK` sur `http://localhost:3000/api/health`.
- `CMD` : `pnpm db:migrate && node dist/main.js` - migrations Drizzle idempotentes appliquées à chaque démarrage du container, puis boot de l'app.
- `docker-compose.yaml` / `compose.yaml` local sert uniquement au dev (Postgres + MinIO + Mailpit) - pas d'image applicative buildée par ce compose.

## État réel

Modules réellement présents et livrés : Fondations, Auth, S3 Storage, Projects, Blog, Mailer, Contact, CV, Analytics, Runtime Config.

## Licence

Le **code** est publié sous licence [MIT](LICENSE). Le **contenu éditorial** servi par l'API (articles, fiches projets, CV, visuels, templates de mail) reste sous **tous droits réservés** et n'est pas couvert par la licence MIT.
