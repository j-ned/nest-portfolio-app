# Projects — Design

| | |
|---|---|
| **Date** | 2026-04-26 |
| **Statut** | En attente de relecture utilisateur |
| **Périmètre** | Sous-projet "Projects" du chantier de migration Hono → NestJS |
| **Projet cible** | `/home/jned/WebstormProjects/J-Ned/nest-portfolio-app` |
| **Specs précédents** | Fondations, Auth, Profile public, S3 Storage |
| **Spec suivant prévu** | Avatar Profile |

---

## 1. Contexte & motivation

Quatre sous-projets sont terminés (Fondations, Auth, Profile public, S3 Storage). Le `StorageModule @Global` est en place, exposant `StorageService` avec son API générique `(upload/get/delete/list/getPublicUrl)`. Un seul bucket `portfolio-storage` est créé en anonymous-read sur MinIO local, prêt à recevoir des préfixes par feature.

**Projects** est le 5ème sous-projet. C'est aussi le **premier vrai consommateur de S3** (validation e2e du `StorageModule` reportée à ici, cf. ADR du S3 spec). Il livre :

- Un module CRUD admin pour gérer les projets affichés sur le portfolio.
- Un endpoint d'upload d'image avec lifecycle complet (replace, cleanup S3 sur delete).
- Le pattern d'intégration S3 réutilisable pour Avatar Profile et CV.

Le backend Hono actuel (`../angular-portfolio-app/server`) reste actif pendant la construction. La migration des données réelles est explicitement reportée à la fin du chantier global.

## 2. Scope

### Inclus

