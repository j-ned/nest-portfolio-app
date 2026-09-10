import { UnprocessableEntityException } from '@nestjs/common';
import sharp from 'sharp';
import { IMAGE_MAX_WIDTH, ImageOptimizer } from './image-optimizer.service';

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
    const noisy = await sharp({
      create: {
        width: 2400,
        height: 1600,
        channels: 3,
        noise: { type: 'gaussian', mean: 128, sigma: 40 },
      },
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    const out = await optimizer.optimize(noisy);
    expect(out.buffer.length).toBeLessThan(noisy.length / 2);
  });

  it('fichier corrompu → 422', async () => {
    await expect(
      optimizer.optimize(Buffer.from('not an image')),
    ).rejects.toThrow(UnprocessableEntityException);
  });
});
