// Dokumenty prawne akceptowane przez użytkownika i ich aktualne wersje. Wersjonowanie treści
// i ponowna akceptacja po zmianie to F-41; do tego czasu wersje zmieniamy tutaj.

export const LEGAL_DOCUMENTS = ['TERMS', 'PRIVACY'] as const;

export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number];

/** Aktualna wersja każdego dokumentu (data publikacji, RRRR-MM-DD). */
export const LEGAL_DOCUMENT_VERSIONS: Readonly<Record<LegalDocument, string>> = {
  TERMS: '2026-10-01',
  PRIVACY: '2026-10-01',
};
