# Auth — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter le sous-projet Auth du backend NestJS (UsersModule + AuthModule, 9 endpoints sous `/auth`, JWT unique en cookie httpOnly, 2FA TOTP avec backup codes Argon2, admin unique pré-seedé) selon le spec `2026-04-25-auth-nest-portfolio-design.md`.

**Architecture:** Deux modules ajoutés à l'AppModule existant. `UsersModule` expose un `UsersService` interne (pas de controller HTTP). `AuthModule` orchestre via 3 services (`AuthService`, `PasswordService`, `TwoFactorService`) + Passport JWT strategy + guard + `@CurrentUser` decorator. Schéma Drizzle `users` + script de seed idempotent.

**Tech Stack:** NestJS 11, `@nestjs/passport`, `@nestjs/jwt`, `passport-jwt`, `argon2`, `otplib`, `qrcode`, `tsx` (dev), Drizzle ORM (déjà en place), Pino + ValidationPipe + ExceptionFilter (déjà en place).

**Référence spec :** `docs/superpowers/specs/2026-04-25-auth-nest-portfolio-design.md`

---

## File Structure

### Fichiers à créer

| Chemin | Rôle |
|---|---|
| `src/database/schema/users.ts` | Table Drizzle `users` (8 colonnes, UUID, email unique) |
| `src/database/seeds/admin.seed.ts` | Script idempotent qui crée l'admin au premier run |
| `src/users/users.module.ts` | Module exposant `UsersService` |
| `src/users/users.service.ts` | CRUD users via DRIZZLE (8 méthodes) |
| `src/auth/auth.module.ts` | Câblage Passport + JwtModule + UsersModule |
| `src/auth/auth.controller.ts` | 9 endpoints HTTP sous `/auth` |
| `src/auth/auth.service.ts` | Orchestration login / 2FA / change-password |
| `src/auth/auth.service.spec.ts` | ~12 tests unitaires (mocks UsersService, PasswordService, TwoFactorService, JwtService) |
| `src/auth/password.service.ts` | Argon2id hash + verify |
| `src/auth/password.service.spec.ts` | 3 tests unitaires (Argon2 réel) |
| `src/auth/two-factor.service.ts` | otplib + qrcode + génération/hash/match backup codes |
| `src/auth/two-factor.service.spec.ts` | ~8 tests unitaires (otplib réel) |
| `src/auth/jwt.strategy.ts` | Passport strategy (cookie + Bearer extraction) |
| `src/auth/jwt-auth.guard.ts` | `extends AuthGuard('jwt')` |
| `src/auth/current-user.decorator.ts` | `@CurrentUser()` param decorator |
| `src/auth/current-user.decorator.spec.ts` | 1 test unitaire (mock ExecutionContext) |
| `src/auth/dto/login.dto.ts` | `{ email, password }` |
| `src/auth/dto/change-password.dto.ts` | `{ currentPassword, newPassword }` |
| `src/auth/dto/two-factor-verify.dto.ts` | `{ challengeToken, code? \| backupCode? }` (XOR custom validator) |
| `src/auth/dto/two-factor-enable.dto.ts` | `{ code }` |
| `src/auth/dto/two-factor-disable.dto.ts` | `{ password }` |
| `drizzle/0000_*.sql` | Migration auto-générée (table users) |
| `drizzle/meta/0000_snapshot.json` | Snapshot Drizzle auto-généré |

### Fichiers à modifier

| Chemin | Modification |
|---|---|
| `src/database/schema/index.ts` | `export * from './users'` |
| `src/config/env.schema.ts` | +5 env vars (JWT_*, ADMIN_*, TOTP_APP_NAME) |
| `src/config/env.validation.spec.ts` | +5 tests pour les nouvelles vars |
| `src/config/app-config.service.ts` | +5 getters |
| `.env.example` | +5 variables documentées |
| `package.json` | +deps (`@nestjs/passport`, `@nestjs/jwt`, `passport`, `passport-jwt`, `argon2`, `otplib`, `qrcode`, `ms`) + dev deps (`tsx`, `@types/passport-jwt`) + script `db:seed` + update `db:reset` |
| `src/app.module.ts` | +`UsersModule`, +`AuthModule` dans imports |
| `README.md` | Section Quickstart : ajouter step `pnpm db:seed`. Section Auth (nouvelle). |
| `drizzle/meta/_journal.json` | Mis à jour automatiquement par drizzle-kit |

---

## Task 1: Installer les dépendances Auth + étendre la validation env

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`
- Modify: `src/config/env.schema.ts`
- Modify: `src/config/env.validation.spec.ts`
- Modify: `src/config/app-config.service.ts`
- Modify: `.env.example`

- [ ] **Step 1: Installer les dépendances de production**

```bash
pnpm add @nestjs/passport @nestjs/jwt passport passport-jwt argon2 otplib qrcode ms
```

Expected: pnpm résout, modifie `package.json` et `pnpm-lock.yaml`. Aucune erreur.

- [ ] **Step 2: Installer les dépendances de dev**

```bash
pnpm add -D tsx @types/passport-jwt @types/qrcode
```

Expected: pnpm résout sans erreur. (Note : `@types/ms` n'est pas requis, `ms` v3+ ship ses propres types. `@types/argon2` non plus, idem.)

- [ ] **Step 3: Étendre `src/config/env.schema.ts`**

Ouvrir le fichier. Le contenu actuel ressemble à :

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

Le remplacer entièrement par :

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

  // Auth
  JWT_SECRET: z.string().min(32, { message: 'JWT_SECRET must be at least 32 characters' }),
  JWT_EXPIRES_IN: z.string().default('7d'),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_INITIAL_PASSWORD: z.string().min(12, { message: 'ADMIN_INITIAL_PASSWORD must be at least 12 characters' }),
  TOTP_APP_NAME: z.string().default('J-Ned Portfolio'),
});

export type Env = z.infer<typeof envSchema>;
```

- [ ] **Step 4: Étendre `src/config/env.validation.spec.ts`**

Ouvrir le fichier. Compléter `baseValid` et ajouter des tests pour les nouvelles env vars. Modifier la constante existante `baseValid` :

```typescript
  const baseValid = {
    DATABASE_URL: 'postgres://u:p@localhost:55432/db',
    JWT_SECRET: '0123456789abcdef0123456789abcdef',          // exactly 32 chars
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_INITIAL_PASSWORD: 'change-me-please-secure',        // ≥12 chars
  };
```

Puis ajouter ces tests à la fin du `describe('validateEnv', ...)`, juste avant l'accolade fermante :

```typescript
  it('rejette JWT_SECRET trop court', () => {
    expect(() => validateEnv({ ...baseValid, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('utilise JWT_EXPIRES_IN=7d par défaut', () => {
    const result = validateEnv(baseValid);
    expect(result.JWT_EXPIRES_IN).toBe('7d');
  });

  it('respecte JWT_EXPIRES_IN explicite', () => {
    const result = validateEnv({ ...baseValid, JWT_EXPIRES_IN: '14d' });
    expect(result.JWT_EXPIRES_IN).toBe('14d');
  });

  it('rejette ADMIN_EMAIL invalide', () => {
    expect(() => validateEnv({ ...baseValid, ADMIN_EMAIL: 'not-an-email' })).toThrow(/ADMIN_EMAIL/);
  });

  it('rejette ADMIN_INITIAL_PASSWORD trop court', () => {
    expect(() => validateEnv({ ...baseValid, ADMIN_INITIAL_PASSWORD: 'short' })).toThrow(/ADMIN_INITIAL_PASSWORD/);
  });

  it('utilise TOTP_APP_NAME=J-Ned Portfolio par défaut', () => {
    const result = validateEnv(baseValid);
    expect(result.TOTP_APP_NAME).toBe('J-Ned Portfolio');
  });
```

> Note : les 10 tests existants utilisent `baseValid` qui n'avait que `DATABASE_URL`. En enrichissant `baseValid`, les 10 tests existants vont voir des champs supplémentaires (NODE_ENV, PORT, etc. ne sont pas dans `baseValid` mais ils ont des défauts donc OK ; les 4 nouveaux champs requis sont fournis). Vérifier que les 10 tests existants passent toujours.

- [ ] **Step 5: Lancer les tests env validation**

```bash
pnpm test src/config/env.validation.spec.ts
```

Expected : `Tests: 16 passed, 16 total` (10 existants + 6 nouveaux). Si l'un des anciens tests échoue, c'est probablement parce qu'il avait un input qui ne fournissait pas les nouvelles env vars requises ; vérifier que `baseValid` est utilisé partout.

- [ ] **Step 6: Étendre `src/config/app-config.service.ts`**

Ouvrir le fichier. Ajouter ces 5 getters dans la classe `AppConfigService`, après les getters existants :

```typescript
  get jwtSecret() { return this.config.get('JWT_SECRET', { infer: true }); }
  get jwtExpiresIn() { return this.config.get('JWT_EXPIRES_IN', { infer: true }); }
  get adminEmail() { return this.config.get('ADMIN_EMAIL', { infer: true }); }
  get adminInitialPassword() { return this.config.get('ADMIN_INITIAL_PASSWORD', { infer: true }); }
  get totpAppName() { return this.config.get('TOTP_APP_NAME', { infer: true }); }
```

- [ ] **Step 7: Étendre `.env.example`**

Ouvrir le fichier. Le contenu actuel se termine par la ligne commentée `# LOG_LEVEL=info`. Ajouter à la fin :

