// Design tokens Biddy: jedyne źródło kolorów, typografii, promieni, cieni i szerokości kontenerów
// dla web (Tailwind CSS 4, `theme.css` generowany przy buildzie), e-maili i mobile (NativeWind, F-37).
//
// Wartości pochodzą z design systemu Biddy (F-62, docs/features/F-62-design-system.md), zbudowanego
// z makiet Figma (design/*.png). Komponenty używają nazw semantycznych (`bg-primary`,
// `text-muted-foreground`), a skale palety tylko tam, gdzie rola nie ma nazwy (np. kafelki ikon).
//
// Kolory w OKLCH, w gamucie sRGB; pary tekst/tło spełniają WCAG 2.1 AA (test w tokens.test.ts).
// Tam, gdzie makieta nie spełniała AA (pastelowy CTA, jasne metadane, czerwień LIVE), rola używa
// ciemniejszego kroku tej samej skali.

/** Skala kroków palety: 50 (najjaśniejszy) … 950 (najciemniejszy). */
export type PaletteStep = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;

export type ColorScale = Readonly<Record<PaletteStep, string>>;

export const palette = {
  white: 'oklch(1 0 0)',
  black: 'oklch(0 0 0)',
  /** Neutralne z granatowym odcieniem (atrament Biddy): 50–100 tła, 200–300 linie, 400 obramowania pól, 500–600 tekst pomocniczy, 950 tekst i przyciski. */
  ink: {
    50: 'oklch(0.9842 0.0034 247.86)',
    100: 'oklch(0.9683 0.0069 247.9)',
    200: 'oklch(0.9189 0.0113 269.54)',
    300: 'oklch(0.8372 0.0243 272.77)',
    400: 'oklch(0.6354 0.0355 264.28)',
    500: 'oklch(0.5442 0.0558 263.41)',
    600: 'oklch(0.4849 0.0648 262.32)',
    700: 'oklch(0.3999 0.0749 262.08)',
    800: 'oklch(0.3198 0.0861 261.12)',
    900: 'oklch(0.2639 0.0907 260.37)',
    950: 'oklch(0.2208 0.0892 259.81)',
  },
  /** Kolor marki (fiolet z logo): 50–100 tła wyróżnień, 300 obramowania, 500 zaznaczenie, 600–700 tekst i linki. */
  violet: {
    50: 'oklch(0.9768 0.0142 308.3)',
    100: 'oklch(0.9491 0.0315 308.09)',
    200: 'oklch(0.8687 0.0807 308.6)',
    300: 'oklch(0.825 0.1077 307.91)',
    400: 'oklch(0.7468 0.1604 307.26)',
    500: 'oklch(0.6666 0.2131 305.35)',
    600: 'oklch(0.566 0.2451 302.05)',
    700: 'oklch(0.4897 0.2445 299.88)',
    800: 'oklch(0.4142 0.205 299.81)',
    900: 'oklch(0.3445 0.1645 300.14)',
    950: 'oklch(0.2604 0.1246 301.03)',
  },
  /** Drugi kolor marki (koniec gradientu logo i CTA), tylko w gradientach i akcentach. */
  pink: {
    50: 'oklch(0.9749 0.0144 350.08)',
    100: 'oklch(0.9461 0.0317 350.22)',
    200: 'oklch(0.8958 0.0639 350.73)',
    300: 'oklch(0.8202 0.1174 352.08)',
    400: 'oklch(0.7151 0.1872 352.58)',
    500: 'oklch(0.6573 0.2262 352.25)',
    600: 'oklch(0.5757 0.215 356.91)',
    700: 'oklch(0.5049 0.1895 358.06)',
    800: 'oklch(0.4303 0.1599 358.28)',
    900: 'oklch(0.3645 0.13 357.97)',
    950: 'oklch(0.2713 0.0948 358.61)',
  },
  /** Na żywo, pilność i akcje nieodwracalne: 500 kropka LIVE, 600 tła z białym tekstem i tekst. */
  red: {
    50: 'oklch(0.9782 0.0108 10.33)',
    100: 'oklch(0.9454 0.0231 10.96)',
    200: 'oklch(0.8897 0.058 18.3)',
    300: 'oklch(0.8092 0.1083 19.7)',
    400: 'oklch(0.7204 0.1694 23.09)',
    500: 'oklch(0.6379 0.2372 25.22)',
    600: 'oklch(0.5644 0.2194 25.97)',
    700: 'oklch(0.4948 0.1897 25.91)',
    800: 'oklch(0.4244 0.16 26.11)',
    900: 'oklch(0.3594 0.1297 25.93)',
    950: 'oklch(0.2597 0.0897 26.11)',
  },
  /** Sukces (prowadzisz, sprzedane, darmowa dostawa): tekst od 700, ikony 600. */
  green: {
    50: 'oklch(0.9833 0.0191 167.95)',
    100: 'oklch(0.9541 0.0445 165.95)',
    200: 'oklch(0.9101 0.0857 164.76)',
    300: 'oklch(0.8602 0.1252 163.97)',
    400: 'oklch(0.8092 0.1471 164.03)',
    500: 'oklch(0.681 0.1305 171.82)',
    600: 'oklch(0.582 0.0949 181.94)',
    700: 'oklch(0.501 0.0852 185.18)',
    800: 'oklch(0.4291 0.0716 186.9)',
    900: 'oklch(0.3597 0.0599 186.58)',
    950: 'oklch(0.2688 0.0445 187.67)',
  },
  /** Ostrzeżenia i oceny: tekst od 700, ikony 500–600. */
  amber: {
    50: 'oklch(0.9846 0.0124 75.37)',
    100: 'oklch(0.9647 0.0271 72.81)',
    200: 'oklch(0.9195 0.0672 75.56)',
    300: 'oklch(0.8594 0.1172 73.72)',
    400: 'oklch(0.8097 0.15 71.82)',
    500: 'oklch(0.7686 0.1647 70.08)',
    600: 'oklch(0.6292 0.1479 59.75)',
    700: 'oklch(0.5346 0.1299 53.91)',
    800: 'oklch(0.4687 0.1148 51.73)',
    900: 'oklch(0.401 0.0946 50.3)',
    950: 'oklch(0.2903 0.0699 50.1)',
  },
  /** Informacje i przesyłki w drodze: tekst od 700, ikony 600. */
  sky: {
    50: 'oklch(0.9771 0.0125 236.62)',
    100: 'oklch(0.9514 0.025 236.82)',
    200: 'oklch(0.8995 0.0543 237.4)',
    300: 'oklch(0.8307 0.0947 237.67)',
    400: 'oklch(0.7405 0.1297 239.8)',
    500: 'oklch(0.6652 0.1444 240.66)',
    600: 'oklch(0.5876 0.1389 241.97)',
    700: 'oklch(0.5 0.1193 242.75)',
    800: 'oklch(0.4295 0.1 243.96)',
    900: 'oklch(0.3592 0.0803 245.47)',
    950: 'oklch(0.2686 0.0612 246.77)',
  },
} as const satisfies Readonly<Record<string, string | ColorScale>>;

