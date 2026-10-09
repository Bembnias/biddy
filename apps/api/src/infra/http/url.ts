// Adres żądania bez parametrów zapytania. Parametry mogą zawierać sekrety (tokeny weryfikacji
// e-maila i resetu hasła, kody OAuth), więc nie trafiają ani do odpowiedzi (`instance`), ani do
// logów. Plik bez zależności: korzysta z niego też logger.

/** Ścieżka żądania bez części `?…` (i bez fragmentu `#…`, gdyby klient go wysłał). */
export function pathWithoutQuery(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}
