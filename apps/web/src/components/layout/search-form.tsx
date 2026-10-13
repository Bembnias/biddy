import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { routes } from '@/lib/routes';

/**
 * Wyszukiwarka w nagłówku: zwykły formularz GET na /szukaj (działa bez JavaScriptu). Wyniki
 * i podpowiedzi powstaną w F-19.
 */
export function SearchForm({ className }: { readonly className?: string }) {
  const t = useTranslations('layout.search');
  return (
    <form role="search" action={routes.search} method="get" className={className}>
      <div className="flex w-full items-center gap-2">
        <label htmlFor="site-search" className="sr-only">
          {t('label')}
        </label>
        <Input
          id="site-search"
          type="search"
          name="q"
          placeholder={t('placeholder')}
          autoComplete="off"
          enterKeyHint="search"
          className="h-10"
        />
        <Button type="submit" size="icon-lg" aria-label={t('submit')}>
          <Search aria-hidden />
        </Button>
      </div>
    </form>
  );
}
