'use client';

// Start wystawiania (F-14, układ F-63, strona /wystaw): hero z nową aukcją i limitami konta,
// korzyści, weryfikacja telefonu i blokada, szkice z postępem w krokach kreatora.
import {
  type AuctionSummaryDto,
  createAuctionDraft,
  deleteAuctionDraft,
  getGetMyAuctionsQueryKey,
  useGetMyAuctions,
  useGetSellingLimits,
} from '@biddy/api-client';
import { LISTING_STEP_COUNT, formatMoney, money } from '@biddy/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  BadgePercent,
  Camera,
  ImageOff,
  type LucideIcon,
  Package,
  Plus,
  Smartphone,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { type ComponentProps, useState } from 'react';

import { track } from '@/analytics/posthog';
import { LiveBadge } from '@/components/auction/live-badge';
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
import { IconTile } from '@/components/ui/icon-tile';
import { Skeleton } from '@/components/ui/skeleton';
import { LISTING_STEPS } from '@/lib/listing/form';
import { listingWizardUrl, routes, withNext } from '@/lib/routes';
import { cn } from '@/lib/utils';

const DRAFTS = { status: ['DRAFT' as const] };

const BENEFITS: readonly {
  readonly key: 'photos' | 'auction' | 'label' | 'fee';
  readonly Icon: LucideIcon;
  readonly tone: ComponentProps<typeof IconTile>['tone'];
}[] = [
  { key: 'photos', Icon: Camera, tone: 'brand' },
  { key: 'auction', Icon: TrendingUp, tone: 'brand' },
  { key: 'label', Icon: Package, tone: 'success' },
  { key: 'fee', Icon: BadgePercent, tone: 'info' },
];

