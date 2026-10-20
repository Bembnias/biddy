import * as React from 'react';

import { cn } from '@/lib/utils';

const SIZES = {
  xl: 'text-price-xl',
  lg: 'text-price-lg',
  md: 'text-price',
} as const;

/**
 * Kwota z etykietą (F-62) z cyframi tabelarycznymi. Kwotę formatuje wywołujący
 * (`formatMoney` z `@biddy/shared`), żeby zachować jego wybór groszy.
 */
export function Price({
  label,
  children,
  size = 'md',
  align = 'start',
  note,
  className,
}: {
  readonly label?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly size?: keyof typeof SIZES;
  readonly align?: 'start' | 'end';
  readonly note?: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-0.5',
        align === 'end' && 'items-end text-right',
        className,
      )}
    >
      {label === undefined ? null : (
        <span
          className={cn(
            'text-muted-foreground',
            size === 'xl' ? 'text-overline uppercase' : 'text-caption',
          )}
        >
          {label}
        </span>
      )}
      <span className={cn('whitespace-nowrap text-foreground tabular-nums', SIZES[size])}>
        {children}
      </span>
      {note === undefined ? null : (
        <span className="text-caption text-muted-foreground">{note}</span>
      )}
    </div>
  );
}
