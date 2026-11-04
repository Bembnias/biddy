import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { MessagesLink } from '@/components/messaging/messages-link';
import { MyBiddyLink } from '@/components/my-biddy/my-biddy-link';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { Button } from '@/components/ui/button';
import { routes } from '@/lib/routes';

import { Logo } from './logo';
import { SearchForm } from './search-form';
import { UserMenu } from './user-menu';

/**
 * Nagłówek (F-62): logo, wyszukiwarka w pigułce, Moje Biddy, wiadomości (F-29), powiadomienia,
 * konto i „Wystaw przedmiot” w granacie (gradient należy do treści strony, nie do nagłówka).
 * Przyklejony do góry, półprzezroczysty. Na telefonie (< 768 px) wyszukiwarka przechodzi do
 * drugiego wiersza, a Moje Biddy i „Wystaw” są w dolnym pasku nawigacji (F-63, D4); zostają
 * wiadomości, powiadomienia i konto.
 */
export function SiteHeader() {
  const t = useTranslations('layout');
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-3 gap-y-3 px-4 py-3 md:h-16 md:flex-nowrap md:gap-x-6 md:px-10 md:py-0">
        <Logo />
        <SearchForm className="order-last w-full md:order-none md:max-w-md md:flex-1" />
        <nav aria-label={t('mainNavigation')} className="ml-auto">
          <ul className="flex items-center gap-1 md:gap-2">
            <li className="max-md:hidden">
              <MyBiddyLink />
            </li>
            <li>
              <MessagesLink />
            </li>
            <li>
              <NotificationBell />
            </li>
            <li>
              <UserMenu />
            </li>
            <li className="ml-2 max-md:hidden">
              <Button asChild>
                <Link href={routes.sell}>
                  <Plus aria-hidden />
                  {t('sell')}
                </Link>
              </Button>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
