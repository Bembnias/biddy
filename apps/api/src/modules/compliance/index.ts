/**
 * Publiczne API modułu `compliance` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: DAC7, eksporty, retencja danych.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { ComplianceModule } from './compliance.module.js';
