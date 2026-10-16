'use client';

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
    <details ref={ref} className="group rounded-lg border border-border">
      <summary className="cursor-pointer px-4 py-3 font-semibold">{summary}</summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}
