import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Slot } from 'radix-ui';

/**
 * Przycisk według design systemu Biddy (F-62):
 * - `cta` (gradient fiolet → róż): jedna najważniejsza akcja widoku, nigdy w nagłówku;
 * - `default` (granat): główna akcja w karcie, wierszu albo formularzu;
 * - `outline` / `soft` / `ghost`: akcje drugorzędne; `accent`: dodawanie w obrębie sekcji;
 * - `destructive` (potwierdzenie usunięcia) i `destructive-outline` (rozpoczęcie usuwania).
 * Rozmiary: `sm` 32 px (wiersze list), domyślny 40 px, `lg` 48 px (formularze, telefon).
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-transparent text-label whitespace-nowrap transition-[color,background-color,border-color,box-shadow,translate] duration-150 ease-out outline-none select-none focus-visible:shadow-focus-ring active:translate-y-px disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none aria-disabled:pointer-events-none aria-disabled:opacity-45 aria-disabled:shadow-none motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4.5",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        cta: 'bg-linear-to-r from-cta-from to-cta-to text-cta-foreground shadow-cta hover:from-cta-hover-from hover:to-cta-hover-to focus-visible:shadow-focus-ring',
        outline:
          'border-border-strong bg-card text-foreground shadow-xs hover:border-input hover:bg-canvas',
        soft: 'bg-secondary text-secondary-foreground hover:bg-ink-200',
        accent: 'border-brand-border bg-accent text-accent-foreground hover:bg-violet-100',
        ghost: 'text-foreground hover:bg-muted',
        link: 'border-0 text-link underline underline-offset-3 hover:text-link-hover',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-red-700',
        'destructive-outline':
          'border-red-300 bg-card text-destructive hover:border-destructive hover:bg-destructive-soft',
      },
      size: {
        default: 'h-10 px-4 has-[>svg]:px-3.5',
        xs: "h-7 gap-1 px-2 text-caption has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5 [&_svg:not([class*='size-'])]:size-4",
        lg: "h-12 px-6 text-label-lg has-[>svg]:px-5 [&_svg:not([class*='size-'])]:size-5",
        icon: 'size-10 rounded-full',
        'icon-xs': "size-7 rounded-full [&_svg:not([class*='size-'])]:size-3.5",
        'icon-sm': "size-8 rounded-full [&_svg:not([class*='size-'])]:size-4",
        'icon-lg': "size-12 rounded-full [&_svg:not([class*='size-'])]:size-5.5",
      },
    },
    compoundVariants: [
      // Link w tekście: bez wysokości i paddingu przycisku.
      {
        variant: 'link',
        size: ['default', 'xs', 'sm', 'lg'],
        className: 'h-auto px-0 has-[>svg]:px-0',
      },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