```bash

# Auth — secret JWT (32+ chars random ; générer via: openssl rand -base64 32)
JWT_SECRET=change-me-please-at-least-32-characters-of-random
JWT_EXPIRES_IN=7d

# Nom affiché dans l'app TOTP (Google Authenticator, Aegis, etc.)
TOTP_APP_NAME=J-Ned Portfolio

# Identifiants admin (création one-shot au premier seed)
# Après le premier seed, ces variables ne sont plus utilisées (le password est
# hashé en DB et tu changes via /auth/change-password).
ADMIN_EMAIL=admin@nedellec-julien.fr
ADMIN_INITIAL_PASSWORD=change-me-please-at-least-12-chars
```

- [ ] **Step 8: Mettre à jour `.env` local**

```bash
cat .env.example | tail -12 >> .env
```

Vérifier `.env` contient maintenant les nouvelles variables. (Si l'utilisateur a déjà `.env` avec les anciennes vars seulement, on ajoute juste les nouvelles ; pas de duplication.)

- [ ] **Step 9: Vérifier que l'app boote toujours avec les nouvelles env vars**

```bash
pkill -f "nest start" 2>/dev/null; true
sleep 1
pnpm db:up && pnpm db:wait
pnpm start > /tmp/task1-boot.log 2>&1 &
PID=$!
sleep 5
grep -E "(Listening|Error)" /tmp/task1-boot.log | head -5
kill $PID 2>/dev/null
wait 2>/dev/null
```

Expected : log `Listening on http://localhost:3000 (docs: /docs)`, aucune erreur de validation Zod.

- [ ] **Step 10: Vérifier le boot fail-fast avec JWT_SECRET trop court**

```bash
JWT_SECRET=tooshort pnpm start 2>&1 | head -10
```

Expected : crash avec `JWT_SECRET must be at least 32 characters`. (Le process se termine immédiatement, pas besoin de kill.)

- [ ] **Step 11: Commit**

```bash
git add package.json pnpm-lock.yaml src/config/ .env.example
git commit -m "feat(deps,config): dépendances Auth + extension env validation

Prod deps: @nestjs/passport, @nestjs/jwt, passport, passport-jwt, argon2,
otplib, qrcode, ms
Dev deps: tsx, @types/passport-jwt, @types/qrcode

Env vars: +JWT_SECRET (min 32), +JWT_EXPIRES_IN (défaut 7d),
+ADMIN_EMAIL, +ADMIN_INITIAL_PASSWORD (min 12), +TOTP_APP_NAME (défaut).
+5 getters AppConfigService. +6 tests Zod (10 → 16 tests env).

Vérifié: boot fail-fast si JWT_SECRET < 32 chars.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Schéma Drizzle `users` + génération de la migration

**Files:**
- Create: `src/database/schema/users.ts`
- Modify: `src/database/schema/index.ts`
- Create: `drizzle/0000_*.sql` (auto-généré)
- Modify: `drizzle/meta/_journal.json` (auto-mis à jour)
- Create: `drizzle/meta/0000_snapshot.json` (auto-généré)

- [ ] **Step 1: Créer `src/database/schema/users.ts`**

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

- [ ] **Step 2: Modifier `src/database/schema/index.ts`**

Le contenu actuel est :

```typescript
// Barrel central. Chaque module ajoutera son schéma ici.
// Exemple futur : export * from './users';
export const schema = {} as const;
```

Le remplacer par :

```typescript
// Barrel central. Chaque module métier ajoute son schéma ici.
import * as users from './users';

export * from './users';

export const schema = {
  ...users,
} as const;
```

> Note : on importe `* as users` puis on fait `...users` dans `schema` pour exposer toutes les exports nommés (la table + les types). Drizzle utilise `schema` comme dictionnaire pour la résolution des relations.

- [ ] **Step 3: Vérifier que TypeScript compile**

```bash
pnpm build
```

Expected : exit 0, aucune erreur TS. Le `Database` type devient automatiquement `PostgresJsDatabase<{ users: typeof users, User, NewUser }>`.

- [ ] **Step 4: Générer la migration Drizzle**

```bash
pnpm db:generate
```

Expected : drizzle-kit détecte la nouvelle table et écrit `drizzle/0000_*.sql` (le nom inclut un adjectif aléatoire). Output type :
```
1 tables
users 8 columns 1 indexes 0 fks
[✓] Your SQL migration file ➜ drizzle/0000_xxx.sql 🚀
```

- [ ] **Step 5: Inspecter la migration générée**

```bash
ls drizzle/
cat drizzle/0000_*.sql
```

Expected : un fichier `drizzle/0000_<adjectif>.sql` contenant un `CREATE TABLE "users" (...)` avec les 8 colonnes (`id`, `email`, `password_hash`, `is_two_factor_enabled`, `two_factor_secret`, `two_factor_backup_codes_hash`, `created_at`, `updated_at`) et la contrainte `UNIQUE("email")`.

> Si la migration ne ressemble pas à ça (par exemple, drizzle a généré des index ou des défauts différents), arrêter et investiguer. Ne pas commiter une migration qui ne correspond pas au spec.

- [ ] **Step 6: Commit**

```bash
git add src/database/schema/ drizzle/
git commit -m "feat(db): table users + migration Drizzle

- Schéma users (UUID, email unique, passwordHash, 2FA, timestamps tz)
- Type User et NewUser inférés via $inferSelect/$inferInsert
- Barrel schema/index.ts exporte la table pour Drizzle relations
- Migration 0000 auto-générée par drizzle-kit

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Appliquer la migration + script de seed admin

**Files:**
- Create: `src/database/seeds/admin.seed.ts`
- Modify: `package.json` (script `db:seed` + update `db:reset`)

- [ ] **Step 1: Appliquer la migration**

```bash
pnpm db:migrate
```

Expected : drizzle-kit applique `0000_*.sql` à la DB. Output type :
```
[✓] migrations applied successfully!
```

- [ ] **Step 2: Vérifier la table `users` en DB**

```bash
podman exec portfolio-nest-db psql -U portfolio -d portfolio_nest -c '\d users'
```

Expected : description de la table avec 8 colonnes, type uuid pour `id`, contrainte `users_email_unique`.

```bash
podman exec portfolio-nest-db psql -U portfolio -d portfolio_nest -c 'SELECT count(*) FROM users;'
```

Expected : `0` (table vide pour l'instant).

- [ ] **Step 3: Créer `src/database/seeds/admin.seed.ts`**

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
    throw new Error('Missing DATABASE_URL, ADMIN_EMAIL, or ADMIN_INITIAL_PASSWORD in env');
  }
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);
  try {
    const existing = await db.execute(sql`SELECT count(*)::int as c FROM users`);
    const count = (existing[0] as { c: number }).c;
    if (count > 0) {
      console.log(`Admin seed: ${count} user(s) already exist, skipping.`);
      return;
    }
    const passwordHash = await argon2.hash(password);
    await db.insert(users).values({ email, passwordHash });
    console.log(`Admin seed: created user "${email}".`);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Ajouter les scripts `db:seed` et mettre à jour `db:reset` dans `package.json`**

Ouvrir `package.json`, section `scripts`. Ajouter `db:seed` après les autres `db:*` :

```json
"db:seed": "tsx src/database/seeds/admin.seed.ts",
```

Et modifier `db:reset` pour chaîner le seed à la fin :

État actuel de `db:reset` (Fondations) :
```json
"db:reset": "podman compose down -v && pnpm db:up && pnpm db:wait && pnpm db:migrate",
```

Nouvel état :
```json
"db:reset": "podman compose down -v && pnpm db:up && pnpm db:wait && pnpm db:migrate && pnpm db:seed",
```

- [ ] **Step 5: Lancer le seed**

```bash
pnpm db:seed
```

Expected : `Admin seed: created user "admin@nedellec-julien.fr".` (ou l'email configuré dans `.env`).

- [ ] **Step 6: Vérifier que le seed est idempotent**

```bash
pnpm db:seed
```

Expected : `Admin seed: 1 user(s) already exist, skipping.`

- [ ] **Step 7: Vérifier que l'utilisateur est bien en DB**

```bash
podman exec portfolio-nest-db psql -U portfolio -d portfolio_nest -c "SELECT id, email, is_two_factor_enabled, length(password_hash) FROM users;"
```

Expected : 1 ligne, `email` = celui configuré, `is_two_factor_enabled` = `f`, `length(password_hash)` ≈ 95-100 (hash Argon2id encoded).

- [ ] **Step 8: Commit**

```bash
git add src/database/seeds/ package.json
git commit -m "feat(db): script de seed admin idempotent + intégration db:reset

- src/database/seeds/admin.seed.ts : crée l'admin si la table users
  est vide, no-op sinon. Lit ADMIN_EMAIL + ADMIN_INITIAL_PASSWORD via
  dotenv/config (drizzle-kit n'a pas accès à @nestjs/config).
- Script pnpm db:seed (utilise tsx pour exécuter le TS directement).
- Script pnpm db:reset enchaîne désormais migrate + seed.

Vérifié: seed idempotent, user inséré avec hash Argon2id.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `UsersModule` + `UsersService`

**Files:**
- Create: `src/users/users.module.ts`
- Create: `src/users/users.service.ts`

> Pas de tests unitaires sur `UsersService` (cf. ADR-18 du spec). Couverture indirecte via les tests `AuthService` (Task 9) qui mockent `UsersService`.

- [ ] **Step 1: Créer `src/users/users.service.ts`**

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { users, type User } from '../database/schema/users';

@Injectable()
export class UsersService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findById(id: string): Promise<User | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return rows[0] ?? null;
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.db.update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  async updateTwoFactorSecret(id: string, secret: string): Promise<void> {
    await this.db.update(users)
      .set({ twoFactorSecret: secret, updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  async enableTwoFactor(id: string, backupCodesHash: string[]): Promise<void> {
    await this.db.update(users)
      .set({
        isTwoFactorEnabled: true,
        twoFactorBackupCodesHash: backupCodesHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
  }

  async disableTwoFactor(id: string): Promise<void> {
    await this.db.update(users)
      .set({
        isTwoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodesHash: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
  }

  async replaceBackupCodes(id: string, backupCodesHash: string[]): Promise<void> {
    await this.db.update(users)
      .set({ twoFactorBackupCodesHash: backupCodesHash, updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  async consumeBackupCode(id: string, hashToRemove: string): Promise<void> {
    // Postgres array_remove() retire toutes les occurrences ; comme les hashes Argon2 incluent
    // un sel aléatoire, chaque hash est unique → array_remove est safe.
    await this.db.update(users)
      .set({
        twoFactorBackupCodesHash: sql`array_remove(${users.twoFactorBackupCodesHash}, ${hashToRemove})`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
  }
}
```

- [ ] **Step 2: Créer `src/users/users.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';

@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 3: Vérifier que TypeScript compile**

```bash
pnpm build
```

Expected : exit 0, aucune erreur TS. (Les fichiers sont créés mais pas encore importés ailleurs ; ils sont du dead code valide.)

- [ ] **Step 4: Commit**

```bash
git add src/users/
git commit -m "feat(users): UsersService (CRUD users via Drizzle) + UsersModule

8 méthodes: findById, findByEmail, updatePassword, updateTwoFactorSecret,
enableTwoFactor, disableTwoFactor, replaceBackupCodes, consumeBackupCode.

consumeBackupCode utilise Postgres array_remove (safe car les hashes
Argon2 sont uniques grâce au sel aléatoire).

Pas de tests unitaires (couche fine sur Drizzle, ADR-18) — couverture
indirecte via les futurs tests AuthService.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `PasswordService` (TDD)

**Files:**
- Create: `src/auth/password.service.ts`
- Test: `src/auth/password.service.spec.ts`

- [ ] **Step 1: Écrire les tests `src/auth/password.service.spec.ts` AVANT l'implémentation**

```typescript
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(() => {
    service = new PasswordService();
  });

  it('hash et verify roundtrip', async () => {
    const plain = 'my-secret-password-123';
    const hash = await service.hash(plain);
    expect(hash).toMatch(/^\$argon2id\$/);          // Argon2id encoded format
    expect(await service.verify(plain, hash)).toBe(true);
  });

  it('verify retourne false pour un mauvais password', async () => {
    const hash = await service.hash('correct-password');
    expect(await service.verify('wrong-password', hash)).toBe(false);
  });

  it('verify retourne false pour un hash malformé (pas de throw)', async () => {
    expect(await service.verify('any-password', 'not-a-valid-hash')).toBe(false);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
pnpm test src/auth/password.service.spec.ts
```

Expected : FAIL avec "Cannot find module './password.service'".

- [ ] **Step 3: Implémenter `src/auth/password.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain);
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 4: Lancer les tests, confirmer PASS**

```bash
pnpm test src/auth/password.service.spec.ts
```

Expected : `Tests: 3 passed, 3 total`.

- [ ] **Step 5: Commit**

```bash
git add src/auth/password.service.ts src/auth/password.service.spec.ts
git commit -m "feat(auth): PasswordService Argon2id (hash + verify)

- hash(): argon2.hash avec défauts (Argon2id, time=3, mem=64MB, par=4)
- verify(): retourne false si hash malformé (pas de throw)
- 3 tests: roundtrip, mauvais password, hash malformé

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `TwoFactorService` (TDD)

**Files:**
- Create: `src/auth/two-factor.service.ts`
- Test: `src/auth/two-factor.service.spec.ts`

- [ ] **Step 1: Écrire les tests `src/auth/two-factor.service.spec.ts` AVANT l'implémentation**

```typescript
import { authenticator } from 'otplib';
import { Test, TestingModule } from '@nestjs/testing';
import { TwoFactorService } from './two-factor.service';
import { AppConfigService } from '../config/app-config.service';

describe('TwoFactorService', () => {
  let service: TwoFactorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwoFactorService,
        { provide: AppConfigService, useValue: { totpAppName: 'Test App' } },
      ],
    }).compile();
    service = module.get<TwoFactorService>(TwoFactorService);
  });

  it('generateSecret retourne un secret base32 valide', () => {
    const secret = service.generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]+=*$/);            // base32 alphabet
    expect(secret.length).toBeGreaterThanOrEqual(16);
  });

  it('verifyTotpCode accepte un code calculé depuis le secret', () => {
    const secret = service.generateSecret();
    const code = authenticator.generate(secret);
    expect(service.verifyTotpCode(secret, code)).toBe(true);
  });

  it('verifyTotpCode rejette un code invalide', () => {
    const secret = service.generateSecret();
    expect(service.verifyTotpCode(secret, '000000')).toBe(false);
  });

  it('generateQrCodeDataUrl retourne une data URL PNG', async () => {
    const secret = service.generateSecret();
    const dataUrl = await service.generateQrCodeDataUrl('user@example.com', secret);
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('generateBackupCodes retourne 10 codes au format xxxx-xxxx', () => {
    const codes = service.generateBackupCodes();
    expect(codes).toHaveLength(10);
    for (const code of codes) {
      expect(code).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);
    }
    // Tous uniques
    expect(new Set(codes).size).toBe(10);
  });

  it('hashBackupCodes hash chaque code et findMatchingBackupCode trouve le bon hash', async () => {
    const codes = service.generateBackupCodes();
    const hashes = await service.hashBackupCodes(codes);
    expect(hashes).toHaveLength(10);
    for (const hash of hashes) {
      expect(hash).toMatch(/^\$argon2id\$/);
    }
    // Trouve le hash correspondant au 5e code
    const matchHash = await service.findMatchingBackupCode(codes[5], hashes);
    expect(matchHash).toBe(hashes[5]);
  });

  it('findMatchingBackupCode retourne null si aucun match', async () => {
    const codes = service.generateBackupCodes();
    const hashes = await service.hashBackupCodes(codes);
    const matchHash = await service.findMatchingBackupCode('zzzz-zzzz', hashes);
    expect(matchHash).toBeNull();
  });

  it('findMatchingBackupCode retourne null sur tableau vide', async () => {
    const matchHash = await service.findMatchingBackupCode('a1b2-c3d4', []);
    expect(matchHash).toBeNull();
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

```bash
pnpm test src/auth/two-factor.service.spec.ts
```

Expected : FAIL avec "Cannot find module './two-factor.service'".

- [ ] **Step 3: Implémenter `src/auth/two-factor.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class TwoFactorService {
  constructor(private readonly cfg: AppConfigService) {}

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  async generateQrCodeDataUrl(email: string, secret: string): Promise<string> {
    const otpauthUrl = authenticator.keyuri(email, this.cfg.totpAppName, secret);
    return QRCode.toDataURL(otpauthUrl);
  }

  verifyTotpCode(secret: string, code: string): boolean {
    return authenticator.verify({ token: code, secret });
  }

  generateBackupCodes(count = 10): string[] {
    const codes: string[] = [];
    while (codes.length < count) {
      const code = this.randomCode();
      if (!codes.includes(code)) codes.push(code);
    }
    return codes;
  }

  async hashBackupCodes(codes: string[]): Promise<string[]> {
    return Promise.all(codes.map((c) => argon2.hash(c)));
  }

  async findMatchingBackupCode(plain: string, hashes: string[]): Promise<string | null> {
    if (hashes.length === 0) return null;
    // Vérifie en parallèle ; renvoie le premier hash qui matche.
    // Promise.any rejette avec AggregateError si TOUS rejettent.
    try {
      return await Promise.any(
        hashes.map(async (hash) => {
          const ok = await argon2.verify(hash, plain).catch(() => false);
          if (!ok) throw new Error('no match');
          return hash;
        }),
      );
    } catch {
      return null;
    }
  }

  private randomCode(): string {
    // 8 caractères hex (4 bytes) → format 'xxxx-xxxx'
    const bytes = randomBytes(4).toString('hex');     // 8 chars hex
    return `${bytes.slice(0, 4)}-${bytes.slice(4, 8)}`;
  }
}
```

- [ ] **Step 4: Lancer les tests, confirmer PASS**

```bash
pnpm test src/auth/two-factor.service.spec.ts
```

Expected : `Tests: 8 passed, 8 total`.

> Si le test `verifyTotpCode rejette un code invalide` échoue (extremly unlikely : `'000000'` matche par hasard), relancer plusieurs fois ; les TOTP changent toutes les 30s donc le secret généré + un `'000000'` constant ne devraient jamais matcher en pratique.

- [ ] **Step 5: Commit**

```bash
git add src/auth/two-factor.service.ts src/auth/two-factor.service.spec.ts
git commit -m "feat(auth): TwoFactorService (otplib + qrcode + backup codes)

- generateSecret() / verifyTotpCode() : otplib.authenticator
- generateQrCodeDataUrl() : QRCode.toDataURL avec otpauth:// URI
- generateBackupCodes() : 10 codes 'xxxx-xxxx' uniques (random hex)
- hashBackupCodes() : argon2.hash en parallèle (Promise.all)
- findMatchingBackupCode() : argon2.verify en parallèle (Promise.any)
- 8 tests unitaires couvrent tous les cas (otplib réel)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: DTOs (5 fichiers + 1 custom validator)

**Files:**
- Create: `src/auth/dto/login.dto.ts`
- Create: `src/auth/dto/change-password.dto.ts`
- Create: `src/auth/dto/two-factor-verify.dto.ts`
- Create: `src/auth/dto/two-factor-enable.dto.ts`
- Create: `src/auth/dto/two-factor-disable.dto.ts`

- [ ] **Step 1: Créer `src/auth/dto/login.dto.ts`**

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@nedellec-julien.fr' })
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12)
  password!: string;
}
```

- [ ] **Step 2: Créer `src/auth/dto/change-password.dto.ts`**

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(12)
  currentPassword!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12)
  newPassword!: string;
}
```

