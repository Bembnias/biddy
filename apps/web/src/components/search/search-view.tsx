import type { AuctionSearchDto, CategoryDto } from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { TrackOnMount } from '@/analytics/track-on-mount';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { categoryUrl } from '@/lib/routes';
import {
  MAX_RESULTS,
  type SearchState,
  WEB_SORTS,
  type WebSort,
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
  readonly breadcrumbs?: ReactNode;
}

const short = (amount: number) =>
  formatMoney(money(amount), { trailingZeroDisplay: 'stripIfInteger' });

/**
 * Wyniki wyszukiwania i strona kategorii (F-19): nagłówek z liczbą wyników, filtry w zwykłym
 * formularzu GET (działa bez JavaScriptu), siatka kart, paginacja i opis kolejności wyników.
 */
export async function SearchView(props: SearchViewProps) {
  const { state, result, basePath } = props;
  const t = await getTranslations('search');
  const filters = filterCount(state);
  const sort: WebSort = state.sort ?? (result === null ? 'koniec' : webSort(result.sort));

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-10">
      {props.breadcrumbs}
      <h1 className="text-2xl font-bold break-words md:text-3xl">{props.heading}</h1>
      {result === null ? null : (
        <p className="mt-1 text-muted-foreground" aria-live="polite">
          {result.total >= MAX_RESULTS
            ? t('countMore', { count: MAX_RESULTS })
            : t('count', { count: result.total })}
        </p>
      )}
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

      <div className="mt-6 grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div>
          <FilterPanel
            summary={
              filters === 0 ? t('filters.title') : t('filters.titleCount', { count: filters })
            }
          >
            <Filters {...props} sort={sort} />
          </FilterPanel>
        </div>

        <section aria-labelledby="search-results" className="min-w-0 space-y-6">
          <h2 id="search-results" className="sr-only">
            {t('results')}
          </h2>
          {props.droppedAttributes ? (
            <p role="status" className="rounded-md bg-muted p-3 text-sm">
              {t('droppedAttributes')}
            </p>
          ) : null}
          {result === null ? (
            <p role="alert" className="rounded-md border border-destructive/40 p-4 text-sm">
              {t('unavailable')}
            </p>
          ) : result.items.length === 0 ? (
            <div className="space-y-3 rounded-lg border border-dashed border-border p-8 text-center">
              <p>{filters === 0 && state.q === '' ? t('emptyNoFilters') : t('empty')}</p>
              {filters === 0 ? null : (
                <Link
                  href={searchHref(basePath, withoutFilters(state))}
                  className="text-primary underline underline-offset-4 hover:no-underline"
                >
                  {t('filters.clear')}
                </Link>
              )}
            </div>
          ) : (
            <>
              <AuctionGrid auctions={result.items} priorityCount={4} />
              <Pagination basePath={basePath} state={state} result={result} />
            </>
          )}
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer text-foreground underline-offset-4 hover:underline">
              {t('ranking.title')}
            </summary>
            <div className="mt-2 space-y-2">
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

async function Filters({
  state,
  result,
  basePath,
  category,
  parent,
  categoryInQuery,
  sort,
}: SearchViewProps & { readonly sort: WebSort }) {
  const t = await getTranslations('search');
  const conditionLabels = await getTranslations('listing.details.conditions');
  const facets = result?.facets;
  const categoryHref = (path: readonly string[] | undefined) =>
    categoryInQuery
      ? searchHref(basePath, withoutFilters(state), { category: path?.join('/') ?? '' })
      : path === undefined
        ? searchHref('/szukaj', withoutFilters({ ...state, category: '' }))
        : searchHref(categoryUrl(path), withoutFilters({ ...state, category: '' }));

  return (
    <form action={basePath} method="get" className="space-y-6">
      {state.q === '' ? null : <input type="hidden" name="q" value={state.q} />}
      {categoryInQuery && state.category !== '' ? (
        <input type="hidden" name="kategoria" value={state.category} />
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor="search-sort" className="text-sm font-medium">
          {t('filters.sort')}
        </label>
        <NativeSelect id="search-sort" name="sort" defaultValue={sort}>
          {(Object.keys(WEB_SORTS) as WebSort[])
            .filter((key) => key !== 'trafnosc' || state.q !== '')
            .map((key) => (
              <option key={key} value={key}>
                {t(`sorts.${key}`)}
              </option>
            ))}
        </NativeSelect>
      </div>

      {(facets?.categories.length ?? 0) > 0 || category !== undefined ? (
        <nav aria-labelledby="filter-categories" className="space-y-1.5">
          <h3 id="filter-categories" className="text-sm font-medium">
            {t('filters.categories')}
          </h3>
          <ul className="space-y-1 text-sm">
            {category === undefined ? null : (
              <li>
                <Link
                  href={categoryHref(parent?.path)}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {parent === undefined
                    ? t('allCategories')
                    : t('filters.parent', { name: parent.name })}
                </Link>
              </li>
            )}
            {facets?.categories.map((entry) => (
              <li key={entry.id}>
                <Link
                  href={categoryHref(entry.path)}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {entry.name}
                </Link>{' '}
                <span className="text-muted-foreground">
                  {t('filters.count', { count: entry.count })}
                </span>
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
            : [short(facets.price.min), short(facets.price.max)]
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

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">{t('filters.apply')}</Button>
        <Link
          href={searchHref(basePath, withoutFilters({ ...state, sort: undefined }))}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          {t('filters.clear')}
        </Link>
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
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{legend}</legend>
      {options.map((option) => {
        const id = `${name}-${option.value}`;
        return (
          <div key={option.value} className="flex items-center gap-2 text-sm">
            <input
              id={id}
              type="checkbox"
              name={name}
              value={option.value}
              defaultChecked={selected.includes(option.value)}
              className="size-4 accent-primary"
            />
            <label htmlFor={id}>
              {option.label}{' '}
              {option.count > 0 ? (
                <span className="text-muted-foreground">{countLabel(option.count)}</span>
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
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex items-center gap-2">
        {([0, 1] as const).map((index) => (
          <Input
            key={names[index]}
            name={names[index]}
            defaultValue={values[index]}
            placeholder={placeholders[index]}
            aria-label={labels[index]}
            inputMode="decimal"
            autoComplete="off"
            className="h-9"
          />
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
  const link = 'inline-flex h-9 min-w-9 items-center justify-center rounded-md border px-3 text-sm';
  return (
    <nav aria-label={t('label')}>
      <ul className="flex flex-wrap items-center gap-2">
        {current > 1 ? (
          <li>
            <Link
              href={searchHref(basePath, state, { page: current - 1 })}
              rel="prev"
              className={cn(link, 'border-border')}
            >
              {t('previous')}
            </Link>
          </li>
        ) : null}
        {pages.map((page, index) =>
          page === null ? (
            <li key={`gap-${String(index)}`} aria-hidden className="px-1 text-muted-foreground">
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
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border',
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
              className={cn(link, 'border-border')}
            >
              {t('next')}
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
