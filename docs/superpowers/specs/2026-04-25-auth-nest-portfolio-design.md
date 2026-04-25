# Auth — Design

| | |
|---|---|
| **Date** | 2026-04-25 |
| **Statut** | Approuvé (sections), en attente de relecture finale |
| **Périmètre** | Sous-projet "Auth" du chantier de migration Hono → NestJS |
| **Projet cible** | `/home/jned/WebstormProjects/J-Ned/nest-portfolio-app` |
| **Frontend consommateur** | `/home/jned/WebstormProjects/J-Ned/angular-portfolio-app` (adaptation différée) |
| **Modèle de bonnes pratiques** | `/home/jned/WebstormProjects/Prompt Hub/prompt-hub-backend` |
| **Spec précédent** | `2026-04-25-fondations-nest-portfolio-design.md` |

---

## 1. Contexte & motivation

Le sous-projet Fondations est terminé : NestJS scaffold, Drizzle + PostgreSQL, Pino, exception filter, ValidationPipe, Swagger, `/health`. Il reste 7 sous-projets à livrer pour atteindre la parité fonctionnelle avec le backend Hono actuel ; **Auth est le suivant**, car tous les autres modules (Projects, Bookings, etc.) en dépendront pour leurs endpoints d'écriture.

Le frontend Angular consomme actuellement le backend Hono via une auth riche (JWT access + refresh, 2FA TOTP, cookies httpOnly avec paths différents, rate limiting, etc.). **L'utilisateur a explicitement choisi une refonte propre** plutôt que la parité stricte : ce sous-projet ne se contraint pas à reproduire les contrats Hono. Le frontend Angular sera adapté ensuite, dans un sous-projet séparé.

