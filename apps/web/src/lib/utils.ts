import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Łączy klasy Tailwinda; przy konflikcie (np. `px-2` i `px-4`) wygrywa późniejsza. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
