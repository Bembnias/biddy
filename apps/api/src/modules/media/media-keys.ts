// Klucze obiektów w magazynie (F-12). Kubełek uploads (prywatny): oryginały i kwarantanna;
// kubełek media (publiczny): niezmienne warianty WebP.
import type { MediaPurpose } from './db/media.schema.js';

export function incomingKey(ownerId: string, mediaId: string): string {
  return `incoming/${ownerId}/${mediaId}`;
}

export function quarantineKey(mediaId: string): string {
  return `quarantine/${mediaId}.webp`;
}

export function variantKey(purpose: MediaPurpose, mediaId: string, variant: string): string {
  return `${purpose === 'AVATAR' ? 'avatars' : 'items'}/${mediaId}/${variant}.webp`;
}
