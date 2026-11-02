import type { Metadata } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { routes } from '@/lib/routes';

// Next.js sam dodaje do strony 404 meta robots noindex.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notFound');
  return { title: t('metaTitle') };
}

/** 404 (układ F-63): nieznany adres albo notFound() w stronie (np. usunięta aukcja). */
export default function NotFound() {
  const t = useTranslations('notFound');
  return (
    <div className="bg-canvas">
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-20 text-center md:py-28">
        <p aria-hidden className="text-display font-extrabold text-violet-500 tabular-nums">
          404
        </p>
        <h1 className="text-h2">{t('title')}</h1>
        <p className="max-w-[46ch] text-body text-foreground-secondary">{t('text')}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2.5">
          <Button asChild variant="outline" size="lg">
            <Link href={routes.home}>{t('home')}</Link>
          </Button>
          <Button asChild size="lg">
            <Link href={routes.search}>{t('search')}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
