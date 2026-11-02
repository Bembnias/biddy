import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { FakeGatewayBanner, FakePayPanel } from '@/components/payments/fake-pay-panel';

interface PageProps {
  readonly params: Promise<{ readonly paymentId: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('devPayments.pay');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * Testowa strona płatności FakeGateway (F-23, PROJECT.md §7.8): tu FakeGateway przekierowuje
 * płatności kartą, przelewem i BLIK-iem bez kodu. Bez logowania, jak strona operatora. Na
 * produkcji API odpowiada 404, więc strona pokazuje „nie znaleziono”.
 */
export default async function FakePayPage({ params }: PageProps) {
  const { paymentId } = await params;
  const t = await getTranslations('devPayments.pay');
  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-xl px-4 py-12 md:px-6">
        <FakeGatewayBanner />
        <h1 className="mb-6 text-h2">{t('title')}</h1>
        <div className="rounded-xl border border-border bg-card p-6">
          <FakePayPanel paymentId={paymentId} />
        </div>
      </div>
    </div>
  );
}
