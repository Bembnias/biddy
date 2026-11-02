// Generowanie klienta API z kontraktu OpenAPI (apps/api/openapi.json, `pnpm api:generate`).
// Wynik w src/generated/ jest w repozytorium i nie edytujemy go ręcznie: `pnpm api:check`
// (także w CI) sprawdza, czy zgadza się z aktualnym kontraktem API.
import { defineConfig } from 'orval';

export default defineConfig({
  biddy: {
    input: { target: '../../apps/api/openapi.json' },
    output: {
      // Plik na tag OpenAPI (np. time/time.ts) i osobny katalog typów (model/).
      mode: 'tags-split',
      target: './src/generated/endpoints.ts',
      schemas: './src/generated/model',
      client: 'react-query',
      httpClient: 'fetch',
      clean: true,
      indexFiles: true,
      override: {
        // Wszystkie żądania przez nasz fetcher: adres API, sesja, ApiError z Problem Details.
        mutator: { path: './src/fetcher.ts', name: 'apiFetch' },
        // Funkcje zwracają samą treść odpowiedzi; status i błąd obsługuje fetcher.
        fetch: { includeHttpResponseReturnType: false },
        // GET jako zapytania (useX, useXSuspense), pozostałe metody jako mutacje (useX z mutate).
        query: { version: 5, useSuspenseQuery: true, signal: true },
      },
    },
  },
});
