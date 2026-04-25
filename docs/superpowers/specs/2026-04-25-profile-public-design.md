# Profile public — Design

| | |
|---|---|
| **Date** | 2026-04-25 |
| **Statut** | Approuvé (sections), en attente de relecture finale |
| **Périmètre** | Sous-projet "Profile public" du chantier de migration Hono → NestJS |
| **Projet cible** | `/home/jned/WebstormProjects/J-Ned/nest-portfolio-app` |
| **Frontend consommateur** | `/home/jned/WebstormProjects/J-Ned/angular-portfolio-app` (adaptation différée) |
| **Spec précédents** | `2026-04-25-fondations-nest-portfolio-design.md`, `2026-04-25-auth-nest-portfolio-design.md` |

---

## 1. Contexte & motivation

Les sous-projets Fondations et Auth sont terminés : NestJS scaffold + Drizzle + PostgreSQL + Pino + ValidationPipe + Swagger + `/health` + `UsersModule` + `AuthModule` (JWT cookie, 2FA TOTP, admin pré-seedé). Il reste 6 sous-projets à livrer pour atteindre la parité fonctionnelle avec le backend Hono.

**"Profile public"** est le 3e sous-projet. Il introduit les **7 entités de contenu publié sur le portfolio** : ce que les visiteurs voient en lecture publique et ce que l'admin (le seul utilisateur du système) édite via les endpoints protégés.

