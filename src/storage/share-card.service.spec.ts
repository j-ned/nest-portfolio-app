import { NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { ImageOptimizer } from './image-optimizer.service';
import { ShareCardService } from './share-card.service';
import type { S3ObjectStream, StorageService } from './storage.service';

function s3Object(content: string, contentType = 'image/avif'): S3ObjectStream {
  return {
    stream: Readable.from(Buffer.from(content)),
    contentType,
    contentLength: content.length,
  };
}

describe('ShareCardService', () => {
  const card = Buffer.from('jpeg-card');
  let storage: jest.Mocked<Pick<StorageService, 'get' | 'upload'>>;
  let images: jest.Mocked<Pick<ImageOptimizer, 'toShareCard'>>;
  let service: ShareCardService;

  beforeEach(() => {
    storage = {
      get: jest.fn(),
      upload: jest.fn().mockResolvedValue(undefined),
    };
    images = { toShareCard: jest.fn().mockResolvedValue(card) };
    service = new ShareCardService(
      storage as unknown as StorageService,
      images as unknown as ImageOptimizer,
    );
  });

  it('sert la carte déjà dérivée sans rien régénérer', async () => {
    storage.get.mockResolvedValueOnce(s3Object('cached-card', 'image/jpeg'));

    const out = await service.get('b', 'blog/1.avif');

    expect(storage.get).toHaveBeenCalledTimes(1);
    expect(storage.get).toHaveBeenCalledWith('b', 'blog/1.avif.share.jpg');
    expect(out.buffer.toString()).toBe('cached-card');
    expect(out.contentType).toBe('image/jpeg');
    expect(images.toShareCard).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("dérive la carte de l'original à la première demande et la conserve dans S3", async () => {
    storage.get
      .mockRejectedValueOnce(new NotFoundException())
      .mockResolvedValueOnce(s3Object('original-avif'));

    const out = await service.get('b', 'blog/1.avif');

    expect(storage.get).toHaveBeenNthCalledWith(2, 'b', 'blog/1.avif');
    expect(images.toShareCard).toHaveBeenCalledWith(
      Buffer.from('original-avif'),
    );
    expect(storage.upload).toHaveBeenCalledWith(
      'b',
      'blog/1.avif.share.jpg',
      card,
      'image/jpeg',
    );
    expect(out.buffer).toBe(card);
  });

  it("propage le 404 quand l'original n'existe pas non plus", async () => {
    storage.get.mockRejectedValue(new NotFoundException());

    await expect(service.get('b', 'blog/missing.avif')).rejects.toThrow(
      NotFoundException,
    );
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('ne masque pas une erreur S3 autre que 404 sur la dérivée', async () => {
    storage.get.mockRejectedValueOnce(new Error('network down'));

    await expect(service.get('b', 'blog/1.avif')).rejects.toThrow(
      'network down',
    );
    expect(images.toShareCard).not.toHaveBeenCalled();
  });
});