Le projet est mono-utilisateur (l'utilisateur est le seul admin). Les visiteurs publics consultent en lecture sans s'authentifier.

## 2. Scope

### Inclus

- **`UsersModule`** (entité `users`, `UsersService` interne)
- **`AuthModule`** complet :
  - `AuthController` (9 endpoints HTTP)
  - `AuthService` (orchestration login/2FA/change-password)
  - `PasswordService` (Argon2id hash + verify)
  - `TwoFactorService` (otplib + qrcode + backup codes)
  - `JwtStrategy` Passport (cookie + Bearer extraction)
  - `JwtAuthGuard` strict
  - `@CurrentUser()` param decorator
- **Schéma Drizzle `users`** + première vraie migration SQL
- **Script de seed** (`pnpm db:seed`) idempotent qui crée l'admin pré-configuré au premier run
- **Extension de `env.schema.ts`** avec `JWT_SECRET`, `JWT_EXPIRES_IN`, `ADMIN_EMAIL`, `ADMIN_INITIAL_PASSWORD`, `TOTP_APP_NAME`
- **Tests unitaires** sur la logique métier (`AuthService`, `PasswordService`, `TwoFactorService`)
- **Mise à jour du README** pour documenter le workflow seed + nouvelles env vars

### Explicitement exclus

- **Endpoint `/auth/register`** : pas d'inscription publique (admin pré-seedé)
- **Endpoint `/auth/refresh`** : JWT unique long, pas de refresh token
- **Endpoint `/auth/forgot-password`** : nécessite mailer (sous-projet ultérieur)
- **Endpoint `/auth/verify-email`** : pas d'inscription donc rien à vérifier
- **Rôles / permissions** : être authentifié = être admin (un seul user existe)
- **Rate limiting** : décision explicite Q5 (peut être ajouté plus tard via `@nestjs/throttler`)
- **`tokenVersion` pour révocation globale** : YAGNI dans ce contexte mono-utilisateur
- **Audit log** des actions sensibles
- **Session listing / revoke per device**
- **Tests e2e** (Testcontainers, DB de test dédiée)
- **Adaptation du frontend Angular** (sous-projet séparé)
- **Chiffrement applicatif du `twoFactorSecret`** (justification : la DB compromise compromet de toute façon le `passwordHash` Argon2 ; chiffrer le secret ne déplace que la confiance vers une autre clé)

## 3. Architecture & graphe de modules

```
┌──────────────────────────────────────────────────────────────┐
│ AppModule                                                    │
│                                                              │
│  Imports déjà présents (Fondations) :                        │
│   ├── ConfigModule + AppConfigModule                         │
│   ├── LoggerModule (Pino)            ← @Global               │
│   ├── DatabaseModule                  ← @Global              │
│   └── HealthModule                                           │
│                                                              │
│  AJOUTS de ce sous-projet :                                  │
│   ├── UsersModule         exporte UsersService               │
│   │     └── UsersService                                     │
│   │                                                          │
│   └── AuthModule          importe UsersModule                │
│         ├── AuthController        (9 endpoints HTTP)         │
│         ├── AuthService           (orchestration)            │
│         ├── PasswordService       (Argon2id)                 │
│         ├── TwoFactorService      (otplib + qrcode)          │
│         ├── JwtStrategy           (Passport)                 │
│         ├── JwtAuthGuard          (strict)                   │
│         └── @CurrentUser()        (param decorator)          │
└──────────────────────────────────────────────────────────────┘
```

### Principes architecturaux

- **`UsersModule` n'expose AUCUN controller HTTP.** L'admin est pré-seedé via script ; il n'y a pas de CRUD utilisateur exposé. `UsersService` est consommé uniquement par `AuthService` aujourd'hui, et par les futurs modules métier (Projects, Bookings, etc. qui auront un FK `userId`).
- **`AuthModule` importe `UsersModule`** explicitement. **`AuthModule` n'est PAS `@Global`** : les modules métier consommateurs importeront `AuthModule` pour récupérer `JwtAuthGuard` exporté.
- **Trois services dans `AuthModule`** plutôt qu'un seul gros : isole `argon2`, `otplib`, et la logique d'orchestration. Facilite les tests unitaires (mock par service).
- **`JwtStrategy` extrait le token de `req.cookies.token` en priorité, fallback Bearer header** — calque exact prompt-hub. Le frontend Angular utilisera le cookie ; un client REST/Postman pourra utiliser le Bearer.
- **`@CurrentUser()` retourne le `User` complet** (pas juste l'id), car l'objet est déjà chargé par `JwtStrategy.validate()`.

### Flux JWT à chaque requête authentifiée

1. `JwtAuthGuard` (Passport) extrait le token (cookie en priorité, Bearer en fallback).
2. `JwtStrategy.validate(payload)` : payload = `{ sub, iat, exp }`. Si `payload.scope === '2fa-challenge'` → `UnauthorizedException`. Sinon fetch user via `UsersService.findById(sub)`. Si user supprimé → `UnauthorizedException`. Sinon retourne `User`.
3. Passport injecte le `User` dans `req.user`.
4. `@CurrentUser()` extrait `req.user`.

### Flux login complet (avec 2FA enabled)

1. `POST /auth/login` `{ email, password }` → `AuthService.login()` → vérif password (`PasswordService.verify`).
2. Si user a `isTwoFactorEnabled = true` :
   - `challengeToken = jwt.sign({ sub, scope: '2fa-challenge' }, JWT_SECRET, { expiresIn: '5m' })`
   - retourne `200 { requiresTwoFactor: true, challengeToken }`.
3. Frontend stocke `challengeToken` (en mémoire), affiche écran TOTP.
4. `POST /auth/2fa/verify` `{ challengeToken, code }` OU `{ challengeToken, backupCode }` → vérification → si OK, **émission du JWT final dans le cookie `token`** + body `{ user: { id, email, isTwoFactorEnabled } }` (200).

> Le `challengeToken` court (5 min, scope dédié) évite de stocker un état serveur. C'est une amélioration sur le Hono qui passait juste l'email en clair entre les deux étapes.

### Flux login sans 2FA

1. `POST /auth/login` `{ email, password }` → password OK → si `!isTwoFactorEnabled`, **émission directe du JWT dans le cookie** + body `{ user: { id, email, isTwoFactorEnabled: false } }` (200).

## 4. Arborescence des fichiers

```
src/
├── app.module.ts                       # MODIFIÉ : +UsersModule, +AuthModule
├── main.ts                              # INCHANGÉ
│
├── config/
│   ├── env.schema.ts                   # MODIFIÉ : +5 env vars
│   ├── env.validation.ts                # INCHANGÉ
│   ├── env.validation.spec.ts           # MODIFIÉ : +tests pour les nouvelles vars
│   ├── app-config.service.ts            # MODIFIÉ : +5 getters
│   └── app-config.module.ts             # INCHANGÉ
│
├── database/
│   ├── database.module.ts               # INCHANGÉ
│   ├── database.providers.ts            # INCHANGÉ
│   ├── drizzle.constants.ts             # INCHANGÉ
│   ├── drizzle.types.ts                 # INCHANGÉ
│   ├── schema/
│   │   ├── index.ts                     # MODIFIÉ : `export * from './users'`
│   │   └── users.ts                     # NEW : table Drizzle users
│   └── seeds/
│       └── admin.seed.ts                # NEW : script idempotent de création de l'admin
│
├── common/                              # INCHANGÉ
├── health/                              # INCHANGÉ
│
├── users/                               # NEW
│   ├── users.module.ts
│   └── users.service.ts
│
└── auth/                                # NEW
    ├── auth.module.ts
    ├── auth.controller.ts
    ├── auth.service.ts
    ├── auth.service.spec.ts
    ├── password.service.ts
    ├── password.service.spec.ts
    ├── two-factor.service.ts
    ├── two-factor.service.spec.ts
    ├── jwt.strategy.ts
    ├── jwt-auth.guard.ts
    ├── current-user.decorator.ts
    ├── current-user.decorator.spec.ts
    └── dto/
        ├── login.dto.ts
        ├── change-password.dto.ts
        ├── two-factor-verify.dto.ts
        ├── two-factor-enable.dto.ts
        └── two-factor-disable.dto.ts

drizzle/                                  # MODIFIÉ par db:generate
├── 0000_*.sql                            # NEW : migration users
└── meta/
    ├── _journal.json                     # MODIFIÉ
    └── 0000_snapshot.json                # NEW

(test/ inchangé — toujours pas de e2e dans cette itération)
```

### Notes structurelles

- **Pas de controller dans `users/`** : pas d'API HTTP exposée pour les utilisateurs.
- **Pas de tests sur `UsersService`** : couche fine sur Drizzle, peu de logique métier. Couverture indirecte via les tests d'`AuthService` qui mockent `UsersService`. (Cf. §10 Tests.)
- **`schema/users.ts` dans `database/schema/`** (et non dans `users/`) : Drizzle a besoin que tous les schémas soient barrel-exportés depuis `schema/index.ts` pour que les relations futures fonctionnent. Le `Database` type devient automatiquement `PostgresJsDatabase<{ users: typeof users }>`.
- **`seeds/` dans `database/`** : suit la convention que tout ce qui touche la DB vit dans `database/`.

## 5. Modèle de données

### `src/database/schema/users.ts`

```typescript
import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  isTwoFactorEnabled: boolean('is_two_factor_enabled').notNull().default(false),
  twoFactorSecret: text('two_factor_secret'),
  twoFactorBackupCodesHash: text('two_factor_backup_codes_hash').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

### Décisions de schéma

| Choix | Justification |
|---|---|
| `uuid` (`gen_random_uuid()`) | Le payload JWT contient l'id ; un UUID empêche la fuite d'info sur la table. Compatible avec une migration future depuis Hono qui utilise déjà des UUID. |
| `passwordHash` (et non `password`) | Nommage explicite — la colonne contient un hash. Argon2 produit une string compacte qui inclut les paramètres → pas besoin de stocker `salt`/`iterations` séparément. |
| `twoFactorSecret: text` nullable, plaintext | S'il est compromis, c'est en général parce que la DB l'est, auquel cas `passwordHash` (Argon2) protège déjà. Chiffrer le secret ne fait que déplacer la confiance vers une autre clé. |
| `twoFactorBackupCodesHash: text[]` | 10 codes one-time, hashés individuellement. Quand un code est utilisé, on l'**enlève du tableau**. À épuisement ou via `regenerate-backup-codes`, on remplace le tableau. |
| Pas de `name` / `displayName` / `avatar` | Profil public = autre table dans le sous-projet Profile. `users` est strictement la table d'authentification. |
| `withTimezone: true` sur les timestamps | Meilleure pratique Postgres pour `created_at`/`updated_at`. |

### Migration générée

`pnpm db:generate` produit :

```sql
-- drizzle/0000_initial_users.sql (nom approximatif)
CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "password_hash" text NOT NULL,
  "is_two_factor_enabled" boolean DEFAULT false NOT NULL,
  "two_factor_secret" text,
  "two_factor_backup_codes_hash" text[],
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "users_email_unique" UNIQUE("email")
);
```

Aucun trigger Postgres pour `updated_at` — `UsersService` met à jour la colonne explicitement (`{ updatedAt: new Date() }`). Plus visible que des triggers SQL invisibles.

### Seed admin

**Stratégie :** script séparé, pas une migration Drizzle. Drizzle migrations = changements de schéma uniquement. Le seed = données.

`src/database/seeds/admin.seed.ts` :

```typescript
import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import argon2 from 'argon2';
import { sql } from 'drizzle-orm';
import { users } from '../schema/users';

async function main() {
  const url = process.env.DATABASE_URL;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!url || !email || !password) {
    throw new Error('Missing DATABASE_URL, ADMIN_EMAIL, or ADMIN_INITIAL_PASSWORD');
  }
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);
  const existing = await db.execute(sql`SELECT count(*)::int as c FROM users`);
  const count = (existing[0] as { c: number }).c;
  if (count > 0) {
    console.log(`Admin seed: ${count} user(s) already exist, skipping.`);
    await client.end();
    return;
  }
  const passwordHash = await argon2.hash(password);
  await db.insert(users).values({ email, passwordHash });
  console.log(`Admin seed: created user "${email}".`);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Script `package.json` ajouté :

