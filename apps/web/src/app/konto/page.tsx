import {
  Bell,
  ChevronRight,
  CircleCheck,
  Eye,
  Gavel,
  type LucideIcon,
  MapPin,
  Plus,
  Store,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { ResendVerificationButton, SignOutButtons } from '@/components/auth/account-actions';
import { UserAvatar } from '@/components/profile/user-avatar';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/icon-tile';
import { loadMeOrRedirect } from '@/lib/api/me';
import { formatPhoneNumber } from '@/lib/phone';
import { publicProfileUrl, routes, withNext } from '@/lib/routes';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.account');
  return { title: t('metaTitle'), robots: { index: false } };
}

/** Konto renderowane na serwerze z sesją z ciasteczka (SSR); bez sesji przekierowanie na logowanie. */
export default async function AccountPage() {
  const me = await loadMeOrRedirect(routes.account);
  const t = await getTranslations('auth.account');
  const format = await getFormatter();
  const selling = [
    { href: routes.myBiddy, label: t('myBiddy'), Icon: Gavel },
    { href: routes.myAuctions, label: t('myAuctions'), Icon: Store },
    { href: routes.sell, label: t('sell'), Icon: Plus },
  ];
  const profile = [
    { href: routes.profileSettings, label: t('editProfile'), Icon: UserRound },
    { href: routes.addresses, label: t('addresses'), Icon: MapPin },
    { href: routes.notificationSettings, label: t('notifications'), Icon: Bell },
    { href: publicProfileUrl(me.id), label: t('viewPublicProfile'), Icon: Eye },
  ];
  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-2xl space-y-8 px-4 py-8 md:px-6 md:py-12">
        <div className="flex items-center gap-4">
          <UserAvatar userId={me.id} name={me.name} label="" imageUrl={me.avatarUrl} size="lg" />
          <div className="min-w-0">
            <h1 className="text-h2 md:text-h1">{t('title')}</h1>
            <p className="text-title break-words text-foreground-secondary">{me.name}</p>
          </div>
        </div>

        <dl className="divide-y divide-border rounded-xl border border-border bg-card px-6">
          <div className="space-y-2 py-5">
            <dt className="text-overline text-muted-foreground uppercase">{t('email')}</dt>
            <dd className="text-body break-words">{me.email}</dd>
            <dd>
              <Status ok={me.emailVerified}>
                {me.emailVerified ? t('emailVerified') : t('emailNotVerified')}
              </Status>
            </dd>
            {me.emailVerified ? null : (
              <dd className="pt-1">
                <ResendVerificationButton email={me.email} />
              </dd>
            )}
          </div>
          <div className="space-y-2 py-5">
            <dt className="text-overline text-muted-foreground uppercase">{t('phone')}</dt>
            {me.phoneNumber === null ? null : (
              <dd className="text-body tabular-nums">{formatPhoneNumber(me.phoneNumber)}</dd>
            )}
            <dd>
              <Status ok={me.phoneVerified}>
                {me.phoneVerified ? t('phoneVerified') : t('phoneNotVerified')}
              </Status>
            </dd>
            <dd className="pt-1">
              <Button asChild variant="outline" size="sm">
                <Link href={withNext(routes.verifyPhone, routes.account)}>
                  {me.phoneVerified ? t('changePhone') : t('verifyPhone')}
                </Link>
              </Button>
            </dd>
          </div>
          <div className="space-y-2 py-5">
            <dt className="text-overline text-muted-foreground uppercase">{t('memberSince')}</dt>
            <dd className="text-body">
              {format.dateTime(new Date(me.createdAt), { dateStyle: 'long' })}
            </dd>
          </div>
        </dl>

        <LinkSection id="selling-section" title={t('sellingSection')} links={selling} />
        <LinkSection id="profile-section" title={t('profileSection')} links={profile} />

        <div className="rounded-xl border border-border bg-card p-6">
          <SignOutButtons />
        </div>
      </div>
    </div>
  );
}

/** Stan weryfikacji: ikona i tekst w kolorze (nie sam kolor). */
function Status({ ok, children }: { readonly ok: boolean; readonly children: ReactNode }) {
  const Icon = ok ? CircleCheck : TriangleAlert;
  return (
    <span
      className={cn(
        'inline-flex items-start gap-1.5 text-body-sm font-semibold',
        ok ? 'text-success' : 'text-urgent',
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      {children}
    </span>
  );
}

/** Sekcja skrótów: kafelki-linki z ikoną (F-62). */
function LinkSection({
  id,
  title,
  links,
}: {
  readonly id: string;
  readonly title: string;
  readonly links: readonly {
    readonly href: string;
    readonly label: string;
    readonly Icon: LucideIcon;
  }[];
}) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <h2 id={id} className="text-h3">
        {title}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {links.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-title outline-none transition-colors duration-150 hover:border-brand-border hover:bg-accent focus-visible:shadow-focus-ring motion-reduce:transition-none"
            >
              <IconTile tone="brand" size="sm">
                <Icon />
              </IconTile>
              <span className="min-w-0 flex-1">{label}</span>
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
