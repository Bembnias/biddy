'use client';

// Historia sporu (F-28): kto, co i kiedy, z notatką, kwotą i miniaturami zdjęć (najstarsze na
// górze). Zdjęcia są prywatne: wydaje je API stronom sporu, więc adresy prowadzą do API.
import type { DisputeDto } from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { useId } from 'react';

export function DisputeHistory({ dispute }: { readonly dispute: DisputeDto }) {
  const t = useTranslations('dispute.history');
  const format = useFormatter();
  const titleId = useId();
  const zl = (amount: number) =>
    formatMoney(money(amount, dispute.currency), { trailingZeroDisplay: 'stripIfInteger' });
  return (
    <section
      aria-labelledby={titleId}
      className="space-y-4 rounded-2xl border border-border bg-card p-5.5 sm:p-7"
    >
      <h2 id={titleId} className="text-h3">
        {t('title')}
      </h2>
      <ol className="space-y-4 border-l-2 border-ink-200 pl-4">
        {dispute.events.map((event) => (
          <li key={event.id} className="space-y-1.5">
            <p className="text-body-sm">
              <span className="font-semibold">
                {t(`types.${event.type}`, {
                  amount: event.amount === null ? '' : zl(event.amount),
                })}
              </span>
              <span className="text-muted-foreground">
                {' · '}
                {event.actor === dispute.role ? t('you') : t(`actors.${event.actor}`)}
                {' · '}
                {format.dateTime(new Date(event.createdAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </span>
            </p>
            {event.note === null ? null : (
              <p className="text-body break-words whitespace-pre-line text-foreground-secondary">
                {event.note}
              </p>
            )}
            {event.photos.length === 0 ? null : (
              <ul className="flex flex-wrap gap-2">
                {event.photos.map((photo, index) => (
                  <li key={photo.id}>
                    <a
                      href={photo.largeUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-lg outline-none focus-visible:shadow-focus-ring"
                    >
                      {/* Zdjęcie prywatne z API (sesja), bez optymalizacji Next. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.thumbUrl}
                        alt={t('photo', { position: index + 1 })}
                        className="size-20 rounded-lg bg-muted object-cover"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
