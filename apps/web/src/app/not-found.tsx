import { SearchX } from 'lucide-react';
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

/** 404: nieznany adres albo notFound() w stronie (np. usunięta aukcja). */
export default function NotFound() {
  const t = useTranslations('notFound');
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-24 text-center">
      <SearchX aria-hidden className="size-12 text-muted-foreground" />
      <h1 className="mt-6 text-3xl font-bold">{t('title')}</h1>
      <p className="mt-4 text-muted-foreground">{t('text')}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href={routes.home}>{t('home')}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={routes.search}>{t('search')}</Link>
        </Button>
      </div>
    </div>
  );
}
