import { cn } from '@/lib/utils';

/** Pary tło/tekst z palety tokenów, z kontrastem WCAG AA (jasne tło, ciemny tekst). */
const COLORS = [
  'bg-violet-100 text-violet-800',
  'bg-pink-100 text-pink-800',
  'bg-sky-100 text-sky-800',
  'bg-green-100 text-green-800',
] as const;

const SIZES = { xs: 'size-7', md: 'size-10', lg: 'size-20', xl: 'size-28' } as const;
const PIXELS = { xs: 28, md: 40, lg: 80, xl: 112 } as const;
const TEXT = { xs: 'text-badge', md: 'text-base', lg: 'text-2xl', xl: 'text-4xl' } as const;

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
  className,
}: {
  readonly userId: string;
  readonly name: string;
  readonly label: string;
  readonly imageUrl?: string | null;
  /** `xs` 28 px (nagłówek, historia ofert), `md` 40 px, `lg` 80 px, `xl` 112 px (profil publiczny). */
  readonly size?: 'xs' | 'md' | 'lg' | 'xl';
  readonly className?: string;
}) {
  const dimensions = SIZES[size];
  // Pusta etykieta: avatar jest dekoracją obok tekstu, który już nazywa osobę.
  const decorative = label === '';
  if (imageUrl !== undefined && imageUrl !== null) {
    const pixels = PIXELS[size];
    return (
      // Gotowy wariant WebP z CDN (256 px); optymalizacja Next.js nic by tu nie dała.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={label}
        width={pixels}
        height={pixels}
        className={cn('shrink-0 rounded-full object-cover', dimensions, className)}
      />
    );
  }
  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-bold',
        dimensions,
        TEXT[size],
        avatarColor(userId),
        className,
      )}
    >
      <span aria-hidden>{initialsOf(name)}</span>
    </span>
  );
}
