'use client';

import { CircleUser, Gavel, House, type LucideIcon, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

interface Tab {
  readonly key: 'start' | 'search' | 'sell' | 'myBiddy' | 'account';
  readonly href: string;
  readonly Icon: LucideIcon;
  readonly match: (pathname: string) => boolean;
}

const TABS: readonly Tab[] = [
  { key: 'start', href: routes.home, Icon: House, match: (path) => path === routes.home },
  {
    key: 'search',
    href: routes.search,
    Icon: Search,
    match: (path) => path.startsWith(routes.search) || path.startsWith('/kategoria/'),
  },
  { key: 'sell', href: routes.sell, Icon: Plus, match: (path) => path.startsWith(routes.sell) },
  {
    key: 'myBiddy',
    href: routes.myBiddy,
    Icon: Gavel,
    match: (path) => path.startsWith(routes.myBiddy),
  },
  {
    key: 'account',
    href: routes.account,
    Icon: CircleUser,
    match: (path) => path.startsWith(routes.account) || path.startsWith(routes.notifications),
  },
];

/** Strona aukcji ma własny pasek licytacji przyklejony do dołu; oba paski razem się nie mieszczą. */
function hidden(pathname: string): boolean {
  return pathname.startsWith('/a/');
}

/**
 * Dolny pasek nawigacji na telefonie (F-63, decyzja D4): poniżej 768 px zastępuje przyciski
 * „Moje Biddy” i „Wystaw przedmiot” z nagłówka; menu konta i powiadomienia zostają w nagłówku.
 * Strony Moje Biddy i konta same prowadzą gościa do logowania.
 */
export function BottomNav() {
  const t = useTranslations('layout.bottomNav');
  const pathname = usePathname();
  if (hidden(pathname)) {
    return null;
  }
  return (
    <nav
      aria-label={t('label')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <ul className="flex">
        {TABS.map(({ key, href, Icon, match }) => {
          const current = match(pathname);
          return (
            <li key={key} className="flex-1">
              <Link
                href={href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex h-16 flex-col items-center justify-center gap-0.5 text-badge outline-none focus-visible:shadow-focus-ring',
                  current ? 'text-violet-700' : key === 'sell' ? 'text-foreground' : 'text-ink-600',
                )}
              >
                {key === 'sell' ? (
                  <span
                    aria-hidden
                    className="grid h-8 w-10 place-items-center rounded-lg bg-primary text-primary-foreground"
                  >
                    <Icon className="size-5" />
                  </span>
                ) : (
                  <Icon aria-hidden className="size-5.5" />
                )}
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Miejsce pod dolnym paskiem na końcu stopki: pasek nie zasłania ostatnich linków. */
export function BottomNavSpacer() {
  const pathname = usePathname();
  return hidden(pathname) ? null : <div aria-hidden className="h-16 md:hidden" />;
}
