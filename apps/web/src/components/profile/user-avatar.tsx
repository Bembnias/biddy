import { cn } from '@/lib/utils';

/** Pary tło/tekst z palety tokenów, z kontrastem WCAG AA (jasne tło, ciemny tekst). */
const COLORS = [
  'bg-navy-100 text-navy-900',
  'bg-orange-100 text-orange-900',
  'bg-green-100 text-green-900',
  'bg-gray-200 text-gray-900',
] as const;

/** Inicjały z dwóch pierwszych słów imienia, np. „Kasia Kupująca” → „KK”. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/u)
    .filter((word) => word !== '')
    .slice(0, 2)
    .map((word) => [...word][0]?.toUpperCase() ?? '')
    .join('');
}

/** Kolor avatara stały dla konta (z identyfikatora). */
export function avatarColor(userId: string): string {
  let hash = 0;
  for (const char of userId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return COLORS[hash % COLORS.length] ?? COLORS[0];
}

/**
 * Avatar użytkownika: zdjęcie profilowe (F-12, przetworzony kwadrat WebP) albo inicjały na
 * kolorowym tle. Obrazek z Google lub Apple nie jest pokazywany (tylko zdjęcia z Biddy).
 */
export function UserAvatar({
  userId,
  name,
  label,
  imageUrl,
  size = 'md',
}: {
  readonly userId: string;
  readonly name: string;
  readonly label: string;
  readonly imageUrl?: string | null;
  readonly size?: 'md' | 'lg';
}) {
  const dimensions = size === 'lg' ? 'size-20' : 'size-10';
  if (imageUrl !== undefined && imageUrl !== null) {
    const pixels = size === 'lg' ? 80 : 40;
    return (
      // Gotowy wariant WebP z CDN (256 px); optymalizacja Next.js nic by tu nie dała.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={label}
        width={pixels}
        height={pixels}
        className={cn('shrink-0 rounded-full object-cover', dimensions)}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        dimensions,
        size === 'lg' ? 'text-2xl' : 'text-base',
        avatarColor(userId),
      )}
    >
      <span aria-hidden>{initialsOf(name)}</span>
    </span>
  );
}