```json
"db:seed": "tsx src/database/seeds/admin.seed.ts"
```

Workflow nouveau dev (mise à jour README) :

```bash
pnpm install
cp .env.example .env
# Éditer .env : remplir ADMIN_EMAIL et ADMIN_INITIAL_PASSWORD
pnpm db:up && pnpm db:wait
pnpm db:migrate           # crée la table users
pnpm db:seed              # crée l'admin
pnpm dev
```

`pnpm db:reset` mis à jour : `down -v && up && wait && migrate && seed`.

> **Pourquoi `tsx` (et non `ts-node`)** : tsx est plus rapide, plus moderne, démarre en ~50ms vs ~1-2s. Il faudra l'ajouter en devDep.
>
> **Pourquoi pas un `OnApplicationBootstrap` lifecycle hook** : explicite > implicite. Un hook qui touche la DB au boot crée des race conditions (multi-replica, timing avec migrations). Un script séparé est sans ambiguïté.

## 6. Endpoints

### Tableau exhaustif

| Méthode | Chemin | Auth | Body (DTO) | Réponse 200 | Erreurs |
|---|---|---|---|---|---|
| `POST` | `/auth/login` | ❌ | `LoginDto` | (sans 2FA) `{ user: { id, email, isTwoFactorEnabled: false } }` + cookie `token`<br>(avec 2FA) `{ requiresTwoFactor: true, challengeToken }` | 401 invalid credentials |
| `POST` | `/auth/2fa/verify` | ❌ | `TwoFactorVerifyDto` | `{ user: { id, email, isTwoFactorEnabled: true } }` + cookie `token` | 401 invalid challengeToken / code / backupCode |
| `POST` | `/auth/logout` | ✅ | — | `{ ok: true }` + clear cookie | — |
| `GET` | `/auth/me` | ✅ | — | `{ id, email, isTwoFactorEnabled }` | 401 |
| `POST` | `/auth/change-password` | ✅ | `ChangePasswordDto` | `{ ok: true }` | 401 wrong currentPassword |
| `POST` | `/auth/2fa/generate` | ✅ | — | `{ secret: 'BASE32...', qrCodeDataUrl: 'data:image/png;base64,...' }` | 400 already enabled |
| `POST` | `/auth/2fa/enable` | ✅ | `TwoFactorEnableDto` | `{ backupCodes: ['xxx-xxx', ...] }` (10 codes one-time-display) | 400 no secret generated, 401 invalid code |
| `POST` | `/auth/2fa/disable` | ✅ | `TwoFactorDisableDto` | `{ ok: true }` | 401 invalid password, 400 not enabled |
| `POST` | `/auth/2fa/regenerate-backup-codes` | ✅ | `TwoFactorDisableDto` | `{ backupCodes: ['xxx-xxx', ...] }` | 401 invalid password, 400 not enabled |

