# Profile public — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter le sous-projet "Profile public" du backend NestJS (7 entités : Profile, Hero, SocialLinks, Diplomas, Technologies, Expertises, ServicePricing — 32 endpoints HTTP au total) selon le spec `2026-04-25-profile-public-design.md`.

**Architecture:** 7 modules NestJS flat dans `src/`, un par entité. Pattern : lecture publique (sans guard) + écriture protégée par `JwtAuthGuard` (déjà exporté par `AuthModule`). Schémas Drizzle dans `database/schema/` avec un barrel central. Helper de test `createMockDb()` dans `database/test-utils.ts`. Migration unique `0001` qui crée les 7 tables et seed les 2 singletons via INSERT manuel.

**Tech Stack:** NestJS 11, Drizzle ORM, PostgreSQL 17, `class-validator`, `@nestjs/swagger`, Jest. Réutilise `AuthModule` (`JwtAuthGuard`), `DatabaseModule` (`DRIZZLE` token), `AppConfigModule`.

**Référence spec :** `docs/superpowers/specs/2026-04-25-profile-public-design.md`

---

## File Structure

### Fichiers à créer

| Chemin | Rôle |
|---|---|
| `src/database/schema/profile.ts` | Table Drizzle `profile` (singleton, 8 colonnes) |
| `src/database/schema/hero.ts` | Table `hero` (singleton, 6 colonnes) |
| `src/database/schema/social-links.ts` | Table `social_link` (5 colonnes) |
| `src/database/schema/diplomas.ts` | Table `diploma` (6 colonnes incl. `skills text[]`) |
| `src/database/schema/technologies.ts` | Table `technology` (5 colonnes) |
| `src/database/schema/expertises.ts` | Table `expertise` + `pgEnum('offer','seek')` + index |
| `src/database/schema/service-pricing.ts` | Table `service_pricing` (10 colonnes incl. `features text[]`, `order int`) + index |
| `src/database/test-utils.ts` | Helper `createMockDb()` pour mocker DRIZZLE dans les tests |
| `drizzle/0001_*.sql` | Migration auto-générée puis éditée pour ajouter `INSERT INTO profile/hero DEFAULT VALUES` |
| `drizzle/meta/0001_snapshot.json` | Auto-généré |
| `src/profile/{profile.module,profile.controller,profile.service,profile.service.spec}.ts` + `dto/update-profile.dto.ts` | Singleton |
| `src/hero/{hero.module,hero.controller,hero.service,hero.service.spec}.ts` + `dto/update-hero.dto.ts` | Singleton |
| `src/social-links/{social-links.module,...,social-links.service.spec}.ts` + `dto/{create,update}-social-link.dto.ts` | Collection CRUD |
| `src/diplomas/{...}` + `dto/{create,update}-diploma.dto.ts` | Collection CRUD |
| `src/technologies/{...}` + `dto/{create,update}-technology.dto.ts` | Collection CRUD |
| `src/expertises/{...}` + `dto/{create,update}-expertise.dto.ts` | Collection avec discriminator |
| `src/service-pricing/{...}` + `dto/{create,update,reorder}-service-pricing.dto.ts` | Collection avec reorder |

### Fichiers à modifier

| Chemin | Modification |
|---|---|
| `src/database/schema/index.ts` | +7 `import * as` + `export * from` + spread dans `schema` const |
| `src/app.module.ts` | +7 imports modules métier dans `imports` array |
| `README.md` | +section "## Profile public" avec table récap des 32 endpoints |
| `drizzle/meta/_journal.json` | Auto-mis à jour par `drizzle-kit` |

---

## Task 1: Schémas Drizzle des 7 entités + barrel

**Files:**
- Create: `src/database/schema/profile.ts`, `hero.ts`, `social-links.ts`, `diplomas.ts`, `technologies.ts`, `expertises.ts`, `service-pricing.ts`
- Modify: `src/database/schema/index.ts`

- [ ] **Step 1: Créer `src/database/schema/profile.ts`**

```typescript
import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const profile = pgTable('profile', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  displayName: text('display_name').notNull().default(''),
  location: text('location').notNull().default(''),
  avatarUrl: text('avatar_url').notNull().default(''),
  isAvailable: boolean('is_available').notNull().default(true),
  availabilityMessage: text('availability_message').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Profile = typeof profile.$inferSelect;
export type NewProfile = typeof profile.$inferInsert;
```

- [ ] **Step 2: Créer `src/database/schema/hero.ts`**

```typescript
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const hero = pgTable('hero', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull().default(''),
  tagline: text('tagline').notNull().default(''),
  availability: text('availability').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Hero = typeof hero.$inferSelect;
export type NewHero = typeof hero.$inferInsert;
```

- [ ] **Step 3: Créer `src/database/schema/social-links.ts`**

```typescript
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const socialLinks = pgTable('social_link', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  icon: text('icon').notNull(),
  label: text('label').notNull(),
  href: text('href').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SocialLink = typeof socialLinks.$inferSelect;
export type NewSocialLink = typeof socialLinks.$inferInsert;
```

- [ ] **Step 4: Créer `src/database/schema/diplomas.ts`**

```typescript
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const diplomas = pgTable('diploma', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  title: text('title').notNull(),
  provider: text('provider').notNull(),
  shortDescription: text('short_description').notNull(),
  skills: text('skills').array().notNull().default(sql`ARRAY[]::text[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Diploma = typeof diplomas.$inferSelect;
export type NewDiploma = typeof diplomas.$inferInsert;
```

- [ ] **Step 5: Créer `src/database/schema/technologies.ts`**

```typescript
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const technologies = pgTable('technology', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  category: text('category').notNull(),
  icon: text('icon').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Technology = typeof technologies.$inferSelect;
export type NewTechnology = typeof technologies.$inferInsert;
```

- [ ] **Step 6: Créer `src/database/schema/expertises.ts`**

```typescript
import { pgTable, uuid, text, timestamp, index, pgEnum } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const expertiseTypeEnum = pgEnum('expertise_type', ['offer', 'seek']);

export const expertises = pgTable('expertise', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  type: expertiseTypeEnum('type').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  typeIdx: index('expertise_type_idx').on(t.type),
}));

export type Expertise = typeof expertises.$inferSelect;
export type NewExpertise = typeof expertises.$inferInsert;
export type ExpertiseType = (typeof expertiseTypeEnum.enumValues)[number];
```

- [ ] **Step 7: Créer `src/database/schema/service-pricing.ts`**

```typescript
import { pgTable, uuid, text, integer, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const servicePricing = pgTable('service_pricing', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  title: text('title').notNull(),
  description: text('description').notNull(),
  price: text('price').notNull(),
  features: text('features').array().notNull().default(sql`ARRAY[]::text[]`),
  highlighted: boolean('highlighted').notNull().default(false),
  enabled: boolean('enabled').notNull().default(true),
  order: integer('order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orderIdx: index('service_pricing_order_idx').on(t.order),
}));

export type ServicePricing = typeof servicePricing.$inferSelect;
export type NewServicePricing = typeof servicePricing.$inferInsert;
```

- [ ] **Step 8: Modifier `src/database/schema/index.ts`**

Ouvrir le fichier. État actuel (post-Auth) :

```typescript
// Barrel central. Chaque module métier ajoute son schéma ici.
import * as users from './users';

export * from './users';

export const schema = {
  ...users,
} as const;
```

Le remplacer par :

```typescript
// Barrel central. Chaque module métier ajoute son schéma ici.
import * as users from './users';
import * as profile from './profile';
import * as hero from './hero';
import * as socialLinks from './social-links';
import * as diplomas from './diplomas';
import * as technologies from './technologies';
import * as expertises from './expertises';
import * as servicePricing from './service-pricing';

export * from './users';
export * from './profile';
export * from './hero';
export * from './social-links';
export * from './diplomas';
export * from './technologies';
export * from './expertises';
export * from './service-pricing';

export const schema = {
  ...users,
  ...profile,
  ...hero,
  ...socialLinks,
  ...diplomas,
  ...technologies,
  ...expertises,
  ...servicePricing,
} as const;
```

- [ ] **Step 9: Vérifier que TypeScript compile**

```bash
pnpm build
```

Expected : exit 0. Le `Database` type devient automatiquement `PostgresJsDatabase<{ users, profile, hero, socialLinks, diplomas, technologies, expertises, servicePricing, ... + types }>`.

- [ ] **Step 10: Générer la migration Drizzle**

```bash
pnpm db:generate
```

Expected : drizzle-kit détecte les 7 nouvelles tables + 1 enum + 2 index, et écrit `drizzle/0001_*.sql`. Output type :
```
1 enum
7 tables
profile 8 columns 0 indexes 0 fks
hero 6 columns 0 indexes 0 fks
social_link 5 columns 0 indexes 0 fks
diploma 6 columns 0 indexes 0 fks
technology 5 columns 0 indexes 0 fks
expertise 4 columns 1 indexes 0 fks
service_pricing 9 columns 1 indexes 0 fks
[✓] Your SQL migration file ➜ drizzle/0001_xxx.sql
```

- [ ] **Step 11: Inspecter la migration générée**

```bash
ls drizzle/
cat drizzle/0001_*.sql
```

Expected : un fichier `drizzle/0001_<adjectif>.sql` contenant `CREATE TYPE "expertise_type" AS ENUM ('offer', 'seek');` puis 7 `CREATE TABLE` + 2 `CREATE INDEX`.

- [ ] **Step 12: Commit (PAS encore l'application en DB)**

```bash
git add src/database/schema/ drizzle/
git commit -m "feat(db): schémas Drizzle des 7 entités Profile public

7 tables: profile, hero, social_link, diploma, technology, expertise,
service_pricing.

- Singletons (profile, hero) : tous champs notNull default ''.
- Collections : champs notNull sans default (validation via DTOs).
- diploma.skills, service_pricing.features : text[] notNull default '{}'.
- expertise.type : pgEnum('offer', 'seek') + index sur le type.
- service_pricing.order : integer + index pour le tri ASC.

Migration 0001 auto-générée par drizzle-kit. Pas encore appliquée
ni éditée pour le seed singletons (Task 2).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Édition manuelle de la migration + application + vérification DB

**Files:**
- Modify: `drizzle/0001_*.sql` (édition manuelle pour ajouter INSERT singletons)

