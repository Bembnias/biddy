'use client';

// Start wystawiania (F-14, strona /wystaw): weryfikacja telefonu, blokada i limit aktywnych
// aukcji, lista szkiców i nowy szkic.
import {
  createAuctionDraft,
  deleteAuctionDraft,
  getGetMyAuctionsQueryKey,
  useGetMyAuctions,
  useGetSellingLimits,
} from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { listingWizardUrl, routes, withNext } from '@/lib/routes';

const DRAFTS = { status: ['DRAFT' as const] };

export function SellStart({ phoneVerified }: { readonly phoneVerified: boolean }) {
  const t = useTranslations('listing.start');
  const format = useFormatter();
  const router = useRouter();
  const queryClient = useQueryClient();
  const drafts = useGetMyAuctions(DRAFTS);
  const limits = useGetSellingLimits();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  const start = async () => {
    setCreating(true);
    setError(undefined);
    try {
      const draft = await createAuctionDraft();
      track('listing_started');
      router.push(listingWizardUrl(draft.id));
    } catch {
      setError(t('error'));
      setCreating(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteAuctionDraft(id);
    } finally {
      await queryClient.invalidateQueries({ queryKey: getGetMyAuctionsQueryKey(DRAFTS) });
    }
  };

  const blockedUntil =
    limits.data?.listingBlockedUntil === null || limits.data === undefined
      ? undefined
      : new Date(limits.data.listingBlockedUntil);
  const limitReached =
    limits.data !== undefined && limits.data.activeAuctions >= limits.data.maxActiveAuctions;

  return (
    <div className="space-y-8">
      {phoneVerified ? null : (
        <div className="space-y-3 rounded-xl border border-border bg-card p-5">
          <h2 className="text-title">{t('phoneTitle')}</h2>
          <p className="text-body-sm text-foreground-secondary">{t('phoneText')}</p>
          <Button asChild variant="outline">
            <Link href={withNext(routes.verifyPhone, routes.sell)}>{t('phoneAction')}</Link>
          </Button>
        </div>
      )}
      {blockedUntil !== undefined && blockedUntil > new Date() ? (
        <p className="rounded-lg bg-destructive-soft px-4 py-3 text-body-sm">
          {t('blocked', {
            date: format.dateTime(blockedUntil, { dateStyle: 'long', timeStyle: 'short' }),
          })}
        </p>
      ) : null}
      {limits.data === undefined ? null : (
        <p className="text-body-sm text-muted-foreground">
          {limitReached
            ? t('limitReached', { max: limits.data.maxActiveAuctions })
            : limits.data.maxAuctionValue === null
              ? t('limitNoValue', {
                  active: limits.data.activeAuctions,
                  max: limits.data.maxActiveAuctions,
                })
              : t('limit', {
                  active: limits.data.activeAuctions,
                  max: limits.data.maxActiveAuctions,
                  value: formatMoney(money(limits.data.maxAuctionValue), {
                    trailingZeroDisplay: 'stripIfInteger',
                  }),
                })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Button
          type="button"
          variant="cta"
          size="lg"
          disabled={creating}
          onClick={() => void start()}
        >
          {creating ? t('creating') : t('new')}
        </Button>
        <Link
          href={routes.myAuctions}
          className="text-label text-link underline-offset-3 hover:text-link-hover hover:underline"
        >
          {t('myAuctions')}
        </Link>
      </div>
      {error === undefined ? null : (
        <p role="alert" className="text-body-sm text-destructive">
          {error}
        </p>
      )}

      <section aria-labelledby="drafts-title" className="space-y-4">
        <h2 id="drafts-title" className="text-h3">
          {t('drafts')}
        </h2>
        {drafts.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : drafts.isError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
          >
            {t('loadError')}
            <Button type="button" variant="outline" size="sm" onClick={() => void drafts.refetch()}>
              {t('retry')}
            </Button>
          </div>
        ) : drafts.data.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">{t('noDrafts')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {drafts.data.map((draft) => {
              const title = draft.title ?? t('untitled');
              return (
                <li key={draft.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
                  {draft.coverUrl === null ? (
                    <div aria-hidden className="size-14 rounded-md bg-muted" />
                  ) : (
                    // Miniatura WebP z CDN.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={draft.coverUrl} alt="" className="size-14 rounded-md object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-title">{title}</p>
                    <p className="text-body-sm text-muted-foreground">
                      {t('updated', {
                        date: format.dateTime(new Date(draft.updatedAt), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }),
                      })}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button asChild size="sm">
                      <Link
                        href={listingWizardUrl(draft.id)}
                        aria-label={t('continueNamed', { title })}
                      >
                        {t('continue')}
                      </Link>
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label={t('deleteNamed', { title })}
                        >
                          {t('delete')}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t('deleteText', { title })}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t('keep')}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void remove(draft.id)}>
                            {t('deleteConfirm')}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
