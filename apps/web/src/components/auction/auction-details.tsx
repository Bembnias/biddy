import type { PublicAuctionDto } from '@biddy/api-client';
import { getTranslations } from 'next-intl/server';

/** Opis, parametry i dostawa przedmiotu (F-18); renderowane na serwerze, trafiają do HTML. */
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
    <div className="space-y-8">
      <section aria-labelledby="auction-description">
        <h2 id="auction-description" className="text-xl font-semibold">
          {t('description')}
        </h2>
        <p className="mt-3 break-words whitespace-pre-line">{auction.description}</p>
      </section>

      {parameters.length === 0 ? null : (
        <section aria-labelledby="auction-parameters">
          <h2 id="auction-parameters" className="text-xl font-semibold">
            {t('parameters')}
          </h2>
          <dl className="mt-3 grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-6 gap-y-2">
            {parameters.map((parameter) => (
              <div key={parameter.key} className="contents">
                <dt className="text-muted-foreground">{parameter.label}</dt>
                <dd>{parameter.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section aria-labelledby="auction-shipping">
        <h2 id="auction-shipping" className="text-xl font-semibold">
          {t('shipping')}
        </h2>
        <dl className="mt-3 grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-6 gap-y-2">
          {auction.packageSize === null ? null : (
            <>
              <dt className="text-muted-foreground">{t('packageSize')}</dt>
              <dd>{shipping(`sizes.${auction.packageSize}`)}</dd>
            </>
          )}
          <dt className="text-muted-foreground">{t('carriers')}</dt>
          <dd>
            {auction.carriers.length === 0 ? (
              t('noCarriers')
            ) : (
              <ul>
                {auction.carriers.map((carrier) => (
                  <li key={carrier.id}>
                    {carrier.name}{' '}
                    <span className="text-muted-foreground">
                      ({shipping(`kinds.${carrier.kind}`)})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </dl>
        <p className="mt-2 text-sm text-muted-foreground">{t('carriersHint')}</p>
      </section>
    </div>
  );
}