Toutes ces entités partagent le même pattern : **lecture publique sans auth + écriture protégée par `JwtAuthGuard`**. Aucune FK croisée entre elles (chacune est isolée). Pas de relation avec `users` (l'admin unique est implicite — pas de `created_by`).

Comme pour Auth, l'utilisateur a explicitement choisi une **refonte propre** plutôt que la parité stricte avec Hono. Le frontend Angular sera adapté dans un sous-projet séparé ultérieur.

## 2. Scope

### Inclus

- **Schémas Drizzle** des 7 tables (`profile`, `hero`, `social_link`, `diploma`, `technology`, `expertise`, `service_pricing`)
- **Migration unique `0001_*.sql`** créant les 7 tables + insérant les 2 lignes singletons (Profile, Hero) avec valeurs par défaut
- **7 modules NestJS** dans `src/`, un par entité : `ProfileModule`, `HeroModule`, `SocialLinksModule`, `DiplomasModule`, `TechnologiesModule`, `ExpertisesModule`, `ServicePricingModule`
- **32 endpoints HTTP** répartis (cf. §6 ci-dessous)
- **13 DTOs** avec `class-validator` + `@ApiProperty` Swagger
- **~37 tests unitaires** sur les services (mock DRIZZLE)
- **Helper de test partagé** `src/database/test-utils.ts` (`createMockDb()`) — réutilisable pour tous les sous-projets futurs
- **Mise à jour du README** : section "Profile public" avec table récap des 32 endpoints

### Explicitement exclus

- **Upload d'avatar S3** (`POST /profile/avatar` du Hono) : reporté au sous-projet "Projects" (qui introduira le S3 setup) ou à un sous-projet S3 dédié. Pour l'instant, `Profile.avatarUrl` est juste un champ texte éditable par PATCH (l'admin met une URL externe).
- **Pagination** : aucun `?limit/offset` (collections de portfolio < 20 items en pratique)
- **Cache HTTP** : aucun `Cache-Control` header (peut être ajouté en sous-projet "Polish")
- **Soft delete** : DELETE = hard delete (DROP de la ligne)
- **Slug** : aucun champ slug, identifiants UUID partout
- **Ordering sur autres collections** que ServicePricing : seul `service_pricing` a un champ `order`. Les autres trient par `createdAt ASC` (Postgres natural order)
- **Bulk operations** (sauf `/reorder` ServicePricing) : aucune
- **`bioTitle` / `bioParagraphs` du Profile Hono** : non répliqués (le frontend ne les utilise plus dans la nouvelle architecture)
- **`expertise.type='seek'` exposé publiquement par le Hono actuel** : le Hono ne l'expose pas ; on l'expose via `GET /expertises/seeks` dédié
- **Rate limiting** : déjà décidé absent au niveau de l'app (cf. ADR-5 du spec Auth)
- **Tests e2e** (Testcontainers, DB de test dédiée)
- **Adaptation du frontend Angular** (sous-projet séparé)

## 3. Architecture & graphe de modules

```
┌──────────────────────────────────────────────────────────────┐
│ AppModule                                                    │
│                                                              │
│  Imports déjà présents (Fondations + Auth) :                 │
│   ├── ConfigModule + AppConfigModule                         │
│   ├── LoggerModule (Pino)            ← @Global               │
│   ├── DatabaseModule                  ← @Global              │
│   ├── HealthModule                                           │
│   └── AuthModule (UsersModule importé en interne)            │
│                                                              │
│  AJOUTS de ce sous-projet (7 modules) :                      │
│   ├── ProfileModule         (singleton, GET + PATCH)         │
│   ├── HeroModule            (singleton, GET + PATCH)         │
│   ├── SocialLinksModule     (collection, CRUD complet)       │
│   ├── DiplomasModule        (collection, CRUD)               │
│   ├── TechnologiesModule    (collection, CRUD)               │
│   ├── ExpertisesModule      (collection avec discriminator)  │
│   └── ServicePricingModule  (collection + reorder)           │
│                                                              │
│  Chaque module dépend de :                                   │
│   - DatabaseModule (@Global)  pour le token DRIZZLE          │
│   - AuthModule                pour JwtAuthGuard (writes)     │
└──────────────────────────────────────────────────────────────┘
```

### Structure interne d'un module type

Exemple `SocialLinksModule` :

```
src/social-links/
├── social-links.module.ts        # @Module declaration
├── social-links.controller.ts    # 5 endpoints CRUD
├── social-links.service.ts       # CRUD via DRIZZLE
├── social-links.service.spec.ts  # Tests unitaires (mock DRIZZLE)
└── dto/
    ├── create-social-link.dto.ts
    └── update-social-link.dto.ts
```

### Pattern par catégorie d'entité

**Singletons (Profile + Hero) — 2 endpoints chacun :**
- `GET /<entity>` (public) — retourne la ligne unique seedée
- `PATCH /<entity>` (admin) — update les champs fournis (jamais d'INSERT)

**Collections standard (SocialLinks, Diplomas, Technologies) — 5 endpoints chacune :**
- `GET /<entity>s` (public) — liste, tri par `createdAt ASC`
- `GET /<entity>s/:id` (public)
- `POST /<entity>s` (admin)
- `PATCH /<entity>s/:id` (admin)
- `DELETE /<entity>s/:id` (admin)

**Expertises (collection avec discriminator) — 7 endpoints :**
- `GET /expertises/offers` (public)
- `GET /expertises/seeks` (public)
- `GET /expertises/:id` (admin) — retourne le détail incluant le `type`
- `POST /expertises/offers` (admin) — crée avec `type='offer'` injecté
- `POST /expertises/seeks` (admin) — crée avec `type='seek'` injecté
- `PATCH /expertises/:id` (admin) — `type` non modifiable
- `DELETE /expertises/:id` (admin)

**ServicePricing (collection + reorder) — 6 endpoints :**
- 5 CRUD + `PATCH /service-pricing/reorder` (admin) — body `{orderedIds: string[]}`

**Total : 32 endpoints HTTP.**

### Conventions transversales (héritées de Fondations + Auth)

- Tous les `POST/PATCH/DELETE/reorder` protégés par `@UseGuards(JwtAuthGuard)`
- Tous les endpoints publics sans guard
- Format d'erreur unifié via `HttpExceptionFilter` global
- Tous documentés via `@ApiOperation` + `@ApiResponse` Swagger
- Validation via `class-validator` DTOs + `ValidationPipe` global
- Pas de tests sur les controllers (calque ADR-18 d'Auth) — couverture indirecte par les services + vérif e2e curl

## 4. Arborescence des fichiers

```
src/
├── app.module.ts                              # MODIFIÉ : +7 imports
├── (autres fichiers Fondations + Auth INCHANGÉS)
│
├── database/
│   ├── (existant inchangé)
│   ├── schema/
│   │   ├── index.ts                           # MODIFIÉ : +7 export * from
│   │   ├── users.ts                           # INCHANGÉ
│   │   ├── profile.ts                         # NEW
│   │   ├── hero.ts                            # NEW
│   │   ├── social-links.ts                    # NEW
│   │   ├── diplomas.ts                        # NEW
│   │   ├── technologies.ts                    # NEW
│   │   ├── expertises.ts                      # NEW
│   │   └── service-pricing.ts                 # NEW
│   ├── seeds/
│   │   └── admin.seed.ts                      # INCHANGÉ
│   └── test-utils.ts                          # NEW : helper createMockDb()
│
├── profile/                                   # NEW
│   ├── profile.module.ts
│   ├── profile.controller.ts
│   ├── profile.service.ts
│   ├── profile.service.spec.ts
│   └── dto/update-profile.dto.ts
│
├── hero/                                      # NEW (idem)
├── social-links/                              # NEW (5 endpoints CRUD)
├── diplomas/                                  # NEW (idem)
├── technologies/                              # NEW (idem)
├── expertises/                                # NEW (7 endpoints)
└── service-pricing/                           # NEW (6 endpoints + reorder)

drizzle/
├── 0000_*.sql                                 # INCHANGÉ (users)
├── 0001_*.sql                                 # NEW : 7 tables + INSERT singletons
└── meta/
    ├── _journal.json                          # MODIFIÉ
    ├── 0000_snapshot.json                     # INCHANGÉ
    └── 0001_snapshot.json                     # NEW
```

### Notes structurelles

- 7 schémas Drizzle dans `database/schema/`, tous re-exportés par le barrel `index.ts`
- Une seule migration `0001_*.sql` couvre les 7 tables + édition manuelle pour ajouter `INSERT INTO profile DEFAULT VALUES; INSERT INTO hero DEFAULT VALUES;`
- Helper de test partagé `src/database/test-utils.ts` réutilisable pour tous les sous-projets

## 5. Modèles de données (7 schémas Drizzle)

> Tous les schémas suivent la convention héritée de `users` : UUID PK avec `gen_random_uuid()`, timestamps avec timezone, snake_case en DB.

### 5.1 — `profile` (singleton)

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

> **Pourquoi `notNull default ''`** : un singleton n'a jamais de NULL — soit la valeur est éditée, soit string vide. Évite `string | null` dans le DTO de réponse.
>
> **`bioTitle/bioParagraphs` du Hono non répliqués** (cf. ADR-18) : le frontend ne les utilise plus.

### 5.2 — `hero` (singleton)

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

### 5.3 — `social_link` (collection)

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

> Pas de défaut sur les colonnes : créer une ligne vide n'a pas de sens pour une collection. Validation via DTO.

### 5.4 — `diploma` (collection)

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

> `skills` array Postgres `notNull default '{}'` — jamais NULL, simplifie le frontend.

### 5.5 — `technology` (collection)

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

### 5.6 — `expertise` (collection avec discriminator)

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
export type ExpertiseType = typeof expertiseTypeEnum.enumValues[number];
```

> **`pgEnum` (vs text + check)** : type-safe en DB et en TS, Drizzle infère `'offer' | 'seek'`.
> **Index sur `type`** : les requêtes publiques font systématiquement `WHERE type=...`.

### 5.7 — `service_pricing` (collection + ordering)

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

> **`price: text`** (pas numeric) : texte libre style "À partir de 500€/jour". Pas de calcul, pas de devise.
> **`enabled: boolean`** : permet de "désactiver" un service sans le supprimer. Backend renvoie tout, frontend filtre.

### 5.8 — Migration `0001`

Générée par `pnpm db:generate`, **éditée manuellement** pour ajouter à la fin :

```sql
-- Seed singletons
INSERT INTO profile DEFAULT VALUES;
INSERT INTO hero DEFAULT VALUES;
```

> Décision : édition manuelle (vs migration `0002` séparée) pour garder une seule migration cohérente et éviter le bruit.

## 6. Endpoints (32) + DTOs

### 6.1 — Profile (singleton, 2 endpoints)

| Méthode | Chemin | Auth | Body | Réponse 200 |
|---|---|---|---|---|
| `GET` | `/profile` | ❌ | — | `Profile` (singleton seedé) |
| `PATCH` | `/profile` | ✅ | `UpdateProfileDto` | `Profile` mis à jour |

```typescript
class UpdateProfileDto {
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) displayName?: string;
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) location?: string;
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500) @IsUrl({}, { message: 'avatarUrl must be a valid URL' })
  avatarUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isAvailable?: boolean;
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @IsString() @MaxLength(500) availabilityMessage?: string;
}
```

### 6.2 — Hero (singleton, 2 endpoints)

| Méthode | Chemin | Auth | Body | Réponse 200 |
|---|---|---|---|---|
| `GET` | `/hero` | ❌ | — | `Hero` |
| `PATCH` | `/hero` | ✅ | `UpdateHeroDto` | `Hero` |

```typescript
class UpdateHeroDto {
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) name?: string;
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) tagline?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) availability?: string;
}
```

### 6.3 — SocialLinks (collection, 5 endpoints)

| Méthode | Chemin | Auth | Body | Réponse |
|---|---|---|---|---|
| `GET` | `/social-links` | ❌ | — | `SocialLink[]` (`ORDER BY created_at ASC`) |
| `GET` | `/social-links/:id` | ❌ | — | `SocialLink` (404 si absent) |
| `POST` | `/social-links` | ✅ | `CreateSocialLinkDto` | `SocialLink` (201) |
| `PATCH` | `/social-links/:id` | ✅ | `UpdateSocialLinkDto` | `SocialLink` (404 si absent) |
| `DELETE` | `/social-links/:id` | ✅ | — | 204 (404 si absent) |

```typescript
class CreateSocialLinkDto {
  @ApiProperty({ maxLength: 50, example: 'github' }) @IsString() @IsNotEmpty() @MaxLength(50) icon!: string;
  @ApiProperty({ maxLength: 100, example: 'GitHub' }) @IsString() @IsNotEmpty() @MaxLength(100) label!: string;
  @ApiProperty({ maxLength: 500, example: 'https://github.com/jned' })
  @IsString() @IsUrl() @MaxLength(500)
  href!: string;
}
class UpdateSocialLinkDto extends PartialType(CreateSocialLinkDto) {}
```

### 6.4 — Diplomas (collection, 5 endpoints)

Mêmes endpoints que SocialLinks.

```typescript
class CreateDiplomaDto {
  @ApiProperty({ maxLength: 200 }) @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @ApiProperty({ maxLength: 200 }) @IsString() @IsNotEmpty() @MaxLength(200) provider!: string;
  @ApiProperty({ maxLength: 1000 }) @IsString() @IsNotEmpty() @MaxLength(1000) shortDescription!: string;
  @ApiPropertyOptional({ type: [String], example: ['TypeScript', 'NestJS'] })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(50, { each: true })
  skills?: string[];
}
class UpdateDiplomaDto extends PartialType(CreateDiplomaDto) {}
```

### 6.5 — Technologies (collection, 5 endpoints)

```typescript
class CreateTechnologyDto {
  @ApiProperty({ maxLength: 100, example: 'TypeScript' }) @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @ApiProperty({ maxLength: 50, example: 'language' }) @IsString() @IsNotEmpty() @MaxLength(50) category!: string;
  @ApiProperty({ maxLength: 100, example: 'devicon-typescript-plain' }) @IsString() @IsNotEmpty() @MaxLength(100) icon!: string;
}
class UpdateTechnologyDto extends PartialType(CreateTechnologyDto) {}
```

### 6.6 — Expertises (7 endpoints)

| Méthode | Chemin | Auth | Body | Réponse |
|---|---|---|---|---|
| `GET` | `/expertises/offers` | ❌ | — | `Expertise[]` `WHERE type='offer'` |
| `GET` | `/expertises/seeks` | ❌ | — | `Expertise[]` `WHERE type='seek'` |
| `GET` | `/expertises/:id` | ✅ | — | `Expertise` (admin only — détail incluant le `type`) |
| `POST` | `/expertises/offers` | ✅ | `CreateExpertiseDto` | `Expertise` (201, `type='offer'` injecté) |
| `POST` | `/expertises/seeks` | ✅ | `CreateExpertiseDto` | `Expertise` (201, `type='seek'` injecté) |
| `PATCH` | `/expertises/:id` | ✅ | `UpdateExpertiseDto` | `Expertise` (le `type` n'est PAS modifiable) |
| `DELETE` | `/expertises/:id` | ✅ | — | 204 |

```typescript
class CreateExpertiseDto {
  @ApiProperty({ maxLength: 200 }) @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @ApiProperty({ maxLength: 1000 }) @IsString() @IsNotEmpty() @MaxLength(1000) description!: string;
}
class UpdateExpertiseDto extends PartialType(CreateExpertiseDto) {}
// Pas de champ `type` dans aucun des deux DTOs : injecté par le controller selon le path
```

### 6.7 — ServicePricing (6 endpoints)

| Méthode | Chemin | Auth | Body | Réponse |
|---|---|---|---|---|
| `GET` | `/service-pricing` | ❌ | — | `ServicePricing[]` (`ORDER BY order ASC`, **inclut `enabled=false`**) |
| `GET` | `/service-pricing/:id` | ❌ | — | `ServicePricing` (404 si absent) |
| `POST` | `/service-pricing` | ✅ | `CreateServicePricingDto` | `ServicePricing` (201) |
| `PATCH` | `/service-pricing/:id` | ✅ | `UpdateServicePricingDto` | `ServicePricing` |
| `DELETE` | `/service-pricing/:id` | ✅ | — | 204 |
| `PATCH` | `/service-pricing/reorder` | ✅ | `ReorderServicePricingDto` | `ServicePricing[]` (liste à jour) |

```typescript
class CreateServicePricingDto {
  @ApiProperty({ maxLength: 200 }) @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @ApiProperty({ maxLength: 1000 }) @IsString() @IsNotEmpty() @MaxLength(1000) description!: string;
  @ApiProperty({ maxLength: 200 }) @IsString() @IsNotEmpty() @MaxLength(200) price!: string;
  @ApiPropertyOptional({ type: [String], default: [] })
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(200, { each: true })
  features?: string[];
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() highlighted?: boolean;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ default: 0, minimum: 0 }) @IsOptional() @IsInt() @Min(0) order?: number;
}
class UpdateServicePricingDto extends PartialType(CreateServicePricingDto) {}

