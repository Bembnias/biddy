// Rewalidacja stron ISR na żądanie workera API (F-18, PROJECT.md §11.3): `POST /api/revalidate`
// z sekretem w nagłówku Authorization i listą tagów. Przyjmujemy tylko tagi stron aukcji, żeby
// sekret nie pozwalał unieważniać dowolnego cache.
import { createHash, timingSafeEqual } from 'node:crypto';

import { PUBLIC_ID_PATTERN } from '@biddy/shared';

/** Najwięcej tagów w jednym żądaniu. */
export const MAX_REVALIDATE_TAGS = 20;

const AUCTION_TAG_PREFIX = 'auction:';

/** Tag strony aukcji: `auction:{publicId}`. */
export function isAuctionCacheTag(tag: unknown): tag is string {
  return (
    typeof tag === 'string' &&
    tag.startsWith(AUCTION_TAG_PREFIX) &&
    PUBLIC_ID_PATTERN.test(tag.slice(AUCTION_TAG_PREFIX.length))
  );
}

/** Porównanie nagłówka `Bearer {sekret}` w stałym czasie (skróty mają równą długość). */
export function isAuthorized(header: string | null, secret: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header ?? ''), digest(`Bearer ${secret}`));
}

/** Tagi z treści `{ tags: string[] }` albo null, gdy treść jest niepoprawna. */
export function parseRevalidateBody(body: unknown): string[] | null {
  if (typeof body !== 'object' || body === null || !('tags' in body)) {
    return null;
  }
  const { tags } = body;
  if (
    !Array.isArray(tags) ||
    tags.length === 0 ||
    tags.length > MAX_REVALIDATE_TAGS ||
    !tags.every(isAuctionCacheTag)
  ) {
    return null;
  }
  return [...new Set(tags)];
}

export type RevalidateResult =
  | { readonly status: 200; readonly body: { readonly revalidated: number } }
  | { readonly status: 400 | 401 | 503; readonly body: { readonly error: string } };

/**
 * Obsługa żądania: sekret, treść, rewalidacja tagów. `revalidate` to `revalidateTag` z Next
 * (w testach atrapa).
 */
export function handleRevalidate(
  request: { readonly authorization: string | null; readonly body: unknown },
  secret: string | undefined,
  revalidate: (tag: string) => void,
): RevalidateResult {
  if (secret === undefined) {
    return { status: 503, body: { error: 'Rewalidacja nie jest skonfigurowana.' } };
  }
  if (!isAuthorized(request.authorization, secret)) {
    return { status: 401, body: { error: 'Nieprawidłowy sekret rewalidacji.' } };
  }
  const tags = parseRevalidateBody(request.body);
  if (tags === null) {
    return {
      status: 400,
      body: {
        error: `Oczekiwano { tags: [...] }: od 1 do ${String(MAX_REVALIDATE_TAGS)} tagów auction:{publicId}.`,
      },
    };
  }
  for (const tag of tags) {
    revalidate(tag);
  }
  return { status: 200, body: { revalidated: tags.length } };
}