/**
 * Kolory semantyczne: nazwy shadcn/ui (`background`, `primary`, `muted`…) i role Biddy. Para `x` /
 * `x-foreground` to tło i tekst na nim. Komponenty używają tylko ich.
 */
export const semanticColors = {
  /** Tło stron publicznych (aukcja, wyszukiwarka, logowanie). */
  background: palette.white,
  /** Tło stron konta (Moje Biddy, profil), na którym leżą białe karty. */
  canvas: palette.ink[50],
  foreground: palette.ink[950],
  /** Tekst opisów i akapitów. */
  'foreground-secondary': palette.ink[600],
  card: palette.white,
  'card-foreground': palette.ink[950],
  popover: palette.white,
  'popover-foreground': palette.ink[950],
  /** Przyciski „default” (granat): akcja w karcie lub wierszu, aktywny segment przełącznika. */
  primary: palette.ink[950],
  'primary-hover': palette.ink[800],
  'primary-foreground': palette.white,
  /** Tło przycisku „soft” („Obserwuj aukcję”). */
  secondary: palette.ink[100],
  'secondary-foreground': palette.ink[950],
  /** Spokojne wypełnienia: wyszukiwarka, chipy atrybutów, szyna przełącznika, szkielety. */
  muted: palette.ink[100],
  /** Etykiety, metadane, znaczniki czasu, placeholdery. */
  'muted-foreground': palette.ink[500],
  /** Fioletowe tło wyróżnień: chip kategorii, przycisk „accent”, hover na liście. */
  accent: palette.violet[50],
  'accent-foreground': palette.violet[700],
  /** Linki w tekście i akcje tekstowe. */
  link: palette.violet[600],
  'link-hover': palette.violet[700],
  /** Gradient CTA (`bg-linear-to-r from-cta-from to-cta-to`): jedna najważniejsza akcja widoku. */
  'cta-from': palette.violet[600],
  'cta-to': palette.pink[600],
  'cta-hover-from': palette.violet[700],
  'cta-hover-to': palette.pink[700],
  'cta-foreground': palette.white,
  /** Zaznaczenie i aktywność (kropka radia, wybrana karta, wypełnione serce); nie na tekst. */
  brand: palette.violet[500],
  /** Wypełnienia marki z białym tekstem: aktywna zakładka, zaznaczony checkbox, licznik. */
  'brand-strong': palette.violet[600],
  'brand-border': palette.violet[300],
  /** Gradient logo do dużych powierzchni dekoracyjnych (nigdy pod tekstem). */
  'logo-from': palette.violet[500],
  'logo-to': palette.pink[500],
  /** Panel marki na ekranach logowania: biały tekst ≥ 24 px na górze, drobny tylko na dole. */
  'panel-from': palette.violet[500],
  'panel-to': palette.violet[700],
  /** Akcje nieodwracalne i błędy. */
  destructive: palette.red[600],
  'destructive-foreground': palette.white,
  'destructive-soft': palette.red[50],
  /** Plakietka LIVE (biały tekst) i kropka „na żywo”. */
  live: palette.red[600],
  'live-dot': palette.red[500],
  /** Licznik w ostatniej godzinie aukcji. */
  urgent: palette.red[600],
  'urgent-soft': palette.red[50],
  success: palette.green[700],
  'success-foreground': palette.white,
  'success-soft': palette.green[50],
  warning: palette.amber[700],
  'warning-soft': palette.amber[100],
  info: palette.sky[700],
  'info-soft': palette.sky[100],
  /** Gwiazdki ocen, zawsze z liczbą obok. */
  rating: palette.amber[500],
  /** Linie dekoracyjne (separatory, obramowania kart). */
  border: palette.ink[200],
  /** Obramowanie przycisków outline, pigułek i kart wyboru. */
  'border-strong': palette.ink[300],
  /** Obramowanie pól formularza: kontrast ≥ 3:1 z tłem (WCAG 1.4.11). */
  input: palette.ink[400],
  /** Obwódka fokusu: kontrast ≥ 3:1 z tłem. */
  ring: palette.violet[600],
} as const;