- [ ] **Step 1: Éditer manuellement la migration pour ajouter le seed des singletons**

Trouver le fichier (`ls drizzle/0001_*.sql` — nom avec un adjectif aléatoire). L'ouvrir et **ajouter à la fin** (après le dernier `CREATE INDEX` ou `CREATE TABLE`) :

```sql

-- Seed singletons (Profile + Hero)
INSERT INTO "profile" DEFAULT VALUES;
INSERT INTO "hero" DEFAULT VALUES;
```

> Note : `DEFAULT VALUES` insère une ligne avec uniquement les valeurs par défaut. Pour `profile` : id (UUID auto), display_name='', location='', avatar_url='', is_available=true, availability_message='', created_at/updated_at=now(). Pour `hero` : id (UUID), name='', tagline='', availability='', timestamps. Tous les champs ont des défauts explicites donc ça marche.

- [ ] **Step 2: Appliquer la migration**

```bash
pnpm db:migrate
```

Expected : drizzle-kit applique `0001_*.sql`. Output type :
```
[✓] migrations applied successfully!
```

- [ ] **Step 3: Vérifier les 7 tables en DB**

```bash
podman exec portfolio-nest-db psql -U portfolio -d portfolio_nest -c '\dt'
```

Expected : 8 tables listées (`users`, `profile`, `hero`, `social_link`, `diploma`, `technology`, `expertise`, `service_pricing`) plus la `__drizzle_migrations`.

- [ ] **Step 4: Vérifier les enums + index**

```bash
podman exec portfolio-nest-db psql -U portfolio -d portfolio_nest -c '\dT'
podman exec portfolio-nest-db psql -U portfolio -d portfolio_nest -c "\di expertise* service*"
```

Expected : `expertise_type` enum présent. Index `expertise_type_idx` et `service_pricing_order_idx` présents.

- [ ] **Step 5: Vérifier les singletons seedés**

```bash
podman exec portfolio-nest-db psql -U portfolio -d portfolio_nest -c "SELECT count(*) FROM profile; SELECT count(*) FROM hero; SELECT count(*) FROM social_link;"
```

Expected : `profile` count = 1, `hero` count = 1, `social_link` count = 0.

```bash
podman exec portfolio-nest-db psql -U portfolio -d portfolio_nest -c "SELECT id, display_name, location, is_available FROM profile;"
```

Expected : 1 ligne avec UUID, `display_name=''`, `location=''`, `is_available=t`.

- [ ] **Step 6: Commit (l'édition de la migration uniquement)**

```bash
git add drizzle/0001_*.sql
git commit -m "feat(db): seed Profile + Hero singletons via migration 0001

Édition manuelle de drizzle/0001_*.sql pour ajouter à la fin :
  INSERT INTO \"profile\" DEFAULT VALUES;
  INSERT INTO \"hero\" DEFAULT VALUES;

GET /profile et GET /hero retournent désormais 200 dès le boot
(plutôt que 404 jusqu'au premier PATCH). Pattern PATCH = simple
UPDATE (jamais d'INSERT à gérer dans le service).

Vérifié: 1 ligne dans profile et hero après pnpm db:migrate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Helper `createMockDb()` partagé dans `src/database/test-utils.ts`

**Files:**
- Create: `src/database/test-utils.ts`

> Pas de tests sur le helper (c'est lui-même un outil de test).

- [ ] **Step 1: Créer `src/database/test-utils.ts`**

```typescript
/**
 * Mock du builder Drizzle pour les tests unitaires des services.
 *
 * L'API Drizzle est fluent : db.select().from(table).where(...).limit(1).
 * Chaque méthode retourne un builder mockReturnThis pour permettre le chaînage.
 *
 * Le terminator (`returning`, ou un await direct sur la chaîne) doit être
 * configuré par chaque test : `db.returning.mockResolvedValueOnce([{...}])`.
 *
 * Pour les méthodes qui retournent directement un Promise<T[]> sans .returning()
 * (comme `db.select().from(t).where(...)` qui est awaitable), on utilise
 * `mockImplementation` pour simuler. En pratique, les services Drizzle
 * appellent toujours .returning() pour insert/update/delete et awaitent
 * directement pour select. Pour mocker le select, on peut faire
 * `db.where.mockResolvedValueOnce([...])` ou `db.limit.mockResolvedValueOnce([...])`.
 */
export function createMockDb() {
  const builder: Record<string, jest.Mock> = {
    select: jest.fn(),
    from: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    insert: jest.fn(),
    values: jest.fn(),
    update: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    returning: jest.fn(),
    transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(builder)),
    execute: jest.fn(),
  };
  // Chaque méthode retourne le builder lui-même pour permettre le chaînage.
  for (const key of Object.keys(builder)) {
    if (key !== 'transaction') {
      builder[key].mockReturnValue(builder);
    }
  }
  return builder;
}
```

- [ ] **Step 2: Vérifier que TypeScript compile**

```bash
pnpm build
```

Expected : exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/database/test-utils.ts
git commit -m "test(db): helper createMockDb() pour mocker l'API fluent Drizzle

Réutilisable par tous les services qui injectent DRIZZLE.
Chaque méthode (select, from, where, orderBy, limit, insert, values,
update, set, delete, returning) retourne le builder lui-même pour
permettre le chaînage. Les tests configurent les terminators par
mockResolvedValueOnce.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: ProfileModule (singleton, TDD)

**Files:**
- Create: `src/profile/profile.module.ts`, `profile.controller.ts`, `profile.service.ts`, `profile.service.spec.ts`
- Create: `src/profile/dto/update-profile.dto.ts`

- [ ] **Step 1: Créer `src/profile/dto/update-profile.dto.ts`**

```typescript
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional() @IsString() @MaxLength(200)
  displayName?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional() @IsString() @MaxLength(200)
  location?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500) @IsUrl({}, { message: 'avatarUrl must be a valid URL' })
  avatarUrl?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500)
  availabilityMessage?: string;
}
```

- [ ] **Step 2: Écrire le test `src/profile/profile.service.spec.ts` AVANT l'implémentation**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import type { Profile } from '../database/schema/profile';

describe('ProfileService', () => {
  let service: ProfileService;
  let db: ReturnType<typeof createMockDb>;

  const mkProfile = (overrides: Partial<Profile> = {}): Profile => ({
    id: 'profile-uuid',
    displayName: '',
    location: '',
    avatarUrl: '',
    isAvailable: true,
    availabilityMessage: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    db = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(ProfileService);
  });

  describe('findOne', () => {
    it('retourne le singleton quand il existe', async () => {
      const row = mkProfile({ displayName: 'Julien' });
      db.limit.mockResolvedValueOnce([row]);
      await expect(service.findOne()).resolves.toEqual(row);
    });

    it('throw InternalServerErrorException si singleton absent', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(service.findOne()).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('update', () => {
    it('met à jour les champs fournis et retourne la ligne', async () => {
      const existing = mkProfile();
      const updated = mkProfile({ displayName: 'Julien', location: 'Lyon' });
      // findOne d'abord (select.from.limit), puis update.set.where.returning
      db.limit.mockResolvedValueOnce([existing]);
      db.returning.mockResolvedValueOnce([updated]);
      const result = await service.update({ displayName: 'Julien', location: 'Lyon' });
      expect(result).toEqual(updated);
    });
  });
});
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

```bash
pnpm test src/profile/profile.service.spec.ts
```

Expected : FAIL avec "Cannot find module './profile.service'".

- [ ] **Step 4: Implémenter `src/profile/profile.service.ts`**

```typescript
import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { profile, type Profile } from '../database/schema/profile';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class ProfileService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findOne(): Promise<Profile> {
    const rows = await this.db.select().from(profile).limit(1);
    if (rows.length === 0) {
      throw new InternalServerErrorException('Profile singleton missing — did you run the migration?');
    }
    return rows[0];
  }

  async update(dto: UpdateProfileDto): Promise<Profile> {
    const existing = await this.findOne();
    const [updated] = await this.db
      .update(profile)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(profile.id, existing.id))
      .returning();
    return updated;
  }
}
```

- [ ] **Step 5: Lancer les tests, confirmer PASS**

```bash
pnpm test src/profile/profile.service.spec.ts
```

Expected : `Tests: 3 passed, 3 total`.

- [ ] **Step 6: Créer `src/profile/profile.controller.ts`**

```typescript
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@ApiTags('Profile')
@Controller('profile')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  @ApiOperation({ summary: 'Get the public profile (singleton)' })
  @ApiResponse({ status: 200, description: 'Profile' })
  findOne() {
    return this.profile.findOne();
  }

  @UseGuards(JwtAuthGuard)
  @Patch()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update the profile (admin)' })
  @ApiResponse({ status: 200, description: 'Profile updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  update(@Body() dto: UpdateProfileDto) {
    return this.profile.update(dto);
  }
}
```

- [ ] **Step 7: Créer `src/profile/profile.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [AuthModule],     // pour JwtAuthGuard
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
```

- [ ] **Step 8: Vérifier que tout compile**

```bash
pnpm build
```

Expected : exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/profile/
git commit -m "feat(profile): ProfileModule (singleton GET + PATCH)

- ProfileService.findOne() lit la ligne unique seedée (throw 500 si manquante)
- ProfileService.update() applique le partial et retourne la ligne
- Controller: GET /profile public, PATCH /profile protégé par JwtAuthGuard
- DTO UpdateProfileDto avec class-validator (IsUrl sur avatarUrl)
- 3 tests unitaires (mock DRIZZLE via createMockDb)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: HeroModule (singleton, TDD)

**Files:**
- Create: `src/hero/hero.module.ts`, `hero.controller.ts`, `hero.service.ts`, `hero.service.spec.ts`
- Create: `src/hero/dto/update-hero.dto.ts`

- [ ] **Step 1: Créer `src/hero/dto/update-hero.dto.ts`**

```typescript
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateHeroDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional() @IsString() @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional() @IsString() @MaxLength(200)
  tagline?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional() @IsString() @MaxLength(100)
  availability?: string;
}
```

- [ ] **Step 2: Écrire le test `src/hero/hero.service.spec.ts` AVANT l'implémentation**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { HeroService } from './hero.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import type { Hero } from '../database/schema/hero';

describe('HeroService', () => {
  let service: HeroService;
  let db: ReturnType<typeof createMockDb>;

  const mkHero = (overrides: Partial<Hero> = {}): Hero => ({
    id: 'hero-uuid',
    name: '',
    tagline: '',
    availability: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    db = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HeroService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(HeroService);
  });

  describe('findOne', () => {
    it('retourne le singleton', async () => {
      const row = mkHero({ name: 'Julien' });
      db.limit.mockResolvedValueOnce([row]);
      await expect(service.findOne()).resolves.toEqual(row);
    });

    it('throw InternalServerErrorException si absent', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(service.findOne()).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('update', () => {
    it('met à jour et retourne la ligne', async () => {
      const existing = mkHero();
      const updated = mkHero({ name: 'Julien', tagline: 'Dev fullstack' });
      db.limit.mockResolvedValueOnce([existing]);
      db.returning.mockResolvedValueOnce([updated]);
      const result = await service.update({ name: 'Julien', tagline: 'Dev fullstack' });
      expect(result).toEqual(updated);
    });
  });
});
```

