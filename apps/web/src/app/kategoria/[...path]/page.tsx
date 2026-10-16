import type { CategoryDto } from '@biddy/api-client';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { SearchView } from '@/components/search/search-view';
import type { SearchParams } from '@/lib/page-params';
import { categoryUrl, routes } from '@/lib/routes';
import { categoryByPath, categoryTrail, loadCategories, runSearch } from '@/lib/search/load';
import { filterCount, parseSearchState } from '@/lib/search/search-params';

interface PageProps {
  readonly params: Promise<{ readonly path: string[] }>;
  readonly searchParams: SearchParams;
}

async function resolveCategory(params: PageProps['params']): Promise<CategoryDto> {
  const { path } = await params;
  const category = categoryByPath(await loadCategories(), path.map(decodeURIComponent));
  if (category === undefined) {
    notFound();
  }
  return category;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const category = await resolveCategory(params);
  const state = parseSearchState(await searchParams);
  const t = await getTranslations('search');
  const url = categoryUrl(category.path);
  const filtered = state.q !== '' || filterCount(state) > 0 || state.page > 1;
  return {
    title: category.name,
    description: t('metaCategoryDescription', { name: category.name }),
    alternates: { canonical: url },
    openGraph: { title: category.name, url },
    // Warianty z filtrami i kolejne strony: bez indeksowania (kanoniczna strona kategorii jest).
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
  };
}

/** Strona kategorii (F-19): aukcje z kategorii i podkategorii, filtry atrybutów kategorii. */
export default async function CategoryPage({ params, searchParams }: PageProps) {
  const category = await resolveCategory(params);
  const categories = await loadCategories();
  const trail = categoryTrail(categories, category);
  const state = { ...parseSearchState(await searchParams), category: '' };
  const { result, droppedAttributes } = await runSearch(state, category.id);
  const t = await getTranslations('search');
  return (
    <SearchView
      heading={
        state.q === ''
          ? category.name
          : `${t('titleQuery', { q: state.q })} ${t('inCategory', { name: category.name })}`
      }
      basePath={categoryUrl(category.path)}
      state={state}
      result={result}
      category={category}
      parent={trail.at(-2)}
      categoryInQuery={false}
      droppedAttributes={droppedAttributes}
      breadcrumbs={
        <nav aria-label={t('breadcrumbs')} className="mb-3 text-sm text-muted-foreground">
          <ol className="flex flex-wrap gap-x-2">
            <li>
              <Link href={routes.search} className="underline-offset-4 hover:underline">
                {t('allCategories')}
              </Link>
            </li>
            {trail.map((crumb) => (
              <li key={crumb.id} className="flex gap-x-2">
                <span aria-hidden>›</span>
                {crumb.id === category.id ? (
                  <span aria-current="page">{crumb.name}</span>
                ) : (
                  <Link
                    href={categoryUrl(crumb.path)}
                    className="underline-offset-4 hover:underline"
                  >
                    {crumb.name}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </nav>
      }
    />
  );
}
