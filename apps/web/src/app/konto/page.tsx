import {
  Banknote,
  Bell,
  ChevronRight,
  CircleCheck,
  Gavel,
  type LucideIcon,
  Mail,
  MapPin,
  MessagesSquare,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Store,
  TriangleAlert,
  UserRound,
  UserX,
} from 'lucide-react';
import { getMyBalance, getMyStanding } from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ComponentProps, ReactNode } from 'react';

import { ResendVerificationButton, SignOutButtons } from '@/components/auth/account-actions';
import { UserAvatar } from '@/components/profile/user-avatar';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/icon-tile';
import { loadMeOrRedirect } from '@/lib/api/me';
import { withSessionCookies } from '@/lib/api/server';
import { monthAndYear } from '@/lib/dates';
import { formatPhoneNumber } from '@/lib/phone';
import { publicProfileUrl, routes, withNext } from '@/lib/routes';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.account');
  return { title: t('metaTitle'), robots: { index: false } };
}

interface Shortcut {
  readonly href: string;
  readonly label: string;
  readonly description: string;
  readonly Icon: LucideIcon;
  readonly tone: ComponentProps<typeof IconTile>['tone'];
  /** Ostrzeżenie pod opisem (np. aktywna blokada konta). */
  readonly alert?: string;
}

/** Czy konto ma aktywną blokadę (F-61); błąd API nie blokuje strony konta. */
async function hasActiveBlock(): Promise<boolean> {
  try {
    const standing = await getMyStanding(await withSessionCookies());
    return standing.buyer.block !== null || standing.seller.block !== null;
  } catch {
    return false;
  }
}

/** Saldo do wypłaty (F-27) w opisie skrótu; błąd API nie blokuje strony konta. */
async function availableBalance(): Promise<number | undefined> {
  try {
    return (await getMyBalance(await withSessionCookies())).available;
  } catch {
    return undefined;
  }
}

/**
 * Moje konto (F-10, układ F-63) renderowane na serwerze z sesją z ciasteczka (SSR); bez sesji
 * przekierowanie na logowanie. Karta konta z e-mailem i telefonem, skróty z opisami
 * i wylogowanie w karcie „Bezpieczeństwo”.
 */
