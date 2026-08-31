import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  blogPosts,
  type NewBlogPost,
  type BlogPost,
} from '../database/schema/blog-posts';
import { StorageService } from '../storage/storage.service';
import { deleteS3IfExists } from '../storage/s3-utils';
import { AppConfigService } from '../config/app-config.service';
import { CreateBlogPostDto } from './dto/create-blog-post.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';
import { findByIdOrFail } from '../common/crud-helpers';
import {
  isUniqueViolation,
  mimeToExt,
  slugify,
  fireAndForget,
} from '../common/utils';

@Injectable()
export class BlogService {
  private static readonly BUCKET = 'portfolio-storage';
  private readonly logger = new Logger(BlogService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly config: AppConfigService,
  ) {}

  async findAllPublished(): Promise<BlogPost[]> {
    const rows = await this.db
      .select()
      .from(blogPosts)
      .where(eq(blogPosts.status, 'published'))
      .orderBy(desc(blogPosts.publishedAt));
    return rows.map((r) => this.toResponse(r));
  }

  async findAllForAdmin(): Promise<BlogPost[]> {
    const rows = await this.db
      .select()
      .from(blogPosts)
      .orderBy(desc(blogPosts.createdAt));
    return rows.map((r) => this.toResponse(r));
  }

  async findBySlug(slug: string): Promise<BlogPost> {
    const rows = await this.db
      .select()
      .from(blogPosts)
      .where(eq(blogPosts.slug, slug))
      .limit(1);
    if (rows.length === 0) {
      throw new NotFoundException(`Blog post "${slug}" not found`);
    }
    return this.toResponse(rows[0]);
  }

  async findById(id: string): Promise<BlogPost> {
    return this.toResponse(await this.findByIdRaw(id));
  }

  async create(dto: CreateBlogPostDto): Promise<BlogPost> {
    const slug = slugify(dto.title);
    const publishedAt = dto.status === 'published' ? new Date() : null;
    try {
      const [row] = await this.db
        .insert(blogPosts)
        .values({ ...dto, slug, publishedAt })
        .returning();
      if (dto.status === 'published') this.triggerDeploy();
      return this.toResponse(row);
    } catch (err) {
      if (isUniqueViolation(err, 'slug')) {
        throw new ConflictException(
          `Blog post with slug "${slug}" already exists`,
        );
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateBlogPostDto): Promise<BlogPost> {
    const current = await this.findByIdRaw(id);

    // coverImage extrait du spread : il ne peut être que null ou undefined
    // côté DTO (upload géré par POST /:id/image), mais on ne veut jamais
    // qu'il soit propagé tel quel dans le patch DB (colonne NOT NULL DEFAULT '').
    const { coverImage, ...rest } = dto;
    const patch: Partial<NewBlogPost> = { ...rest, updatedAt: new Date() };
    if (dto.title !== undefined) patch.slug = slugify(dto.title);
    if (coverImage === null) patch.coverImage = '';

    const isPublishing =
      dto.status === 'published' && current.status !== 'published';
    if (isPublishing) patch.publishedAt = new Date();

    let row: BlogPost;
    try {
      [row] = await this.db
        .update(blogPosts)
        .set(patch)
        .where(eq(blogPosts.id, id))
        .returning();
    } catch (err) {
      if (isUniqueViolation(err, 'slug')) {
        throw new ConflictException(
          `Blog post with slug "${patch.slug}" already exists`,
        );
      }
      throw err;
    }

    // S3 cleanup APRÈS le write DB réussi : si le write échoue, on préfère
    // garder l'objet S3 (orphelin DB-cohérent) plutôt qu'une DB cassée.
    if (coverImage === null) {
      await deleteS3IfExists(
        this.storage,
        BlogService.BUCKET,
        current.coverImage,
      );
    }
    if (isPublishing) this.triggerDeploy();

    return this.toResponse(row);
  }

  async remove(id: string): Promise<void> {
    const current = await this.findByIdRaw(id);
    await this.db.delete(blogPosts).where(eq(blogPosts.id, id));
    await deleteS3IfExists(
      this.storage,
      BlogService.BUCKET,
      current.coverImage,
    );
  }

  async uploadCoverImage(
    id: string,
    file: Express.Multer.File,
  ): Promise<BlogPost> {
    const current = await this.findByIdRaw(id);
    const newKey = `blog/${id}.${mimeToExt(file.mimetype)}`;

    // Ordre : upload → update DB → cleanup ancienne clé.
    // Si une étape échoue, on préfère un orphelin S3 (cleanup manuel possible)
    // à une DB qui référence une clé supprimée (image cassée côté front).
    await this.storage.upload(
      BlogService.BUCKET,
      newKey,
      file.buffer,
      file.mimetype,
    );

    const [row] = await this.db
      .update(blogPosts)
      .set({ coverImage: newKey, updatedAt: new Date() })
      .where(eq(blogPosts.id, id))
      .returning();

    if (current.coverImage !== newKey) {
      await deleteS3IfExists(
        this.storage,
        BlogService.BUCKET,
        current.coverImage,
      );
    }

    return this.toResponse(row);
  }

  async like(slug: string): Promise<{ likesCount: number }> {
    // Incrément atomique côté DB (pas de read-then-write applicatif) pour
    // éviter une race condition entre deux likes concurrents.
    const [row] = await this.db
      .update(blogPosts)
      .set({ likesCount: sql`${blogPosts.likesCount} + 1` })
      .where(eq(blogPosts.slug, slug))
      .returning();
    if (!row) throw new NotFoundException(`Blog post "${slug}" not found`);
    return { likesCount: row.likesCount };
  }

  // Helper privé : retourne la row brute (sans transformation URL).
  // Utilisé par toutes les opérations internes qui ont besoin de la key S3.
  private findByIdRaw(id: string): Promise<BlogPost> {
    return findByIdOrFail<BlogPost>(this.db, blogPosts, id, 'Blog post');
  }

  // Publier un article déclenche un rebuild : les pages /blog sont prerendered
  // au build (pas de SSR par requête en prod, cf. spec), donc rien n'est
  // visible tant que le site n'a pas été reconstruit et redéployé.
  private triggerDeploy(): void {
    const url = this.config.dokployDeployWebhookUrl;
    if (!url) return;
    fireAndForget(
      fetch(url, { method: 'POST' }),
      this.logger,
      'dokploy-deploy-webhook',
    );
  }

  // Transforme la key DB en URL publique pour la sortie API.
  private toResponse(p: BlogPost): BlogPost {
    return {
      ...p,
      coverImage: p.coverImage
        ? this.storage.getPublicUrl(BlogService.BUCKET, p.coverImage)
        : '',
    };
  }
}
