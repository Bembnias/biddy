'use client';

import { useGetSession } from '@biddy/api-client';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { UserAvatar } from '@/components/profile/user-avatar';
import { Button } from '@/components/ui/button';
import { routes } from '@/lib/routes';

/**
 * „Zaloguj się” albo awatar z powitaniem prowadzący do konta (F-62). Stan sesji pobiera
 * przeglądarka (GET /v1/session), żeby strony publiczne zostały statyczne (ISR); do tego czasu
 * widać „Zaloguj się”.
 */
export function UserMenu() {
  const t = useTranslations('layout');
  const { data } = useGetSession({ query: { staleTime: 60_000, retry: false } });
  const user = data?.user ?? null;
  if (user === null) {
    return (
      <Button asChild variant="ghost">
        <Link href={routes.signIn}>{t('signIn')}</Link>
      </Button>
    );
  }
  const firstName = user.name.split(/\s+/u)[0] ?? user.name;
  return (
    <Button asChild variant="ghost" className="rounded-full pr-2 pl-1.5 max-sm:size-10 max-sm:p-0">
      <Link href={routes.account} aria-label={t('account')}>
        <UserAvatar
          userId={user.id}
          name={user.name}
          label=""
          imageUrl={user.avatarUrl}
          size="xs"
        />
        <span aria-hidden className="max-md:hidden">
          <span className="font-medium text-muted-foreground">{t('greeting')}</span> {firstName}!
        </span>
        <ChevronRight aria-hidden className="size-4 text-muted-foreground max-md:hidden" />
      </Link>
    </Button>
  );
}
