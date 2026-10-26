import type { AuctionSearchDto, CategoryDto } from '@biddy/api-client';
import { ArrowRight, ChevronLeft, ChevronRight, Info, SearchX, X } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { TrackOnMount } from '@/analytics/track-on-mount';
import { LiveDot } from '@/components/auction/live-badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { parseBidAmount, shortMoney } from '@/lib/auction/auction-state';
import { categoryUrl } from '@/lib/routes';
import {
  type ActiveFilter,
  MAX_RESULTS,
  type SearchState,
  WEB_SORTS,
  type WebSort,
  activeFilters,
  attributeField,
  filterCount,
  pageWindow,
  searchHref,
  webSort,
  withoutFilters,
} from '@/lib/search/search-params';
import { cn } from '@/lib/utils';

import { AuctionGrid } from './auction-card';
import { FilterPanel } from './filter-panel';

interface SearchViewProps {
  readonly heading: string;
  /** Adres formularza i linków: `/szukaj` albo `/kategoria/…`. */
  readonly basePath: string;
  readonly state: SearchState;
  readonly result: AuctionSearchDto | null;
  readonly category: CategoryDto | undefined;
  /** Kategoria nadrzędna (link „Wróć do”). */
  readonly parent: CategoryDto | undefined;
  /** Na /szukaj kategoria jest parametrem, na stronie kategorii częścią adresu. */
  readonly categoryInQuery: boolean;
  readonly droppedAttributes: boolean;
  /** Ile aukcji z wyników kończy się w ciągu godziny (pasek nad wynikami, F-63). */
  readonly endingSoon: number;
  readonly breadcrumbs?: ReactNode;
}

const PILL =
  'inline-flex h-10 shrink-0 items-center rounded-full border px-4 text-label whitespace-nowrap outline-none transition-colors duration-150 focus-visible:shadow-focus-ring motion-reduce:transition-none';

/**
 * Wyniki wyszukiwania i strona kategorii (F-19, układ F-63): nagłówek z liczbą wyników
 * i pigułkami sortowania, pasek aukcji kończących się w ciągu godziny, filtry w zwykłym
 * formularzu GET (działa bez JavaScriptu), chipy wybranych filtrów, siatka kart i paginacja.
 */
export async function SearchView(props: SearchViewProps) {
  const { state, result, basePath } = props;
  const t = await getTranslations('search');
  const filters = filterCount(state);
  const sort: WebSort = state.sort ?? (result === null ? 'koniec' : webSort(result.sort));
  const sorts = (Object.keys(WEB_SORTS) as WebSort[]).filter(
    (key) => key !== 'trafnosc' || state.q !== '',
  );

  return (
    <div className="mx-auto w-full max-w-page px-4 py-6 md:px-10 md:py-8">
      {props.breadcrumbs}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-h2 break-words md:text-h1">{props.heading}</h1>
          {result === null ? null : (
            <p className="text-body text-foreground-secondary" aria-live="polite">
              {result.total >= MAX_RESULTS
                ? t('countMore', { count: MAX_RESULTS })
                : t('count', { count: result.total })}
            </p>
          )}
        </div>
        {/* Pigułki to linki: sortowanie działa bez JavaScriptu i zostaje w adresie. */}
        <div
          role="group"
          aria-labelledby="search-sort-label"
          className="flex max-w-full items-center gap-2"
        >
          <span id="search-sort-label" className="shrink-0 text-label text-foreground-secondary">
            {t('filters.sort')}:
          </span>
          <ul className="-mr-4 flex gap-2 overflow-x-auto pr-4 pb-1 md:mr-0 md:flex-wrap md:overflow-visible md:pr-0 md:pb-0">
            {sorts.map((key) => (
              <li key={key}>
                <Link
                  href={searchHref(basePath, state, { sort: key, page: 1 })}
                  aria-current={key === sort ? 'true' : undefined}
                  className={cn(
                    PILL,
                    key === sort
                      ? 'border-brand-strong bg-brand-strong text-primary-foreground hover:bg-violet-700'
                      : 'border-border-strong bg-card text-foreground hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700',
                  )}
                >
                  {t(`sorts.${key}`)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {result === null ? null : (
        <TrackOnMount
          event="search_performed"
          properties={{
            hasQuery: state.q !== '',
            category: props.category?.slug ?? '',
            filters,
            sort,
            results: result.total,
          }}
        />
      )}

      {props.endingSoon > 0 ? (
        <Link
          href={`${searchHref(basePath, state, { sort: 'koniec', page: 1 })}#wyniki`}
          className="mt-6 flex items-center gap-3.5 rounded-xl bg-primary px-4.5 py-3.5 text-primary-foreground outline-none transition-colors duration-150 hover:bg-primary-hover focus-visible:shadow-focus-ring motion-reduce:transition-none"
        >
          <LiveDot className="text-live-dot" />
          <span className="flex-1 text-body font-semibold">
            {t.rich('endingSoon', {
              count: props.endingSoon,
              strong: (chunks) => <strong className="font-extrabold">{chunks}</strong>,
            })}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-label font-bold text-violet-300">
            {t('endingSoonShow')}
            <ArrowRight aria-hidden className="size-4" />
          </span>
        </Link>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-8">
        <div>
          <FilterPanel
            summary={
              filters === 0 ? t('filters.title') : t('filters.titleCount', { count: filters })
            }
          >
            <Filters {...props} />
          </FilterPanel>
        </div>

        <section
          id="wyniki"
          aria-labelledby="search-results"
          className="min-w-0 scroll-mt-24 space-y-6"
        >
          <h2 id="search-results" className="sr-only">
            {t('results')}
          </h2>
          <FilterChips {...props} />
          {props.droppedAttributes ? (
            <p role="status" className="rounded-lg bg-info-soft px-4 py-3 text-body-sm">
              {t('droppedAttributes')}
            </p>
          ) : null}
          {result === null ? (
            <p role="alert" className="rounded-lg bg-destructive-soft px-4 py-3 text-body-sm">
              {t('unavailable')}
            </p>
          ) : result.items.length === 0 ? (
            filters === 0 && state.q === '' ? (
              <EmptyState icon={SearchX} headingLevel="h3" title={t('emptyNoFilters')} />
            ) : (
              <EmptyState
                icon={SearchX}
                headingLevel="h3"
                title={t('empty')}
                action={
                  filters === 0 ? undefined : (
                    <Button asChild variant="outline">
                      <Link href={searchHref(basePath, withoutFilters(state))}>
                        {t('filters.clear')}
                      </Link>
                    </Button>
                  )
                }
              >
                {t('emptyHint')}
              </EmptyState>
            )
          ) : (
            <>
              <AuctionGrid auctions={result.items} priorityCount={4} />
              <Pagination basePath={basePath} state={state} result={result} />
            </>
          )}
          <details className="group rounded-xl border border-border bg-canvas px-5 py-4">
            <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-xs text-label text-foreground outline-none focus-visible:shadow-focus-ring [&::-webkit-details-marker]:hidden">
              <Info aria-hidden className="size-4.5 shrink-0 text-foreground-secondary" />
              {t('ranking.title')}
            </summary>
            <div className="mt-2.5 space-y-2 text-body-sm text-foreground-secondary">
              <p>{t('ranking.relevance')}</p>
              <p>{t('ranking.sort')}</p>
              <p>{t('ranking.noPaid')}</p>
            </div>
          </details>
        </section>
      </div>
    </div>
  );
}

/** Chipy wybranych filtrów z linkiem usunięcia (bez JavaScriptu: to zwykłe linki). */
async function FilterChips({ state, result, basePath }: SearchViewProps) {
  const t = await getTranslations('search');
  const conditions = await getTranslations('search.card.conditions');
  const active = activeFilters(state);
  if (active.length === 0) {
    return null;
  }
  const facets = result?.facets.attributes ?? [];
  const attribute = (key: string) => facets.find((facet) => facet.key === key);
  const money = (text: string) => {
    const amount = parseBidAmount(text);
    return typeof amount === 'number' ? shortMoney(amount) : text;
  };
  const label = (filter: ActiveFilter): string => {
    switch (filter.kind) {
      case 'condition':
        return filter.values.map((value) => conditions(value)).join(', ');
      case 'price':
        return filter.from !== '' && filter.to !== ''
          ? t('chips.priceRange', { from: money(filter.from), to: money(filter.to) })
          : filter.from !== ''
            ? t('chips.priceFrom', { price: money(filter.from) })
            : t('chips.priceTo', { price: money(filter.to) });
      case 'values': {
        const facet = attribute(filter.key);
        const values = filter.values.map(
          (value) => facet?.options.find((option) => option.value === value)?.label ?? value,
        );
        return t('chips.values', { name: facet?.label ?? filter.key, values: values.join(', ') });
      }
      case 'range': {
        const facet = attribute(filter.key);
        const name =
          facet === undefined
            ? filter.key
            : facet.unit === null
              ? facet.label
              : `${facet.label} (${facet.unit})`;
        return filter.from !== '' && filter.to !== ''
          ? t('chips.range', { name, from: filter.from, to: filter.to })
          : filter.from !== ''
            ? t('chips.rangeFrom', { name, from: filter.from })
            : t('chips.rangeTo', { name, to: filter.to });
      }
    }
  };
  return (
    <ul aria-label={t('activeFilters')} className="flex flex-wrap items-center gap-2">
      {active.map((filter) => {
        const text = label(filter);
        return (
          <li
            key={
              filter.kind === 'values' || filter.kind === 'range'
                ? `${filter.kind}-${filter.key}`
                : filter.kind
            }
            className="inline-flex h-8 max-w-full items-center gap-1 rounded-full border border-violet-200 bg-violet-50 pr-1 pl-3 text-body-sm font-bold text-violet-700"
          >
            <span className="truncate">{text}</span>
            <Link
              href={searchHref(basePath, filter.without)}
              aria-label={t('removeFilter', { name: text })}
              className="grid size-6 shrink-0 place-items-center rounded-full outline-none hover:bg-violet-100 focus-visible:shadow-focus-ring"
            >
              <X aria-hidden className="size-3.5" />
            </Link>
          </li>
        );
      })}
      {active.length > 1 ? (
        <li>
          <Link
            href={searchHref(basePath, withoutFilters(state))}
            className="rounded-xs px-1 text-label text-link underline-offset-3 outline-none hover:text-link-hover hover:underline focus-visible:shadow-focus-ring"
          >
            {t('filters.clear')}
          </Link>
        </li>
      ) : null}
    </ul>
  );
}

const LEGEND = 'mb-2 text-overline text-muted-foreground uppercase';
/** Legenda jako zwykły wiersz (float), a nie na krawędzi fieldsetu: odstępy jak w nagłówkach sekcji. */
const FIELDSET_LEGEND = `${LEGEND} float-left w-full`;

async function Filters({
  state,
  result,
  basePath,
  category,
  parent,
  categoryInQuery,
}: SearchViewProps) {
  const t = await getTranslations('search');
  const conditionLabels = await getTranslations('listing.details.conditions');
  const facets = result?.facets;
  const categoryHref = (path: readonly string[] | undefined) =>
    categoryInQuery
      ? searchHref(basePath, withoutFilters(state), { category: path?.join('/') ?? '' })
      : path === undefined
        ? searchHref('/szukaj', withoutFilters({ ...state, category: '' }))
        : searchHref(categoryUrl(path), withoutFilters({ ...state, category: '' }));
  const categoryLink =
    'flex justify-between gap-2 rounded-md px-2.5 py-1.5 text-body-sm text-ink-700 outline-none hover:bg-muted hover:text-foreground focus-visible:shadow-focus-ring';

  return (
    <form action={basePath} method="get">
      {state.q === '' ? null : <input type="hidden" name="q" value={state.q} />}
      {categoryInQuery && state.category !== '' ? (
        <input type="hidden" name="kategoria" value={state.category} />
      ) : null}
      {/* Sortowanie wybiera się pigułkami nad wynikami; filtry go nie zmieniają. */}
      {state.sort === undefined ? null : <input type="hidden" name="sort" value={state.sort} />}

      <div className="divide-y divide-border [&>*]:py-5 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
        {(facets?.categories.length ?? 0) > 0 || category !== undefined ? (
          <nav aria-labelledby="filter-categories">
            <h3 id="filter-categories" className={LEGEND}>
              {t('filters.categories')}
            </h3>
            <ul className="-mx-2.5 flex flex-col">
              {category === undefined ? null : (
                <li>
                  <Link href={categoryHref(parent?.path)} className={cn(categoryLink, 'font-bold')}>
                    {parent === undefined
                      ? t('allCategories')
                      : t('filters.parent', { name: parent.name })}
                  </Link>
                </li>
              )}
              {facets?.categories.map((entry) => (
                <li key={entry.id}>
                  <Link href={categoryHref(entry.path)} className={categoryLink}>
                    {entry.name}
                    <span className="text-muted-foreground tabular-nums">
                      {t('filters.count', { count: entry.count })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <CheckboxGroup
          legend={t('filters.condition')}
          name="stan"
          options={mergeSelected(
            facets?.conditions.map((entry) => ({
              value: entry.value,
              label: conditionLabels(entry.value),
              count: entry.count,
            })) ?? [],
            state.conditions,
            (value) => conditionLabels(value as (typeof state.conditions)[number]),
          )}
          selected={state.conditions}
          countLabel={(count) => t('filters.count', { count })}
        />

        <RangeFields
          legend={t('filters.price')}
          names={['cena_od', 'cena_do']}
          values={[state.priceFrom, state.priceTo]}
          placeholders={
            facets?.price === null || facets?.price === undefined
              ? [t('filters.from'), t('filters.to')]
              : [shortMoney(facets.price.min), shortMoney(facets.price.max)]
          }
          labels={[
            t('filters.fromLabel', { name: t('filters.price') }),
            t('filters.toLabel', { name: t('filters.price') }),
          ]}
        />

        {facets?.attributes.map((attribute) =>
          attribute.type === 'number' ? (
            <RangeFields
              key={attribute.key}
              legend={
                attribute.unit === null ? attribute.label : `${attribute.label} (${attribute.unit})`
              }
              names={[attributeField(attribute.key, 'od'), attributeField(attribute.key, 'do')]}
              values={[
                state.ranges[attribute.key]?.from ?? '',
                state.ranges[attribute.key]?.to ?? '',
              ]}
              placeholders={
                attribute.range === null
                  ? [t('filters.from'), t('filters.to')]
                  : [String(attribute.range.min), String(attribute.range.max)]
              }
              labels={[
                t('filters.fromLabel', { name: attribute.label }),
                t('filters.toLabel', { name: attribute.label }),
              ]}
            />
          ) : (
            <CheckboxGroup
              key={attribute.key}
              legend={attribute.label}
              name={attributeField(attribute.key)}
              options={mergeSelected(
                attribute.options,
                state.values[attribute.key] ?? [],
                (value) => value,
              )}
              selected={state.values[attribute.key] ?? []}
              countLabel={(count) => t('filters.count', { count })}
            />
          ),
        )}

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" className="flex-1">
            {t('filters.apply')}
          </Button>
          <Link
            href={searchHref(basePath, withoutFilters({ ...state, sort: undefined }))}
            className="rounded-xs text-label text-link underline-offset-3 outline-none hover:text-link-hover hover:underline focus-visible:shadow-focus-ring"
          >
            {t('filters.clear')}
          </Link>
        </div>
      </div>
    </form>
  );
}

interface Option {
  readonly value: string;
  readonly label: string;
  readonly count: number;
}

/** Wybrane opcje zostają na liście, nawet gdy przy obecnych filtrach mają 0 aukcji. */
function mergeSelected(
  options: readonly Option[],
  selected: readonly string[],
  label: (value: string) => string,
): Option[] {
  const missing = selected
    .filter((value) => !options.some((option) => option.value === value))
    .map((value) => ({ value, label: label(value), count: 0 }));
  return [...options, ...missing];
}

function CheckboxGroup({
  legend,
  name,
  options,
  selected,
  countLabel,
}: {
  readonly legend: string;
  readonly name: string;
  readonly options: readonly Option[];
  readonly selected: readonly string[];
  readonly countLabel: (count: number) => string;
}) {
  if (options.length === 0) {
    return null;
  }
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className={FIELDSET_LEGEND}>{legend}</legend>
      {options.map((option) => {
        const id = `${name}-${option.value}`;
        return (
          <div key={option.value} className="flex min-h-8 items-center gap-2.5 text-body">
            <input
              id={id}
              type="checkbox"
              name={name}
              value={option.value}
              defaultChecked={selected.includes(option.value)}
              className="size-4.5 shrink-0 accent-brand-strong"
            />
            <label htmlFor={id}>
              {option.label}{' '}
              {option.count > 0 ? (
                <span className="text-muted-foreground tabular-nums">
                  {countLabel(option.count)}
                </span>
              ) : null}
            </label>
          </div>
        );
      })}
    </fieldset>
  );
}

function RangeFields({
  legend,
  names,
  values,
  placeholders,
  labels,
}: {
  readonly legend: string;
  readonly names: readonly [string, string];
  readonly values: readonly [string, string];
  readonly placeholders: readonly [string, string];
  readonly labels: readonly [string, string];
}) {
  return (
    <fieldset className="flex flex-col">
      <legend className={FIELDSET_LEGEND}>{legend}</legend>
      <div className="flex items-center gap-2">
        {([0, 1] as const).map((index) => (
          <span key={names[index]} className="contents">
            {index === 1 ? (
              <span aria-hidden className="text-muted-foreground">
                –
              </span>
            ) : null}
            <Input
              name={names[index]}
              defaultValue={values[index]}
              placeholder={placeholders[index]}
              aria-label={labels[index]}
              inputMode="decimal"
              autoComplete="off"
              className="h-11 tabular-nums"
            />
          </span>
        ))}
      </div>
    </fieldset>
  );
}

async function Pagination({
  basePath,
  state,
  result,
}: {
  readonly basePath: string;
  readonly state: SearchState;
  readonly result: AuctionSearchDto;
}) {
  const t = await getTranslations('search.pagination');
  const total = result.totalPages;
  if (total <= 1) {
    return null;
  }
  const current = Math.min(state.page, total);
  const pages = pageWindow(current, total);
  const link =
    'inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-md px-3 text-label tabular-nums outline-none transition-colors duration-150 focus-visible:shadow-focus-ring motion-reduce:transition-none';
  const outline = 'border border-border-strong bg-card hover:bg-muted';
  return (
    <nav aria-label={t('label')} className="flex justify-center pt-4">
      <ul className="flex flex-wrap items-center justify-center gap-1.5">
        {current > 1 ? (
          <li>
            <Link
              href={searchHref(basePath, state, { page: current - 1 })}
              rel="prev"
              className={cn(link, outline)}
            >
              <ChevronLeft aria-hidden className="size-4" />
              <span className="max-sm:sr-only">{t('previous')}</span>
            </Link>
          </li>
        ) : null}
        {pages.map((page, index) =>
          page === null ? (
            <li key={`gap-${String(index)}`} aria-hidden className="px-1.5 text-muted-foreground">
              …
            </li>
          ) : (
            <li key={page}>
              <Link
                href={searchHref(basePath, state, { page })}
                aria-label={t('page', { page })}
                aria-current={page === current ? 'page' : undefined}
                className={cn(
                  link,
                  page === current
                    ? 'bg-primary text-primary-foreground hover:bg-primary-hover'
                    : 'hover:bg-muted',
                )}
              >
                {page}
              </Link>
            </li>
          ),
        )}
        {current < total ? (
          <li>
            <Link
              href={searchHref(basePath, state, { page: current + 1 })}
              rel="next"
              className={cn(link, outline)}
            >
              <span className="max-sm:sr-only">{t('next')}</span>
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
