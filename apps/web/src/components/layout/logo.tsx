import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { routes } from '@/lib/routes';

/** Logo tekstowe (tymczasowe, do czasu identyfikacji wizualnej). */
export function Logo() {
  const t = useTranslations('layout');
  return (
    <Link
      href={routes.home}
      aria-label={t('home')}
      className="rounded-md text-2xl font-bold text-primary"
    >
      Biddy<span className="text-highlight">.</span>
    </Link>
  );
}
