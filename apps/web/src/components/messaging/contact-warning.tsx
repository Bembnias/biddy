'use client';

import type { ContactFlag } from '@biddy/shared';
import { ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { contactKinds } from '@/lib/messaging/messaging';

/**
 * Ostrzeżenie o danych kontaktowych (F-29, decyzja nr 136): pod oflagowaną wiadomością dla obu
 * stron (`message`) albo jako podpowiedź w polu wiadomości przed wysłaniem (`hint`).
 */
export function ContactWarning({
  flags,
  variant,
  id,
}: {
  readonly flags: readonly ContactFlag[];
  readonly variant: 'message' | 'hint';
  readonly id?: string;
}) {
  const t = useTranslations('messaging.contact');
  if (flags.length === 0) {
    return null;
  }
  const kinds = contactKinds(flags, (flag) => t(`kinds.${flag}`));
  return (
    <Alert id={id} variant="warning" role="note" className="py-2.5">
      <ShieldAlert aria-hidden />
      <AlertDescription className="text-foreground">
        {variant === 'message' ? t('warning', { kinds }) : t('hint', { kinds })}
      </AlertDescription>
    </Alert>
  );
}
