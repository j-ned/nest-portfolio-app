import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { cvFiles, type CvFile } from '../database/schema';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class CvService {
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

    const [row] = await this.db
      .insert(cvFiles)
      .values({
        fileName: file.originalname,
        fileKey: CvService.KEY,
        fileSize: file.size,
        mimeType: file.mimetype,
      })
      .onConflictDoUpdate({
        target: cvFiles.fileKey,
        set: {
          fileName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async findLatestMetadata(): Promise<CvFile | null> {
    const [row] = await this.db
      .select()
      .from(cvFiles)
      .orderBy(desc(cvFiles.uploadedAt))
      .limit(1);
    return row ?? null;
  }

  async download(): Promise<{ stream: Readable; metadata: CvFile }> {
    const metadata = await this.findLatestMetadata();
    if (!metadata) throw new NotFoundException('No CV uploaded');
    const { stream } = await this.storage.get(
      CvService.BUCKET,
      metadata.fileKey,
    );
    return { stream, metadata };
  }

  async remove(): Promise<void> {
    const metadata = await this.findLatestMetadata();
    if (!metadata) throw new NotFoundException('No CV uploaded');
    // Ordre : DB delete → S3 delete (cohérence Projects.remove après fix 8cf3104)
    await this.db.delete(cvFiles).where(eq(cvFiles.id, metadata.id));
    await this.storage.delete(CvService.BUCKET, metadata.fileKey);
  }
}
