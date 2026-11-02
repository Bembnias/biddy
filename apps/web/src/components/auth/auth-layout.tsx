import { formatMoney, money } from '@biddy/shared';
import { BadgePercent, Gavel, ShieldCheck, TrendingUp, Watch } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import type { ComponentProps, ReactNode } from 'react';

import logoWhite from '@/assets/brand/biddy-logo-white.png';
import { LiveBadge } from '@/components/auction/live-badge';
import { IconTile } from '@/components/ui/icon-tile';
import { cn } from '@/lib/utils';

/**
 * Logowanie i rejestracja (F-62, układ F-63): od 1024 px panel marki z lewej, formularz z prawej;
 * węziej sam formularz. Tytuł i opis nad formularzem, wyrównane do lewej.
 */
export function AuthSplitPage({
  variant,
  title,
  lead,
  children,
}: {
  readonly variant: 'signIn' | 'signUp';
  readonly title: string;
  readonly lead?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="grid lg:min-h-[calc(100dvh-4rem)] lg:grid-cols-2">
      <BrandPanel variant={variant} />
      <div className="flex justify-center px-4 py-10 sm:py-14 lg:items-center">
        <div className="w-full max-w-auth space-y-7">
          <div className="space-y-1.5">
            <h1 className="text-h2 md:text-h1">{title}</h1>
            {lead === undefined ? null : (
              <p className="text-body text-foreground-secondary">{lead}</p>
            )}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Pozostałe strony kont (F-63: hasło, e-mail, regulamin, wypisanie, telefon): karta na środku
 * tła `canvas` z kafelkiem ikony nad tytułem. `center` dla wyników akcji (wysłano, potwierdzono).
 * `above` i `below` to treść poza kartą, np. postęp weryfikacji i przypis.
 */
export function AuthCard({
  icon,
  tone = 'brand',
  title,
  lead,
  center = false,
  above,
  below,
  children,
}: {
  readonly icon?: ReactNode;
  readonly tone?: ComponentProps<typeof IconTile>['tone'];
  readonly title: string;
  readonly lead?: ReactNode;
  readonly center?: boolean;
  readonly above?: ReactNode;
  readonly below?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <div className="bg-canvas">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-5 px-4 py-10 sm:py-16">
        {above}
        <section
          aria-labelledby="auth-card-title"
          className={cn(
            'flex flex-col gap-5 rounded-2xl border border-border bg-card p-5 shadow-md sm:p-8',
            center && 'items-center text-center',
          )}
        >
          {icon === undefined ? null : (
            <IconTile
              tone={tone}
              size="lg"
              className={cn(center && 'size-18 rounded-full [&>svg]:size-8')}
            >
              {icon}
            </IconTile>
          )}
          <div className="space-y-1.5">
            <h1 id="auth-card-title" className="text-h2">
              {title}
            </h1>
            {lead === undefined ? null : (
              <div className="text-body text-foreground-secondary">{lead}</div>
            )}
          </div>
          {children === undefined ? null : <div className="w-full">{children}</div>}
        </section>
        {below === undefined ? null : (
          <p className="text-center text-body-sm text-muted-foreground">{below}</p>
        )}
      </div>
    </div>
  );
}

const SIGN_IN_POINTS = [
  { key: 'protection', Icon: ShieldCheck },
  { key: 'proxy', Icon: TrendingUp },
  { key: 'zeroFee', Icon: BadgePercent },
] as const;

const SIGN_UP_STEPS = ['account', 'email', 'phone'] as const;

/**
 * Panel marki (F-63): gradient `panel-from` → `panel-to` z dwoma kołami w tle. Przy logowaniu
 * przykładowa karta aukcji z LIVE i trzy korzyści, przy rejestracji droga do pierwszej oferty.
 * Duże hasło stoi na jaśniejszej górze (biały tekst ≥ 24 px), drobniejszy tekst niżej.
 */
function BrandPanel({ variant }: { readonly variant: 'signIn' | 'signUp' }) {
  const t = useTranslations('auth.panel');
  return (
    <aside
      aria-label="Biddy"
      className="relative hidden flex-col justify-between gap-10 overflow-hidden bg-linear-160 from-panel-from to-panel-to px-14 py-12 text-primary-foreground lg:flex"
    >
      <span
        aria-hidden
        className="absolute -top-36 -right-36 size-105 rounded-full border-56 border-white/8"
      />
      <span
        aria-hidden
        className="absolute -bottom-30 -left-20 size-75 rounded-full border-40 border-white/6"
      />
      <Image
        src={logoWhite}
        alt=""
        width={160}
        height={90}
        className="relative h-11 w-auto self-start"
      />
      <div className="relative flex max-w-130 flex-col gap-8">
        <p className="text-h1">{variant === 'signIn' ? t('tagline') : t('signUpTagline')}</p>
        {variant === 'signIn' ? <SignInPanel /> : <SignUpPanel />}
      </div>
      <p className="relative max-w-115 text-body-sm text-violet-100">
        {variant === 'signIn' ? t('footnote') : t('signUpFootnote')}
      </p>
    </aside>
  );
}

function SignInPanel() {
  const t = useTranslations('auth.panel');
  return (
    <>
      {/* Przykład tego, jak wygląda aukcja na żywo: dekoracja bez znaczenia dla czytnika. */}
      <div
        aria-hidden
        className="flex max-w-100 -rotate-2 items-center gap-3.5 rounded-2xl bg-card p-3 text-foreground shadow-lg"
      >
        <IconTile tone="brand" size="lg" className="size-19 rounded-xl [&>svg]:size-9">
          <Watch />
        </IconTile>
        <span className="flex flex-1 flex-col items-start gap-0.5">
          <LiveBadge />
          <span className="text-label">{t('exampleTitle')}</span>
          <span className="flex items-center gap-2.5">
            <span className="text-price-lg tabular-nums">
              {formatMoney(money(32_000), { trailingZeroDisplay: 'stripIfInteger' })}
            </span>
            <span className="text-timer text-urgent tabular-nums">04:12</span>
          </span>
        </span>
      </div>
      <ul className="space-y-4">
        {SIGN_IN_POINTS.map(({ key, Icon }) => (
          <li key={key} className="flex items-start gap-3.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-white/16">
              <Icon aria-hidden className="size-5" />
            </span>
            <span className="text-body-lg font-semibold">{t(key)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function SignUpPanel() {
  const t = useTranslations('auth.panel.steps');
  return (
    <ol>
      {SIGN_UP_STEPS.map((step, index) => (
        <li key={step} className="flex gap-4">
          <span className="flex flex-col items-center">
            <span
              aria-hidden
              className={cn(
                'grid size-10 place-items-center rounded-full text-title font-extrabold',
                index === 0 ? 'bg-card text-violet-700' : 'border-2 border-white/60',
              )}
            >
              {index + 1}
            </span>
            <span aria-hidden className="min-h-5 w-0.5 flex-1 bg-white/30" />
          </span>
          <span
            className={cn('pt-2 pb-5 text-label-lg', index === 0 ? 'font-bold' : 'font-semibold')}
          >
            {t(step)}
          </span>
        </li>
      ))}
      <li className="flex gap-4">
        <span aria-hidden className="grid size-10 place-items-center rounded-full bg-pink-600">
          <Gavel className="size-5" />
        </span>
        <span className="py-2 text-label-lg font-extrabold">{t('bid')}</span>
      </li>
    </ol>
  );
}