class ReorderServicePricingDto {
  @ApiProperty({ type: [String], description: 'IDs in desired order (index 0 = first)' })
  @IsArray() @ArrayUnique() @IsUUID('all', { each: true })
  orderedIds!: string[];
}
```

### Sémantique du reorder

Le service charge tous les IDs passés, vérifie qu'ils existent tous (sinon `BadRequestException` 400 avec liste des IDs manquants), puis dans une transaction réassigne `order = index` à chacun selon l'ordre du tableau. **Les IDs absents du body conservent leur `order` actuel** (sémantique partielle, pas réinitialisés à 0).

### Format d'erreur

Toutes les erreurs sortent via le `HttpExceptionFilter` global → `{statusCode, error, message, path, timestamp}`.

## 7. Tests

### 7.1 — Helper partagé `createMockDb()`

Pour mocker l'API fluent de Drizzle (`db.select().from(...).where(...).limit(...)`), on introduit un helper réutilisable :

```typescript
// src/database/test-utils.ts (NEW)
export function createMockDb() {
  const builder = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    returning: jest.fn(),
    transaction: jest.fn(async (fn) => fn(builder)),
  };
  return builder;
}
```

Chaque test configure `db.returning.mockResolvedValueOnce([...])` selon ce qu'il attend. Réutilisable pour tous les sous-projets futurs.

### 7.2 — Tests par module

| Fichier | ~Tests | Notes |
|---|---|---|
| `profile.service.spec.ts` | 2 | findOne (singleton), update partial |
| `hero.service.spec.ts` | 2 | idem |
| `social-links.service.spec.ts` | 6 | CRUD complet (avec 404 pour findById/update/delete) |
| `diplomas.service.spec.ts` | 6 | idem + test sur `skills` array roundtrip |
| `technologies.service.spec.ts` | 5 | CRUD |
| `expertises.service.spec.ts` | 8 | findOffers, findSeeks, findById, createOffer, createSeek, update (type immuable), delete |
| `service-pricing.service.spec.ts` | 8 | CRUD + reorder OK + reorder échoue si ID inexistant |

**Total : ~37 nouveaux tests unitaires**, ~90 tests au total.

### 7.3 — Pas de tests sur les controllers

Calque ADR-18 du sous-projet Auth. Les controllers sont des passes-plats fins ; on teste la logique dans les services et on vérifie le câblage end-to-end via curl en Task de vérification finale.

## 8. Décisions d'architecture (résumé)

| # | Décision | Pourquoi |
|---|---|---|
| ADR-1 | 1 sous-projet pour les 7 entités (vs split en 2) | Cohérence de pattern, pas de FK croisée. (Q1 → A) |
| ADR-2 | Expertises : 2 endpoints publics séparés `/offers` et `/seeks`, table unique avec discriminator | Clarté frontend, refonte propre. (Q2 → A) |
| ADR-3 | Singletons (Profile, Hero) seedés via migration | GET retourne 200 dès le boot, PATCH = simple UPDATE. (Q3 → A) |
| ADR-4 | ServicePricing : endpoint bulk `/reorder` body `{orderedIds: string[]}` | UX drag-and-drop frontend triviale. (Q4 → B) |
| ADR-5 | Pas de pagination, pas de cache, pas de soft delete, pas de slug, pas d'ordering sur autres collections | Scope minimaliste. (Q5 → tout) |
| ADR-6 | 7 modules NestJS flat dans `src/`, un par entité | Idiomatique NestJS, calque prompt-hub. (Approche 1) |
| ADR-7 | Pas de classe de base CRUD partagée | Premature abstraction ; ~80 lignes répétées tolérées. |
| ADR-8 | Pas de tests unitaires sur les controllers | Pattern hérité d'Auth (calque ADR-18 Auth) |
| ADR-9 | Helper `createMockDb()` partagé dans `src/database/test-utils.ts` | 7 spec files vont mocker DRIZZLE — DRY justifiée |
| ADR-10 | Migration `0001` éditée manuellement pour ajouter `INSERT INTO profile DEFAULT VALUES; INSERT INTO hero DEFAULT VALUES;` | Évite une migration séparée juste pour 2 inserts |
| ADR-11 | `pgEnum` pour `expertise.type` (vs text + check) | Type-safe en DB et en TS |
| ADR-12 | `text[]` Postgres avec `default '{}'` (jamais NULL) pour `skills` (Diplomas) et `features` (ServicePricing) | Simplifie le frontend |
| ADR-13 | `price` est un `text` (pas `numeric`) | Texte libre style "À partir de 500€/jour" — pas de calcul |
| ADR-14 | `enabled: boolean` sur ServicePricing, le filtrage `enabled=true` est fait par le frontend (backend renvoie tout) | Permet à l'admin de prévisualiser les services désactivés via Swagger |
| ADR-15 | Singletons `notNull default ''` pour tous les champs | Pas de `string \| null` côté frontend |
| ADR-16 | Reorder sémantique partielle : IDs absents conservent leur `order` | Permet reorder partiel (drag-and-drop d'un seul élément) |
| ADR-17 | `@IsUrl()` sur `avatarUrl` Profile et `href` SocialLink | Garde-fou contre les saisies tordues |
| ADR-18 | Suppression de `bioTitle`/`bioParagraphs` du Profile | Le frontend Angular ne les utilise plus dans la nouvelle architecture |
| ADR-19 | Avatar S3 reporté au sous-projet Projects (ou S3 dédié) | Pas de S3 setup encore ; YAGNI propre — `avatarUrl` reste un champ texte PATCH-able |
| ADR-20 | Modules métier non-`@Global`, importent explicitement DatabaseModule (déjà global) et AuthModule (pour JwtAuthGuard) | Convention NestJS canonique |

## 9. Critères de done

Le sous-projet Profile public est terminé quand toutes ces conditions sont vraies :

1. **Migration `0001_*.sql` créée et appliquée** : 7 tables présentes en DB (`\dt` montre `profile`, `hero`, `social_link`, `diploma`, `technology`, `expertise`, `service_pricing` — plus `users` de Auth).
2. **Singletons seedés** : `SELECT count(*) FROM profile;` = 1 et `SELECT count(*) FROM hero;` = 1.
3. **`pnpm test` passe** : ~90 tests verts (53 existants + ~37 nouveaux).
4. **`pnpm build`** produit `dist/` sans erreur.
5. **`pnpm lint`** clean.
6. **App boote avec 32 routes mappées** sous `/profile`, `/hero`, `/social-links`, `/diplomas`, `/technologies`, `/expertises`, `/service-pricing` (vérifié dans les logs RoutesResolver).
7. **Swagger sur `/docs`** documente les 32 endpoints avec leurs DTOs.
8. **End-to-end manuel via curl** :
   - `GET /profile` → 200 + singleton seedé
   - `PATCH /profile` (avec cookie auth) `{displayName: "Julien"}` → 200 + ligne mise à jour
   - `POST /social-links` (admin) avec un objet valide → 201
   - `GET /social-links` → 200 + array contenant la nouvelle ligne
   - `PATCH /social-links/:id` (admin) → 200
   - `DELETE /social-links/:id` (admin) → 204
   - `POST /expertises/offers` → crée avec `type='offer'`
   - `POST /expertises/seeks` → crée avec `type='seek'`
   - `GET /expertises/offers` → ne retourne que les `'offer'`
   - `GET /expertises/seeks` → ne retourne que les `'seek'`
   - `POST /service-pricing` × 3 → crée 3 services
   - `PATCH /service-pricing/reorder` avec `{orderedIds: [c, a, b]}` → réassigne `order` = 0, 1, 2
   - `GET /service-pricing` → confirme nouvel ordre
   - `POST /social-links` SANS cookie auth → 401
   - `GET /social-links` SANS cookie auth → 200 (lecture publique)
   - `DELETE /social-links/non-existent-uuid` (admin) → 404
   - `PATCH /service-pricing/reorder` avec un UUID inexistant → 400 avec message clair
9. **README mis à jour** : nouvelle section "Profile public" avec table récap des 32 endpoints + lien vers le spec.

## 10. Hors scope (suite des sous-projets)

Ordre des sous-projets restants :

1. ✅ Fondations
2. ✅ Auth
3. ✅ **Profile public** *(ce document)*
4. **Projects** (CRUD + upload image S3) — **introduit le S3 setup** dans le projet
5. **Avatar upload** (sous-projet bonus, ou intégré à Projects) — utilise le S3 du sous-projet 4 pour `POST /profile/avatar`
6. **Contact** (messages + envoi mail) — introduit le mailer
7. **Bookings** (réservations + slots + mail confirmation)
8. **CV** (upload S3 + download)
9. **Analytics** (page views + agrégats)
10. **Frontend Angular adaptation** (sous-projet séparé)

Chaque sous-projet aura son propre cycle spec → plan → implémentation.
