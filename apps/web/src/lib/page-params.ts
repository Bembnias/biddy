/** Parametry zapytania strony (Next.js przekazuje je jako Promise). */
export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Pierwsza wartość parametru zapytania. */
export async function searchParam(params: SearchParams, name: string): Promise<string | undefined> {
  const value = (await params)[name];
  return Array.isArray(value) ? value[0] : value;
}
