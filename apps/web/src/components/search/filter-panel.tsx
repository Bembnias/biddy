'use client';

import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';

/**
 * Rozwijany panel filtrów (natywne `<details>`, działa bez JavaScriptu). Na telefonie zwinięty,
 * żeby wyniki były od razu widoczne; na desktopie (≥ 1024 px) rozwijamy go po załadowaniu.
 */
export function FilterPanel({
  summary,
  children,
}: {
  readonly summary: ReactNode;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current !== null && window.matchMedia('(min-width: 1024px)').matches) {
      ref.current.open = true;
    }
  }, []);
  return (
    <details ref={ref} className="group rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-5 py-4 text-title outline-none focus-visible:shadow-focus-ring [&::-webkit-details-marker]:hidden">
        <SlidersHorizontal aria-hidden className="size-4.5 text-foreground-secondary" />
        {summary}
        <ChevronDown
          aria-hidden
          className="ml-auto size-4.5 text-foreground-secondary transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="border-t border-border p-5">{children}</div>
    </details>
  );
}
