import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Pasek stanu licytującego (F-63): prowadzisz (zieleń), przebito Cię (pełna czerwień), wygrana
 * (pełny fiolet) i stany końcowe (neutralny). Zawsze ikona i tekst, nigdy sam kolor. Nie jest
 * regionem na żywo: zdarzenie ogłasza toast.
 */
const stateBarVariants = cva('flex items-center gap-3 rounded-lg px-4 py-3', {
  variants: {
    tone: {
      success: 'border border-green-200 bg-success-soft text-success',
      urgent: 'bg-urgent text-primary-foreground',
      won: 'bg-violet-700 text-primary-foreground',
      neutral: 'bg-muted text-ink-700',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function BidStateBar({
  tone,
  icon: Icon,
  title,
  description,
  className,
}: VariantProps<typeof stateBarVariants> & {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      data-testid="bidder-status"
      data-tone={tone}
      className={cn(stateBarVariants({ tone }), 'animate-enter', className)}
    >
      <Icon aria-hidden className="size-5.5 shrink-0" />
      <p className="flex min-w-0 flex-col">
        <span className="text-label font-extrabold">{title}</span>
        {description === undefined ? null : <span className="text-body-sm">{description}</span>}
      </p>
    </div>
  );
}
