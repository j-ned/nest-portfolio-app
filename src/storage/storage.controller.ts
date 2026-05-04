import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { StorageService } from './storage.service';

/**
 * Whitelist des buckets servis publiquement via le proxy.
 * Évite qu'un éventuel bucket privé soit exposé par mégarde si quelqu'un
 * connaît son nom.
 */
const PUBLIC_BUCKETS = new Set<string>(['portfolio-storage']);

@ApiTags('Storage')
@Controller('storage')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Get(':bucket/*splat')
  @ApiOperation({
    summary:
      'Proxy public d’un objet S3 (Garage v2 ne supporte pas l’accès anonyme direct)',
  })
  @ApiResponse({ status: 200, description: 'Stream binaire avec Content-Type d’origine' })
  @ApiResponse({ status: 404, description: 'Bucket non public ou objet inexistant' })
  async getObject(
    @Param('bucket') bucket: string,
    @Param('splat') splat: string[],
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!PUBLIC_BUCKETS.has(bucket)) {
      throw new NotFoundException();
    }
    const key = Array.isArray(splat) ? splat.join('/') : String(splat);
    if (!key) throw new NotFoundException();

    const { buffer, contentType } = await this.storage.get(bucket, key);
    res.set({
      'Content-Type': contentType,
      'Content-Length': buffer.length.toString(),
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    });
    return new StreamableFile(buffer);
  }
}
