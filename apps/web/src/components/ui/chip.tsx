import { X } from 'lucide-react';
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Etykieta atrybutu albo filtra pisana normalnie (F-62): „Stan: Jak nowy”, „Męskie”,
 * „Kupujący: Janusz K.”. `onRemove` dodaje przycisk usunięcia z opisem dla czytników.
 */
const chipVariants = cva(
  'inline-flex shrink-0 items-center gap-1 border border-transparent text-caption font-semibold whitespace-nowrap [&>svg]:size-3.5 [&>svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-foreground',
        brand: 'bg-accent text-accent-foreground',
        'brand-outline': 'border-brand-border bg-accent text-accent-foreground',
        outline: 'border-border-strong bg-card text-foreground',
      },
      shape: {
        default: 'rounded-sm',
        pill: 'rounded-full',
      },
      size: {
        default: 'h-6.5 px-2.5',
        sm: 'h-5.5 px-2',
      },
    },
    defaultVariants: { tone: 'neutral', shape: 'default', size: 'default' },
  },
);

function Chip({
  className,
  tone,
  shape,
  size,
  children,
  onRemove,
  removeLabel,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof chipVariants> & {
    readonly onRemove?: () => void;
    /** Opis przycisku usunięcia, np. „Usuń filtr: Rozmiar 42”. */
    readonly removeLabel?: string;
  }) {
  return (
    <span
      data-slot="chip"
      className={cn(chipVariants({ tone, shape, size }), className)}
      {...props}
    >
      {children}
      {onRemove === undefined ? null : (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="-mr-1 grid size-4.5 place-items-center rounded-full outline-none hover:bg-ink-200 focus-visible:shadow-focus-ring"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      )}
    </span>
  );
}

export { Chip, chipVariants };
