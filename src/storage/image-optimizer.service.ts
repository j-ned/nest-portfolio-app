import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import sharp from 'sharp';

/** Largeur max stockée : les visuels s'affichent au plus en ~800 px CSS, 1600 couvre le retina 2×. */
export const IMAGE_MAX_WIDTH = 1600;
const AVIF_QUALITY = 60;
const AVIF_EFFORT = 4;
/** Carte de partage Open Graph : le 1,91:1 attendu par Facebook, LinkedIn et X, en JPEG (l'AVIF n'y est pas décodé). */
export const SHARE_CARD = { width: 1200, height: 630 } as const;
const SHARE_CARD_JPEG_QUALITY = 80;

export type OptimizedImage = {
  readonly buffer: Buffer;
  readonly mimetype: 'image/avif';
  readonly ext: 'avif';
  readonly width: number;
  readonly height: number;
};

/**
 * Normalise toute image uploadée (JPEG, PNG, WebP, AVIF) en AVIF ≤ 1600 px, orientation EXIF
 * appliquée. Un JPEG d'appareil photo de 2,8 Mo devient ~70 Ko sans que l'admin ait à y penser.
 */
@Injectable()
export class ImageOptimizer {
  async optimize(input: Buffer): Promise<OptimizedImage> {
    try {
      const { data, info } = await sharp(input, { animated: false })
        .rotate()
        .resize({ width: IMAGE_MAX_WIDTH, withoutEnlargement: true })
        .avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT })
        .toBuffer({ resolveWithObject: true });
      return {
        buffer: data,
        mimetype: 'image/avif',
        ext: 'avif',
        width: info.width,
        height: info.height,
      };
    } catch {
      throw new UnprocessableEntityException(
        'Image illisible : fichier corrompu ou format non supporté',
      );
    }
  }

  /**
   * Carte de partage JPEG 1200×630 (recadrage centré) pour `og:image` / `twitter:image` : les
   * crawlers sociaux ne lisent pas l'AVIF stocké, et exigent un ratio 1,91:1 pour la grande carte.
   */
  async toShareCard(input: Buffer): Promise<Buffer> {
    try {
      return await sharp(input, { animated: false })
        .rotate()
        .resize({ ...SHARE_CARD, fit: 'cover', position: 'attention' })
        .jpeg({ quality: SHARE_CARD_JPEG_QUALITY, progressive: true })
        .toBuffer();
    } catch {
      throw new UnprocessableEntityException(
        'Image illisible : fichier corrompu ou format non supporté',
      );
    }
  }
}
