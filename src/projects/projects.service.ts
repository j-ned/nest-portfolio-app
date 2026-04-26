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

  findAll(filters: {
    category?: string;
    featured?: boolean;
  }): Promise<Project[]> {
    const conditions: SQL[] = [];
    if (filters.category)
      conditions.push(eq(projects.category, filters.category));
    if (filters.featured) conditions.push(eq(projects.featured, true));

    return this.db
      .select()
      .from(projects)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(projects.order), desc(projects.createdAt));
  }

  async findById(id: string): Promise<Project> {
    const [row] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    if (!row) throw new NotFoundException(`Project ${id} not found`);
    return row;
  }

  async create(dto: CreateProjectDto): Promise<Project> {
    const slug = slugify(dto.title);
    try {
      const [row] = await this.db
        .insert(projects)
        .values({ ...dto, slug })
        .returning();
      return row;
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
    const current = await this.findById(id);

    // image extrait du spread : il ne peut être que null ou undefined côté DTO,
    // mais on ne veut jamais qu'il soit propagé tel quel dans le patch DB
    // (la column est NOT NULL DEFAULT '').
    const { image, ...rest } = dto;
    const patch: Partial<NewProject> = { ...rest, updatedAt: new Date() };
    if (dto.title !== undefined) patch.slug = slugify(dto.title);

    if (image === null) {
      if (current.image) {
        await this.storage.delete(ProjectsService.BUCKET, current.image);
      }
      patch.image = '';
    }

    try {
      const [row] = await this.db
        .update(projects)
        .set(patch)
        .where(eq(projects.id, id))
        .returning();
      return row;
    } catch (err) {
      if (isUniqueViolation(err, 'slug')) {
        throw new ConflictException(
          `Project with slug "${patch.slug}" already exists`,
        );
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

    // Ordre : upload → update DB → cleanup ancienne clé.
    // Si une étape échoue, on préfère un orphelin S3 (cleanup manuel possible)
    // à une DB qui référence une clé supprimée (image cassée côté front).
    await this.storage.upload(
      ProjectsService.BUCKET,
      newKey,
      file.buffer,
      file.mimetype,
    );

    await this.db
      .update(projects)
      .set({ image: newKey, updatedAt: new Date() })
      .where(eq(projects.id, id));

    if (current.image && current.image !== newKey) {
      await this.storage.delete(ProjectsService.BUCKET, current.image);
    }

    return {
      image: newKey,
      url: this.storage.getPublicUrl(ProjectsService.BUCKET, newKey),
    };
  }
}
