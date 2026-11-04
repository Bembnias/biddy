import { Star } from 'lucide-react';

import { filledStars } from '@/lib/reviews/reviews';
import { cn } from '@/lib/utils';

/**
 * Gwiazdki oceny (F-30): pięć ikon, pełne do zaokrąglonej wartości. Dla czytników jeden opis
 * (`label`, np. „4 z 5”), ikony są ozdobne.
 */
export function RatingStars({
  value,
  label,
  className,
  size = 'sm',
}: {
  readonly value: number;
  readonly label: string;
  readonly className?: string;
  readonly size?: 'sm' | 'lg';
}) {
  const filled = filledStars(value);
  return (
    <span role="img" aria-label={label} className={cn('inline-flex shrink-0 gap-0.5', className)}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          aria-hidden
          className={cn(
            size === 'lg' ? 'size-5' : 'size-4',
            star <= filled ? 'fill-current text-rating' : 'text-ink-200',
          )}
        />
      ))}
    </span>
  );
}
