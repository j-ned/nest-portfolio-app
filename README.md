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
- **Migration `0001_*.sql` éditée manuellement** : on a appendé `INSERT INTO profile DEFAULT VALUES;` et `INSERT INTO hero DEFAULT VALUES;` à la fin du fichier généré par `drizzle-kit generate`. Ne pas régénérer cette migration sans réajouter ces inserts (sinon `GET /profile` retourne 500 sur une DB fraîchement créée).

## S3 Storage

Module d'infrastructure pour le stockage d'objets S3-compatible. Utilisé par les feature modules qui ont besoin d'uploader/servir des fichiers (Projects, CV, Avatar futur).

**Stack** :
- Lib : `@aws-sdk/client-s3` v3
- Dev local : container MinIO (S3-compatible) sur ports 9000 (API) + 9001 (console)
- Prod : Cloudflare R2 (S3-compatible, egress gratuit)

**Quickstart S3 (en plus du DB) :**

```bash
pnpm s3:up           # démarre MinIO + crée le bucket portfolio-storage en anonymous-read
pnpm s3:console      # affiche l'URL + creds de la console web MinIO
pnpm s3:logs         # tail logs MinIO
pnpm s3:reset        # wipe + recrée le bucket (dev only)
```

> Le hook `predev` démarre automatiquement Postgres + MinIO avant `pnpm dev`. Onboarding nouveau dev : `pnpm install && cp .env.example .env && pnpm dev`.

**API** :

| Méthode | Signature |
|---|---|
| `upload` | `(bucket, key, body: Buffer, contentType): Promise<void>` |
| `get` | `(bucket, key): Promise<Buffer>` (404 si NoSuchKey) |
| `delete` | `(bucket, key): Promise<void>` (idempotent) |
| `list` | `(bucket, prefix?): Promise<S3Object[]>` |
| `getPublicUrl` | `(bucket, key): string` (URL publique anonymous-read) |

**Usage dans un feature module futur** :

```typescript
@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  async uploadImage(slug: string, file: Buffer, mime: string): Promise<string> {
    const ext = mime.split('/')[1];
    const key = `projects/${slug}.${ext}`;
    await this.storage.upload('portfolio-storage', key, file, mime);
    return this.storage.getPublicUrl('portfolio-storage', key);
  }
}
```

**`StorageModule` est `@Global`** : `StorageService` est injectable directement, pas besoin d'`imports: [StorageModule]` dans les feature modules.

**Configuration prod (Cloudflare R2)** :

Sur le dashboard Cloudflare R2, créer le bucket `portfolio-storage` puis générer un API Token R2 (Read & Write). Mettre à jour `.env` prod :

```bash
S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY=<R2 Access Key ID>
S3_SECRET_KEY=<R2 Secret Access Key>
# S3_PUBLIC_URL non requis : on sert via le proxy NestJS /storage/:bucket/*.
```

Les fichiers publics sont servis par le proxy NestJS `/storage/:bucket/*` (le bucket R2 reste privé). Pour bypasser le proxy à terme, configurer un Custom Domain R2 (nécessite que le DNS du domaine soit géré par Cloudflare) et exposer `S3_PUBLIC_URL=https://media.example.com`, puis adapter `StorageService.getPublicUrl()`.

**Voir le spec complet** : [`docs/superpowers/specs/2026-04-25-s3-storage-design.md`](docs/superpowers/specs/2026-04-25-s3-storage-design.md).

## Projects