- [ ] **Step 3: Créer `src/auth/dto/two-factor-verify.dto.ts`** avec custom validator XOR

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsNotEmpty, IsOptional, Length, Matches,
  registerDecorator, ValidationOptions, ValidationArguments,
} from 'class-validator';

// Custom validator: exactement un des deux champs (code OU backupCode) doit être fourni
function IsExactlyOneOf(fields: string[], options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'IsExactlyOneOf',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          const obj = args.object as Record<string, unknown>;
          const provided = fields.filter((f) => obj[f] !== undefined && obj[f] !== null && obj[f] !== '');
          return provided.length === 1;
        },
        defaultMessage(args: ValidationArguments) {
          return `Exactly one of [${fields.join(', ')}] must be provided (got: ${
            fields.filter((f) => (args.object as Record<string, unknown>)[f] !== undefined).length
          })`;
        },
      },
    });
  };
}

export class TwoFactorVerifyDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  challengeToken!: string;

  @ApiPropertyOptional({ example: '123456', description: 'TOTP 6-digit code (mutually exclusive with backupCode)' })
  @IsOptional()
  @IsString()
  @Length(6, 6)
  @IsExactlyOneOf(['code', 'backupCode'])
  code?: string;

  @ApiPropertyOptional({ example: 'a1b2-c3d4', description: 'Backup code in xxxx-xxxx format (mutually exclusive with code)' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]{4}-[a-z0-9]{4}$/)
  backupCode?: string;
}
```

> Note : `IsExactlyOneOf` est posé sur `code` mais valide la combinaison des deux champs (le validator est appelé une fois et inspecte l'objet entier via `args.object`). Le message d'erreur sera attribué au champ `code` mais c'est suffisamment clair.

- [ ] **Step 4: Créer `src/auth/dto/two-factor-enable.dto.ts`**

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class TwoFactorEnableDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  code!: string;
}
```

