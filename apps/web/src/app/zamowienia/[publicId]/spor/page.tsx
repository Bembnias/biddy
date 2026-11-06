import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { DisputePanel } from '@/components/disputes/dispute-panel';
import { loadMeOrRedirect } from '@/lib/api/me';
import { disputeUrl, orderUrl } from '@/lib/routes';

interface PageProps {
  readonly params: Promise<{ readonly publicId: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dispute');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * Spór o zamówienie (F-28, PROJECT.md §7.5): zgłoszenie problemu w oknie 36 h i widok sporu dla
 * obu stron. Link ze strony zamówienia i z powiadomień o sporze.
 */
export default async function DisputePage({ params }: PageProps) {
  const { publicId } = await params;
  await loadMeOrRedirect(disputeUrl(publicId));
  const t = await getTranslations('dispute');
  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-page space-y-4 px-4 py-8 md:px-6 md:py-10">
        <Link
          href={orderUrl(publicId)}
          className="inline-flex items-center gap-1.5 rounded-xs text-label text-link underline-offset-3 outline-none hover:text-link-hover hover:underline focus-visible:shadow-focus-ring"
        >
          <ChevronLeft aria-hidden className="size-4" />
          {t('back', { number: publicId })}
        </Link>
        <DisputePanel publicId={publicId} />
      </div>
    </div>
  );
}
