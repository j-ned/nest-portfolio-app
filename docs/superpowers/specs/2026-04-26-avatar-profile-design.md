# Avatar Profile — Design

| | |
|---|---|
| **Date** | 2026-04-26 |
| **Statut** | En attente de relecture utilisateur |
| **Périmètre** | Sous-projet "Avatar Profile" du chantier de migration Hono → NestJS |
| **Projet cible** | `/home/jned/WebstormProjects/J-Ned/nest-portfolio-app` |
| **Specs précédents** | Fondations, Auth, Profile public, S3 Storage, Projects |
| **Spec suivant prévu** | Contact |

---

## 1. Contexte & motivation

Cinq sous-projets sont terminés. Le `StorageModule @Global` est en place et a été validé en condition réelle par Projects (premier consommateur). Le pattern d'intégration S3 (lifecycle actif `upload → DB → cleanup`, `@Equals(null)` dans le PATCH DTO, `ParseFilePipe` whitelist MIME) est éprouvé.

**Avatar Profile** est le 6ème sous-projet. Il livre :

- Un endpoint d'upload d'avatar pour le singleton `Profile` (pattern S3 réutilisé).
- La transformation des keys S3 brutes en URLs publiques en sortie API (`findOne` du Profile).
- Un correctif rétroactif du même genre dans `ProjectsService` (les méthodes `findAll`/`findById` retournaient encore les keys brutes au lieu des URLs : la spec Projects voulait des URLs mais l'implémentation n'a transformé qu'au niveau de `uploadImage`).

Après ce sous-projet, le pattern "key en DB, URL en API" sera homogène entre Projects et Avatar — cohérent avec l'ADR-5 du S3 Storage spec.

## 2. Scope

### Inclus

**Avatar Profile** :
- **`UpdateProfileDto.avatarUrl`** modifié : passe de `@IsUrl()` à `@Equals(null)` (interdit toute valeur non-null, même protection que `UpdateProjectDto.image`).
- **`ProfileService.uploadAvatar(file)`** : nouvelle méthode. Lifecycle actif `upload → DB → cleanup` ancienne clé si extension diffère.
- **`ProfileService.findOne()` et `update()`** : transforment `avatarUrl` (key brute → URL publique) avant de retourner. Helper privé `findOneRaw` pour les usages internes nécessitant la key brute.
- **`ProfileController.uploadAvatar`** : nouveau endpoint `POST /profile/avatar` (auth, multipart, `ParseFilePipe` 5MB + MIME whitelist `webp|jpeg|png|avif`).
- **`ProfileModule`** : ajout `MulterModule.register({ limits: { fileSize: 5MB } })`.
- **Bucket** : `'portfolio-storage'` (existant, partagé). **Préfixe** : `avatar/avatar.<ext>` (nom fixe car singleton).
- ~10 nouveaux tests dans `profile.service.spec.ts` + ajustement des 2 existants pour la transformation URL.

**Correctif Projects (rétroactif, dans le même sous-projet)** :
- **`ProjectsService.findAll()` et `findById()`** : map `image` → URL publique via `getPublicUrl()` quand `image !== ''`.
- Helper privé **`findByIdRaw`** : pour les usages internes (`update`, `remove`, `uploadImage`) nécessitant la key brute.
- **`uploadImage`** garde son shape de réponse `{ image, url }` (pas de breaking change ; le shape était déjà non-uniforme et fait sens pour ce cas — le client a besoin de l'URL immédiate post-upload).
- Ajustement des tests `findAll`/`findById` qui assertent la valeur de `image`.

### Explicitement exclus

- **Pas de `DELETE /profile/avatar`** dédié : la suppression passe par `PATCH /profile` body `{ avatarUrl: null }`. Cohérent avec le pattern Projects (`{ image: null }`).
- **Pas de proxy backend** (`GET /profile/avatar-image` du Hono) : URL S3 directe via `getPublicUrl()`.
- **Pas de signed URLs, pas de versioning, pas de resize/optimisation serveur**.
- **Pas de migration de données existantes** : la colonne `avatarUrl` est seedée à `''` par migration `0001`. Les éventuelles URLs déjà PATCHées (rare, env de dev) seront silencieusement traitées comme des "keys" — invalides, retourneront un lien S3 cassé. L'admin re-uploadera.
- **Pas d'extension du bucket ni de sa policy** : déjà `anonymous-read` depuis le S3 Storage subproject.
- **Pas de hoisting de `MIME_TO_EXT`** dans `src/common/` : on l'importe directement depuis `src/projects/projects.utils`. Hoisting envisageable quand un 3ème consommateur (CV) apparaîtra.

## 3. Décisions clés (résumé)

| Q | Choix | Conséquence |
|---|---|---|
| Q1 — endpoints scope | A : `POST /profile/avatar` seul (suppression via `PATCH avatarUrl: null`) | Une seule nouvelle route, cohérent avec Projects |
| Q2 — format key S3 | A : `avatar/avatar.<ext>` | Préfixe `avatar/`, nom fixe (singleton), pas de pollution racine |
| Q3 — surface API GET | A : transformer dans le service (key DB → URL API) | Frontend reçoit une URL prête à coller dans `<img src>` |
| Q4 — réponse upload | B : retourner la `Profile` complète | Cohérent avec `PATCH /profile`, frontend remplace son state |
| (lock) — Validation | 5MB + MIME whitelist `webp\|jpeg\|png\|avif` | Calque Projects |
| (lock) — DTO `avatarUrl` | `@Equals(null)` (was `@IsUrl()`) | Sécurité : interdit l'écrasement de la key DB par une string arbitraire |
| (lock) — Lifecycle S3 | `upload → DB → cleanup` ; `PATCH null` → `DB → S3 delete` | Calque Projects (corrigé), préfère orphelin S3 à référence DB cassée |
| Bonus — Correctif Projects | (i) Inclus dans ce sous-projet | Cohérence end-to-end avant Avatar, évite dette pendante |

## 4. Architecture & graphe de modules

Pas de nouveau module. On étend `ProfileModule` existant.

```
┌──────────────────────────────────────────────────────────────┐
│ AppModule (existant après Projects)                          │
│                                                              │
│   …                                                          │
│   ├── ProfileModule       ← MODIFIÉ : +MulterModule.register │
│   │     controllers: [ProfileController]                     │
│   │     providers:   [ProfileService]                        │
│   │     ProfileService injecte :                             │
│   │       ├── DRIZZLE  (DatabaseModule @Global)              │
│   │       └── StorageService (StorageModule @Global)         │
│   │                                                          │
│   ├── ProjectsModule      ← MODIFIÉ : findAll/findById       │
│   │                                    transformation URL     │
│   …                                                          │
└──────────────────────────────────────────────────────────────┘
```

### Principes

- **Pas de nouveau module** : `ProfileModule` accueille le nouvel endpoint `POST /profile/avatar` et la nouvelle méthode `uploadAvatar`.
- **`StorageService` injecté dans `ProfileService`** : pas de port/adapter, dépendance directe (calque Projects).
- **Bucket en constante privée du service** : `private static readonly BUCKET = 'portfolio-storage'` (calque Projects).
- **`MulterModule.register` au niveau `ProfileModule`** : `memoryStorage` par défaut, `limits: 5MB` comme filet de sécurité (validation fine via `ParseFilePipe` au paramètre).

## 5. Arborescence des fichiers

```
src/
├── profile/                                    # MODIFIÉ
│   ├── dto/
│   │   └── update-profile.dto.ts               # MODIFIÉ : avatarUrl → @Equals(null)
│   ├── profile.controller.ts                   # MODIFIÉ : +uploadAvatar
│   ├── profile.module.ts                       # MODIFIÉ : +MulterModule.register
│   ├── profile.service.ts                      # MODIFIÉ : +uploadAvatar, transform URL, helpers
│   └── profile.service.spec.ts                 # MODIFIÉ : ajustements + ~10 tests nouveaux
│
└── projects/                                   # MODIFIÉ (correctif rétroactif)
    ├── projects.service.ts                     # MODIFIÉ : findAll/findById transforment image
    └── projects.service.spec.ts                # MODIFIÉ : ajustement des assertions findAll/findById

README.md                                       # MODIFIÉ : +section Avatar Profile + liste sous-projets
```

**Aucun fichier nouveau**. Aucune migration. Aucune nouvelle dépendance.

## 6. Schéma DB

**Aucune migration**. La table `profile` existe déjà avec :

```typescript
avatarUrl: text('avatar_url').notNull().default(''),
```

Le changement est sémantique uniquement :
- **Avant** : la colonne stockait une URL string complète (legacy de l'époque où le PATCH acceptait `@IsUrl()`).
- **Après** : la colonne stocke une **key S3 brute** (ex `avatar/avatar.webp`), avec `''` pour "pas d'avatar". L'API retourne l'URL transformée via `getPublicUrl()`.

## 7. DTO

`src/profile/dto/update-profile.dto.ts` (modifié) :

```typescript
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional() @IsString() @MaxLength(200)
  displayName?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional() @IsString() @MaxLength(200)
  location?: string;

  @ApiPropertyOptional({
    type: 'null',
    nullable: true,
    description:
      'Pass null to remove avatar (also deletes from S3). Use POST /profile/avatar to upload a new one.',
  })
  @IsOptional() @Equals(null)
  avatarUrl?: null;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500)
  availabilityMessage?: string;
}
```

**Diff** :
- `@IsUrl({}, { message: 'avatarUrl must be a valid URL' })` retiré.
- `@Equals(null)` ajouté.
- Type passe de `avatarUrl?: string` à `avatarUrl?: null`.

## 8. Service

`src/profile/profile.service.ts` (réécrit) :

```typescript
import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { profile, type NewProfile, type Profile } from '../database/schema/profile';
import { StorageService } from '../storage/storage.service';
import { MIME_TO_EXT } from '../projects/projects.utils';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class ProfileService {
  private static readonly BUCKET = 'portfolio-storage';

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  async findOne(): Promise<Profile> {
    const row = await this.findOneRaw();
    return this.toResponse(row);
  }

  async update(dto: UpdateProfileDto): Promise<Profile> {
    const current = await this.findOneRaw();

    // avatarUrl extrait du spread : il ne peut être que null ou undefined côté DTO,
    // mais on ne veut jamais qu'il soit propagé tel quel dans le patch DB
    // (la column est NOT NULL DEFAULT '').
    const { avatarUrl, ...rest } = dto;
    const patch: Partial<NewProfile> = { ...rest, updatedAt: new Date() };
    if (avatarUrl === null) patch.avatarUrl = '';

    const [row] = await this.db
      .update(profile)
      .set(patch)
      .where(eq(profile.id, current.id))
      .returning();

    // Cleanup S3 APRÈS le write DB réussi : si le write échoue, on préfère
    // garder l'objet S3 (orphelin DB-cohérent) plutôt qu'une DB cassée.
    if (avatarUrl === null && current.avatarUrl) {
      await this.storage.delete(ProfileService.BUCKET, current.avatarUrl);
    }

    return this.toResponse(row);
  }

  async uploadAvatar(file: Express.Multer.File): Promise<Profile> {
    const current = await this.findOneRaw();

    const ext = MIME_TO_EXT[file.mimetype];
    const newKey = `avatar/avatar.${ext}`;

    // Ordre : upload → update DB → cleanup ancienne clé.
    // Si une étape échoue, on préfère un orphelin S3 (cleanup manuel possible)
    // à une DB qui référence une clé supprimée (image cassée côté front).
    await this.storage.upload(
      ProfileService.BUCKET,
      newKey,
      file.buffer,
      file.mimetype,
    );

    const [row] = await this.db
      .update(profile)
      .set({ avatarUrl: newKey, updatedAt: new Date() })
      .where(eq(profile.id, current.id))
      .returning();

    if (current.avatarUrl && current.avatarUrl !== newKey) {
      await this.storage.delete(ProfileService.BUCKET, current.avatarUrl);
    }

    return this.toResponse(row);
  }

  // Helper privé : retourne la row brute (sans transformation URL).
  // Utilisé par toutes les opérations internes qui ont besoin de la key S3.
  private async findOneRaw(): Promise<Profile> {
    const rows = await this.db.select().from(profile).limit(1);
    if (rows.length === 0) {
      throw new InternalServerErrorException(
        'Profile singleton missing — did you run the migration?',
      );
    }
    return rows[0];
  }

  // Transforme la key DB en URL publique pour la sortie API.
  // L'avatarUrl est soit '' (pas d'avatar), soit l'URL S3 publique complète.
  private toResponse(p: Profile): Profile {
    return {
      ...p,
      avatarUrl: p.avatarUrl
        ? this.storage.getPublicUrl(ProfileService.BUCKET, p.avatarUrl)
        : '',
    };
  }
}
```

**Notes** :
- `MIME_TO_EXT` importé depuis `src/projects/projects.utils` (DRY).
- `findOneRaw` reste privé : pas exposé hors du service (calque le pattern Projects' `findById` qu'on va dupliquer en `findByIdRaw` dans le correctif).
- Le `Profile` type retourné par `toResponse` reste typé `Profile` (la transformation est implicite dans la sémantique du champ ; pas de type alias séparé `ProfileResponse` — YAGNI).

## 9. Controller

`src/profile/profile.controller.ts` (méthode ajoutée, reste inchangé) :

```typescript
@UseGuards(JwtAuthGuard)
@Post('avatar')
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
  summary:
    'Upload/replace profile avatar (admin, max 5MB, image/webp|jpeg|png|avif)',
})
@ApiResponse({ status: 422, description: 'File too large or unsupported MIME type' })
@UseInterceptors(FileInterceptor('file'))
uploadAvatar(
  @UploadedFile(
    new ParseFilePipe({
      validators: [
        new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
        new FileTypeValidator({
          fileType: /^image\/(webp|jpeg|png|avif)$/,
        }),
      ],
    }),
  )
  file: Express.Multer.File,
) {
  return this.profile.uploadAvatar(file);
}
```

Imports ajoutés :
```typescript
import {
  FileTypeValidator,
  MaxFileSizeValidator,
  ParseFilePipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
```

Pas de `:id` (singleton). Pas de 404 (singleton garanti par migration `0001`). 422 documenté pour les cas `ParseFilePipe`.

## 10. Module

`src/profile/profile.module.ts` (modifié) :

```typescript
import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AuthModule } from '../auth/auth.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [
    AuthModule,
    MulterModule.register({
      // Mémoire (memoryStorage par défaut) : on garde le buffer pour upload S3 direct.
      // Filet de sécurité supplémentaire — la validation fine est dans ParseFilePipe.
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  ],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
```

`AuthModule` était déjà présent (le module existait avec `JwtAuthGuard` pour `PATCH`). Seul ajout : `MulterModule.register`.

## 11. Correctif Projects

### `src/projects/projects.service.ts` — diff

Ajouter le helper privé `toResponse` et `findByIdRaw`, modifier `findAll` et `findById` :

```typescript
findAll(filters: { ... }): Promise<Project[]> {
  const conditions: SQL[] = [];
  if (filters.category) conditions.push(eq(projects.category, filters.category));
  if (filters.featured) conditions.push(eq(projects.featured, true));

  return this.db
    .select()
    .from(projects)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(projects.order), desc(projects.createdAt))
    .then((rows) => rows.map((r) => this.toResponse(r)));
}

async findById(id: string): Promise<Project> {
  const row = await this.findByIdRaw(id);
  return this.toResponse(row);
}

private async findByIdRaw(id: string): Promise<Project> {
  const [row] = await this.db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!row) throw new NotFoundException(`Project ${id} not found`);
  return row;
}

private toResponse(p: Project): Project {
  return {
    ...p,
    image: p.image
      ? this.storage.getPublicUrl(ProjectsService.BUCKET, p.image)
      : '',
  };
}
```

`update`, `remove`, `uploadImage` doivent appeler `findByIdRaw` à la place de `findById` (pour récupérer la key brute et pouvoir la passer à `storage.delete`). Le `return` de `update` doit aussi passer par `toResponse` (pour rester cohérent : le client reçoit une URL, pas une key).

`uploadImage` garde son shape de retour `{ image: '<key>', url: '<public-url>' }` — pas de breaking change. Le client peut continuer à se référer à l'URL pour l'affichage immédiat, et ignorer la key.

### Tests Projects à ajuster

Dans `src/projects/projects.service.spec.ts` :
- Les tests `findAll` qui asserent les rows entières doivent désormais comparer la version transformée (avec `image` en URL). Solution simple : le mock de `storage.getPublicUrl` retourne `'https://example.test/url'`, et les tests comparent `result[0].image === 'https://example.test/url'` quand `image` non vide, sinon `''`.
- Idem pour `findById`.
- `update`, `remove`, `uploadImage` : pas de changement (utilisent `findByIdRaw` interne, dont les mocks de `db.limit.mockResolvedValueOnce([current])` continuent de fonctionner).
- Au moins un test nouveau : `findById` retourne `image: ''` quand `image` DB est `''` (vérifie le branchement conditionnel de `toResponse`).

## 12. Tests Avatar

`src/profile/profile.service.spec.ts` étendu (~10 tests nouveaux + ajustement des 2 existants) :

| # | Bloc | Cas |
|---|---|---|
| 1 | `findOne` | retourne profile avec `avatarUrl` transformée en URL si key non vide |
| 2 | `findOne` | retourne `avatarUrl: ''` si key vide |
| 3 | `findOne` | throw InternalServerErrorException si singleton absent (existant — vérifier que ça passe toujours après refactor) |
| 4 | `update` | met à jour les champs simples + retourne Profile avec URL transformée |
| 5 | `update` | `avatarUrl: null` + key existante → DB write puis `storage.delete` ; vérifier l'ORDRE (DB avant S3) |
| 6 | `update` | `avatarUrl: null` + pas de key → DB write, pas de delete |
| 7 | `update` | DB write échoue → ne touche pas S3 (régression de la philosophie Projects) |
| 8 | `uploadAvatar` | upload + DB write, pas de delete si pas de key existante |
| 9 | `uploadAvatar` | replace même extension → upload (overwrite), pas de delete |
| 10 | `uploadAvatar` | replace extension différente → upload + DB + delete ancienne |
| 11 | `uploadAvatar` | retourne Profile avec `avatarUrl` transformée en URL |

**Stack tests** : `createMockDb()` (helper partagé) + mock `StorageService` (Jest mock). `storage.getPublicUrl` mock retourne `'https://example.test/url'`.

## 13. Critères de done

Le sous-projet est terminé quand :

1. **DTO** : `UpdateProfileDto.avatarUrl` est `@Equals(null)` (plus `@IsUrl()`). Build TS clean.
2. **Service Profile** : `uploadAvatar` implémenté, `findOne`/`update` retournent une `Profile` avec `avatarUrl` transformée en URL ou `''`.
3. **Controller Profile** : `POST /profile/avatar` mappé, auth + multipart + `ParseFilePipe`.
4. **Module Profile** : `MulterModule.register({ limits: 5MB })` ajouté.
5. **Service Projects** : `findAll`/`findById` retournent des `Project` avec `image` transformée. `findByIdRaw` privé pour usages internes. `update`, `remove`, `uploadImage` utilisent `findByIdRaw`.
6. **Tests Profile** : ~10 nouveaux + 2 ajustés. Tous verts.
7. **Tests Projects** : ajustements pour la transformation `image`. Tous verts.
8. **Total tests** : ~155 verts (était 145, +~10 Avatar).
9. **Build prod** OK, **lint** clean.
10. **Vérification e2e manuelle** :
    ```bash
    pnpm db:up && pnpm db:wait && pnpm s3:up && pnpm dev
    # Login admin + cookie
    curl -X POST http://localhost:3000/profile/avatar -b cookies.txt -F file=@/tmp/test.webp
    # → renvoie Profile avec avatarUrl: 'http://localhost:9000/portfolio-storage/avatar%2Favatar.webp'
    curl http://localhost:3000/profile   # avatarUrl est l'URL publique
    curl -fsSI 'http://localhost:9000/portfolio-storage/avatar/avatar.webp'   # 200
    # Replace avec .png
    curl -X POST http://localhost:3000/profile/avatar -b cookies.txt -F file=@/tmp/test.png
    curl -fsSI 'http://localhost:9000/portfolio-storage/avatar/avatar.webp'   # 404 (cleanup)
    curl -fsSI 'http://localhost:9000/portfolio-storage/avatar/avatar.png'    # 200
    # PATCH avatarUrl: null
    curl -X PATCH http://localhost:3000/profile -b cookies.txt \
      -H 'Content-Type: application/json' -d '{"avatarUrl":null}'
    curl -fsSI 'http://localhost:9000/portfolio-storage/avatar/avatar.png'    # 404
    # PATCH avatarUrl: 'hack' → 400
    curl -X PATCH http://localhost:3000/profile -b cookies.txt \
      -H 'Content-Type: application/json' -d '{"avatarUrl":"hack"}'   # 400
    # Vérifier Projects aussi : URL transformée
    curl http://localhost:3000/projects   # image dans chaque row est une URL S3 complète
    ```
11. **README mis à jour** : nouvelle section "Avatar Profile" + liste des sous-projets : `6. ✅ Avatar Profile`, `7. **Contact** *(prochain)*`.

## 14. Hors scope (suite)

Une fois ce sous-projet terminé :

7. **Contact** (messages + mailer).
8. **Bookings** (réservations + slots + mail).
9. **CV** (upload S3 + download — 3ème consommateur de S3, hoiste probable de `MIME_TO_EXT` dans `src/common/`).
10. **Analytics** (page views + agrégats).
11. **Frontend Angular adaptation** + **migration des données réelles** depuis le backend Hono.
