'use client';

import { useGetOrder } from '@biddy/api-client';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { routes } from '@/lib/routes';

/** Link wstecz strony zamówienia: „Wygrane” dla kupującego, „Sprzedane” dla sprzedającego. */
export function OrderBackLink({ publicId }: { readonly publicId: string }) {
  const t = useTranslations('order');
  const order = useGetOrder(publicId, { query: { retry: false } });
  const seller = order.data?.role === 'SELLER';
  return (
    <Link
      href={seller ? routes.mySales : routes.myWins}
      className="inline-flex items-center gap-1.5 rounded-xs text-label text-link underline-offset-3 outline-none hover:text-link-hover hover:underline focus-visible:shadow-focus-ring"
    >
      <ChevronLeft aria-hidden className="size-4" />
      {seller ? t('backSales') : t('backWins')}
    </Link>
  );
}
