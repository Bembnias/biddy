import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { FakeImageModerator } from './image-moderator.js';
import { ImageRejectedError, processImage } from './image-processing.js';

/**
 * Szerokość geograficzna w EXIF (52°13'0"): trzy ułamki RATIONAL, big-endian jak w JPEG z sharp.
 * Po tych bajtach rozpoznajemy, czy współrzędne przetrwały przetwarzanie.
 */
const GPS_LATITUDE = Buffer.from([0, 0, 0, 52, 0, 0, 0, 1, 0, 0, 0, 13, 0, 0, 0, 1]);

/** JPEG z EXIF (aparat, data) i GPS, obrócony przez orientację 6 (90° w prawo). */
async function photoWithGps(width = 1200, height = 900): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 120, b: 200 } },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({
      IFD0: { Make: 'Aparat', Model: 'Telefon Testowy' },
      IFD2: { DateTimeOriginal: '2026:10:01 12:00:00' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '52/1 13/1 0/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '21/1 0/1 0/1',
      },
    })
    .toBuffer();
}

async function rejection(promise: Promise<unknown>): Promise<string> {
  const error: unknown = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ImageRejectedError);
  return (error as ImageRejectedError).reason;
}

describe('processImage', () => {
  it('warianty WebP bez EXIF i GPS, obrócone według orientacji', async () => {
    const input = await photoWithGps();
    const before = await sharp(input).metadata();
    expect(before.orientation).toBe(6);
    expect(before.exif?.includes(Buffer.from('Telefon Testowy'))).toBe(true);
    expect(before.exif?.includes(GPS_LATITUDE)).toBe(true);

    const { variants, largest } = await processImage(input, 'ITEM_PHOTO');
    expect(variants.map((variant) => [variant.name, variant.width, variant.height])).toEqual([
      ['thumb', 240, 320],
      ['medium', 600, 800],
      ['large', 900, 1200],
    ]);
    expect(largest.name).toBe('large');
    for (const variant of variants) {
      const after = await sharp(variant.data).metadata();
      expect(after.format).toBe('webp');
      expect(after.exif).toBeUndefined();
      expect(after.xmp).toBeUndefined();
      expect(after.icc).toBeUndefined();
      expect(after.orientation).toBeUndefined();
      expect(variant.data.includes(Buffer.from('Telefon Testowy'))).toBe(false);
      expect(variant.data.includes(GPS_LATITUDE)).toBe(false);
      expect(variant.data.includes(Buffer.from('Exif'))).toBe(false);
    }
  });

  it('zdjęcie profilowe: kwadraty 96 i 256 px', async () => {
    const { variants } = await processImage(await photoWithGps(800, 400), 'AVATAR');
    expect(variants.map((variant) => [variant.name, variant.width, variant.height])).toEqual([
      ['small', 96, 96],
      ['large', 256, 256],
    ]);
  });

  it('nie powiększa małych zdjęć przedmiotu', async () => {
    const small = await sharp({
      create: { width: 400, height: 300, channels: 3, background: '#888' },
    })
      .png()
      .toBuffer();
    const { largest } = await processImage(small, 'ITEM_PHOTO');
    expect([largest.width, largest.height]).toEqual([400, 300]);
  });

  it.each([
    ['tekst udający JPEG', Buffer.from('to nie jest zdjęcie')],
    ['pusty plik', Buffer.alloc(0)],
  ])('odrzuca: %s', async (_label, input) => {
    expect(await rejection(processImage(input, 'ITEM_PHOTO'))).toBe(
      'Plik nie jest obsługiwanym zdjęciem (JPEG, PNG albo WebP).',
    );
  });

  it('odrzuca SVG i GIF (rozpoznane z zawartości)', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><script>alert(1)</script></svg>',
    );
    const gif = await sharp({
      create: { width: 400, height: 400, channels: 3, background: '#fff' },
    })
      .gif()
      .toBuffer();
    for (const input of [svg, gif]) {
      expect(await rejection(processImage(input, 'ITEM_PHOTO'))).toContain('nie jest obsługiwanym');
    }
  });

  it('odrzuca za małe zdjęcie i za dużą rozdzielczość (bez dekodowania pikseli)', async () => {
    const tiny = await sharp({
      create: { width: 200, height: 600, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    expect(await rejection(processImage(tiny, 'ITEM_PHOTO'))).toBe(
      'Zdjęcie jest za małe: krótszy bok musi mieć co najmniej 300 px.',
    );
    const huge = await sharp({
      create: { width: 8000, height: 6000, channels: 3, background: '#fff' },
    })
      .jpeg({ quality: 10 })
      .toBuffer();
    expect(await rejection(processImage(huge, 'ITEM_PHOTO'))).toContain('za dużą rozdzielczość');
  });
});

describe('FakeImageModerator', () => {
  it('oznacza zdjęcie prawie w całości czerwone, przepuszcza inne', async () => {
    const moderator = new FakeImageModerator();
    const red = await sharp({
      create: { width: 50, height: 50, channels: 3, background: '#ff0000' },
    })
      .webp()
      .toBuffer();
    const blue = await sharp({
      create: { width: 50, height: 50, channels: 3, background: '#0044ff' },
    })
      .webp()
      .toBuffer();
    expect(await moderator.moderate(red)).toEqual({ flagged: true, labels: ['test-red'] });
    expect(await moderator.moderate(blue)).toEqual({ flagged: false, labels: [] });
  });
});