- **Schéma Drizzle** `project` avec 3 indexes (`category`, `featured`, `order`) + types inférés.
- **Migration Drizzle** `0002_*.sql` générée standard (pas d'INSERT manuel).
- **`ProjectsModule`** : controller + service + DTOs + utils + tests.
- **6 endpoints sous `/projects`** :
  - `GET /projects` (public, filtres `?category` & `?featured=true`, tri fixe)
  - `GET /projects/:id` (public)
  - `POST /projects` (admin, slug auto)
  - `PATCH /projects/:id` (admin)
  - `DELETE /projects/:id` (admin, supprime image S3 si présente)
  - `POST /projects/:id/image` (admin, multipart 5MB + MIME whitelist, cleanup ancienne clé si extension diffère)
- **Lifecycle S3 actif** : upload écrase la même key, replace avec extension différente delete l'ancienne, DELETE projet delete l'image, PATCH `image: null` delete l'image.
- **Helpers** : `slugify()` (avec normalisation accents), `isUniqueViolation()` (détection conflit Postgres).
- **Wiring** : `ProjectsModule` dans `AppModule`, schéma dans le barrel `src/database/schema/index.ts`.
- **Deps** : `multer` + `@types/multer`.
- **Tests** : ~28 (service + utils, via `createMockDb()` + mock `StorageService`).
- **Mise à jour README** : section "Projects" + liste des sous-projets.

### Explicitement exclus

- **Pas de pagination** (`?page&limit`) : YAGNI, un portfolio a au plus quelques dizaines de projets.
- **Pas de `GET /projects/categories`** : le front dérive depuis la liste (`[...new Set(projects.map(p => p.category))]`).
- **Pas de tri serveur paramétrable** (`?_sort=createdAt`) : tri fixe `order ASC, createdAt DESC`.
- **Pas de cache headers** : pas de précédent dans les modules existants. À ajouter de manière transverse plus tard si besoin.
- **Pas de conversion d'image serveur** (sharp, resize, webp coercion) : l'admin uploade ce qu'il veut dans la whitelist.
- **Pas de `GET /projects/by-slug/:slug`** : le front utilise `:id` (UUID) comme tout le reste.
- **Pas de migration de données** depuis le Hono : reporté à la fin du chantier global.
- **Pas de soft delete, pas de versioning d'images, pas de signed URLs**.
- **Pas de `PATCH /projects/reorder`** : pas dans le scope Hono d'origine, à ajouter ultérieurement si besoin (pattern déjà éprouvé dans `ServicePricingModule`).

## 3. Décisions clés (résumé)

| Q | Choix | Conséquence |
|---|---|---|
| Q1 — périmètre endpoints | C : intermédiaire (CRUD + filtres `?category`/`?featured`, tri serveur fixe) | 6 endpoints, pas de pagination ni `/categories`, tri non paramétrable |
| Q2 — image stockage & URL | A : key brute en DB, URL S3 publique via `getPublicUrl()` | Cohérent ADR-5 du S3 spec, pas de proxy backend |
| Q3 — slug & identifiant upload | A : slug auto depuis `title`, upload via `:id` (UUID) | Key S3 stable `projects/<id>.<ext>`, cohérent avec autres modules NestJS |
| Q4 — modèle URLs | A : 4 champs séparés (parité Hono) | Migration future depuis Hono sans transformation |
| Q5 — lifecycle S3 | A : cleanup actif (delete avant upload si ext diffère, PATCH null, DELETE) | Pas d'orphelins, pattern réutilisable pour Avatar/CV |
| Q6 — upload validation | A : `ParseFilePipe` (5MB + MIME whitelist `webp/jpeg/png/avif`) | Erreurs 422 propres, sécurité (pas de SVG) |
| Q7 — collision slug | A : `ConflictException` (409) avec message clair | Fail-fast, cohérent avec esprit du projet |

## 4. Architecture & graphe de modules

```
┌──────────────────────────────────────────────────────────────┐
│ AppModule (existant après S3 Storage)                        │
│                                                              │
│  Imports actuels :                                           │
│   ├── ConfigModule + AppConfigModule                         │
│   ├── LoggerModule (Pino)            ← @Global               │
│   ├── DatabaseModule                  ← @Global              │
│   ├── HealthModule                                           │
│   ├── AuthModule                                             │
│   ├── 7 modules Profile public                               │
│   └── StorageModule                   ← @Global              │
│                                                              │
│  AJOUT de ce sous-projet :                                   │
│   └── ProjectsModule                                         │
│         imports:    [AuthModule, MulterModule.register(...)] │
│         controllers:[ProjectsController]                     │
│         providers:  [ProjectsService]                        │
│                                                              │
│  Inject dans le service :                                    │
│   ├── DRIZZLE     (depuis DatabaseModule @Global)            │
│   └── StorageService (depuis StorageModule @Global)          │
└──────────────────────────────────────────────────────────────┘
```

### Principes

- **Module feature-flat** : calque exact `DiplomasModule` / `ServicePricingModule`.
- **Bucket en constante privée** du service (`'portfolio-storage'`), pas de getter `AppConfigService` (cohérent avec le S3 spec qui ne définit pas `s3Bucket`).
- **Préfixe S3** : `projects/<id>.<ext>` — convention partagée avec les futures features (Avatar `avatar/<id>.<ext>`, CV `cv/<id>.pdf`).
- **`MulterModule` configuré dans le module** : `memoryStorage` (défaut) + `limits.fileSize: 5MB` comme filet de sécurité ; la validation fine est dans `ParseFilePipe` au niveau du paramètre.

## 5. Arborescence des fichiers

```
src/
├── app.module.ts                       # MODIFIÉ : +ProjectsModule
│
├── database/
│   └── schema/
│       ├── index.ts                    # MODIFIÉ : +export projects
│       └── projects.ts                 # NEW : table + types
│
├── (autres modules — INCHANGÉS)
│
└── projects/                           # NEW
    ├── projects.module.ts
    ├── projects.controller.ts
    ├── projects.service.ts
    ├── projects.service.spec.ts        # ~20 tests
    ├── projects.utils.ts               # slugify, isUniqueViolation, MIME_TO_EXT
    ├── projects.utils.spec.ts          # ~8 tests
    └── dto/
        ├── create-project.dto.ts
        └── update-project.dto.ts

drizzle/                                # MODIFIÉ : +0002_*.sql (généré)
package.json                            # MODIFIÉ : +multer, +@types/multer
README.md                               # MODIFIÉ : +section Projects
```

## 6. Schéma DB

### `src/database/schema/projects.ts`

```ts
import {
  pgTable, uuid, text, integer, boolean, timestamp, index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const projects = pgTable(
  'project',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    title: text('title').notNull(),
    slug: text('slug').notNull().unique(),
    category: text('category').notNull(),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    description: text('description').notNull(),
    image: text('image').notNull().default(''),
    liveUrl: text('live_url'),
    repoUrl: text('repo_url'),
    repoUrlFront: text('repo_url_front'),
    repoUrlBack: text('repo_url_back'),
    featured: boolean('featured').notNull().default(false),
    order: integer('order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    categoryIdx: index('project_category_idx').on(t.category),
    featuredIdx: index('project_featured_idx').on(t.featured),
    orderIdx: index('project_order_idx').on(t.order),
  }),
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
```

### Adaptations vs Hono

- `id` : `uuid` natif Postgres (au lieu de `text` + `crypto.randomUUID()` JS) — cohérence NestJS, support `ParseUUIDPipe`.
- Timestamps : `withTimezone: true` (convention NestJS, le Hono était sans tz).
- Naming export TypeScript : `projects` (pluriel), table SQL `project` (singulier, conservée pour migration future).
- Index nommage : `project_*_idx` (calque `service_pricing_order_idx`).

### Barrel `src/database/schema/index.ts` — diff

```ts
import * as projects from './projects';
// ...
export * from './projects';
// ...
export const schema = {
  // ... existants
  ...projects,
} as const;
```

### Migration

Générée par `pnpm db:generate` → fichier `drizzle/0002_*.sql`. Pas d'INSERT manuel à appender (contrairement à `0001` pour les singletons Profile/Hero).

## 7. DTOs

### `src/projects/dto/create-project.dto.ts`

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional,
  IsString, IsUrl, MaxLength, Min, ValidateIf,
} from 'class-validator';

