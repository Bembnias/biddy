import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Kwadratowy kafelek z ikoną albo literą w tonie statusu (F-62): tło 50–100 skali, treść 700, bo
 * litera to tekst (≥ 4,5:1). Dekoracyjny: obok zawsze jest tekst, który mówi to samo.
 */
const iconTileVariants = cva(
  'inline-grid shrink-0 place-items-center font-extrabold [&>svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-ink-700',
        brand: 'bg-violet-100 text-violet-700',
        success: 'bg-success-soft text-green-700',
        warning: 'bg-warning-soft text-amber-700',
        danger: 'bg-red-100 text-red-700',
        info: 'bg-info-soft text-sky-700',
        // Pełne tła (F-63) dla zdarzeń, które wymagają uwagi: przebicie i wygrana.
        urgent: 'bg-urgent text-primary-foreground',
        won: 'bg-violet-700 text-primary-foreground',
      },
      size: {
        sm: 'size-8 rounded-md text-label [&>svg]:size-4',
        default: 'size-10 rounded-md text-title [&>svg]:size-5',
        lg: 'size-14 rounded-lg text-h3 [&>svg]:size-7',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'default' },
  },
);

function IconTile({
  className,
  tone,
  size,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof iconTileVariants>) {
  return (
    <span
      aria-hidden
      data-slot="icon-tile"
      className={cn(iconTileVariants({ tone, size }), className)}
      {...props}
    />
  );
}

export { IconTile, iconTileVariants };
