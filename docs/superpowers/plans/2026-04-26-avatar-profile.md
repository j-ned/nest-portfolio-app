# Avatar Profile — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter le sous-projet "Avatar Profile" du backend NestJS (endpoint `POST /profile/avatar` + transformation `avatarUrl` key→URL en sortie API + correctif rétroactif Projects pour cohérence) selon le spec `2026-04-26-avatar-profile-design.md`. ~10 nouveaux tests Profile + ajustements Projects, total projet ~155.

**Architecture:** Pas de nouveau module — extension de `ProfileModule` existant. `ProfileService` injecte `StorageService` (en plus de `DRIZZLE`), gère le lifecycle S3 actif (`upload → DB → cleanup` post-success, calque Projects). Helpers privés `findOneRaw` (key brute pour usages internes) et `toResponse` (transforme key → URL publique en sortie). Correctif rétroactif `ProjectsService` : même pattern `findByIdRaw` / `toResponse`, `findAll`/`findById`/`update`/`uploadImage` retournent désormais des `Project` avec `image` = URL.

**Tech Stack:** NestJS 11, Drizzle ORM, `@nestjs/platform-express` + `multer` (déjà installés au sous-projet précédent), `class-validator` (DTOs), `ParseFilePipe` (validation upload), Jest + `createMockDb()` partagé (tests).

**Référence spec :** `docs/superpowers/specs/2026-04-26-avatar-profile-design.md`

---

## File Structure

### Fichiers à modifier

| Chemin | Modification |
|---|---|
| `src/profile/dto/update-profile.dto.ts` | `avatarUrl` : `@IsUrl()` → `@Equals(null)`, type `string?` → `null?` |
| `src/profile/profile.service.ts` | +inject `StorageService`, +helpers `findOneRaw`/`toResponse`, +méthode `uploadAvatar`, refactor `findOne`/`update` |
| `src/profile/profile.service.spec.ts` | Ajustement des 2 existants pour la transformation URL + ~10 nouveaux tests |
| `src/profile/profile.controller.ts` | +`POST /profile/avatar` (multipart, ParseFilePipe) |
| `src/profile/profile.module.ts` | +`MulterModule.register({ limits: { fileSize: 5MB } })` |
| `src/projects/projects.service.ts` | +helpers `findByIdRaw`/`toResponse`, refactor `findAll`/`findById`/`update`/`remove`/`uploadImage` |
| `src/projects/projects.service.spec.ts` | Ajustement des assertions sur `image` après transformation |
| `README.md` | +section `## Avatar Profile` + liste sous-projets : `6. ✅ Avatar Profile`, `7. **Contact** *(prochain)*` |

### Aucun fichier nouveau, aucune migration, aucune nouvelle dépendance.

---

## Task 1: DTO change + ProfileService refactor (existing methods)

**Files:**
- Modify: `src/profile/dto/update-profile.dto.ts`
- Modify: `src/profile/profile.service.ts`
- Modify: `src/profile/profile.service.spec.ts`

- [ ] **Step 1: Modifier le DTO**

Remplacer le contenu de `src/profile/dto/update-profile.dto.ts` par :

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
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @ApiPropertyOptional({
    type: 'null',
    nullable: true,
    description:
      'Pass null to remove avatar (also deletes from S3). Use POST /profile/avatar to upload a new one.',
  })
  @IsOptional()
  @Equals(null)
  avatarUrl?: null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  availabilityMessage?: string;
}
```

**Diff** : `@IsUrl()` retiré, `@Equals(null)` ajouté, type passe de `string` à `null`.

- [ ] **Step 2: Refactor le service**

Remplacer le contenu de `src/profile/profile.service.ts` par :

```typescript
import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  profile,
  type NewProfile,
  type Profile,
} from '../database/schema/profile';
import { StorageService } from '../storage/storage.service';
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

- [ ] **Step 3: Mettre à jour les tests existants**

Remplacer le contenu de `src/profile/profile.service.spec.ts` par :

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import { StorageService } from '../storage/storage.service';
import type { Profile } from '../database/schema/profile';