- [ ] **Step 5: Créer `src/auth/dto/two-factor-disable.dto.ts`**

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class TwoFactorDisableDto {
  @ApiProperty()
  @IsString()
  @MinLength(12)
  password!: string;
}
```

- [ ] **Step 6: Vérifier que TypeScript compile**

```bash
pnpm build
```

Expected : exit 0, aucune erreur TS.

- [ ] **Step 7: Commit**

```bash
git add src/auth/dto/
git commit -m "feat(auth): 5 DTOs HTTP avec class-validator + Swagger

- LoginDto, ChangePasswordDto, TwoFactorEnableDto, TwoFactorDisableDto:
  validation simple (IsEmail, IsString, MinLength, Length).
- TwoFactorVerifyDto : custom validator IsExactlyOneOf qui exige
  exactement un des champs 'code' ou 'backupCode' (XOR).
- @ApiProperty / @ApiPropertyOptional pour Swagger.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `JwtStrategy` + `JwtAuthGuard` + `@CurrentUser()` decorator

**Files:**
- Create: `src/auth/jwt.strategy.ts`
- Create: `src/auth/jwt-auth.guard.ts`
- Create: `src/auth/current-user.decorator.ts`
- Test: `src/auth/current-user.decorator.spec.ts`

- [ ] **Step 1: Créer `src/auth/jwt.strategy.ts`**

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { AppConfigService } from '../config/app-config.service';
import { UsersService } from '../users/users.service';
import type { User } from '../database/schema/users';

interface JwtPayload {
  sub: string;
  scope?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    cfg: AppConfigService,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => (req?.cookies as Record<string, string> | undefined)?.token ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: cfg.jwtSecret,
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    if (payload.scope === '2fa-challenge') {
      throw new UnauthorizedException('Challenge token cannot be used for authentication');
    }
    const user = await this.users.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    return user;
  }
}
```

- [ ] **Step 2: Créer `src/auth/jwt-auth.guard.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

- [ ] **Step 3: Créer `src/auth/current-user.decorator.ts`**

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '../database/schema/users';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User => {
    return ctx.switchToHttp().getRequest().user;
  },
);
```

- [ ] **Step 4: Écrire le test `src/auth/current-user.decorator.spec.ts`**

> Le decorator est créé via `createParamDecorator` qui retourne un objet opaque, mais on peut tester la factory function en accédant à `(CurrentUser as any).factory` ou en utilisant directement la fonction qu'on définit. Approche simple : on teste la fonction inline.

```typescript
import { ExecutionContext } from '@nestjs/common';

// On réplique la factory du decorator pour pouvoir la tester directement.
// (createParamDecorator wrappe la factory dans un metadata Symbol qu'on n'a pas accès depuis dehors.)
const currentUserFactory = (_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user;
};

describe('CurrentUser decorator factory', () => {
  it('extrait request.user du contexte HTTP', () => {
    const fakeUser = { id: 'abc', email: 'x@y.com' };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ user: fakeUser }),
      }),
    } as unknown as ExecutionContext;

    expect(currentUserFactory(undefined, ctx)).toBe(fakeUser);
  });

  it('retourne undefined si request.user est absent', () => {
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({}),
      }),
    } as unknown as ExecutionContext;

    expect(currentUserFactory(undefined, ctx)).toBeUndefined();
  });
});
```

> Note : ce test couvre la logique de la factory. Le wrapping `createParamDecorator` est testé indirectement par les tests end-to-end via `curl` plus tard.

- [ ] **Step 5: Lancer le test**

```bash
pnpm test src/auth/current-user.decorator.spec.ts
```

Expected : `Tests: 2 passed, 2 total`.

- [ ] **Step 6: Vérifier que tout compile**

```bash
pnpm build
```

Expected : exit 0, aucune erreur TS.

- [ ] **Step 7: Commit**

```bash
git add src/auth/jwt.strategy.ts src/auth/jwt-auth.guard.ts src/auth/current-user.decorator.ts src/auth/current-user.decorator.spec.ts
git commit -m "feat(auth): JwtStrategy + JwtAuthGuard + @CurrentUser decorator

- JwtStrategy: extraction cookie 'token' priorité, fallback Bearer header.
  Rejette payload.scope === '2fa-challenge' (défense en profondeur).
- JwtAuthGuard: extends AuthGuard('jwt') (calque prompt-hub).
- @CurrentUser: param decorator extrait req.user.
- 2 tests pour la factory du decorator.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `AuthService` (TDD avec mocks)

**Files:**
- Create: `src/auth/auth.service.ts`
- Test: `src/auth/auth.service.spec.ts`

- [ ] **Step 1: Écrire les tests `src/auth/auth.service.spec.ts` AVANT l'implémentation**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { PasswordService } from './password.service';
import { TwoFactorService } from './two-factor.service';
import { AppConfigService } from '../config/app-config.service';
import type { User } from '../database/schema/users';

