'use client';

// Błąd w layoucie głównym: zastępuje cały dokument, więc nie ma dostawców (next-intl, fonty).
// Teksty bierzemy wprost z pliku komunikatów, style z tokenów (globals.css).
import { reportError } from '@/lib/report-error';
import { useEffect } from 'react';

import messages from '../../messages/pl.json';

import './globals.css';

export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    reportError(error);
  }, [error]);
  const t = messages.error;
  return (
    <html lang="pl">
      <body>
        <main className="mx-auto flex max-w-2xl flex-col items-center px-4 py-24 text-center">
          <h1 className="text-3xl font-bold">{t.title}</h1>
          <p className="mt-4 text-muted-foreground">{t.text}</p>
          <button
            type="button"
            onClick={reset}
            className="mt-8 h-10 rounded-md bg-primary px-6 font-medium text-primary-foreground"
          >
            {t.retry}
          </button>
          {error.digest === undefined ? null : (
            <p className="mt-6 text-xs text-muted-foreground">
              {t.reference.replace('{digest}', error.digest)}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
