import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Podstrona konta (profil, adresy, wystawianie; wygląd F-62): tło `canvas`, powrót, nagłówek h1
 * i opis. Treść to zwykle białe karty.
 */
export function AccountPage({
  title,
  text,
  back,
  children,
}: {
  readonly title: string;
  readonly text?: string;
  readonly back: { readonly href: string; readonly label: string };
  readonly children: ReactNode;
}) {
  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 md:px-6 md:py-12">
        <Link
          href={back.href}
          className="inline-flex items-center gap-1.5 rounded-xs text-label text-link underline-offset-3 outline-none hover:text-link-hover hover:underline focus-visible:shadow-focus-ring"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {back.label}
        </Link>
        <h1 className="mt-4 text-h2 md:text-h1">{title}</h1>
        {text === undefined ? null : (
          <p className="mt-2 text-body text-foreground-secondary">{text}</p>
        )}
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}
