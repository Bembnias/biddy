import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Slot } from 'radix-ui';

/**
 * Plakietka statusu (F-62): jedno–dwa słowa wielkimi literami w tonie, który coś znaczy
 * (`live` zawsze pełna czerwień z pulsującą kropką). Do atrybutów i filtrów służy `Chip`.
 */
const badgeVariants = cva(
  'inline-flex h-5.5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 text-badge whitespace-nowrap uppercase [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      tone: {
        neutral: '',
        brand: '',
        success: '',
        warning: '',
        danger: '',
        info: '',
        live: 'bg-live text-primary-foreground',
      },
      variant: {
        soft: '',
        solid: '',
        outline: 'bg-card',
      },
    },
    compoundVariants: [
      { tone: 'neutral', variant: 'soft', className: 'bg-muted text-foreground' },
      { tone: 'neutral', variant: 'solid', className: 'bg-primary text-primary-foreground' },
      { tone: 'neutral', variant: 'outline', className: 'border-border-strong text-foreground' },
      { tone: 'brand', variant: 'soft', className: 'bg-accent text-accent-foreground' },
      { tone: 'brand', variant: 'solid', className: 'bg-brand-strong text-primary-foreground' },
      {
        tone: 'brand',
        variant: 'outline',
        className: 'border-brand bg-accent text-accent-foreground',
      },
      { tone: 'success', variant: 'soft', className: 'bg-success-soft text-success' },
      { tone: 'success', variant: 'solid', className: 'bg-success text-success-foreground' },
      { tone: 'success', variant: 'outline', className: 'border-green-600 text-success' },
      { tone: 'warning', variant: 'soft', className: 'bg-warning-soft text-warning' },
      { tone: 'warning', variant: 'solid', className: 'bg-warning text-primary-foreground' },
      { tone: 'warning', variant: 'outline', className: 'border-amber-600 text-warning' },
      { tone: 'danger', variant: 'soft', className: 'bg-destructive-soft text-destructive' },
      { tone: 'danger', variant: 'solid', className: 'bg-destructive text-destructive-foreground' },
      { tone: 'danger', variant: 'outline', className: 'border-red-500 text-destructive' },
      { tone: 'info', variant: 'soft', className: 'bg-info-soft text-info' },
      { tone: 'info', variant: 'solid', className: 'bg-info text-primary-foreground' },
      { tone: 'info', variant: 'outline', className: 'border-sky-600 text-info' },
      { tone: 'live', className: 'border-transparent bg-live text-primary-foreground' },
    ],
    defaultVariants: {
      tone: 'neutral',
      variant: 'soft',
    },
  },
);

function Badge({
  className,
  tone = 'neutral',
  variant = 'soft',
  asChild = false,
  children,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp
      data-slot="badge"
      data-tone={tone}
      className={cn(badgeVariants({ tone, variant }), className)}
      {...props}
    >
      {tone === 'live' && !asChild ? (
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-primary-foreground motion-safe:animate-pulse"
        />
      ) : null}
      {children}
    </Comp>
  );
}

export { Badge, badgeVariants };
