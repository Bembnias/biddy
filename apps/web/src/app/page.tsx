import { BadgePercent, Gavel, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { routes, searchUrl } from '@/lib/routes';

const VALUES = [
  { key: 'fairPrice', Icon: Gavel },
  { key: 'protection', Icon: ShieldCheck },
  { key: 'zeroFee', Icon: BadgePercent },
] as const;

const NICHES = ['collectibles', 'sneakers', 'retro'] as const;

export default function HomePage() {
  const t = useTranslations('home');
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