describe('ProfileService', () => {
  let service: ProfileService;
  let db: ReturnType<typeof createMockDb>;
  let storage: jest.Mocked<StorageService>;

  const mkProfile = (overrides: Partial<Profile> = {}): Profile => ({
    id: 'profile-uuid',
    displayName: '',
    location: '',
    avatarUrl: '',
    isAvailable: true,
    availabilityMessage: '',
    createdAt: new Date('2026-04-26T00:00:00Z'),
    updatedAt: new Date('2026-04-26T00:00:00Z'),
    ...overrides,
  });

  beforeEach(async () => {
    db = createMockDb();
    storage = {
      upload: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
      list: jest.fn(),
      getPublicUrl: jest.fn().mockReturnValue('https://example.test/url'),
    } as unknown as jest.Mocked<StorageService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        { provide: DRIZZLE, useValue: db },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = module.get(ProfileService);
  });

  describe('findOne', () => {
    it('retourne avatarUrl transformée en URL publique si key non vide', async () => {
      const row = mkProfile({ avatarUrl: 'avatar/avatar.webp' });
      db.limit.mockResolvedValueOnce([row]);
      const result = await service.findOne();
      expect(result.avatarUrl).toBe('https://example.test/url');
      expect(storage.getPublicUrl).toHaveBeenCalledWith(
        'portfolio-storage',
        'avatar/avatar.webp',
      );
    });

    it("retourne avatarUrl: '' si key vide", async () => {
      const row = mkProfile({ avatarUrl: '' });
      db.limit.mockResolvedValueOnce([row]);
      const result = await service.findOne();
      expect(result.avatarUrl).toBe('');
      expect(storage.getPublicUrl).not.toHaveBeenCalled();
    });

    it('throw InternalServerErrorException si singleton absent', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(service.findOne()).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('update', () => {
    it("met à jour les champs simples et retourne Profile avec avatarUrl ''", async () => {
      const existing = mkProfile({ avatarUrl: '' });
      const updated = mkProfile({
        displayName: 'Julien',
        location: 'Lyon',
        avatarUrl: '',
      });
      db.limit.mockResolvedValueOnce([existing]);
      db.returning.mockResolvedValueOnce([updated]);
      const result = await service.update({
        displayName: 'Julien',
        location: 'Lyon',
      });
      expect(result.displayName).toBe('Julien');
      expect(result.avatarUrl).toBe('');
    });
  });
});
```

> Note : on ne couvre pas tous les cas de `update` (notamment `avatarUrl: null`) dans cette task — ils seront ajoutés en Task 2 avec le reste des tests `uploadAvatar`. Cette task ne fait que reculer les tests existants pour qu'ils passent avec la nouvelle signature.

- [ ] **Step 4: Vérifier que les tests passent**

```bash
pnpm test src/profile/profile.service.spec.ts
```

Expected: 4 tests verts (3 findOne + 1 update).

- [ ] **Step 5: Vérifier le suite complète**

```bash
pnpm test
```

Expected: 145 → toujours 145 tests verts (on a remplacé 2 tests par 4, mais on n'a pas fini d'ajouter — et le suite globale doit rester ≥ 145 ; en pratique sera ~147 ici).

> Si moins de 145 tests, c'est qu'on a accidentellement cassé un test ailleurs. Investiguer.

- [ ] **Step 6: Lint**

```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/profile/dto/update-profile.dto.ts src/profile/profile.service.ts src/profile/profile.service.spec.ts
git commit -m "refactor(profile): @Equals(null) sur avatarUrl + transformation key→URL en sortie"
```

---

## Task 2: Add uploadAvatar method + tests TDD

**Files:**
- Modify: `src/profile/profile.service.ts`
- Modify: `src/profile/profile.service.spec.ts`

- [ ] **Step 1: Écrire les nouveaux tests d'abord (TDD)**

Ouvrir `src/profile/profile.service.spec.ts` et ajouter ces nouveaux tests/blocs.

Dans le bloc `describe('update', ...)` existant, ajouter ces 3 nouveaux cas (juste après le test existant) :

```typescript
    it("avatarUrl: null + key existante → DB write puis storage.delete", async () => {
      const existing = mkProfile({ avatarUrl: 'avatar/avatar.webp' });
      const updated = mkProfile({ avatarUrl: '' });
      db.limit.mockResolvedValueOnce([existing]);
      db.returning.mockResolvedValueOnce([updated]);
      await service.update({ avatarUrl: null });
      expect(storage.delete).toHaveBeenCalledWith(
        'portfolio-storage',
        'avatar/avatar.webp',
      );
    });

    it("avatarUrl: null + pas de key → DB write, pas de delete S3", async () => {
      const existing = mkProfile({ avatarUrl: '' });
      const updated = mkProfile({ avatarUrl: '' });
      db.limit.mockResolvedValueOnce([existing]);
      db.returning.mockResolvedValueOnce([updated]);
      await service.update({ avatarUrl: null });
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it("ne touche pas S3 si le write DB échoue (avatarUrl: null)", async () => {
      const existing = mkProfile({ avatarUrl: 'avatar/avatar.webp' });
      db.limit.mockResolvedValueOnce([existing]);
      db.returning.mockRejectedValueOnce(new Error('DB connection lost'));
      await expect(service.update({ avatarUrl: null })).rejects.toThrow(
        'DB connection lost',
      );
      expect(storage.delete).not.toHaveBeenCalled();
    });
```

Et après le bloc `describe('update', ...)`, ajouter un nouveau bloc `describe('uploadAvatar', ...)` :

```typescript
  describe('uploadAvatar', () => {
    const file = {
      buffer: Buffer.from('fake'),
      mimetype: 'image/webp',
      size: 100,
    } as Express.Multer.File;

    it("upload + DB write, pas de delete si pas de key existante", async () => {
      const existing = mkProfile({ avatarUrl: '' });
      const updated = mkProfile({ avatarUrl: 'avatar/avatar.webp' });
      db.limit.mockResolvedValueOnce([existing]);
      db.returning.mockResolvedValueOnce([updated]);
      const result = await service.uploadAvatar(file);
      expect(storage.upload).toHaveBeenCalledWith(
        'portfolio-storage',
        'avatar/avatar.webp',
        file.buffer,
        'image/webp',
      );
      expect(storage.delete).not.toHaveBeenCalled();
      expect(result.avatarUrl).toBe('https://example.test/url');
    });

    it("replace même extension → upload, pas de delete (clé identique)", async () => {
      const existing = mkProfile({ avatarUrl: 'avatar/avatar.webp' });
      const updated = mkProfile({ avatarUrl: 'avatar/avatar.webp' });
      db.limit.mockResolvedValueOnce([existing]);
      db.returning.mockResolvedValueOnce([updated]);
      await service.uploadAvatar(file);
      expect(storage.upload).toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it("replace extension différente → upload + DB + delete ancienne", async () => {
      const existing = mkProfile({ avatarUrl: 'avatar/avatar.jpg' });
      const updated = mkProfile({ avatarUrl: 'avatar/avatar.webp' });
      db.limit.mockResolvedValueOnce([existing]);
      db.returning.mockResolvedValueOnce([updated]);
      await service.uploadAvatar(file);
      expect(storage.upload).toHaveBeenCalledWith(
        'portfolio-storage',
        'avatar/avatar.webp',
        file.buffer,
        'image/webp',
      );
      expect(storage.delete).toHaveBeenCalledWith(
        'portfolio-storage',
        'avatar/avatar.jpg',
      );
    });

    it("retourne Profile avec avatarUrl transformée en URL", async () => {
      const existing = mkProfile({ avatarUrl: '' });
      const updated = mkProfile({ avatarUrl: 'avatar/avatar.webp' });
      db.limit.mockResolvedValueOnce([existing]);
      db.returning.mockResolvedValueOnce([updated]);
      const result = await service.uploadAvatar(file);
      expect(result.avatarUrl).toBe('https://example.test/url');
      expect(storage.getPublicUrl).toHaveBeenCalledWith(
        'portfolio-storage',
        'avatar/avatar.webp',
      );
    });
  });
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

```bash
pnpm test src/profile/profile.service.spec.ts
```

Expected: 7 tests fail (3 nouveaux update + 4 uploadAvatar) avec `service.uploadAvatar is not a function` ou similaire pour les uploadAvatar, et erreurs sur les nouveaux update tests.

- [ ] **Step 3: Implémenter `uploadAvatar` dans le service**

Ouvrir `src/profile/profile.service.ts`. Ajouter l'import de `MIME_TO_EXT` en haut :

```typescript
import { MIME_TO_EXT } from '../projects/projects.utils';
```

Puis ajouter la méthode `uploadAvatar` dans la classe `ProfileService`, **après** `update()` et **avant** `findOneRaw()` (= entre les méthodes publiques et les helpers privés) :

```typescript
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
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

```bash
pnpm test src/profile/profile.service.spec.ts
```

Expected: tous les tests verts (4 existants + 3 update nouveaux + 4 uploadAvatar = 11 tests dans ce fichier).

- [ ] **Step 5: Lancer la suite complète**

```bash
pnpm test
```

Expected: ~152 tests verts (+7 par rapport à la fin de Task 1).

- [ ] **Step 6: Lint**

```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/profile/profile.service.ts src/profile/profile.service.spec.ts
git commit -m "feat(profile): uploadAvatar + tests lifecycle S3"
```

---

## Task 3: Controller endpoint + Module update + smoke test

**Files:**
- Modify: `src/profile/profile.controller.ts`
- Modify: `src/profile/profile.module.ts`

- [ ] **Step 1: Mettre à jour le controller**

Remplacer le contenu de `src/profile/profile.controller.ts` par :

```typescript
import {
  Body,
  Controller,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  ParseFilePipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
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
}
```

- [ ] **Step 2: Mettre à jour le module**

Remplacer le contenu de `src/profile/profile.module.ts` par :

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

> Note : `AuthModule` était déjà importé. Seul ajout : `MulterModule.register`.

- [ ] **Step 3: Vérifier que TypeScript compile**

```bash
pnpm build
```

Expected: clean.

- [ ] **Step 4: Lancer la suite de tests**

```bash
pnpm test
```

Expected: tous verts (~152 tests, idem fin Task 2 — pas de nouveau test ici).

- [ ] **Step 5: Smoke test boot**

```bash
pnpm db:up && pnpm db:wait && pnpm s3:up
timeout 25 pnpm dev > /tmp/avatar-boot.log 2>&1 || true
```

Puis vérifier :

```bash
grep -E 'ProfileModule|/profile/avatar' /tmp/avatar-boot.log
```

Expected (au moins ces 3 lignes) :
- `ProfileModule dependencies initialized`
- `Mapped {/profile/avatar, POST}` route
- `Nest application successfully started`

Si la route avatar n'apparaît pas, STOP et rapporter en BLOCKED.

- [ ] **Step 6: Lint**

```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/profile/profile.controller.ts src/profile/profile.module.ts
git commit -m "feat(profile): POST /profile/avatar (multipart) + MulterModule"
```

---

## Task 4: Projects retrofix (transformation `image` en URL)

**Files:**
- Modify: `src/projects/projects.service.ts`
- Modify: `src/projects/projects.service.spec.ts`

- [ ] **Step 1: Refactor `projects.service.ts`**

Remplacer le contenu de `src/projects/projects.service.ts` par (changements structurels marqués en commentaire) :

```typescript
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  projects,
  type NewProject,
  type Project,
} from '../database/schema/projects';
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

  async findAll(filters: {
    category?: string;
    featured?: boolean;
  }): Promise<Project[]> {
    const conditions: SQL[] = [];
    if (filters.category) conditions.push(eq(projects.category, filters.category));
    if (filters.featured) conditions.push(eq(projects.featured, true));

    const rows = await this.db
      .select()
      .from(projects)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(projects.order), desc(projects.createdAt));
    return rows.map((r) => this.toResponse(r));
  }

  async findById(id: string): Promise<Project> {
    const row = await this.findByIdRaw(id);
    return this.toResponse(row);
  }

  async create(dto: CreateProjectDto): Promise<Project> {
    const slug = slugify(dto.title);
    try {
      const [row] = await this.db
        .insert(projects)
        .values({ ...dto, slug })
        .returning();
      return this.toResponse(row);
    } catch (err) {
      if (isUniqueViolation(err, 'slug')) {
        throw new ConflictException(
          `Project with slug "${slug}" already exists`,
        );
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateProjectDto): Promise<Project> {
    const current = await this.findByIdRaw(id);

    const { image, ...rest } = dto;
    const patch: Partial<NewProject> = { ...rest, updatedAt: new Date() };
    if (dto.title !== undefined) patch.slug = slugify(dto.title);
    if (image === null) patch.image = '';

    let row: Project;
    try {
      [row] = await this.db
        .update(projects)
        .set(patch)
        .where(eq(projects.id, id))
        .returning();
    } catch (err) {
      if (isUniqueViolation(err, 'slug')) {
        throw new ConflictException(
          `Project with slug "${patch.slug}" already exists`,
        );
      }
      throw err;
    }

    if (image === null && current.image) {
      await this.storage.delete(ProjectsService.BUCKET, current.image);
    }

    return this.toResponse(row);
  }

  async remove(id: string): Promise<void> {
    const current = await this.findByIdRaw(id);
    await this.db.delete(projects).where(eq(projects.id, id));
    if (current.image) {
      await this.storage.delete(ProjectsService.BUCKET, current.image);
    }
  }

  async uploadImage(
    id: string,
    file: Express.Multer.File,
  ): Promise<Project> {
    const current = await this.findByIdRaw(id);

    const ext = MIME_TO_EXT[file.mimetype];
    const newKey = `projects/${id}.${ext}`;

    // Ordre : upload → update DB → cleanup ancienne clé.
    await this.storage.upload(
      ProjectsService.BUCKET,
      newKey,
      file.buffer,
      file.mimetype,
    );

    const [row] = await this.db
      .update(projects)
      .set({ image: newKey, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();

    if (current.image && current.image !== newKey) {
      await this.storage.delete(ProjectsService.BUCKET, current.image);
    }

    return this.toResponse(row);
  }

  // Helper privé : retourne la row brute (sans transformation URL).
  // Utilisé par toutes les opérations internes qui ont besoin de la key S3.
  private async findByIdRaw(id: string): Promise<Project> {
    const [row] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    if (!row) throw new NotFoundException(`Project ${id} not found`);
    return row;
  }

  // Transforme la key DB en URL publique pour la sortie API.
  private toResponse(p: Project): Project {
    return {
      ...p,
      image: p.image
        ? this.storage.getPublicUrl(ProjectsService.BUCKET, p.image)
        : '',
    };
  }
}
```

**Changements clés** :
- `findAll` retourne via `rows.map(toResponse)` (transformation systématique).
- `findById` est désormais un wrapper de `findByIdRaw` + `toResponse`.
- `findByIdRaw` (private) remplace l'ancien `findById` interne — appelé par `update`, `remove`, `uploadImage`.
- `create`, `update`, `uploadImage` retournent `toResponse(row)` (transformation systématique en sortie).
- `uploadImage` change de signature : retourne `Promise<Project>` au lieu de `Promise<{ image, url }>`.
- `toResponse` (private) gère le cas `image: ''`.

- [ ] **Step 2: Mettre à jour les tests Projects**

Ouvrir `src/projects/projects.service.spec.ts`. Plusieurs tests doivent être ajustés pour la transformation. Voici les changements à appliquer :

**Dans le `beforeEach` du `describe('ProjectsService', ...)` (autour de la ligne 30-45) — vérifier que le mock storage existe déjà** : il devrait l'être (le test `uploadImage` l'utilise). Si non, l'ajouter :

```typescript
storage = {
  upload: jest.fn().mockResolvedValue(undefined),
  get: jest.fn(),
  delete: jest.fn().mockResolvedValue(undefined),
  list: jest.fn(),
  getPublicUrl: jest.fn().mockReturnValue('https://example.test/url'),
} as unknown as jest.Mocked<StorageService>;
```

(Il devrait l'être déjà — Task 5 du sous-projet précédent l'a setup.)

**Dans le bloc `describe('findAll', ...)` — modifier le premier test** :

L'ancien :
```typescript
    it('retourne tous les projets, triés order ASC, createdAt DESC', async () => {
      const rows = [mkProject({ id: 'a' }), mkProject({ id: 'b' })];
      db.orderBy.mockResolvedValueOnce(rows);
      await expect(service.findAll({})).resolves.toEqual(rows);
    });
```

Le remplacer par :
```typescript
    it('retourne tous les projets transformés (image=URL ou ""), triés order ASC, createdAt DESC', async () => {
      const rows = [
        mkProject({ id: 'a', image: 'projects/a.webp' }),
        mkProject({ id: 'b', image: '' }),
      ];
      db.orderBy.mockResolvedValueOnce(rows);
      const result = await service.findAll({});
      expect(result).toHaveLength(2);
      expect(result[0].image).toBe('https://example.test/url');
      expect(result[1].image).toBe('');
    });
```

**Dans le bloc `describe('findById', ...)` — modifier le premier test** :

L'ancien :
```typescript
    it('retourne le projet', async () => {
      const row = mkProject();
      db.limit.mockResolvedValueOnce([row]);
      await expect(service.findById(row.id)).resolves.toEqual(row);
    });
```

Le remplacer par :
```typescript
    it('retourne le projet avec image transformée en URL', async () => {
      const row = mkProject({ image: 'projects/<id>.webp' });
      db.limit.mockResolvedValueOnce([row]);
      const result = await service.findById(row.id);
      expect(result.image).toBe('https://example.test/url');
    });

    it('retourne image: "" quand DB image est vide', async () => {
      const row = mkProject({ image: '' });
      db.limit.mockResolvedValueOnce([row]);
      const result = await service.findById(row.id);
      expect(result.image).toBe('');
    });
```

**Dans le bloc `describe('create', ...)` — pas de changement nécessaire** (les tests ne comparent que `result.slug`, pas `result.image`).

**Dans le bloc `describe('update', ...)` — vérifier qu'aucun test ne fait `toEqual(updated)` sur la row entière**. Si oui, modifier pour `expect(result.title).toBe(...)` ou similaire.

Pour le test `'re-slugifie si title change'`, ajouter à la fin :
```typescript
expect(storage.delete).not.toHaveBeenCalled();
```
(Devrait déjà être présent suite au fix Task 5 du sous-projet précédent — vérifier.)

**Dans le bloc `describe('uploadImage', ...)` — modifier les tests** :

Pour `'upload puis update DB, pas de delete si pas d\'image existante'`, l'ancien :
```typescript
      const result = await service.uploadImage(current.id, file);
      expect(storage.upload).toHaveBeenCalledWith(...);
      expect(storage.delete).not.toHaveBeenCalled();
      expect(result.image).toBe(`projects/${current.id}.webp`);
      expect(result.url).toBe('https://example.test/url');
    });
```

Le remplacer par (le shape de retour change : on ne retourne plus `{ image, url }` mais `Project` complète) :
```typescript
      // Le mock returning doit retourner la Project mise à jour
      db.returning.mockResolvedValueOnce([
        mkProject({ ...current, image: `projects/${current.id}.webp` }),
      ]);
      const result = await service.uploadImage(current.id, file);
      expect(storage.upload).toHaveBeenCalledWith(
        'portfolio-storage',
        `projects/${current.id}.webp`,
        file.buffer,
        'image/webp',
      );
      expect(storage.delete).not.toHaveBeenCalled();
      expect(result.image).toBe('https://example.test/url');
      expect(result.id).toBe(current.id);
    });
```

> Important : le service utilise désormais `await db.update(...).returning()` dans `uploadImage` (auparavant c'était `await db.update(...).where()` sans `.returning()`). Les tests `uploadImage` doivent ajouter un `db.returning.mockResolvedValueOnce([row])` pour fournir la nouvelle row au lieu de `db.where.mockResolvedValueOnce(undefined)`.

Pour les autres tests `uploadImage` (`replace même extension`, `replace extension différente`), faire le même type d'ajustement : ajouter `db.returning.mockResolvedValueOnce([newRow])` et remplacer les assertions sur `result.image`/`result.url` par le shape Project transformé.

> Si tu trouves que ces ajustements deviennent compliqués au cas par cas, **STOP et rapporter**. C'est probablement le signe qu'il faut une approche plus systématique (par exemple un `mkProject({ image: '...key' })` qui passe à travers `toResponse` dans les expectations).

- [ ] **Step 3: Lancer les tests Projects**

```bash
pnpm test src/projects/projects.service.spec.ts
```

Expected: 23 tests verts (après ajustements).

> Si certains tests échouent, lire le message et investiguer. Les ajustements ci-dessus couvrent les cas clés mais il peut y avoir des résidus à fixer. **Ne JAMAIS modifier le service** pour faire passer les tests — toujours ajuster les tests.

- [ ] **Step 4: Lancer la suite complète**

```bash
pnpm test
```

Expected: ~152 tests verts (idem fin Task 3).

- [ ] **Step 5: Lint**

```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/projects/projects.service.ts src/projects/projects.service.spec.ts
git commit -m "refactor(projects): findAll/findById/uploadImage retournent image=URL (cohérence Avatar)"
```

---

## Task 5: Vérification e2e manuelle

**Files:** Aucun changement de code. Cette tâche valide que tout fonctionne contre Postgres + MinIO réels.

**Préparation** : avoir un fichier image de test à disposition. Si besoin :
```bash
printf 'RIFF\x00\x00\x00\x00WEBPVP8 ' > /tmp/test.webp
printf '\x89PNG\r\n\x1a\n' > /tmp/test.png
```

- [ ] **Step 1: Démarrer la stack**

```bash
pnpm db:up && pnpm db:wait && pnpm s3:up && pnpm dev
```

- [ ] **Step 2: Login admin**

Dans un autre terminal :
```bash
curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<ADMIN_EMAIL>","password":"<ADMIN_INITIAL_PASSWORD>"}' \
  -c /tmp/avatar-cookies.txt -i
```
Expected: 200 + Set-Cookie.

- [ ] **Step 3: GET /profile initial**

```bash
curl http://localhost:3000/profile
```

Expected: la `Profile` singleton avec `avatarUrl: ''`.

- [ ] **Step 4: Upload initial**

```bash
curl -X POST http://localhost:3000/profile/avatar \
  -b /tmp/avatar-cookies.txt -F file=@/tmp/test.webp
```

Expected: `Profile` avec `avatarUrl: 'http://localhost:9000/portfolio-storage/avatar%2Favatar.webp'` (URL S3 transformée).

- [ ] **Step 5: Vérifier l'objet S3**

```bash
curl -fsSI 'http://localhost:9000/portfolio-storage/avatar/avatar.webp'
```

Expected: 200 OK.

- [ ] **Step 6: GET /profile à nouveau**

```bash
curl http://localhost:3000/profile
```

Expected: `avatarUrl` pointe vers l'URL S3 (la même qu'au step 4).

- [ ] **Step 7: Replace avec extension différente**

```bash
curl -X POST http://localhost:3000/profile/avatar \
  -b /tmp/avatar-cookies.txt -F file=@/tmp/test.png
```

Expected: `Profile` avec `avatarUrl` pointant vers `.png`.

- [ ] **Step 8: Vérifier le cleanup S3**

```bash
curl -fsSI 'http://localhost:9000/portfolio-storage/avatar/avatar.webp'   # 404 attendu (cleanup)
curl -fsSI 'http://localhost:9000/portfolio-storage/avatar/avatar.png'    # 200 attendu
```

- [ ] **Step 9: PATCH avatarUrl: null**

```bash
curl -X PATCH http://localhost:3000/profile \
  -b /tmp/avatar-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"avatarUrl":null}'
```

Expected: `Profile` avec `avatarUrl: ''`.

- [ ] **Step 10: Vérifier le cleanup S3 sur PATCH null**

```bash
curl -fsSI 'http://localhost:9000/portfolio-storage/avatar/avatar.png'
```

Expected: 404 (cleanup OK).

- [ ] **Step 11: PATCH avatarUrl avec string arbitraire (sécurité)**

```bash
curl -X PATCH http://localhost:3000/profile \
  -b /tmp/avatar-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"avatarUrl":"hack"}' -i
```

Expected: 400 (class-validator rejette via `@Equals(null)`).

- [ ] **Step 12: Upload trop gros (422)**

```bash
dd if=/dev/zero of=/tmp/too-big.webp bs=1M count=6 2>/dev/null
curl -X POST http://localhost:3000/profile/avatar \
  -b /tmp/avatar-cookies.txt -F file=@/tmp/too-big.webp -i
rm /tmp/too-big.webp
```

Expected: 422.

- [ ] **Step 13: Upload MIME interdit (422)**

```bash
echo "<svg/>" > /tmp/bad.svg
curl -X POST http://localhost:3000/profile/avatar \
  -b /tmp/avatar-cookies.txt -F file=@/tmp/bad.svg -i
rm /tmp/bad.svg
```

Expected: 422.

- [ ] **Step 14: Auth absent (401)**

```bash
curl -X POST http://localhost:3000/profile/avatar -F file=@/tmp/test.webp -i
```

Expected: 401.

- [ ] **Step 15: Vérifier que Projects retourne aussi des URLs**

```bash
curl http://localhost:3000/projects
```

Expected: si la liste contient des projets avec image, `image` est désormais une URL S3 complète (pas une key brute). Si la liste est vide ou tous les `image` sont `''`, créer un projet rapidement avec image pour valider.

Si tu as un projet existant avec image :
```bash
# Pour un id existant
curl http://localhost:3000/projects/<EXISTING_ID>
```
Expected: `image` est une URL S3 complète, pas une key brute.

- [ ] **Step 16: Cleanup**

```bash
rm /tmp/avatar-cookies.txt /tmp/test.webp /tmp/test.png 2>/dev/null
# Ctrl+C sur pnpm dev
```

- [ ] **Step 17: Pas de commit**

Cette tâche ne modifie pas de code. Si tous les steps passent, marquer comme done.

---

## Task 6: README + clôture

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Ajouter la section Avatar Profile**

Ouvrir `README.md`. Localiser la section `## Projects` (ajoutée au sous-projet précédent). Insérer la nouvelle section `## Avatar Profile` **immédiatement après** la section Projects et **avant** `## Migration depuis le backend Hono`.

Contenu à insérer :

```markdown
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
```

- [ ] **Step 2: Mettre à jour la liste des sous-projets**

Localiser la liste numérotée dans la section `## Migration depuis le backend Hono`. État actuel (après le sous-projet Projects) :

```markdown
1. ✅ Fondations
2. ✅ Auth (Users + JWT + 2FA + backup codes)
3. ✅ Profile public (Profile, Hero, SocialLinks, Diplomas, Technologies, Expertises, ServicePricing)
4. ✅ S3 Storage (StorageModule + MinIO local + Garage prod)
5. ✅ Projects (CRUD + upload image qui consomme S3 Storage)
6. **Avatar Profile** *(prochain)* (`POST /profile/avatar` qui consomme S3 Storage)
7. Contact (messages + mailer)
8. Bookings (réservations + slots + mail)
9. CV (upload S3 + download)
10. Analytics (page views + agrégats)
```

Le remplacer par :

```markdown
1. ✅ Fondations
2. ✅ Auth (Users + JWT + 2FA + backup codes)
3. ✅ Profile public (Profile, Hero, SocialLinks, Diplomas, Technologies, Expertises, ServicePricing)
4. ✅ S3 Storage (StorageModule + MinIO local + Garage prod)
5. ✅ Projects (CRUD + upload image qui consomme S3 Storage)
6. ✅ Avatar Profile (`POST /profile/avatar` + transformation key→URL en sortie API, cohérent Projects)
7. **Contact** *(prochain)* (messages + mailer)
8. Bookings (réservations + slots + mail)
9. CV (upload S3 + download)
10. Analytics (page views + agrégats)
```

- [ ] **Step 3: Sanity check**

Relire visuellement les sections modifiées. Vérifier :
- La section `## Avatar Profile` est bien entre `## Projects` et `## Migration depuis le backend Hono`.
- Les pipes échappés `\|` dans le tableau d'endpoint rendent correctement.
- Le lien spec pointe vers `2026-04-26-avatar-profile-design.md` (date d'aujourd'hui).
- Item 6 est ✅, item 7 est en cours.

- [ ] **Step 4: Final check global**

```bash
pnpm lint && pnpm build && pnpm test
```

Expected: tout passe. ~152 tests verts.

- [ ] **Step 5: Vérifier les fichiers modifiés depuis le début du sous-projet**

```bash
git diff --stat HEAD~5..HEAD
```

Expected (à 1-2 fichiers près selon l'ordre des commits) :
```
 README.md                                                       | ~30 +-
 src/profile/dto/update-profile.dto.ts                           | several +-
 src/profile/profile.controller.ts                               | many +-
 src/profile/profile.module.ts                                   |   1 +
 src/profile/profile.service.spec.ts                             | many +-
 src/profile/profile.service.ts                                  | many +-
 src/projects/projects.service.spec.ts                           | several +-
 src/projects/projects.service.ts                                | several +-
```

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: README — section Avatar Profile + liste sous-projets"
```

---

## Critères de done globaux (rappel du spec § 13)

Le sous-projet est terminé quand :

1. ✅ `UpdateProfileDto.avatarUrl` est `@Equals(null)` (Task 1).
2. ✅ `ProfileService.uploadAvatar` implémenté avec lifecycle S3 actif (Task 2).
3. ✅ `ProfileService.findOne`/`update` retournent une `Profile` avec `avatarUrl` transformée (Task 1+2).
4. ✅ `POST /profile/avatar` mappé (Task 3).
5. ✅ `MulterModule.register` ajouté (Task 3).
6. ✅ `ProjectsService.findAll`/`findById`/`update`/`uploadImage` retournent `Project` avec `image` transformée (Task 4). `findByIdRaw` privé pour usages internes.
7. ✅ ~10 nouveaux tests Profile + ajustements Projects, **tous verts** (~152 total).
8. ✅ Build prod + lint clean (Task 6 step 4).
9. ✅ Vérification e2e manuelle (Task 5).
10. ✅ README mis à jour (Task 6).
11. ✅ Hors scope confirmé exclu : pas de DELETE dédié, pas de proxy backend, pas de signed URLs.
