import type { AuctionSearchDto } from '@biddy/api-client';
import { BadgePercent, Gavel, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AuctionGrid } from '@/components/search/auction-card';
import { Button } from '@/components/ui/button';
import { categoryUrl, routes, searchUrl } from '@/lib/routes';
import { loadCategories, searchCached } from '@/lib/search/load';

/** Strona główna z aukcjami (F-19): ISR, odświeżana co minutę. */
export const revalidate = 60;

const HOME_LISTING = 8;

const VALUES = [
  { key: 'fairPrice', Icon: Gavel },
  { key: 'protection', Icon: ShieldCheck },
  { key: 'zeroFee', Icon: BadgePercent },
] as const;

const NICHES = ['collectibles', 'sneakers', 'retro'] as const;

export default async function HomePage() {
  const t = await getTranslations('home');
  // Bez wyszukiwarki (błąd API) strona działa, tylko bez sekcji z aukcjami.
  const [ending, newest, categories] = await Promise.all([
    searchCached({ sort: 'ending', pageSize: HOME_LISTING }, 60),
    searchCached({ sort: 'newest', pageSize: HOME_LISTING }, 60),
    loadCategories(),
  ]);
  const roots = categories.filter((category) => category.parentId === null);
  return (
    <>
      <section aria-labelledby="hero-title" className="bg-accent">
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
          <p className="text-sm font-semibold text-primary">{t('hero.eyebrow')}</p>
          <h1
            id="hero-title"
            className="mt-3 max-w-3xl text-4xl font-bold text-balance text-accent-foreground md:text-5xl"
          >
            {t('hero.title')}
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-pretty text-foreground">{t('hero.lead')}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href={routes.search}>{t('hero.browse')}</Link>
            </Button>
            <Button
              asChild
              size="lg"
              className="bg-highlight text-highlight-foreground hover:bg-highlight/90"
            >
              <Link href={routes.sell}>{t('hero.sell')}</Link>
            </Button>
          </div>
        </div>
      </section>

      <Listing
        id="ending-title"
        title={t('ending')}
        result={ending}
        href={`${routes.search}?sort=koniec`}
        more={t('seeAll')}
        priority
      />
      <Listing
        id="newest-title"
        title={t('newest')}
        result={newest}
        href={`${routes.search}?sort=nowe`}
        more={t('seeAll')}
      />

      {roots.length === 0 ? null : (
        <section
          aria-labelledby="categories-title"
          className="mx-auto max-w-6xl px-4 py-10 md:px-6"
        >
          <h2 id="categories-title" className="text-2xl font-bold">
            {t('categories')}
          </h2>
          <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {roots.map((category) => (
              <li key={category.id}>
                <Link
                  href={categoryUrl(category.path)}
                  className="block rounded-lg border border-border bg-card p-4 font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="values-title" className="mx-auto max-w-6xl px-4 py-16 md:px-6">
        <h2 id="values-title" className="text-2xl font-bold">
          {t('values.title')}
        </h2>
        <ul className="mt-8 grid gap-6 md:grid-cols-3">
          {VALUES.map(({ key, Icon }) => (
            <li key={key} className="rounded-lg border border-border bg-card p-6">
              <Icon aria-hidden className="size-8 text-primary" />
              <h3 className="mt-4 text-lg font-semibold">{t(`values.${key}.title`)}</h3>
              <p className="mt-2 text-muted-foreground">{t(`values.${key}.text`)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="niches-title" className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-6">
          <h2 id="niches-title" className="text-2xl font-bold">
            {t('niches.title')}
          </h2>
          <ul className="mt-8 grid gap-6 md:grid-cols-3">
            {NICHES.map((niche) => (
              <li key={niche} className="flex flex-col rounded-lg bg-muted p-6">
                <h3 className="text-lg font-semibold">{t(`niches.${niche}.title`)}</h3>
                <p className="mt-2 flex-1 text-muted-foreground">{t(`niches.${niche}.text`)}</p>
                <Link
                  href={searchUrl(t(`niches.${niche}.query`))}
                  className="mt-4 font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t('niches.cta')}
                  <span className="sr-only">: {t(`niches.${niche}.title`)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}

function Listing({
  id,
  title,
  result,
  href,
  more,
  priority = false,
}: {
  readonly id: string;
  readonly title: string;
  readonly result: AuctionSearchDto | null;
  readonly href: string;
  readonly more: string;
  readonly priority?: boolean;
}) {
  if (result === null || result.items.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby={id} className="mx-auto max-w-6xl px-4 py-10 md:px-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={id} className="text-2xl font-bold">
          {title}
        </h2>
        <Link href={href} className="font-medium text-primary underline-offset-4 hover:underline">
          {more}
          <span className="sr-only">: {title}</span>
        </Link>
      </div>
      <div className="mt-6">
        <AuctionGrid auctions={result.items} priorityCount={priority ? 4 : 0} />
      </div>
    </section>
  );
}
