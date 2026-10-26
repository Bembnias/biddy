import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { routes } from '@/lib/routes';

import { BottomNavSpacer } from './bottom-nav';
import { Logo } from './logo';

interface FooterGroup {
  readonly title: string;
  readonly links: readonly { readonly href: string; readonly label: string }[];
}

export function SiteFooter({ year = new Date().getFullYear() }: { readonly year?: number }) {
  const t = useTranslations('footer');
  const groups: FooterGroup[] = [
    {
      title: t('company.title'),
      links: [
        { href: routes.about, label: t('company.about') },
        { href: routes.contact, label: t('company.contact') },
      ],
    },
    {
      title: t('help.title'),
      links: [
        { href: routes.howBiddingWorks, label: t('help.howBiddingWorks') },
        { href: routes.buyerProtection, label: t('help.buyerProtection') },
        { href: routes.helpCenter, label: t('help.helpCenter') },
      ],
    },
    {
      title: t('rules.title'),
      links: [
        { href: routes.terms, label: t('rules.terms') },
        { href: routes.privacy, label: t('rules.privacy') },
        { href: routes.prohibitedItems, label: t('rules.prohibitedItems') },
      ],
    },
  ];
  return (
    // Granatowa stopka (F-63) domyka stronę jak ciemny pas „Kończą się wkrótce”.
    <footer aria-label={t('label')} className="bg-primary text-ink-300">
      <div className="mx-auto grid max-w-page gap-8 px-4 py-12 sm:grid-cols-2 md:px-10 lg:grid-cols-4">
        <div className="flex flex-col items-start gap-3">
          <Logo />
          <p className="max-w-[32ch] text-body-sm">{t('tagline')}</p>
        </div>
        {groups.map((group) => (
          <nav key={group.title} aria-label={group.title}>
            <h2 className="text-label font-bold text-primary-foreground">{group.title}</h2>
            <ul className="mt-4 space-y-2.5">
              {group.links.map((link) => (
                <li key={link.href}>
                  {/* Strony informacyjne: bez wstępnego pobierania przy każdym wejściu na stronę. */}
                  <Link
                    href={link.href}
                    prefetch={false}
                    className="rounded-xs text-body-sm text-ink-300 underline-offset-3 outline-none hover:text-primary-foreground hover:underline focus-visible:shadow-focus-ring"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="mx-auto max-w-page px-4 md:px-10">
        <p className="border-t border-ink-800 py-6 text-caption text-ink-400">
          {t('copyright', { year })}
        </p>
      </div>
      <BottomNavSpacer />
    </footer>
  );
}
