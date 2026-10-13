// Design tokens Biddy: jedyne źródło kolorów, typografii i promieni zaokrągleń dla web
// (Tailwind CSS 4, `theme.css` generowany przy buildzie) i mobile (NativeWind, F-37).
//
// Wartości są TYMCZASOWE (granat + pomarańcz, font Inter): docelową identyfikację projektuje
// freelancer (PROJECT.md §22 nr 8). Komponenty używają nazw semantycznych (`bg-primary`,
// `text-muted-foreground`), więc nowa paleta nie wymaga zmian w kodzie aplikacji.
//
// Kolory w OKLCH, w gamucie sRGB; pary tekst/tło spełniają WCAG 2.1 AA (test w tokens.test.ts).

/** Skala kroków palety: 50 (najjaśniejszy) … 950 (najciemniejszy). */
export type PaletteStep = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;

export type ColorScale = Readonly<Record<PaletteStep, string>>;

export const palette = {
  white: 'oklch(1 0 0)',
  black: 'oklch(0 0 0)',
  /** Kolor marki: granat (zaufanie, ochrona kupującego). */
  navy: {
    50: 'oklch(0.975 0.012 262)',
    100: 'oklch(0.94 0.028 262)',
    200: 'oklch(0.88 0.057 262)',
    300: 'oklch(0.8 0.098 262)',
    400: 'oklch(0.7 0.141 262)',
    500: 'oklch(0.6 0.155 262)',
    600: 'oklch(0.52 0.16 262)',
    700: 'oklch(0.45 0.159 262)',
    800: 'oklch(0.38 0.153 262)',
    900: 'oklch(0.3 0.141 262)',
    950: 'oklch(0.22 0.122 262)',
  },
  /** Akcent: pomarańcz (emocje licytacji, wyróżnienia, liczniki). */
  orange: {
    50: 'oklch(0.975 0.014 50)',
    100: 'oklch(0.94 0.033 50)',
    200: 'oklch(0.88 0.069 50)',
    300: 'oklch(0.8 0.123 50)',
    400: 'oklch(0.7 0.167 50)',
    500: 'oklch(0.6 0.156 50)',
    600: 'oklch(0.52 0.136 50)',
    700: 'oklch(0.45 0.119 50)',
    800: 'oklch(0.38 0.103 50)',
    900: 'oklch(0.3 0.086 50)',
    950: 'oklch(0.22 0.074 50)',
  },
  /** Neutralne szarości z lekkim chłodnym odcieniem. */
  gray: {
    50: 'oklch(0.975 0.004 255)',
    100: 'oklch(0.94 0.007 255)',
    200: 'oklch(0.88 0.01 255)',
    300: 'oklch(0.8 0.013 255)',
    400: 'oklch(0.7 0.016 255)',
    500: 'oklch(0.6 0.017 255)',
    600: 'oklch(0.52 0.018 255)',
    700: 'oklch(0.45 0.018 255)',
    800: 'oklch(0.38 0.017 255)',
    900: 'oklch(0.3 0.016 255)',
    950: 'oklch(0.22 0.014 255)',
  },
  red: {
    50: 'oklch(0.975 0.012 27)',
    100: 'oklch(0.94 0.03 27)',
    200: 'oklch(0.88 0.062 27)',
    300: 'oklch(0.8 0.111 27)',
    400: 'oklch(0.7 0.185 27)',
    500: 'oklch(0.6 0.204 27)',
    600: 'oklch(0.52 0.208 27)',
    700: 'oklch(0.45 0.181 27)',
    800: 'oklch(0.38 0.155 27)',
    900: 'oklch(0.3 0.126 27)',
    950: 'oklch(0.22 0.1 27)',
  },
  green: {
    50: 'oklch(0.975 0.035 150)',
    100: 'oklch(0.94 0.059 150)',
    200: 'oklch(0.88 0.088 150)',
    300: 'oklch(0.8 0.116 150)',
    400: 'oklch(0.7 0.141 150)',
    500: 'oklch(0.6 0.155 150)',
    600: 'oklch(0.52 0.141 150)',
    700: 'oklch(0.45 0.123 150)',
    800: 'oklch(0.38 0.105 150)',
    900: 'oklch(0.3 0.086 150)',
    950: 'oklch(0.22 0.071 150)',
  },
} as const satisfies Readonly<Record<string, string | ColorScale>>;

/**
 * Kolory semantyczne (nazwy jak w shadcn/ui): komponenty używają tylko ich. Para `x` /
 * `x-foreground` to tło i tekst na nim.
 */
export const semanticColors = {
  background: palette.white,
  foreground: palette.gray[950],
  card: palette.white,
  'card-foreground': palette.gray[950],
  popover: palette.white,
  'popover-foreground': palette.gray[950],
  primary: palette.navy[700],
  'primary-foreground': palette.white,
  secondary: palette.gray[100],
  'secondary-foreground': palette.gray[900],
  muted: palette.gray[100],
  'muted-foreground': palette.gray[600],
  accent: palette.navy[50],
  'accent-foreground': palette.navy[900],
  /** Wyróżnienie (np. przycisk akcji na stronie głównej, licznik końca aukcji). */
  highlight: palette.orange[400],
  'highlight-foreground': palette.gray[950],
  destructive: palette.red[600],
  'destructive-foreground': palette.white,
  success: palette.green[700],
  'success-foreground': palette.white,
  /** Linie dekoracyjne (separatory, obramowania kart). */
  border: palette.gray[200],
  /** Obramowanie pól formularza: kontrast ≥ 3:1 z tłem (WCAG 1.4.11). */
  input: palette.gray[500],
  /** Obwódka fokusu: kontrast ≥ 3:1 z tłem. */
  ring: palette.navy[600],
} as const;

export type SemanticColor = keyof typeof semanticColors;

/** Pary tekst/tło, które muszą spełniać WCAG 2.1 AA dla zwykłego tekstu (≥ 4.5:1). */
export const TEXT_CONTRAST_PAIRS: readonly (readonly [SemanticColor, SemanticColor])[] = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'muted'],
  ['accent-foreground', 'accent'],
  ['highlight-foreground', 'highlight'],
  ['destructive-foreground', 'destructive'],
  ['success-foreground', 'success'],
  ['primary', 'background'],
  ['destructive', 'background'],
];

/** Elementy interfejsu, które muszą odróżniać się od tła (WCAG 1.4.11, ≥ 3:1). */
export const UI_CONTRAST_PAIRS: readonly (readonly [SemanticColor, SemanticColor])[] = [
  ['input', 'background'],
  ['ring', 'background'],
];

export const typography = {
  /**
   * Rodziny fontów. Web ładuje font przez next/font i podaje go w zmiennej CSS
   * `--font-face-<nazwa>` (np. `--font-face-sans`); `family` to nazwa dla mobile i zapasowa.
   */
  fontFamily: {
    sans: {
      family: 'Inter',
      fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
    },
  },
  /** Rozmiar i wysokość linii (rem). */
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
  },
} as const satisfies {
  fontFamily: Record<string, { family: string; fallback: readonly string[] }>;
  fontSize: Record<string, readonly [string, string]>;
  fontWeight: Record<string, number>;
};

/** Promienie zaokrągleń (rem). */
export const radius = {
  xs: '0.125rem',
  sm: '0.25rem',
  md: '0.375rem',
  lg: '0.5rem',
  xl: '0.75rem',
  '2xl': '1rem',
  full: '9999px',
} as const;
