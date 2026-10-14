'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Alert, AlertDescription } from '@/components/ui/alert';

/** Zasady kategorii w kreatorze: podróbki, moderacja, zasady wystawiania (F-11). */
export function CategoryNotices({
  isBrandSensitive,
  isRestricted,
  listingNotice,
}: {
  readonly isBrandSensitive: boolean;
  readonly isRestricted: boolean;
  readonly listingNotice?: string | null;
}) {
  const t = useTranslations('catalog.notices');
  const notices = [
    ...(isBrandSensitive ? [t('brandSensitive')] : []),
    ...(isRestricted ? [t('restricted')] : []),
    ...(listingNotice === undefined || listingNotice === null ? [] : [listingNotice]),
  ];
  if (notices.length === 0) {
    return null;
  }
  return (
    <Alert>
      <Info aria-hidden />
      <AlertDescription>
        <ul className="space-y-1">
          {notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