**9 endpoints**, tous sous le prefix `/auth`. Un seul cookie : `token` (JWT 7 jours, httpOnly, sameSite='lax', secure en prod).

### DTOs

```typescript
// LoginDto
class LoginDto {
  @ApiProperty({ example: 'admin@nedellec-julien.fr' })
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12)
  password!: string;
}

// TwoFactorVerifyDto — code OU backupCode (XOR validé via @ValidateIf custom)
class TwoFactorVerifyDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  challengeToken!: string;

  @ApiPropertyOptional({ example: '123456' })
  @IsOptional()
  @IsString()
  @Length(6, 6)
  code?: string;

  @ApiPropertyOptional({ example: 'a1b2-c3d4' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]{4}-[a-z0-9]{4}$/)
  backupCode?: string;
}

// ChangePasswordDto
class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(12)
  currentPassword!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12)
  newPassword!: string;
}

// TwoFactorEnableDto
class TwoFactorEnableDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  code!: string;
}

// TwoFactorDisableDto (et regenerate-backup-codes)
class TwoFactorDisableDto {
  @ApiProperty()
  @IsString()
  @MinLength(12)
  password!: string;
}
```

> **Pourquoi `MinLength(12)` partout** : le password Argon2id seul (sans 2FA forcée) est la principale défense contre le brute-force. 12 chars min est l'OWASP 2026 baseline. Pas de regex de complexité (caractères spéciaux, etc.) : la longueur prime sur la complexité (cf. NIST SP 800-63B).

### Cookie `token`

