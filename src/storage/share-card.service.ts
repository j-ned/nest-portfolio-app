import { Injectable, NotFoundException } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { ImageOptimizer } from './image-optimizer.service';
import { shareCardKey } from './s3-utils';
import { StorageService } from './storage.service';

export type ShareCard = {
  readonly buffer: Buffer;
  readonly contentType: 'image/jpeg';
};

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array),
    );
  }
  return Buffer.concat(chunks);
}

/**
 * Carte de partage d'une image du bucket, dérivée à la première demande puis conservée dans S3
 * sous `<key>.share.jpg`. `StorageService` supprime cette dérivée dès que l'original est remplacé
 * ou effacé : pas de backfill, pas de colonne en base, les images déjà en ligne en profitent.
 */
@Injectable()
export class ShareCardService {
  constructor(
    private readonly storage: StorageService,
    private readonly images: ImageOptimizer,
  ) {}

  async get(bucket: string, key: string): Promise<ShareCard> {
    const derivedKey = shareCardKey(key);
    try {
      const cached = await this.storage.get(bucket, derivedKey);
      return {
        buffer: await readAll(cached.stream),
        contentType: 'image/jpeg',
      };
    } catch (err: unknown) {
      if (!(err instanceof NotFoundException)) throw err;
    }

    const original = await this.storage.get(bucket, key);
    const buffer = await this.images.toShareCard(
      await readAll(original.stream),
    );
    await this.storage.upload(bucket, derivedKey, buffer, 'image/jpeg');
    return { buffer, contentType: 'image/jpeg' };
  }
}
