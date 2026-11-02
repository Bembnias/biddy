// Kolory tokenów zapisujemy w OKLCH (percepcyjnie równe kroki jasności, natywnie w CSS i Tailwind 4).
// Do sprawdzania kontrastu (WCAG 2.1) przeliczamy je na sRGB.

/** Kolor w OKLCH: jasność 0–1, chroma ≥ 0, odcień w stopniach. */
export interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

const OKLCH_PATTERN = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/;

/** Parsuje zapis `oklch(L C H)` używany w tokenach (bez kanału alfa i procentów). */
export function parseOklch(value: string): Oklch {
  const match = OKLCH_PATTERN.exec(value);
  if (match === null) {
    throw new Error(
      `Oczekiwano koloru w formacie oklch(L C H), np. oklch(0.45 0.13 262): ${value}`,
    );
  }
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) };
}

/** Liniowe sRGB (bez korekcji gamma); poza zakresem 0–1 oznacza kolor spoza gamutu sRGB. */
export interface LinearRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** OKLCH → liniowe sRGB (macierze z definicji OKLab, Björn Ottosson). */
export function oklchToLinearRgb({ l, c, h }: Oklch): LinearRgb {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);
  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = l - 0.0894841775 * a - 1.291485548 * b;
  const lCube = lPrime ** 3;
  const mCube = mPrime ** 3;
  const sCube = sPrime ** 3;
  return {
    r: 4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube,
    g: -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube,
    b: -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube,
  };
}

/** Tolerancja błędów zaokrągleń przy sprawdzaniu gamutu. */
const GAMUT_EPSILON = 0.002;

/** Czy kolor mieści się w sRGB (ekrany pokażą go bez przycinania). */
export function isInSrgbGamut(value: string): boolean {
  const { r, g, b } = oklchToLinearRgb(parseOklch(value));
  return [r, g, b].every((channel) => channel >= -GAMUT_EPSILON && channel <= 1 + GAMUT_EPSILON);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Luminancja względna (WCAG 2.1): współczynniki liczone na liniowym sRGB. */
export function relativeLuminance(value: string): number {
  const { r, g, b } = oklchToLinearRgb(parseOklch(value));
  return 0.2126 * clamp01(r) + 0.7152 * clamp01(g) + 0.0722 * clamp01(b);
}

/** Kontrast WCAG 2.1 dwóch kolorów, od 1 (brak) do 21 (czarny na białym). */
export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (left, right) => right - left,
  ) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Kanał liniowy → 8-bitowy sRGB z korekcją gamma. */
function toSrgbByte(channel: number): number {
  const linear = clamp01(channel);
  const encoded = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

/**
 * Kolor tokenu jako `#rrggbb`, dla miejsc bez obsługi OKLCH (generowane obrazki, np. ikona
 * i grafiki Open Graph przez next/og).
 */
export function toHex(value: string): string {
  const { r, g, b } = oklchToLinearRgb(parseOklch(value));
  return `#${[r, g, b].map((channel) => toSrgbByte(channel).toString(16).padStart(2, '0')).join('')}`;
}