export type SemanticColor = keyof typeof semanticColors;

/** Pary tekst/tło, które muszą spełniać WCAG 2.1 AA dla zwykłego tekstu (≥ 4.5:1). */
export const TEXT_CONTRAST_PAIRS: readonly (readonly [SemanticColor, SemanticColor])[] = [
  ['foreground', 'background'],
  ['foreground', 'canvas'],
  ['foreground', 'muted'],
  ['foreground', 'accent'],
  ['foreground-secondary', 'background'],
  ['foreground-secondary', 'canvas'],
  ['foreground-secondary', 'muted'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'canvas'],
  ['muted-foreground', 'muted'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['primary-foreground', 'primary-hover'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['link', 'background'],
  ['link', 'canvas'],
  ['link', 'accent'],
  ['cta-foreground', 'cta-from'],
  ['cta-foreground', 'cta-to'],
  ['cta-foreground', 'cta-hover-from'],
  ['cta-foreground', 'cta-hover-to'],
  ['primary-foreground', 'brand-strong'],
  ['primary-foreground', 'live'],
  ['primary-foreground', 'panel-to'],
  ['destructive-foreground', 'destructive'],
  ['destructive', 'background'],
  ['destructive', 'destructive-soft'],
  ['urgent', 'urgent-soft'],
  ['success', 'background'],
  ['success', 'success-soft'],
  ['success-foreground', 'success'],
  ['warning', 'background'],
  ['warning', 'warning-soft'],
  ['info', 'background'],
  ['info', 'info-soft'],
];

/**
 * Elementy interfejsu i duży tekst, które muszą odróżniać się od tła (WCAG 1.4.11 i 1.4.3 dla
 * tekstu ≥ 24 px: ≥ 3:1).
 */
export const UI_CONTRAST_PAIRS: readonly (readonly [SemanticColor, SemanticColor])[] = [
  ['input', 'background'],
  ['input', 'canvas'],
  ['ring', 'background'],
  ['ring', 'canvas'],
  ['brand', 'background'],
  ['primary-foreground', 'panel-from'],
];

/** Styl tekstu: rozmiar i interlinia (rem), grubość i opcjonalny rozstaw liter. */
export interface TextStyle {
  readonly fontSize: string;
  readonly lineHeight: string;
  readonly fontWeight: number;
  readonly letterSpacing?: string;
}

export const typography = {
  /**
   * Rodziny fontów. Web ładuje font przez next/font i podaje go w zmiennej CSS
   * `--font-face-<nazwa>` (np. `--font-face-sans`); `family` to nazwa dla mobile i zapasowa.
   */
  fontFamily: {
    sans: {
      family: 'Plus Jakarta Sans',
      fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
    },
  },
  /** Skala rozmiarów (rem): rozmiar i wysokość linii. */
  fontSize: {
    xs: ['0.75rem', '1rem'],
    sm: ['0.875rem', '1.25rem'],
    base: ['1rem', '1.5rem'],
    lg: ['1.125rem', '1.75rem'],
    xl: ['1.25rem', '1.75rem'],
    '2xl': ['1.5rem', '2rem'],
    '3xl': ['1.875rem', '2.25rem'],
    '4xl': ['2.25rem', '2.5rem'],
    '5xl': ['3rem', '1.1'],
  },
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    extrabold: 800,
  },
  /**
   * Style semantyczne (klasy `text-h1`, `text-body-sm`, `text-price-xl`…): rozmiar, interlinia,
   * grubość i rozstaw naraz. `overline` i `badge` piszemy dodatkowo wielkimi literami (`uppercase`),
   * a kwoty i liczniki z cyframi tabelarycznymi (`tabular-nums`).
   */
  textStyles: {
    /** Hero strony głównej, najwyżej raz na stronę. */
    display: {
      fontSize: '2.75rem',
      lineHeight: '3.25rem',
      fontWeight: 800,
      letterSpacing: '-0.025em',
    },
    /** Tytuł strony i aukcji (jeden `<h1>`). */
    h1: { fontSize: '2rem', lineHeight: '2.5rem', fontWeight: 800, letterSpacing: '-0.02em' },
    /** Tytuł aukcji na telefonie, duże sekcje, tytuły dialogów. */
    h2: { fontSize: '1.5rem', lineHeight: '2rem', fontWeight: 700, letterSpacing: '-0.015em' },
    /** Sekcje strony (Opis, Specyfikacja, Podobne aukcje). */
    h3: { fontSize: '1.25rem', lineHeight: '1.75rem', fontWeight: 700, letterSpacing: '-0.01em' },
    /** Tytuły kart, wierszy list i opcji. */
    title: { fontSize: '1rem', lineHeight: '1.5rem', fontWeight: 700 },
    /** Długie opisy (opis przedmiotu, treści pomocy). */
    'body-lg': { fontSize: '1rem', lineHeight: '1.625rem', fontWeight: 400 },
    /** Domyślny tekst interfejsu. */
    body: { fontSize: '0.9375rem', lineHeight: '1.5rem', fontWeight: 400 },
    /** Metadane, podpowiedzi pod polami, opisy opcji. */
    'body-sm': { fontSize: '0.8125rem', lineHeight: '1.25rem', fontWeight: 500 },
    /** Znaczniki czasu, przypisy, liczniki znaków. */
    caption: { fontSize: '0.75rem', lineHeight: '1rem', fontWeight: 500 },
    /** Etykiety pól, przyciski 32 i 40 px, zakładki. */
    label: { fontSize: '0.875rem', lineHeight: '1.25rem', fontWeight: 600 },
    /** Przyciski 48 px. */
    'label-lg': { fontSize: '1rem', lineHeight: '1.5rem', fontWeight: 700 },
    /** Nagłówki bloków danych („Aktualna oferta”), wielkimi literami. */
    overline: { fontSize: '0.75rem', lineHeight: '1rem', fontWeight: 700, letterSpacing: '0.08em' },
    /** Plakietki statusu (LIVE), wielkimi literami. */
    badge: { fontSize: '0.6875rem', lineHeight: '1rem', fontWeight: 700, letterSpacing: '0.04em' },
    /** Aktualna cena w panelu licytacji. */
    'price-xl': {
      fontSize: '2.25rem',
      lineHeight: '2.5rem',
      fontWeight: 800,
      letterSpacing: '-0.02em',
    },
    /** Cena w wierszach Moje Biddy i zamówień. */
    'price-lg': {
      fontSize: '1.25rem',
      lineHeight: '1.75rem',
      fontWeight: 800,
      letterSpacing: '-0.01em',
    },
    /** Cena na karcie aukcji i w historii ofert. */
    price: { fontSize: '1rem', lineHeight: '1.5rem', fontWeight: 800 },
    /** Licznik do końca aukcji. */
    timer: { fontSize: '0.9375rem', lineHeight: '1.25rem', fontWeight: 700 },
  },
} as const satisfies {
  fontFamily: Record<string, { family: string; fallback: readonly string[] }>;
  fontSize: Record<string, readonly [string, string]>;
  fontWeight: Record<string, number>;
  textStyles: Record<string, TextStyle>;
};

/** Promienie zaokrągleń (rem): kontrolki `md`, karty list `lg`, panel licytacji `xl`, dialogi `2xl`. */
export const radius = {
  xs: '0.25rem',
  sm: '0.375rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
  '2xl': '1.5rem',
  full: '9999px',
} as const;

/** Kolor `oklch(L C H)` z kanałem alfa, np. do cieni. */
function withAlpha(color: string, alpha: number): string {
  return color.replace(/\)$/, ` / ${String(alpha)})`);
}

