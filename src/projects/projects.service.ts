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
    if (filters.category)
      conditions.push(eq(projects.category, filters.category));
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

    // image extrait du spread : il ne peut être que null ou undefined côté DTO,
    // mais on ne veut jamais qu'il soit propagé tel quel dans le patch DB
    // (la column est NOT NULL DEFAULT '').
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

    // S3 cleanup APRÈS le write DB réussi : si le write échoue, on préfère
    // garder l'objet S3 (orphelin DB-cohérent) plutôt qu'une DB cassée.
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

  async uploadImage(id: string, file: Express.Multer.File): Promise<Project> {
    const current = await this.findByIdRaw(id);

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
