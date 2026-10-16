import { CirclePlus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { NotificationBell } from '@/components/notifications/notification-bell';
import { Button } from '@/components/ui/button';
import { routes } from '@/lib/routes';

import { Logo } from './logo';
import { SearchForm } from './search-form';
import { UserMenu } from './user-menu';

/**
 * Nagłówek: logo, wyszukiwarka, „Wystaw przedmiot” i „Zaloguj się”. Na wąskich ekranach
 * (< 768 px) wyszukiwarka przechodzi do drugiego wiersza, a akcje są ikonami z etykietami.
 */
export function SiteHeader() {
  const t = useTranslations('layout');
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 md:flex-nowrap md:px-6">
        <Logo />
        <SearchForm className="order-last w-full md:order-none md:flex-1" />
        <nav aria-label={t('mainNavigation')} className="ml-auto md:ml-0">
          <ul className="flex items-center gap-2">
            <li>
              <Button asChild variant="ghost" className="max-sm:size-10 max-sm:px-0">
                <Link href={routes.sell}>
                  <CirclePlus aria-hidden className="sm:hidden" />
                  <span className="max-sm:sr-only">{t('sell')}</span>
                </Link>
              </Button>
            </li>
            <li>
              <NotificationBell />
            </li>
            <li>
              <UserMenu />
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