const ink = palette.ink[950];
const ringColor = palette.violet[600];

/** Cienie z granatowym odcieniem (nigdy czarne); `cta` tylko pod gradientem CTA. */
export const shadows = {
  xs: `0 1px 2px ${withAlpha(ink, 0.05)}`,
  sm: `0 1px 3px ${withAlpha(ink, 0.08)}, 0 1px 2px ${withAlpha(ink, 0.04)}`,
  md: `0 2px 4px ${withAlpha(ink, 0.04)}, 0 8px 24px -4px ${withAlpha(ink, 0.09)}`,
  lg: `0 4px 12px ${withAlpha(ink, 0.06)}, 0 16px 40px -8px ${withAlpha(ink, 0.16)}`,
  cta: `0 8px 20px -6px ${withAlpha(ringColor, 0.4)}`,
  /** Fokus klawiatury: 2 px odstępu w kolorze tła i 2 px `ring` (trzyma zaokrąglenie). */
  'focus-ring': `0 0 0 2px ${palette.white}, 0 0 0 4px ${ringColor}`,
} as const;

/** Maksymalne szerokości treści (klasy `max-w-page`, `max-w-narrow`…). */
export const containers = {
  /** Strony publiczne: aukcja, wyszukiwarka, strona główna. */
  page: '75rem',
  /** Strony konta: Moje Biddy, profil, powiadomienia. */
  narrow: '60rem',
  /** Kreator aukcji i długie formularze. */
  form: '50rem',
  /** Logowanie, rejestracja, weryfikacje. */
  auth: '26.25rem',
} as const;
