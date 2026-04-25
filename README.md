# Portfolio NestJS Backend

Backend NestJS du portfolio J-Ned. Sous-projet **"Fondations"** : squelette technique sans aucun module métier — la persistance est branchée, la config est validée, le logger est structuré, mais aucune entité applicative n'existe encore.

> Spec d'architecture détaillée : [`docs/superpowers/specs/2026-04-25-fondations-nest-portfolio-design.md`](docs/superpowers/specs/2026-04-25-fondations-nest-portfolio-design.md)
> Plan d'implémentation : [`docs/superpowers/plans/2026-04-25-fondations-nest-portfolio.md`](docs/superpowers/plans/2026-04-25-fondations-nest-portfolio.md)

## Quickstart

**Prérequis :** Node 22 (cf. `.nvmrc`), pnpm, Podman.

```bash
pnpm install
cp .env.example .env
# Éditer .env : remplir au moins JWT_SECRET (32+ chars), ADMIN_EMAIL et ADMIN_INITIAL_PASSWORD
pnpm db:up && pnpm db:wait
pnpm db:migrate                       # crée la table users
pnpm db:seed                          # crée l'admin (idempotent)
pnpm dev                              # démarre l'app en watch
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

- **Drizzle ORM** : type-safe, génération SQL transparente, pas de runtime overhead. Préféré à Prisma (qui exige un client généré et compromet le tipage du schéma) et à TypeORM (decorators-heavy, runtime metadata).
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

## Auth

Module d'authentification : admin unique pré-seedé, JWT en cookie httpOnly, 2FA TOTP avec backup codes.

**Setup initial** :

```bash
pnpm db:seed     # crée l'admin avec ADMIN_EMAIL + ADMIN_INITIAL_PASSWORD (idempotent)
```

**9 endpoints sous `/auth`** :

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| POST | `/auth/login` | ❌ | Login email + password (renvoie cookie ou challenge 2FA) |
| POST | `/auth/2fa/verify` | ❌ | Complete 2FA login (avec `challengeToken` + `code` ou `backupCode`) |
| POST | `/auth/logout` | ✅ | Clear cookie |
| GET | `/auth/me` | ✅ | Infos user courant |
| POST | `/auth/change-password` | ✅ | Change le mot de passe |
| POST | `/auth/2fa/generate` | ✅ | Génère secret + QR code (n'active pas encore) |
| POST | `/auth/2fa/enable` | ✅ | Active 2FA après vérif code (renvoie 10 backup codes one-time) |
| POST | `/auth/2fa/disable` | ✅ | Désactive 2FA (requiert password courant) |
| POST | `/auth/2fa/regenerate-backup-codes` | ✅ | Régénère les 10 backup codes (requiert password courant) |

**Voir le spec complet** : [`docs/superpowers/specs/2026-04-25-auth-nest-portfolio-design.md`](docs/superpowers/specs/2026-04-25-auth-nest-portfolio-design.md).

**Décisions clés (résumées)** :

- JWT unique long (7d défaut), un seul cookie httpOnly `token` (pas de refresh token).
- 2FA TOTP via `otplib` + 10 backup codes hashés Argon2 (consommés à l'usage).
- Argon2id pour le hash password.
- Pas de `/register` (admin pré-seedé).
- Pas de rate limiting par défaut (peut être ajouté via `@nestjs/throttler` si besoin).
- `JwtStrategy` rejette tout JWT avec `scope === '2fa-challenge'` (défense en profondeur).

**Modules métier consommateurs** : importer `AuthModule` puis `@UseGuards(JwtAuthGuard)` + `@CurrentUser()` :

```typescript
@UseGuards(JwtAuthGuard)
@Post('something')
create(@CurrentUser() user: User, @Body() dto: CreateSomethingDto) { /* ... */ }
```

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

## Profile public

Module de contenu publié sur le portfolio. **7 entités** éditées par l'admin et lues publiquement par les visiteurs : Profile (singleton), Hero (singleton), SocialLinks, Diplomas, Technologies, Expertises (avec discriminator `offer`/`seek`), ServicePricing (avec ordering).

**32 endpoints** sous 7 préfixes :

| Préfixe | Endpoints | Pattern |
|---|---|---|
| `/profile` | 2 (GET + PATCH) | Singleton seedé |
| `/hero` | 2 (GET + PATCH) | Singleton seedé |
| `/social-links` | 5 (CRUD) | Collection standard |
| `/diplomas` | 5 (CRUD) | Collection avec `skills: text[]` |
| `/technologies` | 5 (CRUD) | Collection standard |
| `/expertises` | 7 (offers/seeks/admin-detail/CRUD) | Collection avec discriminator `pgEnum('offer','seek')` |
| `/service-pricing` | 6 (CRUD + `PATCH /reorder` bulk) | Collection avec champ `order` |

**Lectures publiques** sans guard. **Toutes les écritures** (POST/PATCH/DELETE/reorder) protégées par `@UseGuards(JwtAuthGuard)`.

**Singletons** (`Profile`, `Hero`) sont seedés via la migration `0001` — `GET /profile` retourne 200 dès le boot, `PATCH /profile` est un simple UPDATE.

**Reorder** : `PATCH /service-pricing/reorder` body `{ orderedIds: string[] }` réassigne `order = index` dans une transaction. Sémantique partielle : les IDs absents conservent leur `order`.

**Voir le spec complet** : [`docs/superpowers/specs/2026-04-25-profile-public-design.md`](docs/superpowers/specs/2026-04-25-profile-public-design.md).

**Décisions clés** :

- Avatar S3 reporté au sous-projet "Projects" (qui introduira le S3 setup) ; `avatarUrl` reste un champ texte PATCH-able.
- Pas de pagination, pas de cache headers, pas de soft delete, pas de slug, pas d'ordering sur les autres collections — scope minimaliste.
- Helper de test partagé `src/database/test-utils.ts` (`createMockDb()`) réutilisable par tous les sous-projets futurs.

## Migration depuis le backend Hono

Le backend Hono actuel (`../angular-portfolio-app/backend`) reste actif pendant la construction de ce NestJS. Le portage se fait par sous-projets indépendants (un spec et un plan par sous-projet) :

1. ✅ Fondations
2. ✅ Auth (Users + JWT + 2FA + backup codes)
3. ✅ Profile public (Profile, Hero, SocialLinks, Diplomas, Technologies, Expertises, ServicePricing)
4. **Projects** *(prochain)* (CRUD + upload image S3) — introduit le S3 setup
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
