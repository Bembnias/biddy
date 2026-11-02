import Image from 'next/image';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import logo from '@/assets/brand/biddy-logo.png';
import { cn } from '@/lib/utils';
import { routes } from '@/lib/routes';

/**
 * Logo Biddy (napis w gradiencie marki) jako link do strony głównej. Plik to PNG 160 × 90 px,
 * ostry do ok. 45 px wysokości; wektor dojdzie z eksportem z Figmy (F-62).
 */
export function Logo({ className }: { readonly className?: string }) {
  const t = useTranslations('layout');
  return (
    <Link
      href={routes.home}
      aria-label={t('home')}
      className={cn(
        'inline-flex shrink-0 rounded-sm outline-none focus-visible:shadow-focus-ring',
        className,
      )}
    >
      <Image src={logo} alt="" width={160} height={90} priority className="h-8 w-auto md:h-9" />
    </Link>
  );
}
