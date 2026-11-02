'use client';

import * as React from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * Przełącznik włącz/wyłącz (F-63, ustawienia powiadomień): `role="switch"` z `aria-checked`,
 * Spacja i Enter przełączają. Włączony w kolorze marki, wyłączony szary z obramowaniem ≥ 3:1.
 */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-150 ease-out outline-none focus-visible:shadow-focus-ring disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none data-[state=checked]:bg-brand data-[state=unchecked]:border-ink-500 data-[state=unchecked]:bg-ink-200',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-5 rounded-full bg-card shadow-sm ring-0 transition-transform duration-150 ease-out motion-reduce:transition-none data-[state=checked]:translate-x-5.5 data-[state=unchecked]:translate-x-0.5"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
