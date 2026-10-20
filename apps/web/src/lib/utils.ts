import { shadows, typography } from '@biddy/design-tokens';
import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge musi znać nazwy z tokenów: bez tego `text-label` (rozmiar) wziąłby za kolor
// i przy `text-label text-primary-foreground` zostawił tylko jedną klasę.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [...Object.keys(typography.fontSize), ...Object.keys(typography.textStyles)],
      shadow: Object.keys(shadows),
    },
  },
});

/** Łączy klasy Tailwinda; przy konflikcie (np. `px-2` i `px-4`) wygrywa późniejsza. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
