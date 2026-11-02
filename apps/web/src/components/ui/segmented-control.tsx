'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: React.ReactNode;
}

/**
 * Przełącznik 2–5 krótkich, wzajemnie wykluczających się trybów (F-62): granatowy aktywny
 * segment na szarej szynie. Grupa radiowa z klawiaturą: strzałki zmieniają wybór, Tab
 * przechodzi do następnego pola.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onValueChange,
  className,
}: {
  readonly label: string;
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onValueChange: (value: T) => void;
  readonly className?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const select = (index: number) => {
    const option = options[(index + options.length) % options.length];
    if (option === undefined) {
      return;
    }
    onValueChange(option.value);
    refs.current[options.indexOf(option)]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('flex gap-1 rounded-lg bg-muted p-1', className)}
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => {
              onValueChange(option.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                select(index + 1);
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                select(index - 1);
              }
            }}
            className={cn(
              'h-10 flex-1 rounded-md px-3 text-label whitespace-nowrap transition-colors duration-150 ease-out outline-none focus-visible:shadow-focus-ring motion-reduce:transition-none sm:px-4',
              checked
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-foreground hover:bg-ink-200',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