const zl = (amount: number) =>
  formatMoney(money(amount), { trailingZeroDisplay: 'stripIfInteger' });

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
      <section
        aria-labelledby="sell-title"
        className="flex flex-wrap items-center gap-10 rounded-2xl border border-border bg-card p-6 sm:p-10"
      >
        <div className="flex min-w-0 flex-[1_1_22rem] flex-col gap-4">
          <p className="text-overline text-violet-700 uppercase">{t('overline')}</p>
          <h1 id="sell-title" className="text-h1 lg:text-display">
            {t('title')}
          </h1>
          <p className="text-body-lg text-foreground-secondary">{t('text')}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pt-2">
            <Button
              type="button"
              variant="cta"
              size="lg"
              disabled={creating}
              onClick={() => void start()}
            >
              <Plus aria-hidden />
              {creating ? t('creating') : t('new')}
            </Button>
            {limits.data === undefined ? null : (
              <p className="text-body-sm text-foreground-secondary tabular-nums">
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
                        value: zl(limits.data.maxAuctionValue),
                      })}
              </p>
            )}
          </div>
          {error === undefined ? null : (
            <p role="alert" className="text-body-sm font-semibold text-destructive">
              {error}
            </p>
          )}
        </div>
        <HeroIllustration />
      </section>

      {phoneVerified ? null : (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-amber-200 bg-warning-soft p-5">
          <IconTile tone="warning">
            <Smartphone />
          </IconTile>
          <div className="min-w-0 flex-[1_1_18rem] space-y-1">
            <h2 className="text-title">{t('phoneTitle')}</h2>
            <p className="text-body-sm text-foreground-secondary">{t('phoneText')}</p>
          </div>
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

      <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        {BENEFITS.map(({ key, Icon, tone }) => (
          <li
            key={key}
            className="flex gap-3.5 rounded-xl border border-border bg-card p-4 sm:block sm:space-y-2.5 sm:p-5.5"
          >
            <IconTile tone={tone} className="size-11 rounded-lg">
              <Icon />
            </IconTile>
            <div className="min-w-0 space-y-1 sm:space-y-2.5">
              <h2 className="text-title font-extrabold">{t(`benefits.${key}.title`)}</h2>
              <p className="text-body-sm text-foreground-secondary">{t(`benefits.${key}.text`)}</p>
            </div>
          </li>
        ))}
      </ul>

      <section aria-labelledby="drafts-title" className="space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="drafts-title" className="text-h3">
            {t('drafts')}
          </h2>
          <Link
            href={routes.myAuctions}
            className="rounded-xs text-label text-link underline-offset-3 outline-none hover:text-link-hover hover:underline focus-visible:shadow-focus-ring"
          >
            {t('myAuctions')}
          </Link>
        </div>
        {drafts.isPending ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-25 w-full rounded-xl" />
            <Skeleton className="h-25 w-full rounded-xl" />
          </div>
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
          <p className="rounded-xl border border-dashed border-border-strong bg-card px-5 py-6 text-center text-body text-foreground-secondary">
            {t('noDrafts')}
          </p>
        ) : (
          <ul className="space-y-3">
            {drafts.data.map((draft) => (
              <DraftRow key={draft.id} draft={draft} onRemove={() => void remove(draft.id)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Szkic (F-63): miniatura, tytuł, pasek postępu z krokiem do uzupełnienia („Krok 4 z 6:
 * Dostawa”) i datą zmiany. „Kontynuuj” otwiera ten krok kreatora.
 */
function DraftRow({
  draft,
  onRemove,
}: {
  readonly draft: AuctionSummaryDto;
  readonly onRemove: () => void;
}) {
  const t = useTranslations('listing.start');
  const steps = useTranslations('listing.wizard.steps');
  const format = useFormatter();
  const title = draft.title ?? t('untitled');
  const step = Math.min((draft.completedSteps ?? 0) + 1, LISTING_STEP_COUNT);
  const stepId = LISTING_STEPS[step - 1]?.id ?? 'zdjecia';
  return (
    <li className="flex flex-wrap items-center gap-x-4.5 gap-y-3 rounded-xl border border-border bg-card px-5 py-4.5">
      {draft.coverUrl === null ? (
        <span
          aria-hidden
          className="grid size-16 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
        >
          <ImageOff className="size-6" />
        </span>
      ) : (
        // Miniatura WebP z CDN.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={draft.coverUrl} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
      )}
      <div className="min-w-0 flex-[1_1_16rem] space-y-1.5">
        <p
          className={cn('truncate text-title', draft.title === null && 'text-foreground-secondary')}
        >
          {title}
        </p>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span aria-hidden className="h-1.5 w-40 overflow-hidden rounded-full bg-ink-200">
            <span
              className="block h-full rounded-full bg-brand"
              style={{ width: `${String((step / LISTING_STEP_COUNT) * 100)}%` }}
            />
          </span>
          <span className="text-body-sm text-foreground-secondary">
            {t('progress', { step, total: LISTING_STEP_COUNT, name: steps(stepId) })}
            {' · '}
            {t('updated', {
              date: format.dateTime(new Date(draft.updatedAt), { day: 'numeric', month: 'long' }),
            })}
          </span>
        </div>
      </div>
      <div className="flex gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:bg-destructive-soft"
              aria-label={t('deleteNamed', { title })}
            >
              {t('delete')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('deleteText', { title })}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('keep')}</AlertDialogCancel>
              <AlertDialogAction onClick={onRemove}>{t('deleteConfirm')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button asChild>
          <Link
            href={listingWizardUrl(draft.id, stepId)}
            aria-label={t('continueNamed', { title })}
          >
            {t('continue')}
          </Link>
        </Button>
      </div>
    </li>
  );
}

/** Przykład aukcji na żywo obok hasła (dekoracja z płótna, ukryta przed czytnikiem). */
function HeroIllustration() {
  const t = useTranslations('listing.start.illustration');
  return (
    <div
      aria-hidden
      className="hidden flex-[0_1_21rem] flex-col gap-2.5 rounded-2xl bg-primary p-5 text-primary-foreground sm:flex"
    >
      <div className="flex items-center justify-between">
        <span className="text-overline text-ink-300 uppercase">{t('label')}</span>
        <LiveBadge />
      </div>
      <div className="flex items-baseline gap-2.5">
        <span className="text-price-xl tabular-nums">{zl(32_000)}</span>
        <span className="text-label font-extrabold text-green-300 tabular-nums">
          {t('from', { price: zl(12_000) })}
        </span>
      </div>
      <svg viewBox="0 0 300 64" className="h-16 w-full text-pink-400" fill="none">
        <polyline
          points="0,58 40,54 80,50 110,44 150,40 180,30 210,26 240,16 270,12 300,4"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-body-sm text-ink-300">{t('caption')}</span>
    </div>
  );
}
