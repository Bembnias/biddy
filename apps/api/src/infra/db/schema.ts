// Schemat Drizzle całej aplikacji: zbiór tabel wszystkich modułów przekazywany do
// `drizzle(pool, { schema })` (zapytania relacyjne `db.query.*`).
//
// Konwencja: każdy moduł trzyma swoje tabele w `src/modules/<moduł>/db/*.schema.ts` (z tych
// plików drizzle-kit generuje migracje, patrz drizzle.config.ts). Nowy plik tabel dopisz tutaj:
//
//   export * from '../../modules/<moduł>/db/<nazwa>.schema.js';
//
// To jedyny plik infra, który może importować pliki modułów, i tylko pliki *.schema.ts
// (reguła granic modułów w eslint.config.js). Tabele innego modułu nie są jego publicznym API.
export {};