- [ ] **Step 3: Lancer le test, vérifier l'échec**

```bash
pnpm test src/hero/hero.service.spec.ts
```

Expected : FAIL avec "Cannot find module './hero.service'".

- [ ] **Step 4: Implémenter `src/hero/hero.service.ts`**

```typescript
import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { hero, type Hero } from '../database/schema/hero';
import { UpdateHeroDto } from './dto/update-hero.dto';

@Injectable()
export class HeroService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findOne(): Promise<Hero> {
    const rows = await this.db.select().from(hero).limit(1);
    if (rows.length === 0) {
      throw new InternalServerErrorException('Hero singleton missing — did you run the migration?');
    }
    return rows[0];
  }

  async update(dto: UpdateHeroDto): Promise<Hero> {
    const existing = await this.findOne();
    const [updated] = await this.db
      .update(hero)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(hero.id, existing.id))
      .returning();
    return updated;
  }
}
```

- [ ] **Step 5: Lancer les tests, confirmer PASS**

```bash
pnpm test src/hero/hero.service.spec.ts
```

Expected : `Tests: 3 passed, 3 total`.

- [ ] **Step 6: Créer `src/hero/hero.controller.ts`**

```typescript
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { HeroService } from './hero.service';
import { UpdateHeroDto } from './dto/update-hero.dto';

@ApiTags('Hero')
@Controller('hero')
export class HeroController {
  constructor(private readonly hero: HeroService) {}

  @Get()
  @ApiOperation({ summary: 'Get the hero section (singleton)' })
  @ApiResponse({ status: 200, description: 'Hero' })
  findOne() {
    return this.hero.findOne();
  }

  @UseGuards(JwtAuthGuard)
  @Patch()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update the hero (admin)' })
  @ApiResponse({ status: 200, description: 'Hero updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  update(@Body() dto: UpdateHeroDto) {
    return this.hero.update(dto);
  }
}
```

- [ ] **Step 7: Créer `src/hero/hero.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HeroController } from './hero.controller';
import { HeroService } from './hero.service';

@Module({
  imports: [AuthModule],
  controllers: [HeroController],
  providers: [HeroService],
})
export class HeroModule {}
```

- [ ] **Step 8: Vérifier que tout compile**

```bash
pnpm build
```

- [ ] **Step 9: Commit**

```bash
git add src/hero/
git commit -m "feat(hero): HeroModule (singleton GET + PATCH)

- HeroService.findOne() / update() — pattern singleton identique à ProfileModule
- Controller: GET /hero public, PATCH /hero protégé par JwtAuthGuard
- DTO UpdateHeroDto (name, tagline, availability — tous optionnels)
- 3 tests unitaires (mock DRIZZLE via createMockDb)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: SocialLinksModule (collection CRUD, TDD)

**Files:**
- Create: `src/social-links/social-links.module.ts`, `social-links.controller.ts`, `social-links.service.ts`, `social-links.service.spec.ts`
- Create: `src/social-links/dto/create-social-link.dto.ts`, `update-social-link.dto.ts`

- [ ] **Step 1: Créer les DTOs**

`src/social-links/dto/create-social-link.dto.ts` :

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateSocialLinkDto {
  @ApiProperty({ maxLength: 50, example: 'github' })
  @IsString() @IsNotEmpty() @MaxLength(50)
  icon!: string;

  @ApiProperty({ maxLength: 100, example: 'GitHub' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  label!: string;

  @ApiProperty({ maxLength: 500, example: 'https://github.com/jned' })
  @IsString() @IsUrl() @MaxLength(500)
  href!: string;
}
```

`src/social-links/dto/update-social-link.dto.ts` :

```typescript
import { PartialType } from '@nestjs/swagger';
import { CreateSocialLinkDto } from './create-social-link.dto';

export class UpdateSocialLinkDto extends PartialType(CreateSocialLinkDto) {}
```

- [ ] **Step 2: Écrire le test `src/social-links/social-links.service.spec.ts` AVANT**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SocialLinksService } from './social-links.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import type { SocialLink } from '../database/schema/social-links';

