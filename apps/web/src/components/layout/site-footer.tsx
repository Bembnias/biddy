import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { routes } from '@/lib/routes';

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
    <footer aria-label={t('label')} className="border-t border-border bg-muted">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3 md:px-6">
        {groups.map((group) => (
          <nav key={group.title} aria-label={group.title}>
            <h2 className="text-sm font-semibold text-foreground">{group.title}</h2>
            <ul className="mt-3 space-y-2">
              {group.links.map((link) => (
                <li key={link.href}>
                  {/* Strony informacyjne: bez wstępnego pobierania przy każdym wejściu na stronę. */}
                  <Link
                    href={link.href}
                    prefetch={false}
                    className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <p className="mx-auto max-w-6xl px-4 pb-8 text-xs text-muted-foreground md:px-6">
        {t('copyright', { year })}
      </p>
    </footer>
  );
}
