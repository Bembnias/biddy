import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Klasy wspólne dla pól formularza (F-62): 48 px, tekst 16 px (iOS nie powiększa strony),
 * obramowanie `input` (≥ 3:1), fokus obramowaniem `ring` z poświatą, błąd przez `aria-invalid`.
 */
const fieldClasses = cn(
  'w-full min-w-0 rounded-md border border-input bg-card text-base text-foreground transition-[border-color,box-shadow] duration-150 ease-out outline-none placeholder:text-muted-foreground hover:border-ink-500 motion-reduce:transition-none',
  'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-violet-100',
  'aria-invalid:border-destructive aria-invalid:focus-visible:ring-red-100',
  'disabled:cursor-not-allowed disabled:border-border-strong disabled:bg-muted disabled:text-muted-foreground',
);

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldClasses,
        'h-12 px-3.5 selection:bg-violet-200 file:inline-flex file:h-8 file:border-0 file:bg-transparent file:text-label file:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export { Input, fieldClasses };
