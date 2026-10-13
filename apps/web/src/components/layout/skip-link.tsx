import { useTranslations } from 'next-intl';

/** Pierwszy element strony: widoczny po fokusie klawiaturą, przenosi do treści (WCAG 2.4.1). */
export function SkipLink() {
  const t = useTranslations('layout');
  return (
    <a
      href="#main"
      className="sr-only rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
    >
      {t('skipToContent')}
    </a>
  );
}