export class CreateProjectDto {
  @ApiProperty({ maxLength: 200 })
  @IsString() @IsNotEmpty() @MaxLength(200)
  title!: string;

  @ApiProperty({ maxLength: 100 })
  @IsString() @IsNotEmpty() @MaxLength(100)
  category!: string;

  @ApiPropertyOptional({ type: [String], example: ['Angular', 'NestJS'] })
  @IsOptional() @IsArray() @ArrayMaxSize(20)
  @IsString({ each: true }) @MaxLength(50, { each: true })
  tags?: string[];

  @ApiProperty({ maxLength: 5000 })
  @IsString() @IsNotEmpty() @MaxLength(5000)
  description!: string;

  @ApiPropertyOptional({ format: 'uri', nullable: true })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUrl()
  liveUrl?: string | null;

  @ApiPropertyOptional({ format: 'uri', nullable: true })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUrl()
  repoUrl?: string | null;

  @ApiPropertyOptional({ format: 'uri', nullable: true })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUrl()
  repoUrlFront?: string | null;

  @ApiPropertyOptional({ format: 'uri', nullable: true })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUrl()
  repoUrlBack?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional() @IsBoolean()
  featured?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional() @IsInt() @Min(0)
  order?: number;
}
```

### `src/projects/dto/update-project.dto.ts`

```ts
import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, ValidateIf } from 'class-validator';
import { CreateProjectDto } from './create-project.dto';

