'use client';

import { useGetSession } from '@biddy/api-client';
import { UserRound } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { routes } from '@/lib/routes';

/**
 * „Zaloguj się” albo „Moje konto” w nagłówku. Stan sesji pobiera przeglądarka (GET /v1/session),
 * żeby strony publiczne zostały statyczne (ISR); do tego czasu widać „Zaloguj się”.
 */
export function UserMenu() {
  const t = useTranslations('layout');
  const { data } = useGetSession({ query: { staleTime: 60_000, retry: false } });
  const user = data?.user ?? null;
  const label = user === null ? t('signIn') : t('account');
  return (
    <Button asChild variant="outline" className="max-sm:size-10 max-sm:px-0">
      <Link href={user === null ? routes.signIn : routes.account}>
        <UserRound aria-hidden className={user === null ? 'sm:hidden' : undefined} />
        <span className="max-sm:sr-only">{label}</span>
      </Link>
    </Button>
  );
}
