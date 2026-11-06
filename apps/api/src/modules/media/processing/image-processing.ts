// Przetwarzanie zdjęć (F-12, PROJECT.md §16.1): sprawdzenie rzeczywistego formatu i rozmiaru,
// obrót według EXIF, ponowne kodowanie do WebP bez żadnych metadanych (w tym GPS) i warianty.
// sharp domyślnie nie kopiuje metadanych do wyniku; obrót wykonujemy jawnie, bo po usunięciu
// EXIF orientacja zniknęłaby razem z nim.
import sharp, { type Metadata } from 'sharp';

import type { MediaPurpose } from '../db/media.schema.js';

/** Limit pikseli przy dekodowaniu: ochrona przed „bombami dekompresji”. */
export const MAX_INPUT_PIXELS = 40_000_000;

/** Formaty przyjmowane po rozpoznaniu zawartości (nie nagłówka od klienta). Bez SVG i GIF. */
const ACCEPTED_FORMATS: ReadonlySet<string> = new Set(['jpeg', 'png', 'webp']);

const WEBP_QUALITY = 82;

export interface VariantSpec {
  readonly name: string;
  /** Dłuższy bok (albo bok kwadratu) w pikselach. */
  readonly size: number;
  /** Kwadrat wykadrowany ze środka (zdjęcie profilowe). */
  readonly square?: boolean;
}

export const PURPOSE_SPECS: Readonly<
  Record<MediaPurpose, { readonly minSide: number; readonly variants: readonly VariantSpec[] }>
> = {
  ITEM_PHOTO: {
    minSide: 300,
    variants: [
      { name: 'thumb', size: 320 },
      { name: 'medium', size: 800 },
      { name: 'large', size: 1600 },
    ],
  },
  AVATAR: {
    minSide: 96,
    variants: [
      { name: 'small', size: 96, square: true },
      { name: 'large', size: 256, square: true },
    ],
  },
  DISPUTE_EVIDENCE: {
    minSide: 200,
    variants: [
      { name: 'thumb', size: 320 },
      { name: 'large', size: 1600 },
    ],
  },
  MESSAGE_PHOTO: {
    minSide: 200,
    variants: [
      { name: 'thumb', size: 320 },
      { name: 'large', size: 1600 },
    ],
  },
};

/** Plik odrzucony z powodem dla użytkownika (po polsku). */
export class ImageRejectedError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'ImageRejectedError';
  }
}

export interface ProcessedVariant {
  readonly name: string;
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
}

export interface ProcessedImage {
  readonly variants: readonly ProcessedVariant[];
  /** Największy wariant (do moderacji i kwarantanny). */
  readonly largest: ProcessedVariant;
}

const NOT_AN_IMAGE = 'Plik nie jest obsługiwanym zdjęciem (JPEG, PNG albo WebP).';

/** Przetwarza oryginał na warianty WebP bez metadanych; rzuca ImageRejectedError. */
export async function processImage(input: Buffer, purpose: MediaPurpose): Promise<ProcessedImage> {
  const spec = PURPOSE_SPECS[purpose];
  let metadata: Metadata;
  try {
    metadata = await sharp(input, { limitInputPixels: false }).metadata();
  } catch {
    throw new ImageRejectedError(NOT_AN_IMAGE);
  }
  if (metadata.format === undefined || !ACCEPTED_FORMATS.has(metadata.format)) {
    throw new ImageRejectedError(NOT_AN_IMAGE);
  }
  if (metadata.width * metadata.height > MAX_INPUT_PIXELS) {
    throw new ImageRejectedError(
      `Zdjęcie ma za dużą rozdzielczość (maks. ${String(MAX_INPUT_PIXELS / 1_000_000)} Mpx). Zmniejsz je przed wysłaniem.`,
    );
  }
  if (Math.min(metadata.width, metadata.height) < spec.minSide) {
    throw new ImageRejectedError(
      `Zdjęcie jest za małe: krótszy bok musi mieć co najmniej ${String(spec.minSide)} px.`,
    );
  }

  const variants: ProcessedVariant[] = [];
  try {
    for (const variant of spec.variants) {
      const pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, pages: 1 })
        .rotate()
        .resize(
          variant.square === true
            ? { width: variant.size, height: variant.size, fit: 'cover', position: 'centre' }
            : {
                width: variant.size,
                height: variant.size,
                fit: 'inside',
                withoutEnlargement: true,
              },
        )
        .webp({ quality: WEBP_QUALITY });
      const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
      variants.push({ name: variant.name, data, width: info.width, height: info.height });
    }
  } catch {
    throw new ImageRejectedError(NOT_AN_IMAGE);
  }
  const largest = variants.at(-1);
  if (largest === undefined) {
    throw new Error(`Brak wariantów dla ${purpose}`);
  }
  return { variants, largest };
}
