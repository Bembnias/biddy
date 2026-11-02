import type { AuctionSearchDto } from '@biddy/api-client';
import {
  ArrowRight,
  BadgePercent,
  BookOpen,
  Dumbbell,
  Footprints,
  Gamepad2,
  Gavel,
  Gem,
  Laptop,
  type LucideIcon,
  ShieldCheck,
  Shirt,
  Sofa,
  Tv,
  WashingMachine,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { LiveDot } from '@/components/auction/live-badge';
import { HomeShowcase } from '@/components/home/home-showcase';
import { AuctionCard, AuctionGrid } from '@/components/search/auction-card';
import { Button } from '@/components/ui/button';
import { categoryUrl, routes, searchUrl } from '@/lib/routes';
import { loadCategories, searchCached } from '@/lib/search/load';
import { cn } from '@/lib/utils';

/** Strona główna z aukcjami (F-19, „Puls licytacji” F-63): ISR, odświeżana co minutę. */
export const revalidate = 60;

const HOME_LISTING = 8;
/** Karty w ciemnym pasie „Kończą się wkrótce” (D3). */
const ENDING_BAND = 4;

const TRUST = [
  { key: 'protection', Icon: ShieldCheck },
  { key: 'autoBid', Icon: Zap },
  { key: 'zeroFee', Icon: BadgePercent },
] as const;

const NICHES = [
  { key: 'collectibles', Icon: Gem, tile: 'bg-violet-700', text: 'text-violet-100' },
  { key: 'sneakers', Icon: Footprints, tile: 'bg-pink-700', text: 'text-pink-100' },
  { key: 'retro', Icon: Gamepad2, tile: 'bg-ink-800', text: 'text-ink-200' },
] as const;

const STEPS = ['max', 'proxy', 'pay'] as const;

const VALUES = [
  { key: 'fairPrice', Icon: Gavel, tile: 'bg-violet-50 text-violet-700' },
  { key: 'protection', Icon: ShieldCheck, tile: 'bg-success-soft text-green-700' },
  { key: 'zeroFee', Icon: BadgePercent, tile: 'bg-pink-100 text-pink-700' },
] as const;

/** Ikony kategorii głównych (slug z drzewa kategorii, F-11); nowa kategoria może jej nie mieć. */
const CATEGORY_ICONS: Readonly<Record<string, LucideIcon>> = {
  kolekcjonerstwo: Gem,
  moda: Shirt,
  elektronika: Laptop,
  rtv: Tv,
  agd: WashingMachine,
  'dom-i-ogrod': Sofa,
  'ksiazki-muzyka-filmy': BookOpen,
  'sport-i-hobby': Dumbbell,
};

const MORE_LINK =
  'inline-flex shrink-0 items-center gap-1.5 rounded-xs text-label-lg underline-offset-3 outline-none hover:underline focus-visible:shadow-focus-ring';

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
  const endingSoon = ending?.items.slice(0, ENDING_BAND) ?? [];
  return (
    <>
      <section aria-labelledby="hero-title" className="bg-background">
        <div className="mx-auto grid max-w-page items-center gap-14 px-4 pt-10 pb-12 md:px-10 md:pt-14 md:pb-18 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
          <div className="flex flex-col items-start gap-6">
            <p className="inline-flex h-8 items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3.5 text-body-sm font-bold text-violet-700">
              <ShieldCheck aria-hidden className="size-4" />
              {t('hero.eyebrow')}
            </p>
            <h1
              id="hero-title"
              className="max-w-3xl text-h1 text-balance text-foreground md:text-display"
            >
              {t.rich('hero.title', {
                accent: (chunks) => <span className="text-brand-strong">{chunks}</span>,
              })}
            </h1>
            <p className="max-w-xl text-body-lg text-pretty text-foreground-secondary">
              {t('hero.lead')}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="cta" size="lg">
                <Link href={routes.search}>
                  {t('hero.browse')}
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href={routes.sell}>{t('hero.sell')}</Link>
              </Button>
            </div>
            <ul className="flex flex-wrap gap-x-6 gap-y-3 pt-2">
              {TRUST.map(({ key, Icon }) => (
                <li key={key} className="flex items-center gap-2 text-label text-ink-700">
                  <Icon aria-hidden className="size-4.5 text-violet-700" />
                  {t(`hero.trust.${key}`)}
                </li>
              ))}
            </ul>
          </div>
          {showcase === undefined ? null : (
            <div className="hidden lg:block">
              <HomeShowcase initial={showcase} />
            </div>
          )}
        </div>
      </section>

      {endingSoon.length === 0 ? null : (
        <section aria-labelledby="ending-title" className="bg-primary text-primary-foreground">
          <div className="mx-auto max-w-page space-y-6 px-4 py-10 md:space-y-8 md:px-10 md:py-16">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="space-y-2">
                <p className="flex items-center gap-2.5 text-overline text-red-300 uppercase">
                  <LiveDot className="text-live-dot" />
                  {t('endingLive')}
                </p>
                <h2 id="ending-title" className="text-h2 md:text-h1">
                  {t('ending')}
                </h2>
                <p className="max-w-2xl text-body text-ink-300">{t('endingLead')}</p>
              </div>
              <Link
                href={`${routes.search}?sort=koniec`}
                className={cn(MORE_LINK, 'text-violet-300 hover:text-primary-foreground')}
              >
                {t('seeAll')}
                <span className="sr-only">: {t('ending')}</span>
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            </div>
            {/* Na telefonie przewijany w poziomie rząd kart, od 768 px siatka. */}
            <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-2 md:gap-6 md:overflow-visible md:px-0 md:pb-0 lg:grid-cols-4">
              {endingSoon.map((auction, index) => (
                <li key={auction.id} className="w-44 shrink-0 snap-start md:w-auto">
                  <AuctionCard auction={auction} variant="dark" priority={index < 2} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section
        aria-labelledby="niches-title"
        className="mx-auto max-w-page px-4 pt-12 md:px-10 md:pt-18"
      >
        <h2 id="niches-title" className="text-h2">
          {t('niches.title')}
        </h2>
        <ul className="mt-6 grid gap-4 md:grid-cols-3 md:gap-6">
          {NICHES.map(({ key, Icon, tile, text }) => (
            <li key={key}>
              <Link
                href={searchUrl(t(`niches.${key}.query`))}
                className={cn(
                  'group relative flex min-h-48 flex-col justify-end gap-1.5 overflow-hidden rounded-2xl p-6 text-primary-foreground outline-none transition-[box-shadow,translate] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lg focus-visible:shadow-focus-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0 md:min-h-56 md:p-7',
                  tile,
                )}
              >
                <span
                  aria-hidden
                  className="absolute top-6 right-6 grid size-16 place-items-center rounded-2xl bg-white/15"
                >
                  <Icon className="size-8" />
                </span>
                <span className="text-h3 font-extrabold">{t(`niches.${key}.title`)}</span>
                <span className={cn('max-w-xs text-body', text)}>{t(`niches.${key}.text`)}</span>
                <span className="mt-2 inline-flex items-center gap-1.5 text-label group-hover:underline group-hover:underline-offset-3">
                  {t('niches.cta')}
                  <ArrowRight aria-hidden className="size-4" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <Listing
        id="newest-title"
        title={t('newest')}
        result={newest}
        href={`${routes.search}?sort=nowe`}
        more={t('seeAll')}
      />

      {/* Tło jak `canvas`, ale tokenem palety: bg-canvas w dziecku <main> barwi całą stronę. */}
      <section aria-labelledby="how-title" className="border-y border-border bg-ink-50">
        <div className="mx-auto max-w-page px-4 py-12 md:px-10 md:py-18">
          <div className="max-w-2xl space-y-2">
            <p className="text-overline text-violet-700 uppercase">{t('how.overline')}</p>
            <h2 id="how-title" className="text-h2">
              {t('how.title')}
            </h2>
          </div>
          <ol className="mt-8 grid gap-4 md:grid-cols-3 md:gap-6">
            {STEPS.map((step, index) => (
              <li
                key={step}
                className="flex flex-col gap-3.5 rounded-xl border border-border bg-card p-6 md:p-7"
              >
                <span
                  aria-hidden
                  className="grid size-11 place-items-center rounded-lg bg-violet-50 text-h3 font-extrabold text-violet-700 tabular-nums"
                >
                  {index + 1}
                </span>
                <h3 className="text-title">{t(`how.${step}.title`)}</h3>
                <p className="text-body text-foreground-secondary">{t(`how.${step}.text`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {roots.length === 0 ? null : (
        <section
          aria-labelledby="categories-title"
          className="mx-auto max-w-page px-4 pt-12 md:px-10 md:pt-18"
        >
          <h2 id="categories-title" className="text-h2">
            {t('categories')}
          </h2>
          <ul className="mt-6 flex flex-wrap gap-3">
            {roots.map((category) => {
              const Icon = CATEGORY_ICONS[category.slug];
              return (
                <li key={category.id}>
                  <Link
                    href={categoryUrl(category.path)}
                    className="inline-flex h-10 items-center gap-2 rounded-full border border-border-strong bg-card px-4 text-label text-foreground outline-none transition-colors duration-150 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 focus-visible:shadow-focus-ring motion-reduce:transition-none"
                  >
                    {Icon === undefined ? null : <Icon aria-hidden className="size-4.5" />}
                    {category.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section
        aria-labelledby="values-title"
        className="mx-auto max-w-page px-4 pt-12 pb-16 md:px-10 md:pt-14 md:pb-22"
      >
        <h2 id="values-title" className="text-h2">
          {t('values.title')}
        </h2>
        <ul className="mt-6 grid gap-6 md:grid-cols-3">
          {VALUES.map(({ key, Icon, tile }) => (
            <li key={key} className="flex items-start gap-4">
              <span
                aria-hidden
                className={cn('grid size-12 shrink-0 place-items-center rounded-lg', tile)}
              >
                <Icon className="size-6" />
              </span>
              <div className="space-y-1.5">
                <h3 className="text-title">{t(`values.${key}.title`)}</h3>
                <p className="text-body text-foreground-secondary">{t(`values.${key}.text`)}</p>
              </div>
            </li>
          ))}
        </ul>
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
}: {
  readonly id: string;
  readonly title: string;
  readonly result: AuctionSearchDto | null;
  readonly href: string;
  readonly more: string;
}) {
  if (result === null || result.items.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby={id} className="mx-auto max-w-page px-4 py-12 md:px-10 md:py-18">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={id} className="text-h2">
          {title}
        </h2>
        <Link href={href} className={cn(MORE_LINK, 'text-link hover:text-link-hover')}>
          {more}
          <span className="sr-only">: {title}</span>
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
      <div className="mt-6">
        <AuctionGrid auctions={result.items} />
      </div>
    </section>
  );
}
