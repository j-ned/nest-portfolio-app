import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import { ShareCardService } from './share-card.service';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

describe('StorageController', () => {
  const storage = { get: jest.fn() };
  const shareCards = { get: jest.fn() };
  let controller: StorageController;
  let res: { set: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [StorageController],
      providers: [
        { provide: StorageService, useValue: storage },
        { provide: ShareCardService, useValue: shareCards },
      ],
    }).compile();
    controller = module.get(StorageController);
    res = { set: jest.fn() };
  });

  const call = (variant?: string) =>
    controller.getObject(
      'portfolio-storage',
      ['blog', '1.avif'],
      res as unknown as Response,
      variant,
    );

  it("sans variante : streame l'objet avec son Content-Type d'origine", async () => {
    storage.get.mockResolvedValue({
      stream: Readable.from(Buffer.from('x')),
      contentType: 'image/avif',
      contentLength: 1,
    });

    await call();

    expect(storage.get).toHaveBeenCalledWith(
      'portfolio-storage',
      'blog/1.avif',
    );
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'image/avif',
        'Content-Length': '1',
      }),
    );
  });

  it('variant=share : sert la carte JPEG avec sa taille et le même cache', async () => {
    const buffer = Buffer.from('jpeg-card');
    shareCards.get.mockResolvedValue({ buffer, contentType: 'image/jpeg' });

    await call('share');

    expect(shareCards.get).toHaveBeenCalledWith(
      'portfolio-storage',
      'blog/1.avif',
    );
    expect(storage.get).not.toHaveBeenCalled();
    expect(res.set).toHaveBeenCalledWith({
      'Content-Type': 'image/jpeg',
      'Content-Length': String(buffer.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
  });

  it('variante inconnue → 400', async () => {
    await expect(call('thumb')).rejects.toThrow(BadRequestException);
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('bucket non public → 404, même avec variante', async () => {
    await expect(
      controller.getObject(
        'private',
        ['x.avif'],
        res as unknown as Response,
        'share',
      ),
    ).rejects.toThrow(NotFoundException);
    expect(shareCards.get).not.toHaveBeenCalled();
  });
});
