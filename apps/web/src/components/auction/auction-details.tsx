import type { PublicAuctionDto } from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import { MapPin, Package, Truck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { IconTile } from '@/components/ui/icon-tile';

type CarrierKind = PublicAuctionDto['carriers'][number]['kind'];

/** Kafelek przewoźnika według rodzaju dostawy (bez znaków firm, F-62). */
const CARRIER_TILES: Record<
  CarrierKind,
  { tone: 'warning' | 'info' | 'brand'; Icon: typeof Truck }
> = {
  LOCKER: { tone: 'warning', Icon: Package },
  COURIER: { tone: 'info', Icon: Truck },
  PICKUP_POINT: { tone: 'brand', Icon: MapPin },
};

/**
 * Opis, parametry i dostawa przedmiotu (F-18, wygląd F-62) z cenami dostaw z cennika Biddy
 * (F-24); renderowane na serwerze, trafiają do HTML.
 */
export async function AuctionDetails({ auction }: { readonly auction: PublicAuctionDto }) {
  const t = await getTranslations('auction.details');
  const conditions = await getTranslations('listing.details.conditions');
  const shipping = await getTranslations('listing.shipping');
  const parameters = [
    ...(auction.condition === null
      ? []
      : [{ key: 'condition', label: t('condition'), value: conditions(auction.condition) }]),
    ...(auction.brand === null ? [] : [{ key: 'brand', label: t('brand'), value: auction.brand }]),
    ...auction.attributes,
  ];

  return (
    <div className="space-y-12">
      <section aria-labelledby="auction-description" className="space-y-3">
        <h2 id="auction-description" className="text-h3">
          {t('description')}
        </h2>
        <p className="max-w-[68ch] text-body-lg break-words whitespace-pre-line text-foreground-secondary">
          {auction.description}
        </p>
      </section>

      {parameters.length === 0 ? null : (
        <section aria-labelledby="auction-parameters" className="space-y-2">
          <h2 id="auction-parameters" className="text-h3">
            {t('parameters')}
          </h2>
          <dl className="text-body">
            {parameters.map((parameter) => (
              <div
                key={parameter.key}
                className="flex justify-between gap-6 border-b border-border py-3"
              >
                <dt className="text-foreground-secondary">{parameter.label}</dt>
                <dd className="text-right font-semibold break-words">{parameter.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section aria-labelledby="auction-shipping" className="space-y-4">
        <h2 id="auction-shipping" className="text-h3">
          {t('shipping')}
        </h2>
        <dl className="space-y-4 text-body">
          {auction.packageSize === null ? null : (
            <div className="flex justify-between gap-6 border-b border-border pb-3">
              <dt className="text-foreground-secondary">{t('packageSize')}</dt>
              <dd className="text-right font-semibold">
                {shipping(`sizes.${auction.packageSize}`)}
              </dd>
            </div>
          )}
          <div className="space-y-3">
            <dt className="text-foreground-secondary">{t('carriers')}</dt>
            <dd>
              {auction.carriers.length === 0 ? (
                t('noCarriers')
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {auction.carriers.map((carrier) => {
                    const { tone, Icon } = CARRIER_TILES[carrier.kind];
                    return (
                      <li
                        key={carrier.id}
                        className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
                      >
                        <IconTile tone={tone}>
                          <Icon />
                        </IconTile>
                        <span className="min-w-0 flex-1">
                          <span className="block text-title break-words">{carrier.name}</span>
                          <span className="block text-body-sm text-muted-foreground">
                            {shipping(`kinds.${carrier.kind}`)}
                          </span>
                        </span>
                        <span className="shrink-0 text-title tabular-nums">
                          {formatMoney(money(carrier.price, auction.currency))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </dd>
          </div>
        </dl>
        <p className="text-body-sm text-muted-foreground">{t('carriersHint')}</p>
      </section>
    </div>
  );
}
