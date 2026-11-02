/** Parametry zapytania strony po odczytaniu. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Parametry zapytania strony (Next.js przekazuje je jako Promise). */
export type SearchParams = Promise<RawSearchParams>;

/** Pierwsza wartość parametru zapytania. */
export async function searchParam(params: SearchParams, name: string): Promise<string | undefined> {
  const value = (await params)[name];
  return Array.isArray(value) ? value[0] : value;
}
