'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'bidding', href: routes.myBiddy },
  { key: 'wins', href: routes.myWins },
  { key: 'watchlist', href: routes.myWatchlist },
  { key: 'auctions', href: routes.myAuctions },
  { key: 'sales', href: routes.mySales },
] as const;

/** Zakładki Moje Biddy (F-21): zwykłe linki, bieżąca z `aria-current="page"`. */
export function MyBiddyTabs() {
  const t = useTranslations('myBiddy.tabs');
  const pathname = usePathname();
  return (
    <nav aria-label={t('label')} className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {TABS.map((tab) => {
          const current = pathname === tab.href;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-block border-b-2 px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  current
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t(tab.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
