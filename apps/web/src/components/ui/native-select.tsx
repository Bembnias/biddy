import { ChevronDown } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { fieldClasses } from './input';

/**
 * Natywna lista wyboru w stylu pól (F-62): pełna obsługa klawiatury i czytników ekranu oraz
 * systemowy wybór na telefonach (formularze kreatora i atrybutów). Strzałka jest dekoracją, więc
 * nie przechwytuje kliknięć.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <div data-slot="native-select-wrapper" className="relative w-full">
      <select
        data-slot="native-select"
        className={cn(fieldClasses, 'h-12 cursor-pointer appearance-none pr-10 pl-3.5', className)}
        {...props}
      />
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3.5 size-4.5 -translate-y-1/2 text-foreground-secondary"
      />
    </div>
  );
}

export { NativeSelect };
