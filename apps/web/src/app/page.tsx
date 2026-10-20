import type { AuctionSearchDto } from '@biddy/api-client';
import { ArrowRight, BadgePercent, ChevronRight, Gavel, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AuctionCard, AuctionGrid } from '@/components/search/auction-card';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/icon-tile';
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
  const showcase = ending?.items[0];
  return (
    <>
      <section
        aria-labelledby="hero-title"
        className="bg-linear-to-br from-violet-50 via-background to-pink-50"
      >
        <div className="mx-auto grid max-w-page items-center gap-10 px-4 py-14 md:px-10 md:py-20 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div>
            <p className="text-overline text-accent-foreground uppercase">{t('hero.eyebrow')}</p>
            <h1
              id="hero-title"
              className="mt-4 max-w-3xl text-h1 text-balance text-foreground md:text-display"
            >
              {t('hero.title')}
            </h1>
            <p className="mt-5 max-w-2xl text-body-lg text-pretty text-foreground-secondary">
              {t('hero.lead')}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild variant="cta" size="lg">
                <Link href={routes.search}>{t('hero.browse')}</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href={routes.sell}>{t('hero.sell')}</Link>
              </Button>
            </div>
          </div>
          {showcase === undefined ? null : (
            <div className="hidden lg:block">
              <div className="rotate-2 rounded-2xl bg-card p-3 shadow-lg">
                <AuctionCard auction={showcase} priority />
              </div>
            </div>
          )}
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
          className="mx-auto max-w-page px-4 py-10 md:px-10"
        >
          <h2 id="categories-title" className="text-h2">
            {t('categories')}
          </h2>
          <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {roots.map((category) => (
              <li key={category.id}>
                <Link
                  href={categoryUrl(category.path)}
                  className="group flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3.5 text-title outline-none transition-colors duration-150 hover:border-brand-border hover:bg-accent focus-visible:shadow-focus-ring motion-reduce:transition-none"
                >
                  {category.name}
                  <ChevronRight
                    aria-hidden
                    className="size-4.5 shrink-0 text-muted-foreground group-hover:text-accent-foreground"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="values-title" className="mx-auto max-w-page px-4 py-12 md:px-10">
        <h2 id="values-title" className="text-h2">
          {t('values.title')}
        </h2>
        <ul className="mt-6 grid gap-4 md:grid-cols-3">
          {VALUES.map(({ key, Icon }) => (
            <li key={key} className="rounded-xl border border-border bg-card p-6">
              <IconTile tone="brand" size="lg">
                <Icon />
              </IconTile>
              <h3 className="mt-5 text-title">{t(`values.${key}.title`)}</h3>
              <p className="mt-2 text-body text-foreground-secondary">{t(`values.${key}.text`)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="niches-title" className="bg-canvas">
        <div className="mx-auto max-w-page px-4 py-12 md:px-10">
          <h2 id="niches-title" className="text-h2">
            {t('niches.title')}
          </h2>
          <ul className="mt-6 grid gap-4 md:grid-cols-3">
            {NICHES.map((niche) => (
              <li key={niche} className="flex flex-col rounded-xl border border-border bg-card p-6">
                <h3 className="text-title">{t(`niches.${niche}.title`)}</h3>
                <p className="mt-2 flex-1 text-body text-foreground-secondary">
                  {t(`niches.${niche}.text`)}
                </p>
                <Link
                  href={searchUrl(t(`niches.${niche}.query`))}
                  className="mt-4 inline-flex items-center gap-1.5 self-start rounded-xs text-label text-link underline-offset-3 outline-none hover:text-link-hover hover:underline focus-visible:shadow-focus-ring"
                >
                  {t('niches.cta')}
                  <span className="sr-only">: {t(`niches.${niche}.title`)}</span>
                  <ArrowRight aria-hidden className="size-4" />
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
    <section aria-labelledby={id} className="mx-auto max-w-page px-4 py-10 md:px-10">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={id} className="text-h2">
          {title}
        </h2>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xs text-label text-link underline-offset-3 outline-none hover:text-link-hover hover:underline focus-visible:shadow-focus-ring"
        >
          {more}
          <span className="sr-only">: {title}</span>
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
      <div className="mt-6">
        <AuctionGrid auctions={result.items} priorityCount={priority ? 4 : 0} />
      </div>
    </section>
  );
}
