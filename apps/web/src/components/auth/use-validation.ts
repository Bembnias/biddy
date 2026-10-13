'use client';

import { useTranslations } from 'next-intl';

import type { ValidationMessages } from '@/lib/auth/schemas';

/** Komunikaty walidacji formularzy kont z next-intl. */
export function useValidationMessages(): ValidationMessages {
  const t = useTranslations('auth.validation');
  return (key) => t(key);
}