export class UpdateProjectDto extends PartialType(CreateProjectDto) {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Pass null to remove image (also deletes from S3)',
  })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  image?: string | null;
}
```

### Notes

- Pas de champ `slug` dans le Create : auto-calculé serveur. Pas de surface API supplémentaire.
- Pas de champ `image` dans le Create : passe par l'endpoint upload dédié.
- `image` ajouté dans Update **uniquement pour permettre `PATCH { image: null }`** (suppression). Pour set une nouvelle image : passer par l'endpoint upload.
- `tags` : 20 entrées × 50 chars max (sécurité payload).
- `description` : 5000 chars max (suffisant, évite TEXT illimité).
- URLs : `@ValidateIf((_, v) => v !== null) @IsUrl()` autorise explicitement `null` pour effacer un champ.
- Pas de DTO pour les query params de `GET /projects` : 2 paramètres simples, lecture directe via `@Query()`.

## 8. Service

### `src/projects/projects.service.ts`

```ts
import {
  ConflictException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { projects, type NewProject, type Project } from '../database/schema/projects';
import { StorageService } from '../storage/storage.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { isUniqueViolation, MIME_TO_EXT, slugify } from './projects.utils';

@Injectable()
export class ProjectsService {
  private static readonly BUCKET = 'portfolio-storage';

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  findAll(filters: { category?: string; featured?: boolean }): Promise<Project[]> {
    const conditions: SQL[] = [];
    if (filters.category) conditions.push(eq(projects.category, filters.category));
    if (filters.featured) conditions.push(eq(projects.featured, true));

    return this.db
      .select()
      .from(projects)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(projects.order), desc(projects.createdAt));
  }

  async findById(id: string): Promise<Project> {
    const [row] = await this.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!row) throw new NotFoundException(`Project ${id} not found`);
    return row;
  }

  async create(dto: CreateProjectDto): Promise<Project> {
    const slug = slugify(dto.title);
    try {
      const [row] = await this.db.insert(projects).values({ ...dto, slug }).returning();
      return row;
    } catch (err) {
      if (isUniqueViolation(err, 'slug')) {
        throw new ConflictException(`Project with slug "${slug}" already exists`);
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateProjectDto): Promise<Project> {
    const current = await this.findById(id);

    const patch: Partial<NewProject> = { ...dto, updatedAt: new Date() };
    if (dto.title !== undefined) patch.slug = slugify(dto.title);

    if (dto.image === null && current.image) {
      await this.storage.delete(ProjectsService.BUCKET, current.image);
      patch.image = '';
    }

    try {
      const [row] = await this.db.update(projects).set(patch).where(eq(projects.id, id)).returning();
      return row;
    } catch (err) {
      if (isUniqueViolation(err, 'slug')) {
        throw new ConflictException(`Project with slug "${patch.slug}" already exists`);
      }
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    const current = await this.findById(id);
    if (current.image) {
      await this.storage.delete(ProjectsService.BUCKET, current.image);
    }
    await this.db.delete(projects).where(eq(projects.id, id));
  }

  async uploadImage(
    id: string,
    file: Express.Multer.File,
  ): Promise<{ image: string; url: string }> {
    const current = await this.findById(id);

    const ext = MIME_TO_EXT[file.mimetype];
    const newKey = `projects/${id}.${ext}`;

    if (current.image && current.image !== newKey) {
      await this.storage.delete(ProjectsService.BUCKET, current.image);
    }

    await this.storage.upload(ProjectsService.BUCKET, newKey, file.buffer, file.mimetype);

    await this.db
      .update(projects)
      .set({ image: newKey, updatedAt: new Date() })
      .where(eq(projects.id, id));

    return {
      image: newKey,
      url: this.storage.getPublicUrl(ProjectsService.BUCKET, newKey),
    };
  }
}
```

### `src/projects/projects.utils.ts`

```ts
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export const MIME_TO_EXT: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/avif': 'avif',
};

export function isUniqueViolation(err: unknown, columnHint?: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: string }).code;
  if (code !== '23505') return false;
  if (!columnHint) return true;
  const constraint = (err as { constraint_name?: string }).constraint_name ?? '';
  return constraint.includes(columnHint);
}
```

### Notes

- Bucket en constante privée du service (pas de getter `AppConfigService`).
- `findById` factorise le 404.
- `slugify` couvre les accents français (`é → e`, `ç → c`).
- `isUniqueViolation` reste local au module tant qu'il n'a qu'un consommateur (YAGNI sur la promotion en `src/common/`).
- L'API `uploadImage` retourne `{ image, url }` : key brute pour cohérence DB + URL publique pour usage immédiat client (évite un GET supplémentaire).

## 9. Controller

### `src/projects/projects.controller.ts`

```ts
import {
  Body, Controller, Delete, FileTypeValidator, Get, HttpCode, HttpStatus,
  MaxFileSizeValidator, Param, ParseFilePipe, ParseUUIDPipe, Patch, Post, Query,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';

@ApiTags('Projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: 'List projects (public, filterable)' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'featured', required: false, enum: ['true'] })
  findAll(
    @Query('category') category?: string,
    @Query('featured') featured?: string,
  ) {
    return this.projects.findAll({ category, featured: featured === 'true' });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a project by id (public)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.findById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a project (admin)' })
  @ApiResponse({ status: 409, description: 'Slug already exists' })
  create(@Body() dto: CreateProjectDto) {
    return this.projects.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a project (admin). Pass image:null to remove image.' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'Slug already exists' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a project + its S3 image (admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.remove(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/image')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOperation({
    summary: 'Upload/replace project image (admin, max 5MB, image/webp|jpeg|png|avif)',
  })
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /^image\/(webp|jpeg|png|avif)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.projects.uploadImage(id, file);
  }
}
```

## 10. Module

### `src/projects/projects.module.ts`

```ts
import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AuthModule } from '../auth/auth.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [
    AuthModule,
    MulterModule.register({
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
```

### Notes

- `MulterModule.register()` sans `dest:` ⇒ `memoryStorage` (défaut) ⇒ `file.buffer` dispo pour upload S3 direct.
- `limits.fileSize` ici sert de **filet de sécurité** (défense en profondeur). Validation fine = `ParseFilePipe` au paramètre.
- `AuthModule` importé pour `JwtAuthGuard` (calque autres modules métier).
- `StorageModule` (`@Global`) et `DatabaseModule` (`@Global`) ne sont pas importés explicitement — leurs services sont injectables directement.

## 11. Tests

Couverture totale : **~28 tests** (20 service + 8 utils).

### `src/projects/projects.service.spec.ts` (~20 tests)

Stack : `createMockDb()` (helper partagé `src/database/test-utils.ts`) + mock `StorageService` (Jest mock).

| # | Bloc | Cas |
|---|---|---|
| 1 | `findAll` | sans filtre → retourne tout, ordré par `order ASC, createdAt DESC` |
| 2 | `findAll` | avec `category` → applique `eq(category)` |
| 3 | `findAll` | avec `featured: true` → applique `eq(featured, true)` |
| 4 | `findAll` | avec les deux filtres → applique `and(...)` |
| 5 | `findById` | trouvé → retourne le projet |
| 6 | `findById` | absent → throw `NotFoundException` |
| 7 | `create` | succès → slug calculé, retourné |
| 8 | `create` | accents dans le titre → slug normalisé (`Mon Été` → `mon-ete`) |
| 9 | `create` | unique violation `slug` → `ConflictException` |
| 10 | `update` | absent → 404 |
| 11 | `update` | nouveau title → re-slugifie |
| 12 | `update` | `image: null` + image présente → `storage.delete` appelé + set `image: ''` |
| 13 | `update` | unique violation `slug` après re-slugify → `ConflictException` |
| 14 | `remove` | absent → 404 |
| 15 | `remove` | présent avec image → `storage.delete` appelé + DB delete |
| 16 | `remove` | présent sans image → ne touche pas S3 |
| 17 | `uploadImage` | absent → 404 |
| 18 | `uploadImage` | nouvelle image, projet sans image → upload + update DB, pas de delete |
| 19 | `uploadImage` | replace même extension → upload (overwrite), pas de delete |
| 20 | `uploadImage` | replace extension différente → delete ancienne, upload nouvelle, update DB |

### `src/projects/projects.utils.spec.ts` (~8 tests)

| # | Cas |
|---|---|
| 1 | `slugify('Mon site')` → `'mon-site'` |
| 2 | `slugify('Mon Été 2026')` → `'mon-ete-2026'` |
| 3 | `slugify('  hello---world  ')` → `'hello-world'` |
| 4 | `slugify('!!@@##')` → `''` |
| 5 | `isUniqueViolation({ code: '23505', constraint_name: 'project_slug_unique' }, 'slug')` → `true` |
| 6 | `isUniqueViolation({ code: '23505', constraint_name: 'other_constraint' }, 'slug')` → `false` |
| 7 | `isUniqueViolation({ code: '99999' })` → `false` |
| 8 | `isUniqueViolation(null)` → `false` |

### Hors scope (tests)

- **Pas de tests controller/e2e** : cohérent avec la convention du projet (`*.service.spec.ts` à côté du source). Validations `ParseFilePipe`/`ParseUUIDPipe` = framework, déjà testées en amont.
- **Pas d'intégration MinIO réelle** : couverte par la vérification e2e manuelle (section 12).

## 12. Critères de done

Le sous-projet est terminé quand toutes ces conditions sont vraies :

1. **Schéma & migration** : `src/database/schema/projects.ts` créé, exporté dans le barrel. `pnpm db:generate` produit `0002_*.sql` (table + 3 indexes). `pnpm db:migrate` applique sans erreur.

2. **Dépendances** : `multer` (prod) + `@types/multer` (dev). `pnpm install` idempotent.

3. **Module wiré** : `ProjectsModule` listé dans `AppModule.imports`. App boot OK, log montre `ProjectsModule dependencies initialized` + 6 routes mappées sous `/projects`.

4. **Endpoints fonctionnels** :
   - `GET /projects` → 200, liste triée `order ASC, createdAt DESC`
   - `GET /projects?category=web` → 200, filtre exact
   - `GET /projects?featured=true` → 200, filtre booléen
   - `GET /projects/:id` → 200 / 404
   - `POST /projects` → 401 sans cookie, 201 avec, 409 si slug collision, 400 si DTO invalide
   - `PATCH /projects/:id` → auth, 200 / 404 / 409 / 400
   - `PATCH /projects/:id` body `{ image: null }` → image S3 supprimée + champ vidé
   - `DELETE /projects/:id` → auth, 204 / 404
   - `POST /projects/:id/image` → auth, 200, 422 si >5MB ou MIME hors whitelist, 404 si projet absent

5. **Lifecycle S3 vérifié** :
   - Upload `.webp` initial → fichier dans `portfolio-storage/projects/<id>.webp`
   - Re-upload `.webp` (même ext) → fichier écrasé, pas d'orphelin
   - Re-upload `.jpg` (ext différente) → ancien `.webp` supprimé, nouveau `.jpg` créé
   - DELETE projet avec image → fichier S3 supprimé
   - PATCH `image: null` → fichier S3 supprimé + champ vidé

6. **Validation** : `forbidNonWhitelisted` strippe les champs inattendus. `ParseFilePipe` retourne 422 propre avec message lisible.

7. **Tests** : ~28 nouveaux tests **tous verts**. Total projet ~136 tests.

8. **Build prod OK** (`pnpm build`), **lint clean** (`pnpm lint`).

9. **Vérification end-to-end manuelle** :
   ```bash
   pnpm db:up && pnpm db:wait && pnpm s3:up && pnpm db:migrate && pnpm dev
   # Dans un autre terminal :
   curl -X POST http://localhost:3000/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"...","password":"..."}' \
     -c cookies.txt
   curl -X POST http://localhost:3000/projects \
     -b cookies.txt -H 'Content-Type: application/json' \
     -d '{"title":"Mon premier projet","category":"web","description":"Test","tags":["Angular"]}'
   # → récupérer l'id
   curl -X POST http://localhost:3000/projects/<ID>/image \
     -b cookies.txt -F file=@/tmp/test.webp
   # Vérifier l'URL retournée :
   curl -fsSI <URL_RETOURNEE>
   curl -fsSI http://localhost:9000/portfolio-storage/projects/<ID>.webp
   curl -X DELETE http://localhost:3000/projects/<ID> -b cookies.txt
   curl -fsSI http://localhost:9000/portfolio-storage/projects/<ID>.webp   # 404 (cleanup OK)
   ```

10. **README mis à jour** :
    - Nouvelle section "Projects" (endpoints, validation upload, lifecycle image)
    - Liste des sous-projets : `5. ✅ Projects`, `6. **Avatar Profile** *(prochain)*`

## 13. Hors scope (suite du chantier)

Une fois ce sous-projet terminé :

6. **Avatar Profile** (`POST /profile/avatar` qui consomme `StorageService` — calque exact du pattern Projects pour l'upload).
7. **Contact** (messages + mailer).
8. **Bookings** (réservations + slots + mail confirmation).
9. **CV** (`POST /cv` + `GET /cv/download` qui consomment `StorageService`).
10. **Analytics** (page views + agrégats).
11. **Frontend Angular adaptation** + **migration des données réelles** depuis le backend Hono.
