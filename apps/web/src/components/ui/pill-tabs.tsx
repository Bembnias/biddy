import Link from 'next/link';
import * as React from 'react';

import { cn } from '@/lib/utils';

export interface PillTab {
  readonly href: string;
  readonly label: React.ReactNode;
  /** Liczba elementów wymagających uwagi, pokazywana w nawiasie. */
  readonly count?: number;
  readonly active: boolean;
}

/**
 * Nawigacja między sekcjami jednej strony w formie pigułek (F-62); aktywna ma wypełnienie
 * `brand-strong` i `aria-current="page"`. Na telefonie przewija się w poziomie.
 */
export function PillTabs({
  label,
  tabs,
  className,
}: {
  readonly label: string;
  readonly tabs: readonly PillTab[];
  readonly className?: string;
}) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="-m-0.5 flex gap-2 overflow-x-auto p-0.5 [scrollbar-width:none]">
        {tabs.map((tab) => (
          <li key={tab.href} className="shrink-0">
            <Link
              href={tab.href}
              aria-current={tab.active ? 'page' : undefined}
              className={cn(
                'inline-flex h-10 items-center gap-1.5 rounded-full border px-4.5 text-label whitespace-nowrap transition-colors duration-150 ease-out outline-none focus-visible:shadow-focus-ring motion-reduce:transition-none',
                tab.active
                  ? 'border-brand-strong bg-brand-strong text-primary-foreground shadow-sm'
                  : 'border-border-strong bg-card text-foreground hover:border-input hover:bg-canvas',
              )}
            >
              {tab.label}
              {tab.count === undefined ? null : (
                <span className="tabular-nums opacity-85">({tab.count})</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
