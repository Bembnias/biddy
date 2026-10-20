import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Komunikat w treści strony (F-62): ikona w kolorze tonu, tytuł i opis na delikatnym tle.
 * `destructive` dla błędów (domyślnie `role="alert"`); pozostałe tony mogą dostać `role="status"`.
 */
const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg px-4 py-3 text-body-sm has-[>svg]:grid-cols-[calc(var(--spacing)*5)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-5',
  {
    variants: {
      variant: {
        default: 'bg-muted text-foreground [&>svg]:text-foreground-secondary',
        info: 'bg-info-soft text-foreground [&>svg]:text-info',
        success: 'bg-success-soft text-foreground [&>svg]:text-success',
        warning: 'bg-warning-soft text-foreground [&>svg]:text-warning',
        destructive: 'bg-destructive-soft text-foreground [&>svg]:text-destructive',
        brand: 'bg-accent text-foreground [&>svg]:text-accent-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('col-start-2 min-h-5 text-label', className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'col-start-2 grid justify-items-start gap-1 text-body-sm text-foreground-secondary [&_p]:leading-relaxed',
        className,
      )}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription };
