import { ArrowRight, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { routes } from '@/lib/routes';

/**
 * Wyszukiwarka w nagłówku w kształcie pigułki (F-62): zwykły formularz GET na /szukaj (działa
 * bez JavaScriptu); wyniki i filtry: F-19. Podpowiedzi przy wpisywaniu dojdą w v1.
 */
export function SearchForm({ className }: { readonly className?: string }) {
  const t = useTranslations('layout.search');
  return (
    <form
      role="search"
      action={routes.search}
      method="get"
      className={cn('relative flex items-center', className)}
    >
      <label htmlFor="site-search" className="sr-only">
        {t('label')}
      </label>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-4 size-4.5 text-muted-foreground"
      />
      <Input
        id="site-search"
        type="search"
        name="q"
        placeholder={t('placeholder')}
        autoComplete="off"
        enterKeyHint="search"
        className="h-10 rounded-full border-transparent bg-muted pr-12 pl-11 text-body hover:border-border-strong focus-visible:bg-card"
      />
      <Button
        type="submit"
        variant="ghost"
        size="icon-sm"
        aria-label={t('submit')}
        className="absolute right-1 text-foreground-secondary hover:bg-ink-200"
      >
        <ArrowRight aria-hidden />
      </Button>
    </form>
  );
}
