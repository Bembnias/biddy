import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

/**
 * Pulsująca kropka (F-63): jedyny element, który animuje się bez przerwy (`animate-ping`, raz na
 * sekundę); przy ograniczonym ruchu zostaje sama kropka.
 */
export function LiveDot({ className }: { readonly className?: string }) {
  return (
    <span aria-hidden className={cn('relative flex size-2 shrink-0', className)}>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-75" />
      <span className="relative inline-flex size-2 rounded-full bg-current" />
    </span>
  );
}

/** Plakietka „LIVE” dla aukcji w ostatniej godzinie (`isLiveAuction`). */
export function LiveBadge({ className }: { readonly className?: string }) {
  const t = useTranslations('auction.live');
  return (
    <span
      className={cn(
        'inline-flex h-6.5 items-center gap-1.5 rounded-full bg-live pr-2.5 pl-2 text-badge text-primary-foreground uppercase',
        className,
      )}
    >
      <LiveDot />
      {t('badge')}
    </span>
  );
}