export default async function AccountPage() {
  const me = await loadMeOrRedirect(routes.account);
  const [t, blocked, available] = await Promise.all([
    getTranslations('auth.account'),
    hasActiveBlock(),
    availableBalance(),
  ]);
  const selling: Shortcut[] = [
    {
      href: routes.myBiddy,
      label: t('myBiddy'),
      description: t('shortcuts.myBiddy'),
      Icon: Gavel,
      tone: 'brand',
    },
    {
      href: routes.messages,
      label: t('messages'),
      description: t('shortcuts.messages'),
      Icon: MessagesSquare,
      tone: 'info',
    },
    {
      href: routes.myAuctions,
      label: t('myAuctions'),
      description: t('shortcuts.myAuctions'),
      Icon: Store,
      tone: 'warning',
    },
    {
      href: routes.balance,
      label: t('balance'),
      description:
        available === undefined || available === 0
          ? t('shortcuts.balance')
          : t('balanceAvailable', {
              amount: formatMoney(money(available), { trailingZeroDisplay: 'stripIfInteger' }),
            }),
      Icon: Banknote,
      tone: 'success',
    },
    {
      href: routes.sell,
      label: t('sell'),
      description: t('shortcuts.sell'),
      Icon: Plus,
      tone: 'neutral',
    },
  ];
  const profile: Shortcut[] = [
    {
      href: routes.profileSettings,
      label: t('editProfile'),
      description: t('shortcuts.editProfile'),
      Icon: UserRound,
      tone: 'neutral',
    },
    {
      href: routes.addresses,
      label: t('addresses'),
      description: t('shortcuts.addresses'),
      Icon: MapPin,
      tone: 'neutral',
    },
    {
      href: routes.notificationSettings,
      label: t('notifications'),
      description: t('shortcuts.notifications'),
      Icon: Bell,
      tone: 'neutral',
    },
    {
      href: routes.blockedUsers,
      label: t('blockedUsers'),
      description: t('shortcuts.blockedUsers'),
      Icon: UserX,
      tone: 'neutral',
    },
    {
      href: routes.accountStanding,
      label: t('standing'),
      description: t('shortcuts.standing'),
      Icon: blocked ? ShieldAlert : ShieldCheck,
      tone: blocked ? 'danger' : 'neutral',
      ...(blocked ? { alert: t('standingAlert') } : {}),
    },
  ];
  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-narrow space-y-7 px-4 py-8 md:px-6 md:py-10">
        <h1 className="text-h2 md:text-h1">{t('title')}</h1>

        <section
          aria-labelledby="account-who"
          className="flex flex-wrap items-center gap-x-6 gap-y-5 rounded-xl border border-border bg-card p-5 sm:p-7"
        >
          <UserAvatar userId={me.id} name={me.name} label="" imageUrl={me.avatarUrl} size="lg" />
          <div className="min-w-0 flex-[1_1_16rem] space-y-1">
            <h2 id="account-who" className="text-h2 break-words">
              {me.name}
            </h2>
            <p className="text-body-sm text-foreground-secondary">
              {t('memberSinceLine', { date: monthAndYear(new Date(me.createdAt)) })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Button asChild variant="ghost">
              <Link href={publicProfileUrl(me.id)}>{t('viewPublicProfile')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={routes.profileSettings}>{t('editProfile')}</Link>
            </Button>
          </div>
          <ul className="grid basis-full gap-3 border-t border-border pt-5 md:grid-cols-2">
            <ContactRow
              Icon={Mail}
              ok={me.emailVerified}
              label={t('email')}
              value={<span className="break-all">{me.email}</span>}
              status={me.emailVerified ? t('emailVerified') : t('emailNotVerified')}
              action={me.emailVerified ? null : <ResendVerificationButton email={me.email} />}
            />
            <ContactRow
              Icon={Smartphone}
              ok={me.phoneVerified}
              label={t('phone')}
              value={
                me.phoneNumber === null ? (
                  <span className="text-muted-foreground">{t('noPhone')}</span>
                ) : (
                  <span className="tabular-nums">{formatPhoneNumber(me.phoneNumber)}</span>
                )
              }
              status={me.phoneVerified ? t('phoneVerified') : t('phoneNotVerified')}
              action={
                <Link
                  href={withNext(routes.verifyPhone, routes.account)}
                  className="rounded-xs text-label text-link underline-offset-3 outline-none hover:text-link-hover hover:underline focus-visible:shadow-focus-ring"
                >
                  {me.phoneVerified ? t('changePhone') : t('verifyPhone')}
                </Link>
              }
            />
          </ul>
        </section>

        <ShortcutSection id="selling-section" title={t('sellingSection')} links={selling} />
        <ShortcutSection id="profile-section" title={t('profileSection')} links={profile} />

        <section
          aria-labelledby="security-section"
          className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-xl border border-border bg-card p-5 sm:px-7 sm:py-6"
        >
          <div className="min-w-0 flex-[1_1_20rem] space-y-1">
            <h2 id="security-section" className="text-h3">
              {t('securitySection')}
            </h2>
            <p className="text-body-sm text-foreground-secondary">{t('signOutEverywhereHint')}</p>
          </div>
          <SignOutButtons />
        </section>
      </div>
    </div>
  );
}

/** E-mail albo telefon: kafelek w tonie weryfikacji, wartość i stan z ikoną (nie sam kolor). */
function ContactRow({
  Icon,
  ok,
  label,
  value,
  status,
  action,
}: {
  readonly Icon: LucideIcon;
  readonly ok: boolean;
  readonly label: string;
  readonly value: ReactNode;
  readonly status: string;
  readonly action: ReactNode;
}) {
  const StatusIcon = ok ? CircleCheck : TriangleAlert;
  return (
    <li className="flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-lg bg-canvas px-4 py-3.5">
      <IconTile tone={ok ? 'success' : 'warning'}>
        <Icon />
      </IconTile>
      <div className="min-w-0 flex-[1_1_10rem]">
        <p className="text-overline text-muted-foreground uppercase">{label}</p>
        <p className="text-title">{value}</p>
      </div>
      <div className="flex flex-col items-start gap-1 sm:items-end">
        <span
          className={cn(
            'inline-flex items-start gap-1.5 text-body-sm font-semibold',
            ok ? 'text-success' : 'text-urgent',
          )}
        >
          <StatusIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {status}
        </span>
        {action}
      </div>
    </li>
  );
}

/** Sekcja skrótów (F-63): kafelki-linki z ikoną, nazwą i opisem. */
function ShortcutSection({
  id,
  title,
  links,
}: {
  readonly id: string;
  readonly title: string;
  readonly links: readonly Shortcut[];
}) {
  return (
    <section aria-labelledby={id} className="space-y-3.5">
      <h2 id={id} className="text-overline text-muted-foreground uppercase">
        {title}
      </h2>
      <ul className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {links.map(({ href, label, description, Icon, tone, alert }) => (
          <li key={href}>
            <Link
              href={href}
              className="group flex h-full items-center gap-3.5 rounded-xl border border-border bg-card p-4.5 outline-none transition-[border-color,box-shadow] duration-200 ease-out hover:border-brand-border hover:shadow-md focus-visible:shadow-focus-ring motion-reduce:transition-none"
            >
              <IconTile tone={tone}>
                <Icon />
              </IconTile>
              <span className="min-w-0 flex-1">
                <span className="block text-title font-extrabold">{label}</span>
                <span className="block text-body-sm text-foreground-secondary">{description}</span>
                {alert === undefined ? null : (
                  <span className="mt-1 inline-flex items-center gap-1 text-body-sm font-semibold text-destructive">
                    <TriangleAlert aria-hidden className="size-3.5" />
                    {alert}
                  </span>
                )}
              </span>
              <ChevronRight
                aria-hidden
                className="size-4.5 shrink-0 text-muted-foreground group-hover:text-accent-foreground"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