Les options sont calculées à partir de `JWT_EXPIRES_IN` pour garantir que cookie et JWT expirent en même temps. La librairie `ms` (transitive de `jsonwebtoken` via `@nestjs/jwt`) parse les durées style `'7d'` / `'2h'` / `'30m'` :

```typescript
import ms from 'ms';

function buildCookieOptions(cfg: AppConfigService) {
  return {
    httpOnly: true,
    secure: cfg.isProduction,
    sameSite: 'lax' as const,
    maxAge: ms(cfg.jwtExpiresIn),    // parse '7d' → 604800000 ms
    path: '/',
  };
}
```

> **Pourquoi `sameSite: 'lax'`** (vs `'strict'`) : `'lax'` permet la navigation cross-site post-login. `'strict'` casse les workflows comme "clic sur un lien externe pour revenir au site". Pour un portfolio, `'lax'` est le bon compromis. Calque prompt-hub.
>
> **Pourquoi calculer `maxAge` depuis `JWT_EXPIRES_IN`** : évite un drift si l'utilisateur change la durée du JWT sans penser à mettre à jour le cookie. Une seule source de vérité.

## 7. Flows 2FA détaillés

### Activation

```
1. User connecté (sans 2FA) → POST /auth/2fa/generate
   Backend:
     - Si user.isTwoFactorEnabled → 400 'Already enabled'
     - secret = otplib.authenticator.generateSecret()        // base32, ~26 chars
     - update user.twoFactorSecret = secret                   // en DB, isTwoFactorEnabled reste false
     - otpauthUrl = otplib.authenticator.keyuri(user.email, TOTP_APP_NAME, secret)
     - qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl)
     - return { secret, qrCodeDataUrl }
   Frontend:
     - Affiche le QR à scanner (Google Authenticator / Aegis / Authy)
     - Affiche aussi le secret en texte (saisie manuelle de secours)

2. User saisit le code TOTP → POST /auth/2fa/enable { code: '123456' }
   Backend:
     - Si !user.twoFactorSecret → 400 'No secret generated'
     - if !otplib.authenticator.verify({ token: code, secret: user.twoFactorSecret }) → 401 'Invalid code'
     - codes = generateBackupCodes()                          // 10 codes au format 'a1b2-c3d4'
     - hashedCodes = await Promise.all(codes.map(c => argon2.hash(c)))
     - update user: { isTwoFactorEnabled: true, twoFactorBackupCodesHash: hashedCodes }
     - return { backupCodes: codes }                           // EN CLAIR, affichés UNE FOIS
   Frontend:
     - Affiche les 10 codes en gros, avec bouton "Téléchargé / imprimé"
     - WARNING: ces codes ne seront plus jamais affichés.
```

### Login avec 2FA enabled

```
1. POST /auth/login { email, password }
   Backend:
     - findByEmail(email) → user | throw 401
     - PasswordService.verify(password, user.passwordHash) → true | throw 401
     - if user.isTwoFactorEnabled:
         challengeToken = jwt.sign({ sub: user.id, scope: '2fa-challenge' }, JWT_SECRET, { expiresIn: '5m' })
         return 200 { requiresTwoFactor: true, challengeToken }
     - else:
         finalToken = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
         res.cookie('token', finalToken, COOKIE_OPTIONS)
         return 200 { user: { id, email, isTwoFactorEnabled: false } }

2. POST /auth/2fa/verify { challengeToken, code | backupCode }
   Backend:
     - jwt.verify(challengeToken) → payload | throw 401
       Si payload.scope ≠ '2fa-challenge' → throw 401
     - findById(payload.sub) → user | throw 401
     - if 'code' fourni:
         if !otplib.authenticator.verify({ token: code, secret: user.twoFactorSecret }) → throw 401
     - else if 'backupCode' fourni:
         matchHash = await findMatchingBackupCode(backupCode, user.twoFactorBackupCodesHash)
         if !matchHash → throw 401
         await UsersService.consumeBackupCode(user.id, matchHash)
     - finalToken = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
     - res.cookie('token', finalToken, COOKIE_OPTIONS)
     - return 200 { user: { id, email, isTwoFactorEnabled: true } }
```

> **Pourquoi un `scope: '2fa-challenge'` dans le challengeToken** : empêche qu'un challengeToken intercepté soit utilisé comme token de session. `JwtStrategy.validate()` rejette tout payload avec `scope === '2fa-challenge'`.
>
> **Pourquoi `Promise.any` pour vérifier les backup codes en parallèle** : `argon2.verify` prend ~100ms par appel. Avec 10 codes en `Promise.all` séquentiel = 1s. En parallèle = ~100ms. `Promise.any` rejette si TOUS échouent.