Module CRUD admin pour les projets affichés sur le portfolio. Premier consommateur du `StorageModule` (upload d'image avec lifecycle complet).

**Schéma** : table `project` (uuid + slug unique + 14 colonnes + 3 indexes : `category`, `featured`, `order`).

**6 endpoints sous `/projects`** :

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/projects` | ❌ | Liste publique. Filtres `?category=xxx`, `?featured=true`. Tri fixe `order ASC, createdAt DESC`. |
| GET | `/projects/:id` | ❌ | Récupère un projet (404 si absent). |
| POST | `/projects` | ✅ | Crée un projet. Slug auto-généré depuis `title`. 409 si collision. |
| PATCH | `/projects/:id` | ✅ | Met à jour. Re-slugifie si `title` change. `image: null` supprime l'image S3. |
| DELETE | `/projects/:id` | ✅ | Supprime le projet + son image S3 si présente. |
| POST | `/projects/:id/image` | ✅ | Upload multipart (`file`, max 5MB, `image/webp\|jpeg\|png\|avif`). Cleanup ancienne clé si extension diffère. |

**Lifecycle S3** : key = `projects/<id>.<ext>`. Upload écrit dans le bucket `portfolio-storage`, met à jour la DB, puis supprime l'ancienne clé si l'extension a changé (ordre upload → DB → cleanup pour ne jamais laisser une référence DB cassée).

**Validation** :
- DTO classique class-validator + Swagger.
- Whitelist MIME stricte (pas de SVG → pas de surface XSS).
- `@Equals(null)` sur `image` dans `UpdateProjectDto` : empêche un PATCH avec une string arbitraire d'écraser la key DB. Pour set une nouvelle image, passer par `POST /:id/image`.

**Voir le spec complet** : [`docs/superpowers/specs/2026-04-26-projects-design.md`](docs/superpowers/specs/2026-04-26-projects-design.md).

## Avatar Profile

Endpoint d'upload de l'avatar pour le singleton Profile. Deuxième consommateur du `StorageModule` après Projects, applique le même pattern de lifecycle S3 actif. Le sous-projet a aussi rendu cohérent la transformation `key → URL S3 publique` côté API : `findOne()` du Profile et `findAll()`/`findById()`/`uploadImage()` des Projects retournent désormais une URL S3 complète dans le champ image, pas une key brute.

**1 nouvel endpoint** :

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| POST | `/profile/avatar` | ✅ | Upload multipart (`file`, max 5MB, `image/webp\|jpeg\|png\|avif`). Retourne la Profile complète avec `avatarUrl` transformée en URL S3 publique. |

**Suppression de l'avatar** : pas d'endpoint dédié. Passer par `PATCH /profile` body `{ avatarUrl: null }` (cohérent avec le pattern Projects' `image: null`).

**Lifecycle S3** : key = `avatar/avatar.<ext>`. L'upload écrit S3, met à jour la DB, puis supprime l'ancienne clé si l'extension a changé (ordre upload → DB → cleanup pour ne jamais laisser une référence DB cassée). PATCH `avatarUrl: null` fait DB write puis S3 delete (même philosophie).

**Validation** :
- `@Equals(null)` sur `avatarUrl` dans `UpdateProfileDto` : interdit toute valeur non-null. Pour set un avatar, l'admin **doit** passer par `POST /profile/avatar`. Pour le retirer, `{ avatarUrl: null }`.
- Whitelist MIME stricte (pas de SVG → pas de surface XSS).

**API surface — transformation key↔URL** :
- DB stocke la key S3 brute (`avatar/avatar.webp`).
- API retourne l'URL S3 publique complète via `getPublicUrl()`. Le frontend reçoit une URL prête à coller dans `<img src>`.
- Le helper privé `findOneRaw` (pour Profile) et `findByIdRaw` (pour Projects) retournent la row sans transformation, pour les usages internes (cleanup S3).

**Voir le spec complet** : [`docs/superpowers/specs/2026-04-26-avatar-profile-design.md`](docs/superpowers/specs/2026-04-26-avatar-profile-design.md).

## Mailer

Module d'infrastructure pour l'envoi d'emails SMTP. Utilisé par les feature modules qui ont besoin de notifier (Contact, Bookings, futurs modules).

**Stack** :
- Lib : `nodemailer` (SMTP transport)
- Dev local : container Mailpit (SMTP catch-all + web UI sur ports 1025/8025)
- Prod : SMTP utilisateur (Gmail / OVH / SES / etc.)

**Quickstart Mailer (en plus du DB et S3)** :

```bash
pnpm mail:up           # démarre Mailpit
pnpm mail:console      # affiche l'URL de la web UI
pnpm mail:logs         # tail logs Mailpit
```

> Le hook `predev` démarre automatiquement Postgres + MinIO + Mailpit avant `pnpm dev`. Onboarding : `pnpm install && cp .env.example .env && pnpm dev`.

**API** :

| Méthode | Signature |
|---|---|
| `sendMail` | `({ to, subject, html }): Promise<void>` (3 retries linear backoff 1s/2s, throws final si tous échouent) |

**Helpers utilitaires** (depuis `src/mailer/mailer.utils.ts`) :

| Fonction | Signature |
|---|---|
| `renderTemplate` | `(html: string, vars: Record<string, string>): string` (string replace `{{var}}`) |
| `loadTemplate` | `(absolutePath: string): string` (sucre sur `readFileSync`) |

**Usage dans un feature module** :

```typescript
import { resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { MailerService } from '../mailer/mailer.service';
import { loadTemplate, renderTemplate } from '../mailer/mailer.utils';

@Injectable()
export class ContactService {
  constructor(private readonly mailer: MailerService) {}

  async notifyAdmin(data: { name: string; email: string; message: string }): Promise<void> {
    const tmpl = loadTemplate(
      resolve(__dirname, 'mail-templates', 'contact-notification.html'),
    );
    const html = renderTemplate(tmpl, data);
    await this.mailer.sendMail({
      to: 'admin@nedellec-julien.fr',
      subject: `Nouveau message de ${data.name}`,
      html,
    });
  }
}
```

**`MailerModule` est `@Global`** : `MailerService` est injectable directement, pas besoin d'`imports: [MailerModule]` dans les feature modules.

**Configuration prod** :

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false   # true pour port 465 (TLS direct)
SMTP_USER=<...>
SMTP_PASS=<...>
SMTP_FROM=noreply@nedellec-julien.fr
```

**Voir le spec complet** : [`docs/superpowers/specs/2026-04-26-mailer-design.md`](docs/superpowers/specs/2026-04-26-mailer-design.md).

## Contact

Module métier pour le formulaire de contact public et la gestion admin des messages reçus. **Premier consommateur réel du `MailerService`** livré au sous-projet précédent.

**Schéma** : table `contact_message` (uuid + 6 cols + 3 indexes : `read`, `createdAt`, composite `read+createdAt`).

**6 endpoints sous `/contact`** :

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/contact/info` | ❌ | Retourne `{ email, phone, location }` depuis env vars (`CONTACT_*`). |
| POST | `/contact/messages` | ❌ | Soumission publique du formulaire. **Throttle 5/60s par IP**. Insère en DB + envoie 2 mails fire-and-forget (notification admin + confirmation visiteur). Retourne 201 avec la row. |
| GET | `/contact/messages` | ✅ | Liste paginée (`?page&limit`, defaults 1/10, max limit 100), tri `createdAt DESC`. |
| GET | `/contact/messages/unread-count` | ✅ | Compteur de messages non-lus. |
| PATCH | `/contact/messages/:id/read` | ✅ | Marque le message comme lu. |
| DELETE | `/contact/messages/:id` | ✅ | Suppression hard. |

**Throttling** : `@nestjs/throttler` configuré globalement (10/60s par défaut), override fin sur `POST /messages` à 5/60s. Guard global via `APP_GUARD`. Storage in-memory — switcher Redis si scale horizontal.

**Stratégie mails** : fire-and-forget après `db.insert`. Le visiteur reçoit 201 dès que la persistence est garantie. Les 2 mails partent en arrière-plan. En cas d'échec SMTP (3 retries du `MailerService` épuisés), l'erreur est loggée mais le visiteur ne voit rien — le message reste en DB pour consultation admin.

**Templates** :
- `src/contact/mail-templates/contact-notification.html` — envoyé à `CONTACT_EMAIL` (admin)
- `src/contact/mail-templates/contact-confirmation.html` — envoyé à l'email du visiteur

Variables : `{{name}}`, `{{email}}`, `{{subject}}`, `{{message}}`.

**Helpers transversaux** :
- `src/common/pagination.ts` : `parsePagination` + types `PaginationParams`/`PaginatedResult<T>`. Premier utilitaire de `src/common/`, réutilisable par futurs modules paginés (Bookings, etc.).

**Configuration prod** :

```bash
CONTACT_EMAIL=admin@nedellec-julien.fr  # destinataire des notifications
CONTACT_PHONE=+33 6 00 00 00 00
CONTACT_LOCATION=Lyon, France
```

Le `SMTP_FROM` (sous-projet Mailer) reste l'expéditeur — souvent identique à `CONTACT_EMAIL` mais conceptuellement distinct.

**Voir le spec complet** : [`docs/superpowers/specs/2026-04-26-contact-design.md`](docs/superpowers/specs/2026-04-26-contact-design.md).

## Bookings

Module métier pour le système de prise de rendez-vous public + gestion admin. **Deuxième consommateur réel du `MailerService`** après Contact, valide la généralisation du pattern.

**Schémas** :
- `booking` (uuid + date + startTime + duration + name/email/phone/subject/message + createdAt + 2 indexes)
- `disabled_date` (uuid + date unique + reason optionnelle) — l'admin peut désactiver des journées (vacances, indisponibilités)

**7 endpoints sous `/bookings`** :

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| POST | `/bookings` | ❌ | Soumission RDV public. **Throttle 3/60s**. **Validation conflit serveur** : 409 si date dans `disabled_date` ou si slot chevauche un booking existant. Insère + envoie 2 mails fire-and-forget. |
| GET | `/bookings` | ✅ | Liste paginée (`?page&limit`), tri `createdAt DESC`. |
| GET | `/bookings/slots?month=YYYY-MM` | ❌ | Liste les bookings du mois (frontend calcule la disponibilité avec ses heures de bureau). |
| DELETE | `/bookings/:id` | ✅ | Suppression hard. |
| GET | `/bookings/disabled-dates` | ❌ | Liste des dates désactivées (ordre `date ASC`). |
| POST | `/bookings/disabled-dates` | ✅ | Désactive une date. 409 si déjà désactivée. |
| DELETE | `/bookings/disabled-dates/:id` | ✅ | Réactive une date (suppression de l'entrée). |

**Validation conflit serveur** : différence clé vs Contact. Le `BookingsService.create` fait 2 vérifs avant l'insert :
1. `SELECT FROM disabled_date WHERE date = ?` — si match, throw 409
2. `SELECT FROM booking WHERE date = ?` puis loop JS pour vérifier le chevauchement (`a.startMin < b.endMin && b.startMin < a.endMin`)

L'helper de chevauchement (`bookings.utils.ts`) est testé indépendamment (6 tests purs sur `parseTimeToMinutes` et `slotsOverlap`).

**Templates** :
- `src/bookings/mail-templates/booking-notification.html` — admin notification (variables `{{name}}`, `{{email}}`, `{{phone}}`, `{{date}}`, `{{duration}}`, `{{subject}}`, `{{message}}`)
- `src/bookings/mail-templates/booking-confirmation.html` — visitor confirmation (variables `{{name}}`, `{{date}}`, `{{duration}}`, `{{subject}}`)

**Configuration** :
- Réutilise `CONTACT_EMAIL` (sous-projet Contact) comme destinataire des notifications admin — pas de nouvelle env var.
- Réutilise `parsePagination` (`src/common/`) — 2ème consommateur du helper (validé).
- Réutilise `isUniqueViolation` (`src/projects/projects.utils`) pour le check disabled-date doublon.

**Pas de validation business hours / future-date côté serveur** : frontend gardien (heures de bureau, créneaux disponibles, refus dates passées). Le serveur fait juste le check de conflit dur (disabled + overlap).

**Voir le spec complet** : [`docs/superpowers/specs/2026-04-26-bookings-design.md`](docs/superpowers/specs/2026-04-26-bookings-design.md).

## CV

Module métier pour la gestion du CV téléchargeable. **Troisième consommateur du `StorageService`** après Projects et Avatar.

**Schéma** : table `cv_file` (uuid + fileName + fileKey unique + fileSize + mimeType + uploadedAt + updatedAt + 1 index sur uploadedAt). Pattern singleton : 1 row max en DB.

**4 endpoints sous `/cv`** :

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| POST | `/cv/upload` | ✅ | Upload multipart (`file`, max 10MB, `application/pdf` strict). Upsert singleton sur key fixe `cv/cv.pdf`. INSERT si pas de CV, UPDATE sinon. |
| GET | `/cv` | ❌ | Métadonnées du CV courant ou `null` si aucun. |
| GET | `/cv/download` | ❌ | Stream backend du PDF avec `Content-Disposition: attachment; filename="<original>"`. 404 si pas de CV. |
| DELETE | `/cv` | ✅ | Supprime DB row + S3 file. 204 ou 404. |

**Lifecycle S3** :
- Upload : `S3 PutObject` (idempotent, écrase la key) → `DB UPSERT` (INSERT si vide, UPDATE sinon).
- Delete : `DB DELETE` → `S3 DELETE` (cohérence Projects/Bookings — DB clean d'abord, S3 ensuite).

**Pourquoi backend proxy pour download** : le `Content-Disposition: attachment; filename="<latest.fileName>"` permet au navigateur de proposer le téléchargement avec le nom original que l'admin a uploadé (ex `Julien-Nedellec-CV-2026.pdf`), pas la clé S3 (`cv.pdf`). La memory pressure pour 10MB est négligeable.

**Configuration** :
- Pas de nouvelle env var (réutilise le bucket `portfolio-storage`)
- Pas de nouvelle dépendance (`multer` + `@types/multer` déjà installés au sous-projet Projects)
- Pas de throttle (admin-only POST + read-only GETs)

**Voir le spec complet** : [`docs/superpowers/specs/2026-04-26-cv-design.md`](docs/superpowers/specs/2026-04-26-cv-design.md).

## Analytics

Module métier pour la collecte de page-views et events custom du portfolio public, avec agrégation quotidienne via cron. **Dernier sous-projet de la migration Hono → NestJS.**

**3 tables** :
- `page_view` (raw events, 9 colonnes, 3 indexes) — purgé après 30j par le cron
- `analytics_event` (events custom : project_click, article_view, cv_download, 7 colonnes, 3 indexes) — purgé après 30j
- `daily_stat` (rollup quotidien, 12 colonnes, unique sur `date`) — conservé indéfiniment

**8 endpoints sous `/analytics`** :

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| POST | `/analytics/track` | ❌ | Track page-view ou event custom (fire-and-forget, 204). Throttle 10/sec/IP. Filtre bots via `isbot`. |
| GET | `/analytics/stats/overview` | ✅ | Totaux (visitors, pv, sessions, bounceRate, avgDuration, eventCounts) sur date range. |
| GET | `/analytics/stats/chart` | ✅ | Time-series quotidien (depuis `daily_stat` + live agg pour today). |
| GET | `/analytics/stats/metrics?type=url\|referrer\|browser\|country\|os` | ✅ | Top N par dimension. |
| GET | `/analytics/stats/active` | ✅ | Sessions actives 5 dernières minutes. |
| GET | `/analytics/stats/projects` | ✅ | Top projets cliqués. |
| GET | `/analytics/stats/articles` | ✅ | Top articles vus. |
| GET | `/analytics/stats/cv-downloads` | ✅ | Total + timeline 30j. |

**Privacy / sécurité** :
- Pas de cookies posés ou lus
- IP utilisée uniquement pour calculer hash session + lookup pays, jamais persistée
- User-Agent jamais persisté brut, seulement parsé en `browser` + `os`
- Session hash = `SHA256(IP + UA + YYYY-MM-DD UTC)` — non-réversible, change chaque jour
- Bots filtrés à l'entrée (lib `isbot`)

**Cron quotidien** : `@Cron('0 0 * * *', { timeZone: 'UTC' })`. Agrège J-1 dans `daily_stat` (UPSERT idempotent), puis purge `page_view` + `analytics_event` > 30j.

**Trigger manuel** : `pnpm build && node dist/scripts/run-analytics-aggregator.js [YYYY-MM-DD]` pour agréger une date arbitraire (utile en cas de cron raté).

**Configuration** :
- Pas de nouvelle env var
- Nouvelles deps : `@nestjs/schedule`, `geoip-lite` (DB MaxMind ~22MB embarquée), `ua-parser-js`, `isbot`
- Throttle global = 10/60s, override 10/sec sur `POST /track`
- `app.set('trust proxy', 1)` activé dans `main.ts` pour lire `X-Forwarded-For` derrière un reverse proxy

**Voir le spec complet** : [`docs/superpowers/specs/2026-04-26-analytics-design.md`](docs/superpowers/specs/2026-04-26-analytics-design.md).

## Migration depuis le backend Hono

Le backend Hono actuel (`../angular-portfolio-app/backend`) reste actif pendant la construction de ce NestJS. Le portage se fait par sous-projets indépendants (un spec et un plan par sous-projet) :

1. ✅ Fondations
2. ✅ Auth (Users + JWT + 2FA + backup codes)
3. ✅ Profile public (Profile, Hero, SocialLinks, Diplomas, Technologies, Expertises, ServicePricing)
4. ✅ S3 Storage (StorageModule + MinIO local + R2 prod)
5. ✅ Projects (CRUD + upload image qui consomme S3 Storage)
6. ✅ Avatar Profile (`POST /profile/avatar` + transformation key→URL en sortie API, cohérent Projects)
7. ✅ Mailer (MailerModule @Global + Mailpit local + nodemailer)
8. ✅ Contact (6 endpoints + 2 templates + throttling 5/60s, premier consumer Mailer)
9. ✅ Bookings (7 endpoints + 2 templates + validation conflit serveur, 2ème consumer Mailer)
10. ✅ CV (upload PDF + download stream + singleton, 3ème consumer S3)
11. ✅ Analytics (3 tables + 8 endpoints + cron rollup nocturne + bot filter + UA + géoloc IP)

**🎉 Migration Hono → NestJS terminée — 11/11 sous-projets livrés.**

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
# nest-portfolio-app
