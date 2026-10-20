'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { CheckIcon } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';

/** Pole wyboru (F-62): zaznaczone w kolorze marki (`brand-strong`), obramowanie `input` ≥ 3:1. */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-5 shrink-0 rounded-xs border-[1.5px] border-input bg-card transition-[background-color,border-color,box-shadow] duration-150 ease-out outline-none hover:border-brand focus-visible:shadow-focus-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-[state=checked]:border-brand-strong data-[state=checked]:bg-brand-strong data-[state=checked]:text-primary-foreground motion-reduce:transition-none',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <CheckIcon className="size-4" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