### Désactivation

```
POST /auth/2fa/disable { password }
   Backend:
     - if !user.isTwoFactorEnabled → 400 'Not enabled'
     - PasswordService.verify(password, user.passwordHash) → true | throw 401
     - update user: { isTwoFactorEnabled: false, twoFactorSecret: null, twoFactorBackupCodesHash: null }
     - return { ok: true }
```

### Régénération des backup codes

```
POST /auth/2fa/regenerate-backup-codes { password }
   Backend:
     - if !user.isTwoFactorEnabled → 400 'Not enabled'
     - PasswordService.verify(password, user.passwordHash) → true | throw 401
     - newCodes = generateBackupCodes()
     - hashedCodes = await Promise.all(newCodes.map(c => argon2.hash(c)))
     - update user.twoFactorBackupCodesHash = hashedCodes
     - return { backupCodes: newCodes }
```

## 8. Internals

### `AuthModule` — câblage DI

```typescript
@Module({
  imports: [
    UsersModule,
    AppConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService) => ({
        secret: cfg.jwtSecret,
        signOptions: { expiresIn: cfg.jwtExpiresIn },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TwoFactorService, JwtStrategy, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
```

### `JwtStrategy`

```typescript
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    cfg: AppConfigService,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req) => req?.cookies?.token ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: cfg.jwtSecret,
    });
  }

  async validate(payload: { sub: string; scope?: string }): Promise<User> {
    if (payload.scope === '2fa-challenge') {
      throw new UnauthorizedException('Challenge token cannot be used for authentication');
    }
    const user = await this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedException('User no longer exists');
    return user;
  }
}
```

### `JwtAuthGuard`

```typescript
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

### `@CurrentUser()`

```typescript
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User => {
    return ctx.switchToHttp().getRequest().user;
  },
);
```

### `UsersService` — surface

```typescript
@Injectable()
export class UsersService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findById(id: string): Promise<User | null>;
  async findByEmail(email: string): Promise<User | null>;
  async updatePassword(id: string, passwordHash: string): Promise<void>;
  async updateTwoFactorSecret(id: string, secret: string): Promise<void>;
  async enableTwoFactor(id: string, backupCodesHash: string[]): Promise<void>;
  async disableTwoFactor(id: string): Promise<void>;
  async replaceBackupCodes(id: string, backupCodesHash: string[]): Promise<void>;
  async consumeBackupCode(id: string, hashToRemove: string): Promise<void>;
}
```

### `PasswordService`

```typescript
@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain);   // Argon2id défauts: time=3, memory=64MB, parallelism=4
  }
  verify(plain: string, hash: string): Promise<boolean> {
    return argon2.verify(hash, plain).catch(() => false);
  }
}
```

### `TwoFactorService` — surface

```typescript
@Injectable()
export class TwoFactorService {
  constructor(private readonly cfg: AppConfigService) {}

  generateSecret(): string;
  async generateQrCodeDataUrl(email: string, secret: string): Promise<string>;
  verifyTotpCode(secret: string, code: string): boolean;

  generateBackupCodes(count?: number): string[];                      // défaut: 10, format 'a1b2-c3d4'
  async hashBackupCodes(codes: string[]): Promise<string[]>;
  async findMatchingBackupCode(plain: string, hashes: string[]): Promise<string | null>;
}
```

## 9. Configuration

### Env vars étendues — `env.schema.ts`

```typescript
// Existant (Fondations)
NODE_ENV, PORT, DATABASE_URL, LOG_LEVEL,

// Nouveau (Auth)
JWT_SECRET: z.string().min(32),
JWT_EXPIRES_IN: z.string().default('7d'),
ADMIN_EMAIL: z.string().email(),
ADMIN_INITIAL_PASSWORD: z.string().min(12),
TOTP_APP_NAME: z.string().default('J-Ned Portfolio'),
```

### `AppConfigService` — getters ajoutés

```typescript
get jwtSecret() { return this.config.get('JWT_SECRET', { infer: true }); }
get jwtExpiresIn() { return this.config.get('JWT_EXPIRES_IN', { infer: true }); }
get adminEmail() { return this.config.get('ADMIN_EMAIL', { infer: true }); }
get adminInitialPassword() { return this.config.get('ADMIN_INITIAL_PASSWORD', { infer: true }); }
get totpAppName() { return this.config.get('TOTP_APP_NAME', { infer: true }); }
```

### `.env.example` étendu

```bash
# Existant
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://portfolio:portfolio@localhost:55432/portfolio_nest
# LOG_LEVEL=info