describe('SocialLinksService', () => {
  let service: SocialLinksService;
  let db: ReturnType<typeof createMockDb>;

  const mkLink = (overrides: Partial<SocialLink> = {}): SocialLink => ({
    id: 'link-uuid',
    icon: 'github',
    label: 'GitHub',
    href: 'https://github.com/jned',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    db = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialLinksService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(SocialLinksService);
  });

  describe('findAll', () => {
    it('retourne tous les liens triés par createdAt ASC', async () => {
      const rows = [mkLink({ id: 'a' }), mkLink({ id: 'b' })];
      db.orderBy.mockResolvedValueOnce(rows);
      await expect(service.findAll()).resolves.toEqual(rows);
    });
  });

  describe('findById', () => {
    it('retourne le lien si présent', async () => {
      const row = mkLink();
      db.limit.mockResolvedValueOnce([row]);
      await expect(service.findById('link-uuid')).resolves.toEqual(row);
    });

    it('throw NotFoundException si absent', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(service.findById('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('insère et retourne la nouvelle ligne', async () => {
      const created = mkLink({ icon: 'linkedin', label: 'LinkedIn', href: 'https://linkedin.com/in/jned' });
      db.returning.mockResolvedValueOnce([created]);
      const result = await service.create({ icon: 'linkedin', label: 'LinkedIn', href: 'https://linkedin.com/in/jned' });
      expect(result).toEqual(created);
    });
  });

  describe('update', () => {
    it('met à jour et retourne la ligne', async () => {
      const updated = mkLink({ label: 'Mon GitHub' });
      db.returning.mockResolvedValueOnce([updated]);
      await expect(service.update('link-uuid', { label: 'Mon GitHub' })).resolves.toEqual(updated);
    });

    it('throw NotFoundException si id inconnu', async () => {
      db.returning.mockResolvedValueOnce([]);
      await expect(service.update('nope', { label: 'X' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('supprime sans erreur si la ligne existe', async () => {
      db.returning.mockResolvedValueOnce([{ id: 'link-uuid' }]);
      await expect(service.remove('link-uuid')).resolves.toBeUndefined();
    });

    it('throw NotFoundException si id inconnu', async () => {
      db.returning.mockResolvedValueOnce([]);
      await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 3: Lancer le test, vérifier l'échec**

```bash
pnpm test src/social-links/social-links.service.spec.ts
```

Expected : FAIL "Cannot find module './social-links.service'".

- [ ] **Step 4: Implémenter `src/social-links/social-links.service.ts`**

```typescript
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { socialLinks, type SocialLink } from '../database/schema/social-links';
import { CreateSocialLinkDto } from './dto/create-social-link.dto';
import { UpdateSocialLinkDto } from './dto/update-social-link.dto';

@Injectable()
export class SocialLinksService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findAll(): Promise<SocialLink[]> {
    return this.db.select().from(socialLinks).orderBy(asc(socialLinks.createdAt));
  }

  async findById(id: string): Promise<SocialLink> {
    const rows = await this.db.select().from(socialLinks).where(eq(socialLinks.id, id)).limit(1);
    if (rows.length === 0) throw new NotFoundException(`SocialLink ${id} not found`);
    return rows[0];
  }

  async create(dto: CreateSocialLinkDto): Promise<SocialLink> {
    const [row] = await this.db.insert(socialLinks).values(dto).returning();
    return row;
  }

  async update(id: string, dto: UpdateSocialLinkDto): Promise<SocialLink> {
    const [row] = await this.db
      .update(socialLinks)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(socialLinks.id, id))
      .returning();
    if (!row) throw new NotFoundException(`SocialLink ${id} not found`);
    return row;
  }

  async remove(id: string): Promise<void> {
    const rows = await this.db
      .delete(socialLinks)
      .where(eq(socialLinks.id, id))
      .returning({ id: socialLinks.id });
    if (rows.length === 0) throw new NotFoundException(`SocialLink ${id} not found`);
  }
}
```

- [ ] **Step 5: Lancer les tests, confirmer PASS**

```bash
pnpm test src/social-links/social-links.service.spec.ts
```

Expected : `Tests: 7 passed, 7 total`.

- [ ] **Step 6: Créer `src/social-links/social-links.controller.ts`**

```typescript
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SocialLinksService } from './social-links.service';
import { CreateSocialLinkDto } from './dto/create-social-link.dto';
import { UpdateSocialLinkDto } from './dto/update-social-link.dto';

@ApiTags('SocialLinks')
@Controller('social-links')
export class SocialLinksController {
  constructor(private readonly social: SocialLinksService) {}

  @Get()
  @ApiOperation({ summary: 'List all social links (public)' })
  findAll() {
    return this.social.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a social link by id (public)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.social.findById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a social link (admin)' })
  create(@Body() dto: CreateSocialLinkDto) {
    return this.social.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a social link (admin)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSocialLinkDto) {
    return this.social.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a social link (admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.social.remove(id);
  }
}
```

- [ ] **Step 7: Créer `src/social-links/social-links.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SocialLinksController } from './social-links.controller';
import { SocialLinksService } from './social-links.service';

@Module({
  imports: [AuthModule],
  controllers: [SocialLinksController],
  providers: [SocialLinksService],
})
export class SocialLinksModule {}
```

- [ ] **Step 8: Vérifier que tout compile**

```bash
pnpm build
```

- [ ] **Step 9: Commit**

```bash
git add src/social-links/
git commit -m "feat(social-links): SocialLinksModule (CRUD complet)

5 endpoints sous /social-links : GET (list public), GET :id (public),
POST (admin), PATCH :id (admin), DELETE :id (admin, 204).

- SocialLinksService: findAll (tri ASC), findById (404), create, update (404), remove (404)
- DTOs Create + Update (PartialType), avec @IsUrl sur href
- 7 tests unitaires (mock DRIZZLE)
- ParseUUIDPipe sur tous les :id

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: DiplomasModule (collection CRUD, TDD)

**Files:**
- Create: `src/diplomas/diplomas.module.ts`, `diplomas.controller.ts`, `diplomas.service.ts`, `diplomas.service.spec.ts`
- Create: `src/diplomas/dto/create-diploma.dto.ts`, `update-diploma.dto.ts`

- [ ] **Step 1: Créer les DTOs**

`src/diplomas/dto/create-diploma.dto.ts` :

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDiplomaDto {
  @ApiProperty({ maxLength: 200 })
  @IsString() @IsNotEmpty() @MaxLength(200)
  title!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString() @IsNotEmpty() @MaxLength(200)
  provider!: string;

  @ApiProperty({ maxLength: 1000 })
  @IsString() @IsNotEmpty() @MaxLength(1000)
  shortDescription!: string;

  @ApiPropertyOptional({ type: [String], example: ['TypeScript', 'NestJS'] })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(50, { each: true })
  skills?: string[];
}
```

`src/diplomas/dto/update-diploma.dto.ts` :

```typescript
import { PartialType } from '@nestjs/swagger';
import { CreateDiplomaDto } from './create-diploma.dto';

export class UpdateDiplomaDto extends PartialType(CreateDiplomaDto) {}
```

- [ ] **Step 2: Écrire le test `src/diplomas/diplomas.service.spec.ts` AVANT**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DiplomasService } from './diplomas.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import type { Diploma } from '../database/schema/diplomas';

describe('DiplomasService', () => {
  let service: DiplomasService;
  let db: ReturnType<typeof createMockDb>;

  const mkDiploma = (overrides: Partial<Diploma> = {}): Diploma => ({
    id: 'diploma-uuid',
    title: 'Master Info',
    provider: 'Univ Lyon',
    shortDescription: 'Master en informatique',
    skills: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    db = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiplomasService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(DiplomasService);
  });

  describe('findAll', () => {
    it('retourne tous les diplômes triés par createdAt ASC', async () => {
      const rows = [mkDiploma({ id: 'a' }), mkDiploma({ id: 'b' })];
      db.orderBy.mockResolvedValueOnce(rows);
      await expect(service.findAll()).resolves.toEqual(rows);
    });
  });

  describe('findById', () => {
    it('retourne le diplôme', async () => {
      const row = mkDiploma();
      db.limit.mockResolvedValueOnce([row]);
      await expect(service.findById('diploma-uuid')).resolves.toEqual(row);
    });

    it('throw NotFoundException si absent', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(service.findById('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('insère avec skills array roundtrip', async () => {
      const created = mkDiploma({ skills: ['TypeScript', 'NestJS'] });
      db.returning.mockResolvedValueOnce([created]);
      const result = await service.create({
        title: 'Master Info',
        provider: 'Univ Lyon',
        shortDescription: 'Master en informatique',
        skills: ['TypeScript', 'NestJS'],
      });
      expect(result.skills).toEqual(['TypeScript', 'NestJS']);
    });

    it('insère sans skills (default)', async () => {
      const created = mkDiploma({ skills: [] });
      db.returning.mockResolvedValueOnce([created]);
      const result = await service.create({
        title: 'Master Info',
        provider: 'Univ Lyon',
        shortDescription: 'Master en informatique',
      });
      expect(result.skills).toEqual([]);
    });
  });

  describe('update', () => {
    it('met à jour les skills', async () => {
      const updated = mkDiploma({ skills: ['Drizzle'] });
      db.returning.mockResolvedValueOnce([updated]);
      await expect(service.update('diploma-uuid', { skills: ['Drizzle'] })).resolves.toEqual(updated);
    });

    it('throw NotFoundException si id inconnu', async () => {
      db.returning.mockResolvedValueOnce([]);
      await expect(service.update('nope', { title: 'X' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('supprime sans erreur', async () => {
      db.returning.mockResolvedValueOnce([{ id: 'diploma-uuid' }]);
      await expect(service.remove('diploma-uuid')).resolves.toBeUndefined();
    });

    it('throw NotFoundException si id inconnu', async () => {
      db.returning.mockResolvedValueOnce([]);
      await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 3: Lancer le test, vérifier l'échec**

```bash
pnpm test src/diplomas/diplomas.service.spec.ts
```

Expected : FAIL.

- [ ] **Step 4: Implémenter `src/diplomas/diplomas.service.ts`**

```typescript
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { diplomas, type Diploma } from '../database/schema/diplomas';
import { CreateDiplomaDto } from './dto/create-diploma.dto';
import { UpdateDiplomaDto } from './dto/update-diploma.dto';

@Injectable()
export class DiplomasService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findAll(): Promise<Diploma[]> {
    return this.db.select().from(diplomas).orderBy(asc(diplomas.createdAt));
  }

  async findById(id: string): Promise<Diploma> {
    const rows = await this.db.select().from(diplomas).where(eq(diplomas.id, id)).limit(1);
    if (rows.length === 0) throw new NotFoundException(`Diploma ${id} not found`);
    return rows[0];
  }

  async create(dto: CreateDiplomaDto): Promise<Diploma> {
    const [row] = await this.db.insert(diplomas).values(dto).returning();
    return row;
  }

  async update(id: string, dto: UpdateDiplomaDto): Promise<Diploma> {
    const [row] = await this.db
      .update(diplomas)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(diplomas.id, id))
      .returning();
    if (!row) throw new NotFoundException(`Diploma ${id} not found`);
    return row;
  }

  async remove(id: string): Promise<void> {
    const rows = await this.db
      .delete(diplomas)
      .where(eq(diplomas.id, id))
      .returning({ id: diplomas.id });
    if (rows.length === 0) throw new NotFoundException(`Diploma ${id} not found`);
  }
}
```

- [ ] **Step 5: Lancer les tests, confirmer PASS**

```bash
pnpm test src/diplomas/diplomas.service.spec.ts
```

Expected : `Tests: 8 passed, 8 total`.

- [ ] **Step 6: Créer `src/diplomas/diplomas.controller.ts`**

```typescript
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DiplomasService } from './diplomas.service';
import { CreateDiplomaDto } from './dto/create-diploma.dto';
import { UpdateDiplomaDto } from './dto/update-diploma.dto';

@ApiTags('Diplomas')
@Controller('diplomas')
export class DiplomasController {
  constructor(private readonly diplomas: DiplomasService) {}

  @Get()
  @ApiOperation({ summary: 'List all diplomas (public)' })
  findAll() {
    return this.diplomas.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a diploma by id (public)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.diplomas.findById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a diploma (admin)' })
  create(@Body() dto: CreateDiplomaDto) {
    return this.diplomas.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a diploma (admin)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDiplomaDto) {
    return this.diplomas.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a diploma (admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.diplomas.remove(id);
  }
}
```

- [ ] **Step 7: Créer `src/diplomas/diplomas.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DiplomasController } from './diplomas.controller';
import { DiplomasService } from './diplomas.service';

@Module({
  imports: [AuthModule],
  controllers: [DiplomasController],
  providers: [DiplomasService],
})
export class DiplomasModule {}
```

- [ ] **Step 8: Vérifier que tout compile**

```bash
pnpm build
```

- [ ] **Step 9: Commit**

```bash
git add src/diplomas/
git commit -m "feat(diplomas): DiplomasModule (CRUD complet)

5 endpoints sous /diplomas : GET (list public), GET :id (public),
POST (admin), PATCH :id (admin), DELETE :id (admin, 204).

- DiplomasService: même pattern que SocialLinks
- DTO Create avec skills?: string[] (ArrayMaxSize 20, chacun MaxLength 50)
- 8 tests unitaires (incluant skills array roundtrip)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: TechnologiesModule (collection CRUD, TDD)

**Files:**
- Create: `src/technologies/technologies.module.ts`, `technologies.controller.ts`, `technologies.service.ts`, `technologies.service.spec.ts`
- Create: `src/technologies/dto/create-technology.dto.ts`, `update-technology.dto.ts`

- [ ] **Step 1: Créer les DTOs**

`src/technologies/dto/create-technology.dto.ts` :

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateTechnologyDto {
  @ApiProperty({ maxLength: 100, example: 'TypeScript' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  name!: string;

  @ApiProperty({ maxLength: 50, example: 'language' })
  @IsString() @IsNotEmpty() @MaxLength(50)
  category!: string;

  @ApiProperty({ maxLength: 100, example: 'devicon-typescript-plain' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  icon!: string;
}
```

`src/technologies/dto/update-technology.dto.ts` :

```typescript
import { PartialType } from '@nestjs/swagger';
import { CreateTechnologyDto } from './create-technology.dto';

export class UpdateTechnologyDto extends PartialType(CreateTechnologyDto) {}
```

- [ ] **Step 2: Écrire le test `src/technologies/technologies.service.spec.ts` AVANT**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TechnologiesService } from './technologies.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import type { Technology } from '../database/schema/technologies';

describe('TechnologiesService', () => {
  let service: TechnologiesService;
  let db: ReturnType<typeof createMockDb>;

  const mkTech = (overrides: Partial<Technology> = {}): Technology => ({
    id: 'tech-uuid',
    name: 'TypeScript',
    category: 'language',
    icon: 'devicon-typescript-plain',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    db = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TechnologiesService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(TechnologiesService);
  });

  it('findAll retourne toutes les techs triées par createdAt ASC', async () => {
    const rows = [mkTech({ id: 'a' }), mkTech({ id: 'b' })];
    db.orderBy.mockResolvedValueOnce(rows);
    await expect(service.findAll()).resolves.toEqual(rows);
  });

  it('findById retourne la tech', async () => {
    const row = mkTech();
    db.limit.mockResolvedValueOnce([row]);
    await expect(service.findById('tech-uuid')).resolves.toEqual(row);
  });

  it('findById throw NotFoundException si absent', async () => {
    db.limit.mockResolvedValueOnce([]);
    await expect(service.findById('nope')).rejects.toThrow(NotFoundException);
  });

  it('create insère et retourne', async () => {
    const created = mkTech();
    db.returning.mockResolvedValueOnce([created]);
    const result = await service.create({ name: 'TypeScript', category: 'language', icon: 'devicon-typescript-plain' });
    expect(result).toEqual(created);
  });

  it('update met à jour ou throw 404', async () => {
    const updated = mkTech({ name: 'TS' });
    db.returning.mockResolvedValueOnce([updated]);
    await expect(service.update('tech-uuid', { name: 'TS' })).resolves.toEqual(updated);

    db.returning.mockResolvedValueOnce([]);
    await expect(service.update('nope', { name: 'X' })).rejects.toThrow(NotFoundException);
  });

  it('remove supprime ou throw 404', async () => {
    db.returning.mockResolvedValueOnce([{ id: 'tech-uuid' }]);
    await expect(service.remove('tech-uuid')).resolves.toBeUndefined();

    db.returning.mockResolvedValueOnce([]);
    await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 3: Lancer le test, vérifier l'échec**

```bash
pnpm test src/technologies/technologies.service.spec.ts
```

Expected : FAIL.

- [ ] **Step 4: Implémenter `src/technologies/technologies.service.ts`**

```typescript
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { technologies, type Technology } from '../database/schema/technologies';
import { CreateTechnologyDto } from './dto/create-technology.dto';
import { UpdateTechnologyDto } from './dto/update-technology.dto';

@Injectable()
export class TechnologiesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findAll(): Promise<Technology[]> {
    return this.db.select().from(technologies).orderBy(asc(technologies.createdAt));
  }

  async findById(id: string): Promise<Technology> {
    const rows = await this.db.select().from(technologies).where(eq(technologies.id, id)).limit(1);
    if (rows.length === 0) throw new NotFoundException(`Technology ${id} not found`);
    return rows[0];
  }

  async create(dto: CreateTechnologyDto): Promise<Technology> {
    const [row] = await this.db.insert(technologies).values(dto).returning();
    return row;
  }

  async update(id: string, dto: UpdateTechnologyDto): Promise<Technology> {
    const [row] = await this.db
      .update(technologies)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(technologies.id, id))
      .returning();
    if (!row) throw new NotFoundException(`Technology ${id} not found`);
    return row;
  }

  async remove(id: string): Promise<void> {
    const rows = await this.db
      .delete(technologies)
      .where(eq(technologies.id, id))
      .returning({ id: technologies.id });
    if (rows.length === 0) throw new NotFoundException(`Technology ${id} not found`);
  }
}
```

- [ ] **Step 5: Lancer les tests, confirmer PASS**

```bash
pnpm test src/technologies/technologies.service.spec.ts
```

Expected : `Tests: 6 passed, 6 total`.

- [ ] **Step 6: Créer `src/technologies/technologies.controller.ts`**

```typescript
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TechnologiesService } from './technologies.service';
import { CreateTechnologyDto } from './dto/create-technology.dto';
import { UpdateTechnologyDto } from './dto/update-technology.dto';

@ApiTags('Technologies')
@Controller('technologies')
export class TechnologiesController {
  constructor(private readonly technologies: TechnologiesService) {}

  @Get()
  @ApiOperation({ summary: 'List all technologies (public)' })
  findAll() {
    return this.technologies.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a technology by id (public)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.technologies.findById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a technology (admin)' })
  create(@Body() dto: CreateTechnologyDto) {
    return this.technologies.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a technology (admin)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTechnologyDto) {
    return this.technologies.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a technology (admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.technologies.remove(id);
  }
}
```

- [ ] **Step 7: Créer `src/technologies/technologies.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TechnologiesController } from './technologies.controller';
import { TechnologiesService } from './technologies.service';

@Module({
  imports: [AuthModule],
  controllers: [TechnologiesController],
  providers: [TechnologiesService],
})
export class TechnologiesModule {}
```

- [ ] **Step 8: Vérifier que tout compile**

```bash
pnpm build
```

- [ ] **Step 9: Commit**

```bash
git add src/technologies/
git commit -m "feat(technologies): TechnologiesModule (CRUD complet)

5 endpoints sous /technologies : pattern identique à
SocialLinks/Diplomas. DTO avec name, category, icon.
6 tests unitaires.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: ExpertisesModule (collection avec discriminator, TDD)

**Files:**
- Create: `src/expertises/expertises.module.ts`, `expertises.controller.ts`, `expertises.service.ts`, `expertises.service.spec.ts`
- Create: `src/expertises/dto/create-expertise.dto.ts`, `update-expertise.dto.ts`

- [ ] **Step 1: Créer les DTOs**

`src/expertises/dto/create-expertise.dto.ts` :

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateExpertiseDto {
  @ApiProperty({ maxLength: 200 })
  @IsString() @IsNotEmpty() @MaxLength(200)
  title!: string;

  @ApiProperty({ maxLength: 1000 })
  @IsString() @IsNotEmpty() @MaxLength(1000)
  description!: string;
}
```

`src/expertises/dto/update-expertise.dto.ts` :

```typescript
import { PartialType } from '@nestjs/swagger';
import { CreateExpertiseDto } from './create-expertise.dto';

export class UpdateExpertiseDto extends PartialType(CreateExpertiseDto) {}
```

> Pas de champ `type` dans les DTOs : injecté par le controller selon le path utilisé.

- [ ] **Step 2: Écrire le test `src/expertises/expertises.service.spec.ts` AVANT**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ExpertisesService } from './expertises.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import type { Expertise } from '../database/schema/expertises';

describe('ExpertisesService', () => {
  let service: ExpertisesService;
  let db: ReturnType<typeof createMockDb>;

  const mkExpertise = (overrides: Partial<Expertise> = {}): Expertise => ({
    id: 'exp-uuid',
    type: 'offer',
    title: 'Architecture',
    description: 'Conception d\'architectures backend',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    db = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpertisesService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(ExpertisesService);
  });

  it('findOffers retourne uniquement les offers triées par createdAt ASC', async () => {
    const rows = [mkExpertise({ id: 'a', type: 'offer' })];
    db.orderBy.mockResolvedValueOnce(rows);
    await expect(service.findOffers()).resolves.toEqual(rows);
  });

  it('findSeeks retourne uniquement les seeks triées par createdAt ASC', async () => {
    const rows = [mkExpertise({ id: 'b', type: 'seek' })];
    db.orderBy.mockResolvedValueOnce(rows);
    await expect(service.findSeeks()).resolves.toEqual(rows);
  });

  it('findById retourne le détail incluant le type', async () => {
    const row = mkExpertise({ type: 'seek' });
    db.limit.mockResolvedValueOnce([row]);
    await expect(service.findById('exp-uuid')).resolves.toEqual(row);
  });

  it('findById throw NotFoundException si absent', async () => {
    db.limit.mockResolvedValueOnce([]);
    await expect(service.findById('nope')).rejects.toThrow(NotFoundException);
  });

  it('create injecte type=offer si createOffer', async () => {
    const created = mkExpertise({ type: 'offer' });
    db.returning.mockResolvedValueOnce([created]);
    const result = await service.create('offer', { title: 'X', description: 'Y' });
    expect(result.type).toBe('offer');
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ type: 'offer' }));
  });

  it('create injecte type=seek si createSeek', async () => {
    const created = mkExpertise({ type: 'seek' });
    db.returning.mockResolvedValueOnce([created]);
    const result = await service.create('seek', { title: 'X', description: 'Y' });
    expect(result.type).toBe('seek');
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ type: 'seek' }));
  });

  it('update ne change PAS le type', async () => {
    const updated = mkExpertise({ title: 'New title' });
    db.returning.mockResolvedValueOnce([updated]);
    await service.update('exp-uuid', { title: 'New title' });
    // Vérifier que le set NE contient PAS de champ "type"
    expect(db.set).toHaveBeenCalledWith(expect.not.objectContaining({ type: expect.anything() }));
  });

  it('update throw NotFoundException si id inconnu', async () => {
    db.returning.mockResolvedValueOnce([]);
    await expect(service.update('nope', { title: 'X' })).rejects.toThrow(NotFoundException);
  });

  it('remove supprime ou throw 404', async () => {
    db.returning.mockResolvedValueOnce([{ id: 'exp-uuid' }]);
    await expect(service.remove('exp-uuid')).resolves.toBeUndefined();

    db.returning.mockResolvedValueOnce([]);
    await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 3: Lancer le test, vérifier l'échec**

```bash
pnpm test src/expertises/expertises.service.spec.ts
```

Expected : FAIL.

- [ ] **Step 4: Implémenter `src/expertises/expertises.service.ts`**

```typescript
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { expertises, type Expertise, type ExpertiseType } from '../database/schema/expertises';
import { CreateExpertiseDto } from './dto/create-expertise.dto';
import { UpdateExpertiseDto } from './dto/update-expertise.dto';

@Injectable()
export class ExpertisesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findOffers(): Promise<Expertise[]> {
    return this.db.select().from(expertises).where(eq(expertises.type, 'offer')).orderBy(asc(expertises.createdAt));
  }

  findSeeks(): Promise<Expertise[]> {
    return this.db.select().from(expertises).where(eq(expertises.type, 'seek')).orderBy(asc(expertises.createdAt));
  }

  async findById(id: string): Promise<Expertise> {
    const rows = await this.db.select().from(expertises).where(eq(expertises.id, id)).limit(1);
    if (rows.length === 0) throw new NotFoundException(`Expertise ${id} not found`);
    return rows[0];
  }

  async create(type: ExpertiseType, dto: CreateExpertiseDto): Promise<Expertise> {
    const [row] = await this.db.insert(expertises).values({ ...dto, type }).returning();
    return row;
  }

  async update(id: string, dto: UpdateExpertiseDto): Promise<Expertise> {
    // Le type n'est PAS modifiable : on ne le passe jamais dans le set.
    const [row] = await this.db
      .update(expertises)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(expertises.id, id))
      .returning();
    if (!row) throw new NotFoundException(`Expertise ${id} not found`);
    return row;
  }

  async remove(id: string): Promise<void> {
    const rows = await this.db
      .delete(expertises)
      .where(eq(expertises.id, id))
      .returning({ id: expertises.id });
    if (rows.length === 0) throw new NotFoundException(`Expertise ${id} not found`);
  }
}
```

- [ ] **Step 5: Lancer les tests, confirmer PASS**

```bash
pnpm test src/expertises/expertises.service.spec.ts
```

Expected : `Tests: 9 passed, 9 total`.

- [ ] **Step 6: Créer `src/expertises/expertises.controller.ts`**

```typescript
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ExpertisesService } from './expertises.service';
import { CreateExpertiseDto } from './dto/create-expertise.dto';
import { UpdateExpertiseDto } from './dto/update-expertise.dto';

@ApiTags('Expertises')
@Controller('expertises')
export class ExpertisesController {
  constructor(private readonly expertises: ExpertisesService) {}

  @Get('offers')
  @ApiOperation({ summary: 'List expertise offers (public, type=offer)' })
  findOffers() {
    return this.expertises.findOffers();
  }

  @Get('seeks')
  @ApiOperation({ summary: 'List expertise seeks (public, type=seek)' })
  findSeeks() {
    return this.expertises.findSeeks();
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get an expertise by id (admin — includes type)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.expertises.findById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('offers')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create an offer (admin, injects type=offer)' })
  createOffer(@Body() dto: CreateExpertiseDto) {
    return this.expertises.create('offer', dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('seeks')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a seek (admin, injects type=seek)' })
  createSeek(@Body() dto: CreateExpertiseDto) {
    return this.expertises.create('seek', dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update an expertise (admin, type non modifiable)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateExpertiseDto) {
    return this.expertises.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an expertise (admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.expertises.remove(id);
  }
}
```

- [ ] **Step 7: Créer `src/expertises/expertises.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ExpertisesController } from './expertises.controller';
import { ExpertisesService } from './expertises.service';

@Module({
  imports: [AuthModule],
  controllers: [ExpertisesController],
  providers: [ExpertisesService],
})
export class ExpertisesModule {}
```

- [ ] **Step 8: Vérifier que tout compile**

```bash
pnpm build
```

- [ ] **Step 9: Commit**

```bash
git add src/expertises/
git commit -m "feat(expertises): ExpertisesModule (collection avec discriminator)

7 endpoints sous /expertises :
- GET /offers (public, type=offer)
- GET /seeks (public, type=seek)
- GET /:id (admin — détail incluant le type)
- POST /offers (admin, injecte type=offer)
- POST /seeks (admin, injecte type=seek)
- PATCH /:id (admin, type non modifiable)
- DELETE /:id (admin, 204)

Le type est injecté par le controller (jamais dans le DTO body).
Le service.update() ne passe PAS le type dans le set Drizzle.
9 tests unitaires (incluant vérif que update ne change pas le type).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: ServicePricingModule (collection + reorder, TDD)

**Files:**
- Create: `src/service-pricing/service-pricing.module.ts`, `service-pricing.controller.ts`, `service-pricing.service.ts`, `service-pricing.service.spec.ts`
- Create: `src/service-pricing/dto/create-service-pricing.dto.ts`, `update-service-pricing.dto.ts`, `reorder-service-pricing.dto.ts`

- [ ] **Step 1: Créer les DTOs**

`src/service-pricing/dto/create-service-pricing.dto.ts` :

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateServicePricingDto {
  @ApiProperty({ maxLength: 200 })
  @IsString() @IsNotEmpty() @MaxLength(200)
  title!: string;

  @ApiProperty({ maxLength: 1000 })
  @IsString() @IsNotEmpty() @MaxLength(1000)
  description!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString() @IsNotEmpty() @MaxLength(200)
  price!: string;

  @ApiPropertyOptional({ type: [String], default: [] })
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(200, { each: true })
  features?: string[];

  @ApiPropertyOptional({ default: false })
  @IsOptional() @IsBoolean()
  highlighted?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional() @IsInt() @Min(0)
  order?: number;
}
```

`src/service-pricing/dto/update-service-pricing.dto.ts` :

```typescript
import { PartialType } from '@nestjs/swagger';
import { CreateServicePricingDto } from './create-service-pricing.dto';

export class UpdateServicePricingDto extends PartialType(CreateServicePricingDto) {}
```

`src/service-pricing/dto/reorder-service-pricing.dto.ts` :

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class ReorderServicePricingDto {
  @ApiProperty({ type: [String], description: 'IDs in desired order (index 0 = first)' })
  @IsArray() @ArrayUnique() @IsUUID('all', { each: true })
  orderedIds!: string[];
}
```

- [ ] **Step 2: Écrire le test `src/service-pricing/service-pricing.service.spec.ts` AVANT**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ServicePricingService } from './service-pricing.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import type { ServicePricing } from '../database/schema/service-pricing';

describe('ServicePricingService', () => {
  let service: ServicePricingService;
  let db: ReturnType<typeof createMockDb>;

  const mkSP = (overrides: Partial<ServicePricing> = {}): ServicePricing => ({
    id: 'sp-uuid',
    title: 'Audit',
    description: 'Audit technique complet',
    price: 'À partir de 1500€',
    features: [],
    highlighted: false,
    enabled: true,
    order: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    db = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServicePricingService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(ServicePricingService);
  });

  it('findAll retourne triée par order ASC', async () => {
    const rows = [mkSP({ id: 'a', order: 0 }), mkSP({ id: 'b', order: 1 })];
    db.orderBy.mockResolvedValueOnce(rows);
    await expect(service.findAll()).resolves.toEqual(rows);
  });

  it('findById retourne ou throw 404', async () => {
    const row = mkSP();
    db.limit.mockResolvedValueOnce([row]);
    await expect(service.findById('sp-uuid')).resolves.toEqual(row);

    db.limit.mockResolvedValueOnce([]);
    await expect(service.findById('nope')).rejects.toThrow(NotFoundException);
  });

  it('create insère et retourne', async () => {
    const created = mkSP();
    db.returning.mockResolvedValueOnce([created]);
    const result = await service.create({ title: 'Audit', description: 'X', price: '1500' });
    expect(result).toEqual(created);
  });

  it('update met à jour ou throw 404', async () => {
    const updated = mkSP({ title: 'Audit Plus' });
    db.returning.mockResolvedValueOnce([updated]);
    await expect(service.update('sp-uuid', { title: 'Audit Plus' })).resolves.toEqual(updated);

    db.returning.mockResolvedValueOnce([]);
    await expect(service.update('nope', { title: 'X' })).rejects.toThrow(NotFoundException);
  });

  it('remove supprime ou throw 404', async () => {
    db.returning.mockResolvedValueOnce([{ id: 'sp-uuid' }]);
    await expect(service.remove('sp-uuid')).resolves.toBeUndefined();

    db.returning.mockResolvedValueOnce([]);
    await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
  });

  describe('reorder', () => {
    it('réassigne order = index pour chaque ID dans le tableau', async () => {
      // 1er select pour vérifier que tous les IDs existent
      db.where.mockResolvedValueOnce([
        { id: 'sp-a' }, { id: 'sp-b' }, { id: 'sp-c' },
      ]);
      // findAll retour final
      const finalRows = [
        mkSP({ id: 'sp-c', order: 0 }),
        mkSP({ id: 'sp-a', order: 1 }),
        mkSP({ id: 'sp-b', order: 2 }),
      ];
      db.orderBy.mockResolvedValueOnce(finalRows);

      const result = await service.reorder({ orderedIds: ['sp-c', 'sp-a', 'sp-b'] });
      expect(result).toEqual(finalRows);
      // Le builder.transaction a été appelé
      expect(db.transaction).toHaveBeenCalled();
    });

    it('throw BadRequestException si un ID est inexistant', async () => {
      db.where.mockResolvedValueOnce([{ id: 'sp-a' }, { id: 'sp-b' }]); // sp-c manquant
      await expect(service.reorder({ orderedIds: ['sp-c', 'sp-a', 'sp-b'] })).rejects.toThrow(BadRequestException);
    });

    it('accepte un tableau vide (no-op)', async () => {
      db.where.mockResolvedValueOnce([]);
      db.orderBy.mockResolvedValueOnce([]);
      const result = await service.reorder({ orderedIds: [] });
      expect(result).toEqual([]);
    });
  });
});
```

- [ ] **Step 3: Lancer le test, vérifier l'échec**

```bash
pnpm test src/service-pricing/service-pricing.service.spec.ts
```

Expected : FAIL.

- [ ] **Step 4: Implémenter `src/service-pricing/service-pricing.service.ts`**

```typescript
import { Inject, Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { servicePricing, type ServicePricing } from '../database/schema/service-pricing';
import { CreateServicePricingDto } from './dto/create-service-pricing.dto';
import { UpdateServicePricingDto } from './dto/update-service-pricing.dto';
import { ReorderServicePricingDto } from './dto/reorder-service-pricing.dto';

@Injectable()
export class ServicePricingService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findAll(): Promise<ServicePricing[]> {
    return this.db.select().from(servicePricing).orderBy(asc(servicePricing.order));
  }

  async findById(id: string): Promise<ServicePricing> {
    const rows = await this.db.select().from(servicePricing).where(eq(servicePricing.id, id)).limit(1);
    if (rows.length === 0) throw new NotFoundException(`ServicePricing ${id} not found`);
    return rows[0];
  }

  async create(dto: CreateServicePricingDto): Promise<ServicePricing> {
    const [row] = await this.db.insert(servicePricing).values(dto).returning();
    return row;
  }

  async update(id: string, dto: UpdateServicePricingDto): Promise<ServicePricing> {
    const [row] = await this.db
      .update(servicePricing)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(servicePricing.id, id))
      .returning();
    if (!row) throw new NotFoundException(`ServicePricing ${id} not found`);
    return row;
  }

  async remove(id: string): Promise<void> {
    const rows = await this.db
      .delete(servicePricing)
      .where(eq(servicePricing.id, id))
      .returning({ id: servicePricing.id });
    if (rows.length === 0) throw new NotFoundException(`ServicePricing ${id} not found`);
  }

  async reorder(dto: ReorderServicePricingDto): Promise<ServicePricing[]> {
    const { orderedIds } = dto;
    if (orderedIds.length === 0) {
      // No-op reorder: lookup empty + return current findAll
      await this.db.select({ id: servicePricing.id }).from(servicePricing).where(inArray(servicePricing.id, orderedIds));
      return this.findAll();
    }
    // Vérifier que tous les IDs existent
    const existing = await this.db
      .select({ id: servicePricing.id })
      .from(servicePricing)
      .where(inArray(servicePricing.id, orderedIds));
    const existingIds = new Set(existing.map((r) => r.id));
    const missing = orderedIds.filter((id) => !existingIds.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(`ServicePricing IDs not found: ${missing.join(', ')}`);
    }
    // Transaction: update each
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx
          .update(servicePricing)
          .set({ order: i, updatedAt: new Date() })
          .where(eq(servicePricing.id, orderedIds[i]));
      }
    });
    return this.findAll();
  }
}
```

- [ ] **Step 5: Lancer les tests, confirmer PASS**

```bash
pnpm test src/service-pricing/service-pricing.service.spec.ts
```

Expected : `Tests: 9 passed, 9 total`.

- [ ] **Step 6: Créer `src/service-pricing/service-pricing.controller.ts`**

```typescript
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ServicePricingService } from './service-pricing.service';
import { CreateServicePricingDto } from './dto/create-service-pricing.dto';
import { UpdateServicePricingDto } from './dto/update-service-pricing.dto';
import { ReorderServicePricingDto } from './dto/reorder-service-pricing.dto';

@ApiTags('ServicePricing')
@Controller('service-pricing')
export class ServicePricingController {
  constructor(private readonly sp: ServicePricingService) {}

  @Get()
  @ApiOperation({ summary: 'List all service pricings (public, sorted by order ASC, includes enabled=false)' })
  findAll() {
    return this.sp.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a service pricing by id (public)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.sp.findById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a service pricing (admin)' })
  create(@Body() dto: CreateServicePricingDto) {
    return this.sp.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('reorder')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reorder service pricings (admin, bulk). IDs absents conservent leur order.' })
  @ApiResponse({ status: 400, description: 'Some IDs not found' })
  reorder(@Body() dto: ReorderServicePricingDto) {
    return this.sp.reorder(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a service pricing (admin)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateServicePricingDto) {
    return this.sp.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a service pricing (admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.sp.remove(id);
  }
}
```

> Note d'ordre : `@Patch('reorder')` est déclaré AVANT `@Patch(':id')`, sinon NestJS matcherait `reorder` comme un id (`ParseUUIDPipe` rejetterait avec 400 — ce qui ne serait pas le comportement attendu).

- [ ] **Step 7: Créer `src/service-pricing/service-pricing.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ServicePricingController } from './service-pricing.controller';
import { ServicePricingService } from './service-pricing.service';

@Module({
  imports: [AuthModule],
  controllers: [ServicePricingController],
  providers: [ServicePricingService],
})
export class ServicePricingModule {}
```

- [ ] **Step 8: Vérifier que tout compile**

```bash
pnpm build
```

- [ ] **Step 9: Commit**

```bash
git add src/service-pricing/
git commit -m "feat(service-pricing): ServicePricingModule (CRUD + /reorder bulk)

6 endpoints sous /service-pricing :
- GET (public, tri order ASC, inclut enabled=false)
- GET :id (public)
- POST (admin)
- PATCH /reorder (admin, body { orderedIds: string[] }, transaction)
- PATCH :id (admin)
- DELETE :id (admin, 204)

Reorder : vérifie que tous les IDs existent (sinon 400 avec liste
des IDs manquants), puis transaction qui réassigne order=index.
Sémantique partielle : IDs absents du body conservent leur order.

9 tests unitaires (CRUD + 3 cas reorder).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Wire les 7 modules dans AppModule + verification

**Files:**
- Modify: `src/app.module.ts`

- [ ] **Step 1: Modifier `src/app.module.ts`**

Ouvrir le fichier. État actuel (post-Auth, post-cleanup `UsersModule`) :

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env'] }),
    AppConfigModule,
    LoggerModule.forRootAsync({ /* ... */ }),
    DatabaseModule,
    HealthModule,
    AuthModule,
  ],
})
export class AppModule {}
```

Ajouter les 7 imports et les 7 modules. État final :

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { ProfileModule } from './profile/profile.module';
import { HeroModule } from './hero/hero.module';
import { SocialLinksModule } from './social-links/social-links.module';
import { DiplomasModule } from './diplomas/diplomas.module';
import { TechnologiesModule } from './technologies/technologies.module';
import { ExpertisesModule } from './expertises/expertises.module';
import { ServicePricingModule } from './service-pricing/service-pricing.module';

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
    AuthModule,
    ProfileModule,
    HeroModule,
    SocialLinksModule,
    DiplomasModule,
    TechnologiesModule,
    ExpertisesModule,
    ServicePricingModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Vérifier que TypeScript compile**

```bash
pnpm build
```

Expected : exit 0.

- [ ] **Step 3: Lancer tous les tests pour confirmer aucune régression**

```bash
pnpm test
```

Expected : ~90 tests verts (53 existants + 3 profile + 3 hero + 7 social-links + 8 diplomas + 6 technologies + 9 expertises + 9 service-pricing = ~95 tests).

- [ ] **Step 4: Lancer lint**

```bash
pnpm lint
```

Expected : exit 0, aucune erreur.

- [ ] **Step 5: Vérifier que l'app boote avec tous les modules**

```bash
pkill -f "nest start" 2>/dev/null; true
sleep 1
pnpm db:up && pnpm db:wait
pnpm start > /tmp/task11-boot.log 2>&1 &
PID=$!
sleep 6
echo "=== Modules initialized ==="
grep -E "ModuleDependenciesInitialized|dependencies initialized" /tmp/task11-boot.log | head -20
echo "=== Routes mapped under /profile, /hero, /social-links, /diplomas, /technologies, /expertises, /service-pricing ==="
grep -E "Mapped \{(/(profile|hero|social-links|diplomas|technologies|expertises|service-pricing))" /tmp/task11-boot.log | head -40
echo "=== Listening ==="
grep "Listening" /tmp/task11-boot.log
kill $PID 2>/dev/null
wait 2>/dev/null
```

Expected :
- Tous les 7 modules initialisés (`ProfileModule`, `HeroModule`, etc.)
- ~32 routes mappées sous les 7 préfixes
- `Listening on http://localhost:3000 (docs: /docs)`

- [ ] **Step 6: Commit**

```bash
git add src/app.module.ts
git commit -m "feat(app): wire les 7 modules Profile public dans AppModule

- ProfileModule, HeroModule, SocialLinksModule, DiplomasModule,
  TechnologiesModule, ExpertisesModule, ServicePricingModule.
- App boot OK avec ~32 routes /profile, /hero, /social-links, /diplomas,
  /technologies, /expertises, /service-pricing mappées.
- ~90 tests verts, lint OK.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Vérification e2e curl + README final

**Files:**
- Modify: `README.md` (ajouter section "Profile public")

> Cette task vérifie les 9 critères de done du spec §9 via curl, puis met à jour le README.

- [ ] **Step 1: Préparer un environnement clean**

```bash
pkill -f "nest start" 2>/dev/null; true
sleep 1
pnpm db:reset       # down -v, up, wait, migrate (incl. les 7 nouvelles tables + seeds singletons), seed admin
```

Expected : la commande chaîne sans erreur. La table `profile` a 1 ligne, `hero` a 1 ligne, `users` a 1 ligne (admin).

- [ ] **Step 2: Démarrer l'app**

```bash
pnpm start > /tmp/task12-app.log 2>&1 &
APP_PID=$!
sleep 6
grep "Listening" /tmp/task12-app.log
```

Expected : `Listening on http://localhost:3000 (docs: /docs)`.

- [ ] **Step 3: Login admin pour récupérer le cookie**

```bash
EMAIL=$(grep '^ADMIN_EMAIL=' .env | cut -d= -f2)
PASSWORD=$(grep '^ADMIN_INITIAL_PASSWORD=' .env | cut -d= -f2)
rm -f /tmp/cookies.txt
# Si l'admin a 2FA enabled (ce qui est le cas si l'utilisateur a fait l'e2e Auth), il faut soit reset la DB soit handle 2FA. Le pnpm db:reset au step 1 efface tout, donc admin sans 2FA.
curl -s -c /tmp/cookies.txt -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | head -c 300
echo
```

Expected : 200 + body `{"user":{"id":"...","email":"...","isTwoFactorEnabled":false}}`. Cookie stocké dans `/tmp/cookies.txt`.

- [ ] **Step 4: Test e2e — Profile**

```bash
echo "=== GET /profile (public, before update) ==="
curl -s http://localhost:3000/profile | head -c 200
echo
echo "=== PATCH /profile (admin) ==="
curl -s -b /tmp/cookies.txt -X PATCH http://localhost:3000/profile \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Julien Nedellec","location":"Lyon, France"}' | head -c 200
echo
echo "=== GET /profile (after update) ==="
curl -s http://localhost:3000/profile | head -c 200
echo
```

Expected : GET retourne le singleton vide → PATCH retourne avec les nouvelles valeurs → GET retourne les nouvelles valeurs.

- [ ] **Step 5: Test e2e — Hero (PATCH sans cookie doit échouer)**

```bash
echo "=== PATCH /hero SANS cookie (doit 401) ==="
curl -s -i -X PATCH http://localhost:3000/hero \
  -H "Content-Type: application/json" \
  -d '{"name":"X"}' | head -5
echo "=== PATCH /hero AVEC cookie (200) ==="
curl -s -b /tmp/cookies.txt -X PATCH http://localhost:3000/hero \
  -H "Content-Type: application/json" \
  -d '{"name":"Julien","tagline":"Dev fullstack TypeScript"}' | head -c 200
echo
```

Expected : 401 sans cookie, 200 avec cookie.

- [ ] **Step 6: Test e2e — SocialLinks CRUD**

```bash
echo "=== POST /social-links (admin) ==="
LINK_ID=$(curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/social-links \
  -H "Content-Type: application/json" \
  -d '{"icon":"github","label":"GitHub","href":"https://github.com/jned"}' | python3 -c "import json, sys; print(json.load(sys.stdin)['id'])")
echo "Created link id: $LINK_ID"
echo "=== GET /social-links (public) ==="
curl -s http://localhost:3000/social-links | head -c 300
echo
echo "=== PATCH /social-links/:id ==="
curl -s -b /tmp/cookies.txt -X PATCH "http://localhost:3000/social-links/$LINK_ID" \
  -H "Content-Type: application/json" \
  -d '{"label":"My GitHub"}' | head -c 200
echo
echo "=== DELETE /social-links/:id ==="
curl -s -i -b /tmp/cookies.txt -X DELETE "http://localhost:3000/social-links/$LINK_ID" | head -3
```

Expected : POST 201 + new id, GET retourne array avec 1 item, PATCH 200 avec label modifié, DELETE 204.

- [ ] **Step 7: Test e2e — Expertises avec discriminator**

```bash
echo "=== POST /expertises/offers ==="
OFFER_ID=$(curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/expertises/offers \
  -H "Content-Type: application/json" \
  -d '{"title":"Architecture","description":"Conception d architectures backend"}' | python3 -c "import json, sys; print(json.load(sys.stdin)['id'])")
echo "Offer id: $OFFER_ID"
echo "=== POST /expertises/seeks ==="
SEEK_ID=$(curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/expertises/seeks \
  -H "Content-Type: application/json" \
  -d '{"title":"Mentor","description":"Cherche un mentor senior"}' | python3 -c "import json, sys; print(json.load(sys.stdin)['id'])")
echo "Seek id: $SEEK_ID"
echo "=== GET /expertises/offers (public, doit retourner 1 offer) ==="
curl -s http://localhost:3000/expertises/offers | head -c 200
echo
echo "=== GET /expertises/seeks (public, doit retourner 1 seek) ==="
curl -s http://localhost:3000/expertises/seeks | head -c 200
echo
echo "=== GET /expertises/:id (admin, retourne le détail incluant le type) ==="
curl -s -b /tmp/cookies.txt "http://localhost:3000/expertises/$OFFER_ID" | head -c 200
echo
```

Expected : 2 entités créées (1 offer, 1 seek), GET offers retourne 1 row avec `type='offer'`, GET seeks retourne 1 row avec `type='seek'`, GET admin :id retourne le détail.

- [ ] **Step 8: Test e2e — ServicePricing avec /reorder**

```bash
echo "=== POST 3 services ==="
SP_A=$(curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/service-pricing \
  -H "Content-Type: application/json" \
  -d '{"title":"A","description":"Service A","price":"100","order":0}' | python3 -c "import json, sys; print(json.load(sys.stdin)['id'])")
SP_B=$(curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/service-pricing \
  -H "Content-Type: application/json" \
  -d '{"title":"B","description":"Service B","price":"200","order":1}' | python3 -c "import json, sys; print(json.load(sys.stdin)['id'])")
SP_C=$(curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/service-pricing \
  -H "Content-Type: application/json" \
  -d '{"title":"C","description":"Service C","price":"300","order":2}' | python3 -c "import json, sys; print(json.load(sys.stdin)['id'])")
echo "Created: $SP_A, $SP_B, $SP_C"

echo "=== GET /service-pricing (avant reorder, ordre A,B,C) ==="
curl -s http://localhost:3000/service-pricing | python3 -c "import json, sys; d=json.load(sys.stdin); print([(s['title'], s['order']) for s in d])"

echo "=== PATCH /service-pricing/reorder (nouvel ordre C,A,B) ==="
curl -s -b /tmp/cookies.txt -X PATCH http://localhost:3000/service-pricing/reorder \
  -H "Content-Type: application/json" \
  -d "{\"orderedIds\":[\"$SP_C\",\"$SP_A\",\"$SP_B\"]}" | python3 -c "import json, sys; d=json.load(sys.stdin); print([(s['title'], s['order']) for s in d])"

echo "=== GET /service-pricing (après reorder, ordre C,A,B) ==="
curl -s http://localhost:3000/service-pricing | python3 -c "import json, sys; d=json.load(sys.stdin); print([(s['title'], s['order']) for s in d])"

echo "=== Reorder avec un UUID inexistant doit 400 ==="
curl -s -i -b /tmp/cookies.txt -X PATCH http://localhost:3000/service-pricing/reorder \
  -H "Content-Type: application/json" \
  -d "{\"orderedIds\":[\"00000000-0000-0000-0000-000000000000\"]}" | head -10
```

Expected : 3 services créés. GET initial montre ordre A=0, B=1, C=2. Après reorder avec [C,A,B], GET montre C=0, A=1, B=2. Reorder avec UUID inexistant → 400 avec message clair.

- [ ] **Step 9: Test e2e — Erreurs (404, 401, 400 validation)**

```bash
echo "=== GET /social-links/nonexistent → 400 (UUID invalid) ==="
curl -s -i http://localhost:3000/social-links/not-a-uuid | head -5

echo "=== GET /social-links/00000000-0000-0000-0000-000000000000 → 404 ==="
curl -s -i http://localhost:3000/social-links/00000000-0000-0000-0000-000000000000 | head -10

echo "=== POST /social-links sans cookie → 401 ==="
curl -s -i -X POST http://localhost:3000/social-links \
  -H "Content-Type: application/json" \
  -d '{"icon":"x","label":"y","href":"https://x.com"}' | head -5

echo "=== POST /social-links avec href invalide → 400 ==="
curl -s -i -b /tmp/cookies.txt -X POST http://localhost:3000/social-links \
  -H "Content-Type: application/json" \
  -d '{"icon":"x","label":"y","href":"not-a-url"}' | head -10
```

Expected : 400 sur UUID malformé, 404 sur UUID valide mais inconnu, 401 sans cookie, 400 sur href non-URL.

- [ ] **Step 10: Test Swagger documente les 32 endpoints**

```bash
curl -s http://localhost:3000/docs-json | python3 -c "
import json, sys
doc = json.load(sys.stdin)
prefixes = ['/profile', '/hero', '/social-links', '/diplomas', '/technologies', '/expertises', '/service-pricing']
total = 0
for prefix in prefixes:
    paths = [p for p in doc['paths'] if p.startswith(prefix)]
    paths_with_methods = sum(len(doc['paths'][p]) for p in paths)
    print(f'{prefix}: {paths_with_methods} endpoints')
    total += paths_with_methods
print(f'TOTAL Profile public: {total}')"
```

Expected : Profile=2, Hero=2, SocialLinks=5, Diplomas=5, Technologies=5, Expertises=7, ServicePricing=6 = **TOTAL 32**.

- [ ] **Step 11: Couper l'app**

```bash
kill $APP_PID 2>/dev/null
wait 2>/dev/null
pkill -f "nest start" 2>/dev/null; true
```

- [ ] **Step 12: Lancer la suite de tests + lint + build**

```bash
pnpm test
pnpm lint
pnpm build
```

Expected : tous PASS, ~90 tests.

- [ ] **Step 13: Mettre à jour `README.md` — ajouter section "Profile public" avant "Migration depuis le backend Hono"**

Ouvrir `README.md`. Trouver la section `## Migration depuis le backend Hono`. Insérer cette section JUSTE AVANT :

```markdown
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
```

- [ ] **Step 14: Mettre à jour la liste des sous-projets dans `README.md`**

Dans la section `## Migration depuis le backend Hono`, mettre à jour la liste numérotée. Avant :

```markdown
1. ✅ Fondations
2. ✅ Auth (Users + JWT + 2FA + backup codes)
3. **Profile public** *(prochain)* (Profile, Hero, SocialLinks, Diplomas, Technologies, Expertises, ServicePricing)
```

Après :

```markdown
1. ✅ Fondations
2. ✅ Auth (Users + JWT + 2FA + backup codes)
3. ✅ Profile public (Profile, Hero, SocialLinks, Diplomas, Technologies, Expertises, ServicePricing)
4. **Projects** *(prochain)* (CRUD + upload image S3) — introduit le S3 setup
```

(Conserver les sous-projets 5-9 inchangés.)

- [ ] **Step 15: Vérifier que le README rend bien**

```bash
grep "^## " README.md
```

Expected : la liste H2 inclut désormais `## Profile public`.

- [ ] **Step 16: Vérifier `git status` clean (sauf README)**

```bash
git status
```

Expected : seul `README.md` est modifié.

- [ ] **Step 17: Commit final**

```bash
git add README.md
git commit -m "docs: README — section Profile public + liste sous-projets

- Nouvelle section ## Profile public : 7 entités, 32 endpoints,
  pattern lecture publique / écriture admin, lien spec.
- Liste sous-projets mise à jour : Profile public ✅, Projects prochain.

Conclut le sous-projet Profile public. 9 critères de done du spec
2026-04-25-profile-public-design.md §9 vérifiés manuellement via curl
(GET/PATCH singletons, CRUD social-links, expertises offers/seeks,
service-pricing reorder, validation + auth errors, Swagger).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 18: Vérifier la log git finale**

```bash
git log --oneline | head -16
```

Expected : ~12 commits pour ce sous-projet (1 schemas, 1 seed migration, 1 helper, 7 modules, 1 wiring, 1 README) + des commits docs précédents.

---

## Récap final

À la fin de ce plan, le sous-projet Profile public est livré :

✅ 7 schémas Drizzle + migration `0001` appliquée + 2 singletons seedés
✅ Helper `createMockDb()` partagé pour tous les sous-projets futurs
✅ 7 modules NestJS flat (`Profile`, `Hero`, `SocialLinks`, `Diplomas`, `Technologies`, `Expertises`, `ServicePricing`)
✅ 32 endpoints HTTP opérationnels (lecture publique + écriture protégée par `JwtAuthGuard`)
✅ ~37 nouveaux tests unitaires (~90 tests au total)
✅ Build production fonctionnel, lint clean
✅ Swagger documente les 32 endpoints
✅ End-to-end manuel via curl validé : Profile/Hero PATCH, SocialLinks CRUD, Expertises offers/seeks/admin-detail, ServicePricing reorder + erreurs (404, 401, 400)
✅ README mis à jour avec section Profile public

**Prochaine étape** : nouveau cycle brainstorm → spec → plan pour le sous-projet **Projects** (qui introduira le S3 setup pour les uploads d'image projet — débloquera aussi l'avatar Profile reporté).
