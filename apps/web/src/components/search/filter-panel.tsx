'use client';

import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';

/**
 * Rozwijany panel filtrów (natywne `<details>`, działa bez JavaScriptu). Na telefonie zwinięty
 * pod przyciskiem „Filtry”, żeby wyniki były od razu widoczne; na desktopie (≥ 1024 px) to karta
 * z boku wyników, rozwijana po załadowaniu (F-63).
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
    <details ref={ref} className="group lg:rounded-2xl lg:border lg:border-border lg:bg-card">
      <summary className="inline-flex h-10 cursor-pointer list-none items-center gap-2 rounded-md border border-border-strong bg-card px-4 text-label outline-none hover:bg-muted focus-visible:shadow-focus-ring lg:flex lg:h-auto lg:rounded-2xl lg:border-0 lg:px-5 lg:py-4 lg:text-title lg:font-extrabold lg:hover:bg-card [&::-webkit-details-marker]:hidden">
        <SlidersHorizontal aria-hidden className="size-4.5 text-foreground-secondary" />
        {summary}
        <ChevronDown
          aria-hidden
          className="size-4.5 text-foreground-secondary transition-transform group-open:rotate-180 motion-reduce:transition-none lg:ml-auto"
        />
      </summary>
      <div className="mt-3 rounded-xl border border-border bg-card p-5 lg:mt-0 lg:rounded-none lg:border-0 lg:border-t lg:bg-transparent">
        {children}
      </div>
    </details>
  );
}
