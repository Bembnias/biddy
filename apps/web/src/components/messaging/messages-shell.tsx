import { MessagesSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

import { ConversationList } from './conversation-list';

/**
 * Układ wiadomości (F-29): od 1024 px lista rozmów (360 px) i rozmowa obok w jednej karcie
 * o wysokości okna; węziej lista albo sama rozmowa (`activeId`). Przewija się lista rozmów
 * i lista wiadomości, a nie cała strona.
 */
export function MessagesShell({
  activeId,
  children,
}: {
  readonly activeId?: string;
  readonly children?: ReactNode;
}) {
  const t = useTranslations('messaging');
  const open = activeId !== undefined;
  const Heading = open ? 'h2' : 'h1';
  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-page px-4 py-5 md:px-6 md:py-8">
        <div
          className={cn(
            'grid overflow-hidden rounded-2xl border border-border bg-card lg:h-[calc(100dvh-8rem)] lg:min-h-[32rem] lg:grid-cols-[22.5rem_minmax(0,1fr)]',
            open && 'h-[calc(100dvh-14.5rem)] min-h-[26rem] md:h-[calc(100dvh-8rem)]',
          )}
        >
          <section
            aria-labelledby="messages-title"
            className={cn(
              'flex min-h-0 min-w-0 flex-col lg:border-r lg:border-border',
              open && 'max-lg:hidden',
            )}
          >
            <Heading id="messages-title" className="border-b border-border px-4 py-4 text-h3">
              {t('title')}
            </Heading>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ConversationList {...(activeId === undefined ? {} : { activeId })} />
            </div>
          </section>
          <div className={cn('min-h-0 min-w-0', !open && 'max-lg:hidden')}>
            {children ?? (
              <div className="grid h-full place-items-center p-6">
                <EmptyState
                  icon={MessagesSquare}
                  title={t('list.pick')}
                  headingLevel="h2"
                  className="border-0"
                >
                  {t('list.pickText')}
                </EmptyState>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
