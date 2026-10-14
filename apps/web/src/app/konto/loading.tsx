import { useTranslations } from 'next-intl';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * Stan ładowania stron konta (dane z API po sesji): szkielet z komunikatem dla czytników.
 * Celowo nie w app/: granica Suspense nad stronami publicznymi wysyłałaby status 200, zanim
 * strona wywoła notFound() (profil, później aukcje), a roboty potrzebują prawdziwego 404.
 */
export default function Loading() {
  const t = useTranslations();
  return (
    <div role="status" aria-busy="true" className="mx-auto max-w-6xl px-4 py-16 md:px-6">
      <span className="sr-only">{t('loading')}</span>
      <Skeleton className="h-10 w-2/3 max-w-xl" />
      <Skeleton className="mt-6 h-5 w-full max-w-2xl" />
      <Skeleton className="mt-3 h-5 w-5/6 max-w-xl" />
      <div className="mt-10 grid gap-6 md:grid-cols-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}
