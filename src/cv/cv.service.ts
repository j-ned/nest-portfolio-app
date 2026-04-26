import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { cvFiles, type CvFile } from '../database/schema/cv-files';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class CvService {
  private readonly logger = new Logger(CvService.name);
  private static readonly BUCKET = 'portfolio-storage';
  private static readonly KEY = 'cv/cv.pdf';

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  async upsert(file: Express.Multer.File): Promise<CvFile> {
    // Ordre : S3 upload → DB upsert.
    // PutObject est idempotent : écrase systématiquement la key.
    await this.storage.upload(
      CvService.BUCKET,
      CvService.KEY,
      file.buffer,
      file.mimetype,
    );

    const [existing] = await this.db.select().from(cvFiles).limit(1);

    if (existing) {
      const [updated] = await this.db
        .update(cvFiles)
        .set({
          fileName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
          updatedAt: new Date(),
        })
        .where(eq(cvFiles.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await this.db
      .insert(cvFiles)
      .values({
        fileName: file.originalname,
        fileKey: CvService.KEY,
        fileSize: file.size,
        mimeType: file.mimetype,
      })
      .returning();
    return created;
  }

  async findLatestMetadata(): Promise<CvFile | null> {
    const [row] = await this.db
      .select()
      .from(cvFiles)
      .orderBy(desc(cvFiles.uploadedAt))
      .limit(1);
    return row ?? null;
  }

  async download(): Promise<{ buffer: Buffer; metadata: CvFile }> {
    const metadata = await this.findLatestMetadata();
    if (!metadata) throw new NotFoundException('No CV uploaded');
    const buffer = await this.storage.get(CvService.BUCKET, metadata.fileKey);
    return { buffer, metadata };
  }

  async remove(): Promise<void> {
    const metadata = await this.findLatestMetadata();
    if (!metadata) throw new NotFoundException('No CV uploaded');
    // Ordre : DB delete → S3 delete (cohérence Projects.remove après fix 8cf3104)
    await this.db.delete(cvFiles).where(eq(cvFiles.id, metadata.id));
    await this.storage.delete(CvService.BUCKET, metadata.fileKey);
  }
}
