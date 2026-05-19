import type { MulterModuleOptions } from '@nestjs/platform-express';

/**
 * Multer configs shared across modules that handle file uploads.
 *
 * memoryStorage (default) is kept so the buffer can be forwarded straight to
 * S3 — fine-grained validation (mime/size) lives in each route's ParseFilePipe.
 * The fileSize limit here is only a safety net against unbounded uploads.
 */
export function multerConfig(maxSizeMb: number): MulterModuleOptions {
  return { limits: { fileSize: maxSizeMb * 1024 * 1024 } };
}
