import { UnprocessableEntityException } from '@nestjs/common';
import sharp from 'sharp';
import {
  IMAGE_MAX_WIDTH,
  ImageOptimizer,
  PORTRAIT,
  SHARE_CARD,
} from './image-optimizer.service';

function solidImage(
  width: number,
  height: number,
  format: 'png' | 'jpeg' | 'webp',
) {
  const img = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 40, b: 40 },
    },
  });
  return img[format]().toBuffer();
}

/** Bruit gaussien RGB ; `background` est exigé par les types de sharp mais ignoré quand `noise` est fourni. */
function gaussianNoise(width: number, height: number, sigma: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: '#808080',
      noise: { type: 'gaussian', mean: 128, sigma },
    },
  });
}

/**
 * JPEG q95 à la taille d'un appareil photo : scène basse fréquence (bruit 1/32 agrandi en cubique,
 * dégradés et formes floues) + grain de capteur fin (σ ≤ 8, fusion `overlay` dans libvips : une
 * boucle JS sur 11 Mo de pixels coûte ~8 s dans le bac à sable Jest). Un bruit blanc pur sur toute
 * l'image n'est pas une photo : c'est le pire cas de l'encodeur AV1, ~4 fois plus lent à encoder.
 */
async function photoLikeJpeg(width: number, height: number) {
  const scene = await gaussianNoise(
    Math.ceil(width / 32),
    Math.ceil(height / 32),
    50,
  )
    .resize(width, height, { kernel: 'cubic' })
    .png({ compressionLevel: 0 })
    .toBuffer();
  const grain = await gaussianNoise(width, height, 8)
    .png({ compressionLevel: 0 })
    .toBuffer();
  return sharp(scene)
    .composite([{ input: grain, blend: 'overlay' }])
    .jpeg({ quality: 95 })
    .toBuffer();
}

describe('ImageOptimizer', () => {
  const optimizer = new ImageOptimizer();
  // Encodage AVIF réel : ~1 s par image, davantage quand la suite tourne en parallèle.
  jest.setTimeout(30_000);

  it.each([
    ['png', 3000, 2000, 1600, 1067],
    ['jpeg', 2816, 1536, 1600, 873],
    ['webp', 1920, 1080, 1600, 900],
  ] as const)(
    '%s %dx%d → AVIF %dx%d, ratio conservé',
    async (format, w, h, expectedW, expectedH) => {
      const input = await solidImage(w, h, format);

      const out = await optimizer.optimize(input);

      expect(out.mimetype).toBe('image/avif');
      expect(out.ext).toBe('avif');
      expect(out.width).toBe(expectedW);
      expect(out.height).toBe(expectedH);
      const meta = await sharp(out.buffer).metadata();
      expect(meta.format).toBe('heif');
      expect(meta.width).toBe(IMAGE_MAX_WIDTH);
    },
  );

  it("n'agrandit pas une image plus petite que la largeur max", async () => {
    const out = await optimizer.optimize(await solidImage(800, 600, 'png'));
    expect(out.width).toBe(800);
    expect(out.height).toBe(600);
  });

  it("réduit nettement le poids d'un JPEG photo", async () => {
    const photo = await photoLikeJpeg(2400, 1600);
    const out = await optimizer.optimize(photo);
    expect(out.buffer.length).toBeLessThan(photo.length / 2);
  });

  it('fichier corrompu → 422', async () => {
    await expect(
      optimizer.optimize(Buffer.from('not an image')),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  describe('toShareCard', () => {
    it.each([
      ['paysage 16:9', 1600, 900],
      ['portrait', 600, 900],
      ['petite image (agrandie pour un rendu constant)', 400, 300],
    ] as const)('%s → JPEG 1200×630', async (_label, w, h) => {
      const out = await optimizer.toShareCard(await solidImage(w, h, 'png'));
      const meta = await sharp(out).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.width).toBe(SHARE_CARD.width);
      expect(meta.height).toBe(SHARE_CARD.height);
    });

    it('lit un AVIF (format stocké) en entrée', async () => {
      const avif = (
        await optimizer.optimize(await solidImage(1600, 900, 'png'))
      ).buffer;
      const meta = await sharp(await optimizer.toShareCard(avif)).metadata();
      expect(meta.format).toBe('jpeg');
    });

    it('fichier corrompu → 422', async () => {
      await expect(
        optimizer.toShareCard(Buffer.from('not an image')),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('toPortrait (spec 021, A5)', () => {
    it.each([
      ['PNG paysage 1000×600', 1000, 600, 'png'],
      ['JPEG portrait 1200×1800', 1200, 1800, 'jpeg'],
      [
        'petite image 300×300 (agrandie pour un cadre constant)',
        300,
        300,
        'webp',
      ],
    ] as const)('%s → AVIF 640×800', async (_label, w, h, format) => {
      const out = await optimizer.toPortrait(await solidImage(w, h, format));

      expect(out.mimetype).toBe('image/avif');
      expect(out.ext).toBe('avif');
      expect([out.width, out.height]).toEqual([
        PORTRAIT.width,
        PORTRAIT.height,
      ]);
      const meta = await sharp(out.buffer).metadata();
      expect(meta.format).toBe('heif');
      expect([meta.width, meta.height]).toEqual([640, 800]);
    });

    it('fichier corrompu → 422', async () => {
      await expect(
        optimizer.toPortrait(Buffer.from('not an image')),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });
});
