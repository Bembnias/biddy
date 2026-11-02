// Startowa lista słów filtra ofert (F-14, PROJECT.md §17: zakazane przedmioty i hazard).
// Zapis po normalizacji: małe litery bez polskich znaków. Gwiazdka na końcu słowa = dowolna
// końcówka (odmiana), słowa w frazie muszą wystąpić po kolei. Listę stroimy z moderatorami (F-35).
//
// BLOCK: przedmiot zakazany, publikacja odrzucona. REVIEW: słowo niejednoznaczne (np. „pistolet
// do kleju”, „etui na paszport”), aukcja czeka na moderatora. Słów, które w kolekcjach i modzie
// najczęściej są niewinne (np. „piwo” w „kufel do piwa”), celowo nie ma.

export type FilterVerdict = 'BLOCK' | 'REVIEW';

export interface FilterTerm {
  readonly term: string;
  readonly verdict: FilterVerdict;
}

const block = (...terms: string[]): FilterTerm[] =>
  terms.map((term) => ({ term, verdict: 'BLOCK' }));
const review = (...terms: string[]): FilterTerm[] =>
  terms.map((term) => ({ term, verdict: 'REVIEW' }));

export const LISTING_TERMS: readonly FilterTerm[] = [
  // Broń, amunicja, materiały wybuchowe.
  ...block('amunicj*', 'naboj*', 'naboi', 'bron palna', 'proch strzelnicz*', 'material* wybuchow*'),
  ...review('bron', 'pistolet*', 'rewolwer*', 'karabin*', 'strzelb*', 'granat reczny', 'kastet*'),
  // Narkotyki i substancje.
  ...block(
    'narkotyk*',
    'marihuan*',
    'mefedron*',
    'amfetamin*',
    'metamfetamin*',
    'kokain*',
    'heroin*',
    'dopalacz*',
    'lsd',
    'mdma',
  ),
  // Leki, sterydy.
  ...block('na recepte', 'steryd*', 'anabolik*', 'viagra'),
  ...review('lek', 'leki', 'lekow', 'suplement*'),
  // Tytoń i e-papierosy.
  ...block('e papieros*', 'epapieros*', 'papierosy', 'papierosow', 'jednorazowk*', 'liquid*'),
  ...review('tyton*', 'snus', 'iqos', 'alkohol*'),
  // Podróbki.
  ...block('podrobk*', 'falsyfikat*'),
  ...review('replik*', 'kopia markow*'),
  // Dokumenty, bilety imienne.
  ...review('dowod osobisty', 'paszport*', 'prawo jazdy', 'bilet* imienn*'),
  // Zwierzęta.
  ...review('szczeni*', 'kociet*', 'zywe zwierz*'),
  // Treści dla dorosłych.
  ...block('porno*'),
  ...review('erotyczn*', 'erotyk*'),
  // Hazard (decyzja w §17: zakazane do czasu opinii prawnej).
  ...block('mystery box', 'mysterybox', 'tajemnicze pudelko'),
  ...review('loteri*', 'losowani*', 'zdrapk*'),
];

/** Wzorce spoza słów (znaki interpunkcyjne), sprawdzane na tekście po zamianie na małe litery. */
export const LISTING_PATTERNS: readonly {
  readonly pattern: RegExp;
  readonly label: string;
  readonly verdict: FilterVerdict;
}[] = [{ pattern: /(?:^|\s)1\s?:\s?1(?:\s|$|[.,!])/u, label: '1:1', verdict: 'REVIEW' }];
