import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** Podstrona konta: nagłówek h1, opis i powrót (profil, adresy). */
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
    <div className="mx-auto w-full max-w-2xl px-4 py-12 md:px-6">
      <Link
        href={back.href}
        className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {back.label}
      </Link>
      <h1 className="mt-4 text-3xl font-bold">{title}</h1>
      {text === undefined ? null : <p className="mt-2 text-muted-foreground">{text}</p>}
      <div className="mt-8">{children}</div>
    </div>
  );
}
