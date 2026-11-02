'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { PillTabs } from '@/components/ui/pill-tabs';
import { routes } from '@/lib/routes';

const TABS = [
  { key: 'bidding', href: routes.myBiddy },
  { key: 'wins', href: routes.myWins },
  { key: 'watchlist', href: routes.myWatchlist },
  { key: 'auctions', href: routes.myAuctions },
  { key: 'sales', href: routes.mySales },
] as const;

/** Zakładki Moje Biddy (F-21, wygląd F-62): pigułki z linkami, bieżąca z `aria-current="page"`. */
export function MyBiddyTabs() {
  const t = useTranslations('myBiddy.tabs');
  const pathname = usePathname();
  return (
    <PillTabs
      label={t('label')}
      className="-mx-4 px-4 md:mx-0 md:px-0"
      tabs={TABS.map((tab) => ({
        href: tab.href,
        label: t(tab.key),
        active: pathname === tab.href,
      }))}
    />
  );
}
