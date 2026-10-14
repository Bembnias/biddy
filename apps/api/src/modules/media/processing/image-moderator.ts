// Moderacja obrazów (F-12): adapter dostawcy (ADR-7) i atrapa. Prawdziwy dostawca (np.
// Cloudflare, Sightengine, AWS Rekognition) zostanie wybrany przed startem.
import sharp from 'sharp';

export interface ModerationResult {
  /** Zdjęcie wymaga sprawdzenia przez moderatora (nie trafia do publicznego kubełka). */
  readonly flagged: boolean;
  /** Powody od dostawcy, np. `nudity`, `violence`. */
  readonly labels: readonly string[];
}

export interface ImageModerator {
  /** Ocena przetworzonego zdjęcia (WebP bez metadanych). */
  moderate(image: Buffer): Promise<ModerationResult>;
}

/** Token DI {@link ImageModerator}. */
export const IMAGE_MODERATOR = Symbol('IMAGE_MODERATOR');

/**
 * Atrapa: oznacza zdjęcia prawie w całości czerwone (etykieta `test-red`), żeby lokalnie
 * i w testach dało się sprawdzić ścieżkę moderacji. Pozostałe przepuszcza.
 */
export class FakeImageModerator implements ImageModerator {
  async moderate(image: Buffer): Promise<ModerationResult> {
    const { channels } = await sharp(image).stats();
    const [red, green, blue] = channels.map((channel) => channel.mean);
    const flagged = (red ?? 0) > 200 && (green ?? 255) < 60 && (blue ?? 255) < 60;
    return { flagged, labels: flagged ? ['test-red'] : [] };
  }
}