# Auth
JWT_SECRET=change-me-please-at-least-32-characters-of-random
JWT_EXPIRES_IN=7d
TOTP_APP_NAME=J-Ned Portfolio

# Identifiants admin (création one-shot au premier seed)
# Après le premier seed, ces variables ne sont plus utilisées (le password est hashé en DB et tu changes via /auth/change-password).
ADMIN_EMAIL=admin@nedellec-julien.fr
ADMIN_INITIAL_PASSWORD=change-me-please-at-least-12-chars
```

## 10. Tests

### Stratégie

| Fichier | Tests | Mocking |
|---|---|---|
| `env.validation.spec.ts` (étendu) | +5 tests : JWT_SECRET trop court rejeté, ADMIN_EMAIL invalide rejeté, JWT_EXPIRES_IN défaut, ADMIN_INITIAL_PASSWORD <12 rejeté, TOTP_APP_NAME défaut | aucun |
| `password.service.spec.ts` | 3 tests : hash + verify roundtrip, verify wrong password = false, verify malformed hash = false | aucun (Argon2 réel) |
| `two-factor.service.spec.ts` | ~8 tests : generateSecret format, generateBackupCodes format, hashBackupCodes + findMatchingBackupCode roundtrip, verifyTotpCode avec un secret connu et un code calculé `otplib.authenticator.generate(secret)`, qrCodeDataUrl format | aucun (otplib réel) |
| `auth.service.spec.ts` | ~12 tests : login sans 2FA → token, login avec 2FA → challengeToken, login wrong password → throw, verify2FA OK code, verify2FA OK backupCode (consomme), verify2FA invalid challengeToken (mauvais scope), verify2FA invalid code, change-password OK, change-password wrong current → throw, generate2FA already enabled → throw, enable2FA invalid code → throw, disable2FA invalid password → throw | mock UsersService, PasswordService, TwoFactorService, JwtService |
| `current-user.decorator.spec.ts` | 1 test : factory extrait `request.user` | mock `ExecutionContext` |

**Total : ~29 tests unitaires nouveaux**, ajoutés aux 12 existants → **~41 tests** à la fin de ce sous-projet.

### Décision : pas de tests unitaires sur `UsersService`

Mocker l'API fluent de Drizzle (`db.select().from(users).where(eq(users.id, x))`) est fragile et peu utile. **`UsersService` est une couche fine sans logique métier** (pure traduction service ↔ Drizzle). Sa correction est couverte indirectement :

1. Par TypeScript (le typage Drizzle attrape les erreurs de schéma).
2. Par les tests d'`AuthService` qui mockent `UsersService` (vérifient que les bons appels sont faits avec les bons args).
3. Par la vérification end-to-end manuelle via `curl` (cf. critères de done).

Si on veut couvrir `UsersService` plus tard, ce sera via des tests d'intégration sur la vraie DB (Testcontainers ou DB de test dédiée) — sous-projet ultérieur "Auth integration tests".

## 11. Décisions d'architecture (résumé)

| # | Décision | Pourquoi |
|---|---|---|
| ADR-1 | Refonte propre, pas de parité Hono | L'utilisateur a explicitement choisi C en Q1. Frontend adapté plus tard. |
| ADR-2 | JWT unique long (7j), un seul cookie httpOnly | Simplicité ; un seul utilisateur ; pas de besoin de révocation per-device. (Q2 → A) |
| ADR-3 | 2FA TOTP avec backup codes | Sécurité légitime pour le compte admin. Backup codes pour récupération si smartphone perdu. (Q3 → B) |
| ADR-4 | Admin unique pré-seedé via script, pas de `/register` | Aucune surface d'inscription publique. Le seed est idempotent. (Q4 → A) |
| ADR-5 | Pas de rate limiting | Décision explicite ; peut être ajouté plus tard via `@nestjs/throttler`. ⚠️ Risque théorique sur `/2fa/verify`. (Q5 → C) |
| ADR-6 | Argon2id avec défauts (`time=3, memory=64MB, parallelism=4`) | Standard moderne OWASP 2026 ; ce qu'utilise déjà Hono. (Q6 → A) |
| ADR-7 | Modules `Users` + `Auth` séparés | Séparation sémantique : Users = entité, Auth = stratégie. Réutilisable par futurs modules métier. |
| ADR-8 | 3 services dans `AuthModule` (Auth, Password, TwoFactor) | Isole les libs (`argon2`, `otplib`) et facilite les tests unitaires. |
| ADR-9 | `AuthModule` non-`@Global`, exporte `JwtAuthGuard` | Modules métier l'importeront explicitement (pratique NestJS canonique). |
| ADR-10 | `JwtStrategy` rejette `scope === '2fa-challenge'` | Défense en profondeur : empêche qu'un challengeToken devienne token de session. |
| ADR-11 | `challengeToken` 5min plutôt qu'état serveur "pending 2FA" | Pas de table `pending_2fa_logins` à gérer. Stateless. |
| ADR-12 | UUID (`gen_random_uuid()`) pour `users.id` | Pas de fuite d'info ; compatible migration Hono. |
| ADR-13 | `twoFactorSecret` en clair en DB (pas chiffré) | Compromis DB compromet déjà tout via passwordHash ; chiffrer ne fait que déplacer la confiance. |
| ADR-14 | Backup codes en `text[]` (Postgres array) | Simple, suffisant pour 10 codes one-time. Suppression = retrait du tableau. |
| ADR-15 | Seed via script `tsx` séparé, pas via `OnApplicationBootstrap` | Explicite > implicite. Pas de race conditions. |
| ADR-16 | `MinLength(12)` pour passwords, pas de regex de complexité | OWASP 2026 / NIST SP 800-63B : longueur > complexité. |
| ADR-17 | Cookie `sameSite: 'lax'` | Calque prompt-hub. Compromis "strict" / workflow utilisateur. |
| ADR-18 | Pas de tests unitaires sur `UsersService` | Couche fine sans logique ; couverture indirecte via tests `AuthService` mocks. |

## 12. Critères de done

Le sous-projet Auth est terminé quand toutes ces conditions sont vraies :

1. `pnpm install` ajoute les nouvelles deps (`@nestjs/passport`, `@nestjs/jwt`, `passport`, `passport-jwt`, `argon2`, `otplib`, `qrcode`, `tsx` en dev, `@types/qrcode` + `@types/passport-jwt` en dev) sans conflit.
2. `pnpm db:generate` produit la migration `0000_*.sql` créant la table `users` (8 colonnes).
3. `pnpm db:migrate` applique la migration sans erreur. Vérification : `podman exec portfolio-nest-db psql -U portfolio -d portfolio_nest -c '\d users'` montre la structure attendue.
4. `pnpm db:seed` crée l'admin avec `ADMIN_EMAIL` + `ADMIN_INITIAL_PASSWORD`. Idempotent : second appel = no-op (message "skipping").
5. `pnpm test` passe (~29 nouveaux tests + les 12 existants = ~41 tests, tous verts).
6. `pnpm lint` ne rapporte aucune erreur.
7. `pnpm build` produit `dist/` exécutable.
8. End-to-end manuel via `curl` :
   - `POST /auth/login { email, password }` (admin seedé) → 200 + cookie `token`
   - `GET /auth/me` (avec cookie) → 200 `{ id, email, isTwoFactorEnabled: false }`
   - `POST /auth/2fa/generate` → 200 `{ secret, qrCodeDataUrl }`
   - Génère un code via `otplib.authenticator.generate(secret)` localement
   - `POST /auth/2fa/enable { code }` → 200 `{ backupCodes: [...] }` (10 codes)
   - `POST /auth/logout` → 200 + cookie cleared
   - `POST /auth/login` à nouveau → 200 `{ requiresTwoFactor: true, challengeToken }`
   - `POST /auth/2fa/verify { challengeToken, code }` → 200 + cookie
   - `POST /auth/2fa/verify { challengeToken, backupCode }` (un autre login) → 200 + cookie ; le backup code doit avoir été consommé (un second login avec le même backup code → 401)
   - `POST /auth/change-password { currentPassword, newPassword }` → 200 ; `POST /auth/login` avec l'ancien password → 401 ; avec le nouveau → 200
   - `POST /auth/2fa/disable { password }` → 200 ; `GET /auth/me` → `isTwoFactorEnabled: false`
9. Swagger sur `/docs` documente tous les 9 endpoints avec leurs DTOs et les status codes possibles.

## 13. Hors scope (suite)

Ordre des sous-projets restants (ré-affiné après Auth) :

1. ✅ Fondations
2. ✅ Auth *(ce document)*
3. **Profile public** (Profile, Hero, SocialLinks, Diplomas, Technologies, Expertises, ServicePricing) — premier vrai usage de `JwtAuthGuard` pour les écritures admin
4. **Projects** (CRUD + upload image S3 — premier sous-projet avec stockage de fichiers)
5. **Contact** (messages + envoi mail — premier sous-projet avec mailer)
6. **Bookings** (réservations + slots + mail confirmation — réutilise mailer)
7. **CV** (upload S3 + download)
8. **Analytics** (page views + agrégats stats — peut-être pas tout en NestJS, on verra)

Chaque sous-projet aura son propre cycle spec → plan → implémentation.
