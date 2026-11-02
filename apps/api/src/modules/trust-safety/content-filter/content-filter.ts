// Filtr słów w ofertach (F-14): normalizacja tekstu i dopasowanie po całych słowach. Nie
// zastępuje moderacji i zgłoszeń (F-35): łapie oczywiste przypadki i proste próby obejścia
// (polskie znaki, wielkie litery, cyfry zamiast liter, separatory).
import {
  type FilterTerm,
  type FilterVerdict,
  LISTING_PATTERNS,
  LISTING_TERMS,
} from './listing-terms.js';

export interface FilterMatch {
  /** Pole oferty, np. `title`. */
  readonly field: string;
  /** Dopasowane słowo z listy (forma z listy, np. `amunicj*`). */
  readonly term: string;
  readonly verdict: FilterVerdict;
}

export interface FilterResult {
  /** Najostrzejszy werdykt albo ALLOW. */
  readonly verdict: FilterVerdict | 'ALLOW';
  readonly matches: readonly FilterMatch[];
}

/** Cyfry i znaki używane zamiast liter (tylko w słowach, które mają też litery, np. „m3f3dr0n”). */
const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

/** Małe litery, bez znaków diakrytycznych (ł → l), słowa rozdzielone pojedynczą spacją. */
export function normalizeWords(text: string): string[] {
  const plain = text
    .toLowerCase()
    .replaceAll('ł', 'l')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '');
  return plain
    .split(/[^\p{L}\p{N}@$]+/u)
    .filter((word) => word !== '')
    .map((word) =>
      /\p{L}/u.test(word) && /[0-9@$]/u.test(word)
        ? [...word].map((char) => LEET[char] ?? char).join('')
        : word,
    )
    .map((word) => word.replace(/[@$]/gu, ''))
    .filter((word) => word !== '');
}

interface CompiledTerm extends FilterTerm {
  readonly words: readonly { readonly text: string; readonly prefix: boolean }[];
}

function compile(terms: readonly FilterTerm[]): CompiledTerm[] {
  return terms.map((term) => ({
    ...term,
    words: term.term
      .split(' ')
      .map((word) =>
        word.endsWith('*')
          ? { text: word.slice(0, -1), prefix: true }
          : { text: word, prefix: false },
      ),
  }));
}

const COMPILED = compile(LISTING_TERMS);

function matchesAt(words: readonly string[], index: number, term: CompiledTerm): boolean {
  return term.words.every((pattern, offset) => {
    const word = words[index + offset];
    if (word === undefined) {
      return false;
    }
    return pattern.prefix ? word.startsWith(pattern.text) : word === pattern.text;
  });
}

/**
 * Sprawdza pola oferty (np. tytuł, opis, marka). BLOCK ma pierwszeństwo przed REVIEW.
 *
 * @example checkListingText({ title: 'Naboje 9 mm' }).verdict // 'BLOCK'
 */
export function checkListingText(
  fields: Readonly<Record<string, string | null | undefined>>,
  terms: readonly FilterTerm[] = LISTING_TERMS,
): FilterResult {
  const compiled = terms === LISTING_TERMS ? COMPILED : compile(terms);
  const matches: FilterMatch[] = [];
  for (const [field, text] of Object.entries(fields)) {
    if (text === null || text === undefined || text.trim() === '') {
      continue;
    }
    const words = normalizeWords(text);
    const seen = new Set<string>();
    for (const term of compiled) {
      if (!seen.has(term.term) && words.some((_, index) => matchesAt(words, index, term))) {
        seen.add(term.term);
        matches.push({ field, term: term.term, verdict: term.verdict });
      }
    }
    if (terms === LISTING_TERMS) {
      for (const { pattern, label, verdict } of LISTING_PATTERNS) {
        if (pattern.test(text.toLowerCase())) {
          matches.push({ field, term: label, verdict });
        }
      }
    }
  }
  const verdict = matches.some((match) => match.verdict === 'BLOCK')
    ? 'BLOCK'
    : matches.length > 0
      ? 'REVIEW'
      : 'ALLOW';
  return { verdict, matches };
}