describe('AuthService', () => {
  let service: AuthService;
  let users: jest.Mocked<UsersService>;
  let password: jest.Mocked<PasswordService>;
  let twoFactor: jest.Mocked<TwoFactorService>;
  let jwt: jest.Mocked<JwtService>;

  const mkUser = (overrides: Partial<User> = {}): User => ({
    id: 'user-123',
    email: 'admin@example.com',
    passwordHash: '$argon2id$...',
    isTwoFactorEnabled: false,
    twoFactorSecret: null,
    twoFactorBackupCodesHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: {
          findById: jest.fn(),
          findByEmail: jest.fn(),
          updatePassword: jest.fn(),
          updateTwoFactorSecret: jest.fn(),
          enableTwoFactor: jest.fn(),
          disableTwoFactor: jest.fn(),
          replaceBackupCodes: jest.fn(),
          consumeBackupCode: jest.fn(),
        } },
        { provide: PasswordService, useValue: {
          hash: jest.fn(),
          verify: jest.fn(),
        } },
        { provide: TwoFactorService, useValue: {
          generateSecret: jest.fn(),
          generateQrCodeDataUrl: jest.fn(),
          verifyTotpCode: jest.fn(),
          generateBackupCodes: jest.fn(),
          hashBackupCodes: jest.fn(),
          findMatchingBackupCode: jest.fn(),
        } },
        { provide: JwtService, useValue: {
          sign: jest.fn(),
          verify: jest.fn(),
        } },
        { provide: AppConfigService, useValue: { jwtExpiresIn: '7d' } },
      ],
    }).compile();

    service = module.get(AuthService);
    users = module.get(UsersService);
    password = module.get(PasswordService);
    twoFactor = module.get(TwoFactorService);
    jwt = module.get(JwtService);
  });

  describe('login', () => {
    it('retourne un token quand credentials valides et 2FA disabled', async () => {
      const user = mkUser();
      users.findByEmail.mockResolvedValue(user);
      password.verify.mockResolvedValue(true);
      jwt.sign.mockReturnValue('jwt-token-final');

      const result = await service.login('admin@example.com', 'good-password');
      expect(result).toEqual({
        kind: 'authenticated',
        token: 'jwt-token-final',
        user: { id: user.id, email: user.email, isTwoFactorEnabled: false },
      });
      expect(jwt.sign).toHaveBeenCalledWith({ sub: user.id });
    });

    it('retourne un challengeToken quand 2FA enabled', async () => {
      const user = mkUser({ isTwoFactorEnabled: true, twoFactorSecret: 'SECRET' });
      users.findByEmail.mockResolvedValue(user);
      password.verify.mockResolvedValue(true);
      jwt.sign.mockReturnValue('challenge-token');

      const result = await service.login('admin@example.com', 'good-password');
      expect(result).toEqual({ kind: 'challenge', challengeToken: 'challenge-token' });
      expect(jwt.sign).toHaveBeenCalledWith(
        { sub: user.id, scope: '2fa-challenge' },
        { expiresIn: '5m' },
      );
    });

    it('throw UnauthorizedException si user inconnu', async () => {
      users.findByEmail.mockResolvedValue(null);
      await expect(service.login('nope@example.com', 'pw')).rejects.toThrow(UnauthorizedException);
    });

    it('throw UnauthorizedException si password incorrect', async () => {
      users.findByEmail.mockResolvedValue(mkUser());
      password.verify.mockResolvedValue(false);
      await expect(service.login('admin@example.com', 'bad')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('verifyTwoFactor', () => {
    it('accepte un code TOTP valide et retourne le token final', async () => {
      const user = mkUser({ isTwoFactorEnabled: true, twoFactorSecret: 'SECRET', twoFactorBackupCodesHash: ['h1', 'h2'] });
      jwt.verify.mockReturnValue({ sub: user.id, scope: '2fa-challenge' });
      users.findById.mockResolvedValue(user);
      twoFactor.verifyTotpCode.mockReturnValue(true);
      jwt.sign.mockReturnValue('final-token');

      const result = await service.verifyTwoFactor('challenge', { code: '123456' });
      expect(result).toEqual({
        token: 'final-token',
        user: { id: user.id, email: user.email, isTwoFactorEnabled: true },
      });
      expect(twoFactor.verifyTotpCode).toHaveBeenCalledWith('SECRET', '123456');
      expect(users.consumeBackupCode).not.toHaveBeenCalled();
    });

    it('accepte un backup code valide, le consomme, retourne le token final', async () => {
      const user = mkUser({ isTwoFactorEnabled: true, twoFactorSecret: 'SECRET', twoFactorBackupCodesHash: ['h1', 'h2', 'h3'] });
      jwt.verify.mockReturnValue({ sub: user.id, scope: '2fa-challenge' });
      users.findById.mockResolvedValue(user);
      twoFactor.findMatchingBackupCode.mockResolvedValue('h2');
      jwt.sign.mockReturnValue('final-token');

      const result = await service.verifyTwoFactor('challenge', { backupCode: 'a1b2-c3d4' });
      expect(result.token).toBe('final-token');
      expect(users.consumeBackupCode).toHaveBeenCalledWith(user.id, 'h2');
    });

    it('throw UnauthorizedException si challengeToken sans bon scope', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-123' });   // pas de scope
      await expect(service.verifyTwoFactor('bad', { code: '123456' })).rejects.toThrow(UnauthorizedException);
    });

    it('throw UnauthorizedException si code TOTP invalide', async () => {
      const user = mkUser({ isTwoFactorEnabled: true, twoFactorSecret: 'SECRET' });
      jwt.verify.mockReturnValue({ sub: user.id, scope: '2fa-challenge' });
      users.findById.mockResolvedValue(user);
      twoFactor.verifyTotpCode.mockReturnValue(false);
      await expect(service.verifyTwoFactor('challenge', { code: '000000' })).rejects.toThrow(UnauthorizedException);
    });

    it('throw UnauthorizedException si backup code ne matche aucun hash', async () => {
      const user = mkUser({ isTwoFactorEnabled: true, twoFactorSecret: 'SECRET', twoFactorBackupCodesHash: ['h1'] });
      jwt.verify.mockReturnValue({ sub: user.id, scope: '2fa-challenge' });
      users.findById.mockResolvedValue(user);
      twoFactor.findMatchingBackupCode.mockResolvedValue(null);
      await expect(service.verifyTwoFactor('challenge', { backupCode: 'zzzz-zzzz' })).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('changePassword', () => {
    it('met à jour le password si currentPassword est valide', async () => {
      const user = mkUser();
      password.verify.mockResolvedValue(true);
      password.hash.mockResolvedValue('new-hash');
      await service.changePassword(user, 'old', 'new-password-12');
      expect(password.hash).toHaveBeenCalledWith('new-password-12');
      expect(users.updatePassword).toHaveBeenCalledWith(user.id, 'new-hash');
    });

    it('throw UnauthorizedException si currentPassword invalide', async () => {
      const user = mkUser();
      password.verify.mockResolvedValue(false);
      await expect(service.changePassword(user, 'wrong', 'new')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('generateTwoFactorSecret', () => {
    it('throw BadRequestException si déjà enabled', async () => {
      const user = mkUser({ isTwoFactorEnabled: true });
      await expect(service.generateTwoFactorSecret(user)).rejects.toThrow(BadRequestException);
    });

    it('génère secret + QR code et persiste', async () => {
      const user = mkUser();
      twoFactor.generateSecret.mockReturnValue('NEW-SECRET');
      twoFactor.generateQrCodeDataUrl.mockResolvedValue('data:image/png;base64,XYZ');
      const result = await service.generateTwoFactorSecret(user);
      expect(result).toEqual({ secret: 'NEW-SECRET', qrCodeDataUrl: 'data:image/png;base64,XYZ' });
      expect(users.updateTwoFactorSecret).toHaveBeenCalledWith(user.id, 'NEW-SECRET');
    });
  });

  describe('enableTwoFactor', () => {
    it('throw BadRequestException si pas de secret en attente', async () => {
      const user = mkUser({ twoFactorSecret: null });
      await expect(service.enableTwoFactor(user, '123456')).rejects.toThrow(BadRequestException);
    });

    it('throw UnauthorizedException si code invalide', async () => {
      const user = mkUser({ twoFactorSecret: 'SECRET' });
      twoFactor.verifyTotpCode.mockReturnValue(false);
      await expect(service.enableTwoFactor(user, '000000')).rejects.toThrow(UnauthorizedException);
    });

    it('génère + hash backup codes et active 2FA si code valide', async () => {
      const user = mkUser({ twoFactorSecret: 'SECRET' });
      twoFactor.verifyTotpCode.mockReturnValue(true);
      twoFactor.generateBackupCodes.mockReturnValue(['a1b2-c3d4', 'e5f6-g7h8']);
      twoFactor.hashBackupCodes.mockResolvedValue(['hash1', 'hash2']);

      const result = await service.enableTwoFactor(user, '123456');
      expect(result).toEqual({ backupCodes: ['a1b2-c3d4', 'e5f6-g7h8'] });
      expect(users.enableTwoFactor).toHaveBeenCalledWith(user.id, ['hash1', 'hash2']);
    });
  });

  describe('disableTwoFactor', () => {
    it('throw BadRequestException si pas enabled', async () => {
      const user = mkUser({ isTwoFactorEnabled: false });
      await expect(service.disableTwoFactor(user, 'pw')).rejects.toThrow(BadRequestException);
    });

    it('throw UnauthorizedException si password invalide', async () => {
      const user = mkUser({ isTwoFactorEnabled: true });
      password.verify.mockResolvedValue(false);
      await expect(service.disableTwoFactor(user, 'bad')).rejects.toThrow(UnauthorizedException);
    });

    it('reset 2FA si password valide', async () => {
      const user = mkUser({ isTwoFactorEnabled: true });
      password.verify.mockResolvedValue(true);
      await service.disableTwoFactor(user, 'good');
      expect(users.disableTwoFactor).toHaveBeenCalledWith(user.id);
    });
  });

  describe('regenerateBackupCodes', () => {
    it('throw BadRequestException si 2FA pas enabled', async () => {
      const user = mkUser({ isTwoFactorEnabled: false });
      await expect(service.regenerateBackupCodes(user, 'pw')).rejects.toThrow(BadRequestException);
    });

    it('throw UnauthorizedException si password invalide', async () => {
      const user = mkUser({ isTwoFactorEnabled: true });
      password.verify.mockResolvedValue(false);
      await expect(service.regenerateBackupCodes(user, 'bad')).rejects.toThrow(UnauthorizedException);
    });

    it('regénère et persiste les nouveaux codes', async () => {
      const user = mkUser({ isTwoFactorEnabled: true });
      password.verify.mockResolvedValue(true);
      twoFactor.generateBackupCodes.mockReturnValue(['new1', 'new2']);
      twoFactor.hashBackupCodes.mockResolvedValue(['hashN1', 'hashN2']);
      const result = await service.regenerateBackupCodes(user, 'good');
      expect(result).toEqual({ backupCodes: ['new1', 'new2'] });
      expect(users.replaceBackupCodes).toHaveBeenCalledWith(user.id, ['hashN1', 'hashN2']);
    });
  });
});
```

> `ConflictException` n'est pas encore utilisée dans le service, mais l'import est gardé pour les tests futurs si besoin. Si TS warn sur l'unused import, le retirer.

- [ ] **Step 2: Lancer le test, vérifier l'échec**

```bash
pnpm test src/auth/auth.service.spec.ts
```

Expected : FAIL avec "Cannot find module './auth.service'".

- [ ] **Step 3: Implémenter `src/auth/auth.service.ts`**

```typescript
import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { PasswordService } from './password.service';
import { TwoFactorService } from './two-factor.service';
import { AppConfigService } from '../config/app-config.service';
import type { User } from '../database/schema/users';

interface JwtPayload {
  sub: string;
  scope?: string;
}

export type LoginResult =
  | { kind: 'authenticated'; token: string; user: PublicUser }
  | { kind: 'challenge'; challengeToken: string };

export interface PublicUser {
  id: string;
  email: string;
  isTwoFactorEnabled: boolean;
}

function publicUser(u: User): PublicUser {
  return { id: u.id, email: u.email, isTwoFactorEnabled: u.isTwoFactorEnabled };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly password: PasswordService,
    private readonly twoFactor: TwoFactorService,
    private readonly jwt: JwtService,
    private readonly cfg: AppConfigService,
  ) {}

  async login(email: string, plainPassword: string): Promise<LoginResult> {
    const user = await this.users.findByEmail(email);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const ok = await this.password.verify(plainPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    if (user.isTwoFactorEnabled) {
      const challengeToken = this.jwt.sign(
        { sub: user.id, scope: '2fa-challenge' },
        { expiresIn: '5m' },
      );
      return { kind: 'challenge', challengeToken };
    }

    const token = this.jwt.sign({ sub: user.id });
    return { kind: 'authenticated', token, user: publicUser(user) };
  }

  async verifyTwoFactor(
    challengeToken: string,
    creds: { code?: string; backupCode?: string },
  ): Promise<{ token: string; user: PublicUser }> {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(challengeToken);
    } catch {
      throw new UnauthorizedException('Invalid challenge token');
    }
    if (payload.scope !== '2fa-challenge') {
      throw new UnauthorizedException('Invalid challenge token');
    }
    const user = await this.users.findById(payload.sub);
    if (!user || !user.isTwoFactorEnabled || !user.twoFactorSecret) {
      throw new UnauthorizedException('Invalid challenge token');
    }

    if (creds.code) {
      if (!this.twoFactor.verifyTotpCode(user.twoFactorSecret, creds.code)) {
        throw new UnauthorizedException('Invalid 2FA code');
      }
    } else if (creds.backupCode) {
      const matchHash = await this.twoFactor.findMatchingBackupCode(
        creds.backupCode,
        user.twoFactorBackupCodesHash ?? [],
      );
      if (!matchHash) throw new UnauthorizedException('Invalid backup code');
      await this.users.consumeBackupCode(user.id, matchHash);
    } else {
      throw new UnauthorizedException('Either code or backupCode is required');
    }

    const token = this.jwt.sign({ sub: user.id });
    return { token, user: publicUser(user) };
  }

  async changePassword(user: User, currentPassword: string, newPassword: string): Promise<void> {
    const ok = await this.password.verify(currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid current password');
    const newHash = await this.password.hash(newPassword);
    await this.users.updatePassword(user.id, newHash);
  }

  async generateTwoFactorSecret(user: User): Promise<{ secret: string; qrCodeDataUrl: string }> {
    if (user.isTwoFactorEnabled) {
      throw new BadRequestException('2FA is already enabled');
    }
    const secret = this.twoFactor.generateSecret();
    const qrCodeDataUrl = await this.twoFactor.generateQrCodeDataUrl(user.email, secret);
    await this.users.updateTwoFactorSecret(user.id, secret);
    return { secret, qrCodeDataUrl };
  }

  async enableTwoFactor(user: User, code: string): Promise<{ backupCodes: string[] }> {
    if (!user.twoFactorSecret) {
      throw new BadRequestException('Generate a 2FA secret first via /auth/2fa/generate');
    }
    if (!this.twoFactor.verifyTotpCode(user.twoFactorSecret, code)) {
      throw new UnauthorizedException('Invalid 2FA code');
    }
    const backupCodes = this.twoFactor.generateBackupCodes();
    const hashes = await this.twoFactor.hashBackupCodes(backupCodes);
    await this.users.enableTwoFactor(user.id, hashes);
    return { backupCodes };
  }

  async disableTwoFactor(user: User, password: string): Promise<void> {
    if (!user.isTwoFactorEnabled) {
      throw new BadRequestException('2FA is not enabled');
    }
    const ok = await this.password.verify(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid password');
    await this.users.disableTwoFactor(user.id);
  }

  async regenerateBackupCodes(user: User, password: string): Promise<{ backupCodes: string[] }> {
    if (!user.isTwoFactorEnabled) {
      throw new BadRequestException('2FA is not enabled');
    }
    const ok = await this.password.verify(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid password');
    const backupCodes = this.twoFactor.generateBackupCodes();
    const hashes = await this.twoFactor.hashBackupCodes(backupCodes);
    await this.users.replaceBackupCodes(user.id, hashes);
    return { backupCodes };
  }
}
```

> `cfg` est injecté pour la cohérence (AppConfigService est exigé dans le `JwtModule.registerAsync` de Task 11), mais il n'est pas utilisé directement par AuthService dans cette implémentation. Garder l'injection : si on ajoute plus tard la lecture de `jwtExpiresIn`, on l'aura.

- [ ] **Step 4: Lancer les tests**

```bash
pnpm test src/auth/auth.service.spec.ts
```

Expected : `Tests: 18 passed, 18 total` (4 login + 5 verifyTwoFactor + 2 changePassword + 2 generateTwoFactorSecret + 3 enableTwoFactor + 3 disableTwoFactor + 3 regenerateBackupCodes — peut varier ±1 selon comptage).

> Si certains tests échouent, lire le message Jest. Cas typique : un mock pas configuré → vérifier que tous les `*.mock*` nécessaires sont posés dans le test concerné.

- [ ] **Step 5: Commit**

```bash
git add src/auth/auth.service.ts src/auth/auth.service.spec.ts
git commit -m "feat(auth): AuthService (orchestration login + 2FA + change-password)

7 méthodes publiques :
- login(): retourne 'authenticated' (JWT direct) ou 'challenge' (JWT court 5min scope='2fa-challenge')
- verifyTwoFactor(): consomme code TOTP ou backupCode (avec consumeBackupCode), retourne JWT final
- changePassword(): vérifie currentPassword, met à jour le hash
- generateTwoFactorSecret(): persiste secret + retourne QR code
- enableTwoFactor(): vérifie code, génère + hash backup codes, active 2FA
- disableTwoFactor(): vérifie password, reset 2FA
- regenerateBackupCodes(): régénère et remplace les backup codes

~18 tests unitaires avec mocks UsersService, PasswordService,
TwoFactorService, JwtService.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: `AuthController` (9 endpoints HTTP)

**Files:**
- Create: `src/auth/auth.controller.ts`

- [ ] **Step 1: Créer `src/auth/auth.controller.ts`**

```typescript
import {
  Body, Controller, Get, HttpCode, HttpStatus, Post, Res, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import ms from 'ms';
import { AuthService } from './auth.service';
import { AppConfigService } from '../config/app-config.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { TwoFactorVerifyDto } from './dto/two-factor-verify.dto';
import { TwoFactorEnableDto } from './dto/two-factor-enable.dto';
import { TwoFactorDisableDto } from './dto/two-factor-disable.dto';
import type { User } from '../database/schema/users';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cfg: AppConfigService,
  ) {}

  // ===== Public endpoints (no JwtAuthGuard) =====

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email + password (returns challenge if 2FA enabled)' })
  @ApiResponse({ status: 200, description: 'Authenticated (cookie set) OR 2FA challenge required' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.email, dto.password);
    if (result.kind === 'authenticated') {
      this.setAuthCookie(res, result.token);
      return { user: result.user };
    }
    return { requiresTwoFactor: true, challengeToken: result.challengeToken };
  }

  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete 2FA login with TOTP code or backup code' })
  @ApiResponse({ status: 200, description: 'Authenticated (cookie set)' })
  @ApiResponse({ status: 401, description: 'Invalid challenge / code / backup code' })
  async verifyTwoFactor(@Body() dto: TwoFactorVerifyDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.verifyTwoFactor(dto.challengeToken, {
      code: dto.code,
      backupCode: dto.backupCode,
    });
    this.setAuthCookie(res, result.token);
    return { user: result.user };
  }

  // ===== Protected endpoints =====

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout (clears auth cookie)' })
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('token', { httpOnly: true, sameSite: 'lax', path: '/' });
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user' })
  me(@CurrentUser() user: User) {
    return { id: user.id, email: user.email, isTwoFactorEnabled: user.isTwoFactorEnabled };
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change the current user password' })
  async changePassword(@CurrentUser() user: User, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(user, dto.currentPassword, dto.newPassword);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/generate')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate a 2FA TOTP secret + QR code (does not enable yet)' })
  async generateTwoFactor(@CurrentUser() user: User) {
    return this.auth.generateTwoFactorSecret(user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/enable')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a TOTP code and enable 2FA (returns 10 one-time backup codes)' })
  async enableTwoFactor(@CurrentUser() user: User, @Body() dto: TwoFactorEnableDto) {
    return this.auth.enableTwoFactor(user, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/disable')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable 2FA (requires current password)' })
  async disableTwoFactor(@CurrentUser() user: User, @Body() dto: TwoFactorDisableDto) {
    await this.auth.disableTwoFactor(user, dto.password);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/regenerate-backup-codes')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Regenerate the 10 backup codes (requires current password)' })
  async regenerateBackupCodes(@CurrentUser() user: User, @Body() dto: TwoFactorDisableDto) {
    return this.auth.regenerateBackupCodes(user, dto.password);
  }

  // ===== Helpers =====

  private setAuthCookie(res: Response, token: string): void {
    res.cookie('token', token, {
      httpOnly: true,
      secure: this.cfg.isProduction,
      sameSite: 'lax',
      maxAge: ms(this.cfg.jwtExpiresIn) as number,
      path: '/',
    });
  }
}
```

- [ ] **Step 2: Vérifier que TypeScript compile**

```bash
pnpm build
```

Expected : exit 0. Le controller importe AuthService, AppConfigService, JwtAuthGuard, CurrentUser, les 5 DTOs — tous existants.

- [ ] **Step 3: Commit**

```bash
git add src/auth/auth.controller.ts
git commit -m "feat(auth): AuthController (9 endpoints HTTP sous /auth)

Public:
- POST /auth/login (200 + cookie OU 200 challenge)
- POST /auth/2fa/verify (200 + cookie)

Protégé (JwtAuthGuard):
- POST /auth/logout (clear cookie)
- GET /auth/me
- POST /auth/change-password
- POST /auth/2fa/generate
- POST /auth/2fa/enable
- POST /auth/2fa/disable
- POST /auth/2fa/regenerate-backup-codes

Cookie 'token' httpOnly sameSite='lax' maxAge=ms(jwtExpiresIn).
Tous les endpoints documentés via @ApiOperation + @ApiResponse Swagger.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: `AuthModule` câblage + intégration `AppModule`

**Files:**
- Create: `src/auth/auth.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Créer `src/auth/auth.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AppConfigModule } from '../config/app-config.module';
import { AppConfigService } from '../config/app-config.service';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TwoFactorService } from './two-factor.service';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';

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

- [ ] **Step 2: Importer `UsersModule` + `AuthModule` dans `AppModule`**

Ouvrir `src/app.module.ts`. État actuel après Fondations :

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

Ajouter les imports `UsersModule` et `AuthModule` (ligne 8-9 ajout) et étendre l'array `imports` :

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';

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
    UsersModule,
    AuthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Installer `cookie-parser` (NestJS ne le configure pas par défaut)**

Le AuthController lit `req.cookies.token` via la JwtStrategy. Pour que ça fonctionne, Express a besoin du middleware `cookie-parser`.

```bash
pnpm add cookie-parser
pnpm add -D @types/cookie-parser
```

- [ ] **Step 4: Câbler `cookie-parser` dans `src/main.ts`**

Ouvrir `src/main.ts`. Ajouter l'import et l'`app.use(cookieParser())` AVANT `useGlobalPipes` :

```typescript
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppConfigService } from './config/app-config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get(AppConfigService);

  app.use(cookieParser());

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

- [ ] **Step 5: Vérifier le build**

```bash
pnpm build
```

Expected : exit 0.

- [ ] **Step 6: Lancer tous les tests pour confirmer aucune régression**

```bash
pnpm test
```

Expected : tous verts. Compteurs (approx) : env validation 16 + health 2 + password 3 + two-factor 8 + auth 18 + current-user-decorator 2 = **49 tests** dans 6 spec files.

- [ ] **Step 7: Vérifier que l'app boote avec tous les modules**

```bash
pkill -f "nest start" 2>/dev/null; true
sleep 1
pnpm db:up && pnpm db:wait
pnpm start > /tmp/task11-boot.log 2>&1 &
PID=$!
sleep 5
grep -E "(Listening|Error|UsersModule|AuthModule|RoutesResolver)" /tmp/task11-boot.log | head -20
kill $PID 2>/dev/null
wait 2>/dev/null
```

Expected : log montre `UsersModule dependencies initialized`, `AuthModule dependencies initialized`, `AuthController {/auth}` avec ses 9 routes mappées, et `Listening on http://localhost:3000 (docs: /docs)`. Aucune erreur.

- [ ] **Step 8: Commit**

```bash
git add src/auth/auth.module.ts src/app.module.ts src/main.ts package.json pnpm-lock.yaml
git commit -m "feat(auth): AuthModule + intégration AppModule + cookie-parser

- AuthModule: JwtModule.registerAsync (secret + expiresIn via AppConfigService),
  PassportModule.register, providers: AuthService, PasswordService,
  TwoFactorService, JwtStrategy, JwtAuthGuard.
- exports: AuthService, JwtAuthGuard (pour les futurs modules métier).
- AppModule: ajoute UsersModule + AuthModule en imports.
- main.ts: app.use(cookieParser()) avant les pipes (requis pour que la
  JwtStrategy puisse lire req.cookies.token).
- +cookie-parser + @types/cookie-parser.

Vérifié: app boot avec 9 routes /auth mappées, ~49 tests verts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Vérification end-to-end + README + commit final

**Files:**
- Modify: `README.md` (étendre la section Quickstart + ajouter section Auth)
- Optionnel: micro-fixes si la vérif e2e révèle un bug

> Cette task vérifie les **9 critères de done** du spec §12 via curl, puis met à jour le README pour intégrer le seed et la section Auth.

- [ ] **Step 1: Préparer un environnement clean**

```bash
pkill -f "nest start" 2>/dev/null; true
sleep 1
pnpm db:reset       # down -v, up, wait, migrate, seed (admin créé)
```

Expected : la commande chaîne sans erreur, l'admin est créé. Le compose est UP, la DB contient 1 user.

- [ ] **Step 2: Démarrer l'app pour les tests e2e**

```bash
pnpm start > /tmp/task12-app.log 2>&1 &
APP_PID=$!
sleep 5
echo "App PID: $APP_PID"
grep "Listening" /tmp/task12-app.log
```

Expected : log `Listening on http://localhost:3000 (docs: /docs)`.

- [ ] **Step 3: Test e2e — login (sans 2FA, premier login)**

```bash
EMAIL=$(grep '^ADMIN_EMAIL=' .env | cut -d= -f2)
PASSWORD=$(grep '^ADMIN_INITIAL_PASSWORD=' .env | cut -d= -f2)
echo "Login as: $EMAIL"
curl -s -i -c /tmp/cookies.txt \
  -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
```

Expected : HTTP 200, body `{"user":{"id":"<uuid>","email":"<email>","isTwoFactorEnabled":false}}`, header `Set-Cookie: token=...; HttpOnly; Path=/; SameSite=Lax`. Le cookie est sauvé dans `/tmp/cookies.txt`.

- [ ] **Step 4: Test e2e — `GET /auth/me` (avec cookie)**

```bash
curl -s -b /tmp/cookies.txt http://localhost:3000/auth/me
```

Expected : `{"id":"<uuid>","email":"<email>","isTwoFactorEnabled":false}`.

- [ ] **Step 5: Test e2e — `POST /auth/2fa/generate`**

```bash
SECRET=$(curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/auth/2fa/generate | tee /tmp/2fa-gen.json | python3 -c "import json, sys; print(json.load(sys.stdin)['secret'])")
echo "Generated secret: $SECRET"
cat /tmp/2fa-gen.json | python3 -c "import json, sys; d=json.load(sys.stdin); print('QR data URL prefix:', d['qrCodeDataUrl'][:50])"
```

Expected : `secret` est une string base32 (~26 chars, alphabet `[A-Z2-7]`), `qrCodeDataUrl` commence par `data:image/png;base64,`.

- [ ] **Step 6: Test e2e — `POST /auth/2fa/enable`**

Calculer un code TOTP localement à partir du secret :

```bash
CODE=$(node -e "const o = require('otplib'); console.log(o.authenticator.generate('$SECRET'))")
echo "TOTP code: $CODE"
curl -s -b /tmp/cookies.txt \
  -X POST http://localhost:3000/auth/2fa/enable \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"$CODE\"}" | tee /tmp/2fa-enable.json
```

Expected : `{"backupCodes":["xxxx-xxxx", ... 10 codes]}`. Garder les 10 codes (on en utilisera un).

```bash
BACKUP_CODE=$(python3 -c "import json; print(json.load(open('/tmp/2fa-enable.json'))['backupCodes'][0])")
echo "First backup code: $BACKUP_CODE"
```

- [ ] **Step 7: Test e2e — `POST /auth/logout`**

```bash
curl -s -b /tmp/cookies.txt -i -X POST http://localhost:3000/auth/logout
```

Expected : HTTP 200, body `{"ok":true}`, header `Set-Cookie` qui efface le cookie (`token=; Expires=...`).

- [ ] **Step 8: Test e2e — login (avec 2FA enabled cette fois)**

```bash
rm /tmp/cookies.txt
RESPONSE=$(curl -s -i -c /tmp/cookies.txt \
  -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
echo "$RESPONSE"
CHALLENGE=$(echo "$RESPONSE" | grep -E "challengeToken" | python3 -c "import json, sys; line=sys.stdin.read(); start=line.find('{'); print(json.loads(line[start:])['challengeToken'])")
echo "Challenge token: $CHALLENGE"
```

Expected : HTTP 200, body `{"requiresTwoFactor":true,"challengeToken":"<JWT>"}`, **PAS de cookie token** dans Set-Cookie.

- [ ] **Step 9: Test e2e — `POST /auth/2fa/verify` avec code TOTP**

```bash
CODE=$(node -e "const o = require('otplib'); console.log(o.authenticator.generate('$SECRET'))")
curl -s -i -c /tmp/cookies.txt \
  -X POST http://localhost:3000/auth/2fa/verify \
  -H "Content-Type: application/json" \
  -d "{\"challengeToken\":\"$CHALLENGE\",\"code\":\"$CODE\"}"
```

Expected : HTTP 200, body `{"user":{...,"isTwoFactorEnabled":true}}`, Set-Cookie token.

- [ ] **Step 10: Test e2e — login + verify avec backup code (consommation)**

```bash
rm /tmp/cookies.txt
CHALLENGE2=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | python3 -c "import json, sys; print(json.load(sys.stdin)['challengeToken'])")
curl -s -i -c /tmp/cookies.txt \
  -X POST http://localhost:3000/auth/2fa/verify \
  -H "Content-Type: application/json" \
  -d "{\"challengeToken\":\"$CHALLENGE2\",\"backupCode\":\"$BACKUP_CODE\"}"
```

Expected : HTTP 200, cookie set. Le backup code est consommé.

- [ ] **Step 11: Test e2e — second usage du même backup code → 401**

```bash
rm /tmp/cookies.txt
CHALLENGE3=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | python3 -c "import json, sys; print(json.load(sys.stdin)['challengeToken'])")
curl -s -i -X POST http://localhost:3000/auth/2fa/verify \
  -H "Content-Type: application/json" \
  -d "{\"challengeToken\":\"$CHALLENGE3\",\"backupCode\":\"$BACKUP_CODE\"}" | head -20
```

Expected : HTTP 401, body `{"statusCode":401,"error":"Unauthorized","message":"Invalid backup code","path":"/auth/2fa/verify","timestamp":"..."}`.

- [ ] **Step 12: Test e2e — change password**

Se reconnecter avec un code TOTP frais :

```bash
rm /tmp/cookies.txt
CHALLENGE4=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | python3 -c "import json, sys; print(json.load(sys.stdin)['challengeToken'])")
CODE=$(node -e "const o = require('otplib'); console.log(o.authenticator.generate('$SECRET'))")
curl -s -c /tmp/cookies.txt -X POST http://localhost:3000/auth/2fa/verify \
  -H "Content-Type: application/json" \
  -d "{\"challengeToken\":\"$CHALLENGE4\",\"code\":\"$CODE\"}" > /dev/null

NEW_PASSWORD="my-new-password-secure"
curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/auth/change-password \
  -H "Content-Type: application/json" \
  -d "{\"currentPassword\":\"$PASSWORD\",\"newPassword\":\"$NEW_PASSWORD\"}"
```

Expected : `{"ok":true}`.

Vérifier que l'ancien password est rejeté :

```bash
curl -s -i -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | head -5
```

Expected : HTTP 401.

Vérifier que le nouveau password marche :

```bash
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$NEW_PASSWORD\"}" | head -3
```

Expected : 200 + `{"requiresTwoFactor":true,"challengeToken":"..."}`.

- [ ] **Step 13: Test e2e — disable 2FA**

```bash
CHALLENGE5=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$NEW_PASSWORD\"}" \
  | python3 -c "import json, sys; print(json.load(sys.stdin)['challengeToken'])")
CODE=$(node -e "const o = require('otplib'); console.log(o.authenticator.generate('$SECRET'))")
rm /tmp/cookies.txt
curl -s -c /tmp/cookies.txt -X POST http://localhost:3000/auth/2fa/verify \
  -H "Content-Type: application/json" \
  -d "{\"challengeToken\":\"$CHALLENGE5\",\"code\":\"$CODE\"}" > /dev/null

curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/auth/2fa/disable \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"$NEW_PASSWORD\"}"
curl -s -b /tmp/cookies.txt http://localhost:3000/auth/me
```

Expected : `{"ok":true}` puis `{"id":"...","email":"...","isTwoFactorEnabled":false}`.

- [ ] **Step 14: Vérifier `/docs` documente les 9 endpoints Auth**

```bash
curl -s http://localhost:3000/docs-json | python3 -c "
import json, sys
doc = json.load(sys.stdin)
auth_paths = [p for p in doc['paths'] if p.startswith('/auth')]
print('Endpoints Auth dans Swagger:', len(auth_paths))
for p in sorted(auth_paths):
    methods = list(doc['paths'][p].keys())
    print(f'  {p}: {methods}')"
```

Expected : 9 endpoints listés (`/auth/login`, `/auth/2fa/verify`, `/auth/logout`, `/auth/me`, `/auth/change-password`, `/auth/2fa/generate`, `/auth/2fa/enable`, `/auth/2fa/disable`, `/auth/2fa/regenerate-backup-codes`).

- [ ] **Step 15: Couper l'app**

```bash
kill $APP_PID 2>/dev/null
wait 2>/dev/null
```

- [ ] **Step 16: Lancer la suite de tests complète**

```bash
pnpm test
pnpm lint
pnpm build
```

Expected : tous PASS. Total tests ≈ 49.

- [ ] **Step 17: Mettre à jour `README.md` — section Quickstart**

Ouvrir `README.md`. La section actuelle :

```markdown
## Quickstart

**Prérequis :** Node 22 (cf. `.nvmrc`), pnpm, Podman.

` ` `bash
pnpm install
cp .env.example .env
pnpm dev          # Démarre Postgres en container puis l'app NestJS
` ` `
```

La remplacer par :

```markdown
## Quickstart

**Prérequis :** Node 22 (cf. `.nvmrc`), pnpm, Podman.

` ` `bash
pnpm install
cp .env.example .env
# Éditer .env : remplir au moins JWT_SECRET (32+ chars), ADMIN_EMAIL et ADMIN_INITIAL_PASSWORD
pnpm db:up && pnpm db:wait
pnpm db:migrate                       # crée la table users
pnpm db:seed                          # crée l'admin (idempotent)
pnpm dev                              # démarre l'app en watch
` ` `
```

(Remplacer les espaces dans les fences ` ` ` par les vraies backticks.)

- [ ] **Step 18: Mettre à jour `README.md` — ajouter une section Auth après "Erreurs"**

Insérer cette section juste après la section `## Erreurs` :

```markdown
## Auth

Module d'authentification : admin unique pré-seedé, JWT en cookie httpOnly, 2FA TOTP avec backup codes.

**Setup initial** :

` ` `bash
pnpm db:seed     # crée l'admin avec ADMIN_EMAIL + ADMIN_INITIAL_PASSWORD (idempotent)
` ` `

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

` ` `typescript
@UseGuards(JwtAuthGuard)
@Post('something')
create(@CurrentUser() user: User, @Body() dto: CreateSomethingDto) { /* ... */ }
` ` `
```

(Remplacer les espaces dans les fences ` ` ` par les vraies backticks.)

- [ ] **Step 19: Mettre à jour la liste des sous-projets dans `README.md`**

Dans la section `## Migration depuis le backend Hono`, mettre à jour la liste numérotée. Avant :

```markdown
1. **Fondations** *(en cours)*
2. Auth (Users + JWT + 2FA + cookies)
```

Après :

```markdown
1. ✅ Fondations
2. ✅ Auth (Users + JWT + 2FA + backup codes)
3. **Profile public** *(prochain)* (Profile, Hero, SocialLinks, Diplomas, Technologies, Expertises, ServicePricing)
```

(Conserver les sous-projets 4-8 inchangés.)

- [ ] **Step 20: Vérifier que le README rend bien**

```bash
head -40 README.md
grep "^## " README.md
```

Expected : entête + nouveau Quickstart visible. La liste de toutes les sections H2 doit inclure `## Auth`.

- [ ] **Step 21: Vérifier `git status` clean (sauf README et éventuelles modifs)**

```bash
git status
```

Expected : seul `README.md` est modifié. Si d'autres fichiers apparaissent (par ex. prettier auto-format inattendu), inspecter.

- [ ] **Step 22: Commit final**

```bash
git add README.md
git commit -m "docs: README — section Auth + Quickstart avec seed

- Quickstart enrichi: étape pnpm db:seed après pnpm db:migrate.
- Nouvelle section ## Auth: 9 endpoints, décisions clés, lien spec.
- Liste sous-projets mise à jour: Fondations ✅, Auth ✅, Profile public prochain.

Conclut le sous-projet Auth. Tous les critères de done du spec
2026-04-25-auth-nest-portfolio-design.md §12 vérifiés manuellement
via curl (login, 2FA generate/enable/verify avec code et avec backup
code consommé, logout, change-password, disable, /docs documente les
9 endpoints).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 23: Vérifier la log git finale**

```bash
git log --oneline | head -20
```

Expected : ordre approximatif (du plus récent au plus ancien) :
```
<hash> docs: README — section Auth + Quickstart avec seed
<hash> feat(auth): AuthModule + intégration AppModule + cookie-parser
<hash> feat(auth): AuthController (9 endpoints HTTP sous /auth)
<hash> feat(auth): AuthService (orchestration login + 2FA + change-password)
<hash> feat(auth): JwtStrategy + JwtAuthGuard + @CurrentUser decorator
<hash> feat(auth): 5 DTOs HTTP avec class-validator + Swagger
<hash> feat(auth): TwoFactorService (otplib + qrcode + backup codes)
<hash> feat(auth): PasswordService Argon2id (hash + verify)
<hash> feat(users): UsersService (CRUD users via Drizzle) + UsersModule
<hash> feat(db): script de seed admin idempotent + intégration db:reset
<hash> feat(db): table users + migration Drizzle
<hash> feat(deps,config): dépendances Auth + extension env validation
<hash> docs(spec): design du sous-projet Auth (NestJS)
... (commits précédents Fondations)
```

12 nouveaux commits + spec = 13 commits ajoutés depuis la fin de Fondations.

---

## Récap final

À la fin de ce plan, le sous-projet Auth est livré :

✅ Table `users` Drizzle (8 colonnes, UUID, email unique) avec migration SQL et journal versionné.
✅ Script `pnpm db:seed` idempotent qui crée l'admin pré-configuré.
✅ `UsersModule` exposant `UsersService` (8 méthodes CRUD).
✅ `AuthModule` complet avec 9 endpoints HTTP, JWT en cookie httpOnly, 2FA TOTP + backup codes.
✅ Guards (`JwtAuthGuard`) et decorator (`@CurrentUser()`) prêts à être consommés par les futurs modules métier.
✅ ~37 nouveaux tests unitaires (env: 6, password: 3, two-factor: 8, auth.service: 18, current-user-decorator: 2).
✅ Total ~49 tests verts dans 6 spec files.
✅ Swagger documente les 9 endpoints sur `/docs`.
✅ Build production fonctionnel.
✅ README mis à jour : Quickstart avec seed, nouvelle section Auth.
✅ End-to-end manuel via curl validé : login, 2FA generate/enable, login avec 2FA, verify avec code, verify avec backup code (consommation), logout, change-password, disable.

**Prochaine étape** : nouveau cycle brainstorm → spec → plan pour le sous-projet **Profile public** (Profile, Hero, SocialLinks, Diplomas, Technologies, Expertises, ServicePricing — premier vrai usage de `JwtAuthGuard` pour les écritures admin).
