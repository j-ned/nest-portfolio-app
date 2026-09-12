import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ShareCardService } from './share-card.service';
import { StorageService } from './storage.service';

const CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';

/**
 * Whitelist des buckets servis publiquement via le proxy.
 * Évite qu'un éventuel bucket privé soit exposé par mégarde si quelqu'un
 * connaît son nom.
 */
const PUBLIC_BUCKETS = new Set<string>(['portfolio-storage']);

/**
 * Le rate limit global (10 req/60s) ne s'applique pas ici : une page peut
 * référencer N images, un dashboard admin avec une liste de projets en charge
 * autant qu'il y a de rows. Le cache HTTP (24h max-age) absorbe les répétitions.
 * R2 Class B (read) free tier = 1M req/mois, largement couvert pour un portfolio.
 */
@SkipThrottle()
@ApiTags('Storage')
@Controller('storage')
export class StorageController {
  constructor(
    private readonly storage: StorageService,
    private readonly shareCards: ShareCardService,
  ) {}

  @Get(':bucket/*splat')
  @ApiOperation({
    summary:
      "Proxy public d'un objet S3 (R2 derrière, custom domain non encore configuré)",
  })
  @ApiResponse({
    status: 200,
    description: "Stream binaire avec Content-Type d'origine",
  })
  @ApiResponse({
    status: 404,
    description: 'Bucket non public ou objet inexistant',
  })
  @ApiQuery({
    name: 'variant',
    required: false,
    enum: ['share'],
    description:
      "`share` : carte de partage JPEG 1200×630 dérivée de l'image (og:image), générée à la première demande",
  })
  async getObject(
    @Param('bucket') bucket: string,
    @Param('splat') splat: string[],
    @Res({ passthrough: true }) res: Response,
    @Query('variant') variant?: string,
  ): Promise<StreamableFile> {
    if (!PUBLIC_BUCKETS.has(bucket)) {
      throw new NotFoundException();
    }
    const key = Array.isArray(splat) ? splat.join('/') : String(splat);
    if (!key) throw new NotFoundException();

    if (variant === 'share') {
      const { buffer, contentType } = await this.shareCards.get(bucket, key);
      res.set({
        'Content-Type': contentType,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': CACHE_CONTROL,
      });
      return new StreamableFile(buffer);
    }
    if (variant !== undefined) {
      throw new BadRequestException(`Unknown variant "${variant}"`);
    }

    const { stream, contentType, contentLength } = await this.storage.get(
      bucket,
      key,
    );
    res.set({
      'Content-Type': contentType,
      'Content-Length': contentLength.toString(),
      'Cache-Control': CACHE_CONTROL,
    });
    return new StreamableFile(stream);
  }
}
