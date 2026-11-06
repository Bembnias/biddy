'use client';

import {
  type MyStandingDto,
  type MyStrikesDto,
  useGetMyStanding,
  useListMyStrikes,
} from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import { Ban, Gavel, ShieldAlert, ShieldCheck, Store } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/icon-tile';
import { Skeleton } from '@/components/ui/skeleton';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

import { AppealForm } from './appeal-form';

type Strike = MyStrikesDto['strikes'][number];
type Block = MyStrikesDto['blocks'][number];
type BuyerStanding = MyStandingDto['buyer'];
type SellerStanding = MyStandingDto['seller'];

const zl = (amount: number) =>
  formatMoney(money(amount), { trailingZeroDisplay: 'stripIfInteger' });

/**
 * Limity i strike'i (F-61): aktywne blokady na górze, poziomy z limitami i tym, co je podniesie,
 * strike'i z uzasadnieniem i odwołaniem. Dane z `GET /me/standing` i `GET /me/strikes`.
 */
export function AccountStanding() {
  const t = useTranslations('standing');
  const standing = useGetMyStanding();
  const history = useListMyStrikes();

  if (standing.isPending || history.isPending) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }
  if (standing.isError || history.isError) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
      >
        {t('error')}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void Promise.all([standing.refetch(), history.refetch()])}
        >
          {t('retry')}
        </Button>
      </div>
    );
  }

  const activeBlocks = history.data.blocks.filter((block) => block.state === 'ACTIVE');
  return (
    <div className="space-y-6">
      {activeBlocks.map((block) => (
        <BlockCard key={block.id} block={block} strikes={history.data.strikes} />
      ))}
      <section aria-labelledby="standing-limits" className="space-y-3.5">
        <h2 id="standing-limits" className="text-overline text-muted-foreground uppercase">
          {t('limits.title')}
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <BuyerCard buyer={standing.data.buyer} />
          <SellerCard seller={standing.data.seller} />
        </div>
      </section>
      <StrikesSection standing={standing.data} strikes={history.data.strikes} />
      <BlockHistory blocks={history.data.blocks.filter((block) => block.state !== 'ACTIVE')} />
      <p className="text-body-sm text-foreground-secondary">
        {t('rules', {
          threshold: standing.data.strikes.threshold,
          days: standing.data.strikes.windowDays,
          blockDays: standing.data.strikes.blockDays,
        })}{' '}
        <Link
          href={routes.terms}
          className="rounded-xs text-link underline underline-offset-3 outline-none hover:text-link-hover focus-visible:shadow-focus-ring"
        >
          {t('terms')}
        </Link>
      </p>
    </div>
  );
}

