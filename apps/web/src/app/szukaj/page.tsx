import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { SearchView } from '@/components/search/search-view';
import type { SearchParams } from '@/lib/page-params';
import { routes } from '@/lib/routes';
import { categoryByPath, countEndingSoon, loadCategories, runSearch } from '@/lib/search/load';
import { parseSearchState } from '@/lib/search/search-params';

interface PageProps {
  readonly searchParams: SearchParams;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const state = parseSearchState(await searchParams);
  const t = await getTranslations('search');
  return {
    title: state.q === '' ? t('metaTitle') : t('metaTitleQuery', { q: state.q }),
    // Wyniki wyszukiwania nie trafiają do indeksu wyszukiwarek (strony kategorii tak).
    robots: { index: false, follow: true },
  };
}

/** Wyszukiwarka (F-19): zapytanie, opcjonalna kategoria (`kategoria=moda/sneakersy`) i filtry. */
export default async function SearchPage({ searchParams }: PageProps) {
  const state = parseSearchState(await searchParams);
  const categories = await loadCategories();
  const category =
    state.category === '' ? undefined : categoryByPath(categories, state.category.split('/'));
  const parent =
    category === undefined ? undefined : categoryByPath(categories, category.path.slice(0, -1));
  const [{ result, droppedAttributes }, endingSoon] = await Promise.all([
    runSearch(state, category?.id),
    countEndingSoon(state, category?.id),
  ]);
  const t = await getTranslations('search');
  const heading =
    state.q === ''
      ? (category?.name ?? t('title'))
      : category === undefined
        ? t('titleQuery', { q: state.q })
        : `${t('titleQuery', { q: state.q })} ${t('inCategory', { name: category.name })}`;
  return (
    <SearchView
      heading={heading}
      basePath={routes.search}
      state={category === undefined ? { ...state, category: '' } : state}
      result={result}
      category={category}
      parent={parent}
      categoryInQuery
      droppedAttributes={droppedAttributes}
      endingSoon={endingSoon}
    />
  );
}
