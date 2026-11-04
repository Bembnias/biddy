import { ShieldCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * Jak weryfikujemy oceny (F-30, dyrektywa Omnibus, PROJECT.md §17): kto i kiedy ocenia, ujawnienie
 * obu ocen razem, brak filtrowania i płatnych wyróżnień, usuwanie tylko z powodu regulaminu.
 */
export async function ReviewsInfo() {
  const t = await getTranslations('reviews.info');
  return (
    <details className="group rounded-xl border border-border bg-card px-4 py-3 text-body-sm">
      <summary className="flex cursor-pointer items-center gap-2 rounded-sm font-semibold text-foreground outline-none focus-visible:shadow-focus-ring">
        <ShieldCheck aria-hidden className="size-4 text-brand" />
        {t('title')}
      </summary>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-foreground-secondary">
        <li>{t('who')}</li>
        <li>{t('blind')}</li>
        <li>{t('all')}</li>
        <li>{t('removal')}</li>
      </ul>
    </details>
  );
}
