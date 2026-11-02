'use client';

import {
  type OrderDetailsDto,
  confirmReceipt,
  getGetOrderQueryKey,
  isApiError,
  reportNotReceived,
} from '@biddy/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { track } from '@/analytics/posthog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Akcja zamówienia z potwierdzeniem: wynik zastępuje widok zamówienia, błąd pokazuje alert. */
function useOrderAction(publicId: string, run: (id: string) => Promise<OrderDetailsDto>) {
  const t = useTranslations('order');
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (): Promise<boolean> => {
    setSending(true);
    setError(undefined);
    try {
      queryClient.setQueryData(getGetOrderQueryKey(publicId), await run(publicId));
      return true;
    } catch (caught) {
      const detail = isApiError(caught)
        ? (caught.problem as { detail?: unknown } | undefined)?.detail
        : undefined;
      setError(typeof detail === 'string' ? detail : t('actionError'));
      return false;
    } finally {
      setSending(false);
    }
  };
  return { sending, error, submit };
}

function ActionError({ message }: { readonly message: string | undefined }) {
  return message === undefined ? null : (
    <p role="alert" className="text-body-sm font-semibold text-destructive">
      {message}
    </p>
  );
}

/** „Wszystko OK”: potwierdzenie odbioru kończy zamówienie i od razu zwalnia środki. */
export function ConfirmReceipt({ publicId }: { readonly publicId: string }) {
  const t = useTranslations('order.confirm');
  const [open, setOpen] = useState(false);
  const action = useOrderAction(publicId, confirmReceipt);
  return (
    <div className="space-y-2">
      <AlertDialog open={open} onOpenChange={(next) => !action.sending && setOpen(next)}>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="cta">
            {t('submit')}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent className="gap-5 rounded-3xl p-7">
          <AlertDialogHeader className="text-left sm:text-left">
            <AlertDialogTitle className="text-h3">{t('title')}</AlertDialogTitle>
            <AlertDialogDescription className="text-body text-foreground-secondary">
              {t('text')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2.5 sm:flex-row">
            <AlertDialogCancel disabled={action.sending} className="sm:flex-1">
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: 'cta' }), 'sm:flex-[1.5]')}
              disabled={action.sending}
              onClick={(event) => {
                event.preventDefault();
                void action.submit().then((done) => {
                  setOpen(false);
                  if (done) {
                    track('order_receipt_confirmed', {});
                  }
                });
              }}
            >
              {action.sending ? t('sending') : t('submit')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ActionError message={action.error} />
    </div>
  );
}

/** Zgłoszenie braku paczki: 14 dni po nadaniu, z potwierdzeniem (pełny zwrot i reklamacja). */
export function ReportNotReceived({
  publicId,
  availableAt,
  allowed,
}: {
  readonly publicId: string;
  readonly availableAt: string;
  readonly allowed: boolean;
}) {
  const t = useTranslations('order.notReceived');
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const action = useOrderAction(publicId, reportNotReceived);
  if (!allowed) {
    return (
      <p className="text-body-sm text-foreground-secondary">
        {t('later', {
          date: format.dateTime(new Date(availableAt), { day: 'numeric', month: 'long' }),
        })}
      </p>
    );
  }
  return (
    <div className="space-y-2.5">
      <p className="text-body-sm text-foreground-secondary">{t('available')}</p>
      <AlertDialog open={open} onOpenChange={(next) => !action.sending && setOpen(next)}>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline">
            {t('open')}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent className="gap-5 rounded-3xl p-7">
          <AlertDialogHeader className="text-left sm:text-left">
            <AlertDialogTitle className="text-h3">{t('title')}</AlertDialogTitle>
            <AlertDialogDescription className="text-body text-foreground-secondary">
              {t('text')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2.5 sm:flex-row">
            <AlertDialogCancel disabled={action.sending} className="sm:flex-1">
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: 'default' }), 'sm:flex-[1.5]')}
              disabled={action.sending}
              onClick={(event) => {
                event.preventDefault();
                void action.submit().then((done) => {
                  setOpen(false);
                  if (done) {
                    track('order_not_received_reported', {});
                  }
                });
              }}
            >
              {action.sending ? t('sending') : t('submit')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ActionError message={action.error} />
    </div>
  );
}
