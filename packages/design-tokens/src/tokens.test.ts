import { describe, expect, it } from 'vitest';

import { contrastRatio, isInSrgbGamut, parseOklch, toHex } from './color.js';
import { themeCss } from './theme-css.js';
import {
  TEXT_CONTRAST_PAIRS,
  UI_CONTRAST_PAIRS,
  palette,
  semanticColors,
  typography,
} from './tokens.js';

const allColors: [string, string][] = Object.entries(palette).flatMap(
  ([name, value]): [string, string][] =>
    typeof value === 'string'
      ? [[name, value]]
      : Object.entries(value).map(([step, color]): [string, string] => [`${name}-${step}`, color]),
);

describe('kontrast WCAG 2.1 AA', () => {
  it.each(TEXT_CONTRAST_PAIRS)('tekst %s na tle %s: ≥ 4.5:1', (text, background) => {
    expect(contrastRatio(semanticColors[text], semanticColors[background])).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it.each(UI_CONTRAST_PAIRS)('element %s na tle %s: ≥ 3:1 (WCAG 1.4.11)', (element, background) => {
    expect(
      contrastRatio(semanticColors[element], semanticColors[background]),
    ).toBeGreaterThanOrEqual(3);
  });
});

describe('paleta', () => {
  it.each(allColors)('%s jest w gamucie sRGB', (_name, color) => {
    expect(isInSrgbGamut(color)).toBe(true);
  });

  it.each(Object.entries(palette).filter(([, value]) => typeof value !== 'string'))(
    'skala %s: jasność maleje od 50 do 950',
    (_name, scale) => {
      const lightness = Object.values(scale as Record<string, string>).map(
        (color) => parseOklch(color).l,
      );
      expect(lightness).toEqual([...lightness].sort((left, right) => right - left));
    },
  );

  it('kolory semantyczne pochodzą z palety', () => {
    const paletteValues = new Set(allColors.map(([, color]) => color));
    for (const [name, color] of Object.entries(semanticColors)) {
      expect(paletteValues.has(color), name).toBe(true);
    }
  });
});

describe('contrastRatio', () => {
  it('czarny na białym: 21, kolor sam ze sobą: 1', () => {
    expect(contrastRatio(palette.black, palette.white)).toBeCloseTo(21, 1);
    expect(contrastRatio(palette.navy[500], palette.navy[500])).toBe(1);
  });

  it('toHex: biały, czarny i kolor marki w #rrggbb', () => {
    expect(toHex(palette.white)).toBe('#ffffff');
    expect(toHex(palette.black)).toBe('#000000');
    expect(toHex(palette.navy[700])).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('odrzuca zapis inny niż oklch(L C H)', () => {
    expect(() => parseOklch('#ffffff')).toThrow(/oklch/);
  });
});

describe('themeCss (motyw Tailwind CSS 4)', () => {
  const css = themeCss();

  it('zeruje domyślne kolory, fonty, rozmiary, grubości i promienie Tailwinda', () => {
    for (const reset of [
      '--color-*: initial;',
      '--font-*: initial;',
      '--text-*: initial;',
      '--font-weight-*: initial;',
      '--radius-*: initial;',
    ]) {
      expect(css).toContain(reset);
    }
  });

  it('definiuje paletę, kolory semantyczne i typografię z tokenów', () => {
    expect(css).toContain(`--color-navy-700: ${palette.navy[700]};`);
    expect(css).toContain(`--color-primary: ${semanticColors.primary};`);
    expect(css).toContain(`--color-muted-foreground: ${semanticColors['muted-foreground']};`);
    expect(css).toContain(
      '--font-sans: var(--font-face-sans, "Inter", ui-sans-serif, system-ui, sans-serif);',
    );
    expect(css).toContain(`--text-base: ${typography.fontSize.base[0]};`);
    expect(css).toContain(`--text-base--line-height: ${typography.fontSize.base[1]};`);
    expect(css).toContain('--font-weight-semibold: 600;');
    expect(css).toContain('--radius-md: 0.375rem;');
  });

  it('jest jednym blokiem @theme', () => {
    expect(css.match(/@theme \{/g)).toHaveLength(1);
    expect(css.trimEnd().endsWith('}')).toBe(true);
  });
});
