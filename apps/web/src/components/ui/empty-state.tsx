import type { LucideIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { IconTile } from './icon-tile';

/**
 * Pusty stan listy (F-62): kafelek z ikoną, tytuł (co tu będzie), jedno zdanie (jak to zapełnić)
 * i najwyżej jedna akcja.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  headingLevel = 'h2',
  className,
}: {
  readonly icon: LucideIcon;
  readonly title: React.ReactNode;
  readonly children?: React.ReactNode;
  readonly action?: React.ReactNode;
  readonly headingLevel?: 'h1' | 'h2' | 'h3';
  readonly className?: string;
}) {
  const Heading = headingLevel;
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong bg-card px-6 py-12 text-center',
        className,
      )}
    >
      <IconTile tone="brand" size="lg">
        <Icon />
      </IconTile>
      <Heading className="mt-1 text-h3 text-foreground">{title}</Heading>
      {children === undefined ? null : (
        <p className="max-w-[46ch] text-body text-foreground-secondary">{children}</p>
      )}
      {action === undefined ? null : <div className="mt-2">{action}</div>}
    </div>
  );
}
