// Klucze obiektów w magazynie (F-12). Kubełek uploads (prywatny): oryginały, kwarantanna
// i warianty zdjęć prywatnych (spory, F-28); kubełek media (publiczny): niezmienne warianty WebP.
import type { MediaPurpose } from './db/media.schema.js';

export function incomingKey(ownerId: string, mediaId: string): string {
  return `incoming/${ownerId}/${mediaId}`;
}

export function quarantineKey(mediaId: string): string {
  return `quarantine/${mediaId}.webp`;
}

const VARIANT_PREFIX: Readonly<Record<MediaPurpose, string>> = {
  ITEM_PHOTO: 'items',
  AVATAR: 'avatars',
  DISPUTE_EVIDENCE: 'evidence',
};

export function variantKey(purpose: MediaPurpose, mediaId: string, variant: string): string {
  return `${VARIANT_PREFIX[purpose]}/${mediaId}/${variant}.webp`;
}
