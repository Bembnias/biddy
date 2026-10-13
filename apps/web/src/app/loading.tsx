import { useTranslations } from 'next-intl';

import { Skeleton } from '@/components/ui/skeleton';

/** Stan ładowania segmentu (strony z danymi z API): szkielet z komunikatem dla czytników. */
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