function BlockCard({ block, strikes }: { readonly block: Block; readonly strikes: Strike[] }) {
  const t = useTranslations('standing');
  const format = useFormatter();
  const causes = strikes.filter((strike) => block.strikeIds.includes(strike.id));
  return (
    <section
      aria-labelledby={`block-${block.id}`}
      className="space-y-3 rounded-xl border border-red-200 bg-destructive-soft p-5 sm:p-6"
    >
      <div className="flex items-start gap-3.5">
        <IconTile tone="danger">
          <Ban />
        </IconTile>
        <div className="min-w-0 space-y-1.5">
          <h2 id={`block-${block.id}`} className="text-h3">
            {block.endsAt === null
              ? t(`block.forever.${block.kind}`)
              : t(`block.until.${block.kind}`, {
                  date: format.dateTime(new Date(block.endsAt), {
                    dateStyle: 'long',
                    timeStyle: 'short',
                  }),
                })}
          </h2>
          <p className="text-body-sm">{block.statement}</p>
          {causes.length === 0 ? null : (
            <ul className="list-disc space-y-0.5 pl-5 text-body-sm text-foreground-secondary">
              {causes.map((strike) => (
                <li key={strike.id}>
                  {t(`reasons.${strike.reason}`)},{' '}
                  {format.dateTime(new Date(strike.createdAt), { dateStyle: 'long' })}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <Appeal subject="block" item={block} />
    </section>
  );
}

/** Stan odwołania albo formularz, jeśli można się jeszcze odwołać. */
function Appeal({
  subject,
  item,
}: {
  readonly subject: 'strike' | 'block';
  readonly item: Strike | Block;
}) {
  const t = useTranslations('standing.appeal');
  const format = useFormatter();
  const { appeal } = item;
  if (appeal.status === 'NONE') {
    return item.canAppeal ? <AppealForm subject={subject} id={item.id} /> : null;
  }
  return (
    <div className="space-y-1 rounded-lg bg-card px-4 py-3 text-body-sm">
      <p className="font-semibold">
        {t(`status.${appeal.status}`, {
          date:
            appeal.appealedAt === null
              ? ''
              : format.dateTime(new Date(appeal.appealedAt), { dateStyle: 'long' }),
        })}
      </p>
      {appeal.note === null ? null : (
        <p className="text-foreground-secondary">{t('decision', { note: appeal.note })}</p>
      )}
    </div>
  );
}

function LimitRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-border py-2.5 first:border-t-0">
      <dt className="text-body-sm text-foreground-secondary">{label}</dt>
      <dd className="text-title tabular-nums">{value}</dd>
    </div>
  );
}

function LevelCard({
  id,
  Icon,
  title,
  level,
  overridden,
  rows,
  next,
}: {
  readonly id: string;
  readonly Icon: typeof Gavel;
  readonly title: string;
  readonly level: string;
  readonly overridden: boolean;
  readonly rows: readonly { readonly label: string; readonly value: string }[];
  readonly next: { readonly title: string; readonly lines: readonly string[] } | null;
}) {
  const t = useTranslations('standing.limits');
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
    >
      <div className="flex items-center gap-3">
        <IconTile tone="brand">
          <Icon />
        </IconTile>
        <div className="min-w-0">
          <h3 id={id} className="text-title font-extrabold">
            {title}
          </h3>
          <Badge tone="brand">{level}</Badge>
        </div>
      </div>
      <dl>
        {rows.map((row) => (
          <LimitRow key={row.label} label={row.label} value={row.value} />
        ))}
      </dl>
      {overridden ? (
        <p className="text-body-sm text-foreground-secondary">{t('overridden')}</p>
      ) : null}
      {next === null ? null : (
        <div className="space-y-1 rounded-lg bg-canvas px-4 py-3 text-body-sm">
          <p className="font-semibold">{next.title}</p>
          <ul className="space-y-0.5 text-foreground-secondary">
            {next.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function BuyerCard({ buyer }: { readonly buyer: BuyerStanding }) {
  const t = useTranslations('standing');
  const amount = (value: number | null) => (value === null ? t('limits.none') : zl(value));
  const count = (value: number | null) => (value === null ? t('limits.none') : String(value));
  const next =
    buyer.next === null
      ? null
      : {
          title: t('limits.next', {
            level: t(`levels.buyer.${buyer.next.level}`),
            limit: amount(buyer.next.limits.maxBidAmount),
          }),
          lines: buyer.next.requirements.map((requirement) =>
            t(`requirements.${requirement.kind}`, {
              current: requirement.current,
              required: requirement.required,
            }),
          ),
        };
  return (
    <LevelCard
      id="standing-buyer"
      Icon={Gavel}
      title={t('limits.buyer')}
      level={t(`levels.buyer.${buyer.level}`)}
      overridden={buyer.overridden}
      rows={[
        { label: t('limits.maxBid'), value: amount(buyer.limits.maxBidAmount) },
        { label: t('limits.activeBids'), value: count(buyer.limits.maxActiveAuctions) },
      ]}
      next={next}
    />
  );
}

function SellerCard({ seller }: { readonly seller: SellerStanding }) {
  const t = useTranslations('standing');
  const amount = (value: number | null) => (value === null ? t('limits.none') : zl(value));
  const count = (value: number | null) => (value === null ? t('limits.none') : String(value));
  const next =
    seller.next === null
      ? null
      : {
          title: t('limits.nextSeller', { level: t(`levels.seller.${seller.next.level}`) }),
          lines: seller.next.requirements.map((requirement) =>
            t(`requirements.${requirement.kind}`, {
              current: requirement.current,
              required: requirement.required,
            }),
          ),
        };
  return (
    <LevelCard
      id="standing-seller"
      Icon={Store}
      title={t('limits.seller')}
      level={t(`levels.seller.${seller.level}`)}
      overridden={seller.overridden}
      rows={[
        { label: t('limits.activeAuctions'), value: count(seller.limits.maxActiveAuctions) },
        { label: t('limits.maxValue'), value: amount(seller.limits.maxAuctionValue) },
      ]}
      next={next}
    />
  );
}

function StrikesSection({
  standing,
  strikes,
}: {
  readonly standing: MyStandingDto;
  readonly strikes: Strike[];
}) {
  const t = useTranslations('standing.strikes');
  const { threshold, windowDays } = standing.strikes;
  return (
    <section aria-labelledby="standing-strikes" className="space-y-3.5">
      <h2 id="standing-strikes" className="text-overline text-muted-foreground uppercase">
        {t('title')}
      </h2>
      <div className="space-y-4 rounded-xl border border-border bg-card p-5">
        <dl className="grid gap-3 sm:grid-cols-2">
          {(['buyer', 'seller'] as const).map((role) => (
            <StrikeMeter
              key={role}
              label={t(`role.${role}`)}
              count={standing.strikes[role]}
              threshold={threshold}
              days={windowDays}
            />
          ))}
        </dl>
        {strikes.length === 0 ? (
          <p className="flex items-center gap-2 text-body-sm text-foreground-secondary">
            <ShieldCheck aria-hidden className="size-4.5 text-success" />
            {t('empty')}
          </p>
        ) : (
          <ul className="space-y-3">
            {strikes.map((strike) => (
              <StrikeItem key={strike.id} strike={strike} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function StrikeMeter({
  label,
  count,
  threshold,
  days,
}: {
  readonly label: string;
  readonly count: number;
  readonly threshold: number;
  readonly days: number;
}) {
  const t = useTranslations('standing.strikes');
  const ratio = Math.min(count / threshold, 1);
  return (
    <div className="space-y-1.5 rounded-lg bg-canvas px-4 py-3">
      <dt className="text-body-sm text-foreground-secondary">{label}</dt>
      <dd className="space-y-1.5">
        <span className="text-title tabular-nums">{t('meter', { count, threshold, days })}</span>
        <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-muted">
          <span
            className={cn('block h-full rounded-full', count === 0 ? 'bg-success' : 'bg-urgent')}
            style={{ width: `${String(Math.max(ratio, count === 0 ? 0 : 0.08) * 100)}%` }}
          />
        </span>
      </dd>
    </div>
  );
}

const STATE_TONES = {
  ACTIVE: 'danger',
  EXPIRED: 'neutral',
  REVOKED: 'success',
} as const;

function StrikeItem({ strike }: { readonly strike: Strike }) {
  const t = useTranslations('standing');
  const format = useFormatter();
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'long' });
  return (
    <li className="space-y-2.5 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-title font-extrabold">
          <ShieldAlert aria-hidden className="size-4.5 text-urgent" />
          {t(`reasons.${strike.reason}`)}
        </h3>
        <Badge tone={STATE_TONES[strike.state]}>{t(`strikes.state.${strike.state}`)}</Badge>
      </div>
      <p className="text-body-sm">{strike.statement}</p>
      <p className="text-body-sm text-foreground-secondary">
        {t('strikes.dates', { issued: date(strike.createdAt), expires: date(strike.expiresAt) })}
      </p>
      {strike.revokeNote === null ? null : (
        <p className="text-body-sm text-foreground-secondary">
          {t('strikes.revoked', { note: strike.revokeNote })}
        </p>
      )}
      <Appeal subject="strike" item={strike} />
    </li>
  );
}

function BlockHistory({ blocks }: { readonly blocks: Block[] }) {
  const t = useTranslations('standing');
  const format = useFormatter();
  if (blocks.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="standing-blocks" className="space-y-3.5">
      <h2 id="standing-blocks" className="text-overline text-muted-foreground uppercase">
        {t('history.title')}
      </h2>
      <ul className="space-y-3">
        {blocks.map((block) => (
          <li key={block.id} className="space-y-1.5 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-title font-extrabold">{t(`history.kind.${block.kind}`)}</h3>
              <Badge tone={block.state === 'LIFTED' ? 'success' : 'neutral'}>
                {t(`history.state.${block.state}`)}
              </Badge>
            </div>
            <p className="text-body-sm text-foreground-secondary">
              {format.dateTime(new Date(block.startsAt), { dateStyle: 'long' })}
              {' – '}
              {block.endsAt === null
                ? t('history.forever')
                : format.dateTime(new Date(block.endsAt), { dateStyle: 'long' })}
            </p>
            {block.liftNote === null ? null : (
              <p className="text-body-sm text-foreground-secondary">{block.liftNote}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
