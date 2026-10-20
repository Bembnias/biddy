// Motyw Tailwind CSS 4 z tokenów: blok `@theme`, który najpierw zeruje domyślne kolory, fonty,
// rozmiary tekstu, grubości, promienie i cienie Tailwinda (`--color-*: initial` itd.), a potem
// definiuje wyłącznie wartości z tokenów. Klasa spoza tokenów (np. `bg-blue-500`) nie wygeneruje
// więc żadnego CSS. Plik zapisuje build pakietu (scripts/build-theme.ts) do dist/theme.css.
import { containers, palette, radius, semanticColors, shadows, typography } from './tokens.js';

/** Zmienna CSS, w której aplikacja podaje font załadowany np. przez next/font. */
export function fontFaceVariable(name: string): string {
  return `--font-face-${name}`;
}

function colorLines(): string[] {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(palette)) {
    if (typeof value === 'string') {
      lines.push(`--color-${name}: ${value};`);
    } else {
      for (const [step, color] of Object.entries(value)) {
        lines.push(`--color-${name}-${step}: ${color};`);
      }
    }
  }
  for (const [name, value] of Object.entries(semanticColors)) {
    lines.push(`--color-${name}: ${value};`);
  }
  return lines;
}

function typographyLines(): string[] {
  const lines: string[] = [];
  for (const [name, { family, fallback }] of Object.entries(typography.fontFamily)) {
    const stack = [`"${family}"`, ...fallback].join(', ');
    lines.push(`--font-${name}: var(${fontFaceVariable(name)}, ${stack});`);
  }
  for (const [name, [size, lineHeight]] of Object.entries(typography.fontSize)) {
    lines.push(`--text-${name}: ${size};`, `--text-${name}--line-height: ${lineHeight};`);
  }
  for (const [name, weight] of Object.entries(typography.fontWeight)) {
    lines.push(`--font-weight-${name}: ${weight};`);
  }
  // Style semantyczne: Tailwind 4 nadaje klasą `text-<nazwa>` też interlinię, grubość i rozstaw.
  for (const [name, style] of Object.entries(typography.textStyles)) {
    lines.push(
      `--text-${name}: ${style.fontSize};`,
      `--text-${name}--line-height: ${style.lineHeight};`,
      `--text-${name}--font-weight: ${style.fontWeight};`,
    );
    if ('letterSpacing' in style) {
      lines.push(`--text-${name}--letter-spacing: ${style.letterSpacing};`);
    }
  }
  return lines;
}

/** Treść dist/theme.css (importowana w CSS aplikacji po `@import "tailwindcss"`). */
export function themeCss(): string {
  const body = [
    '/* Domyślne wartości Tailwinda wyłączone: tylko tokeny Biddy. */',
    '--color-*: initial;',
    '--font-*: initial;',
    '--text-*: initial;',
    '--font-weight-*: initial;',
    '--radius-*: initial;',
    '--shadow-*: initial;',
    '',
    ...colorLines(),
    '',
    ...typographyLines(),
    '',
    ...Object.entries(radius).map(([name, value]) => `--radius-${name}: ${value};`),
    '',
    ...Object.entries(shadows).map(([name, value]) => `--shadow-${name}: ${value};`),
    '',
    ...Object.entries(containers).map(([name, value]) => `--container-${name}: ${value};`),
  ];
  return [
    '/* Wygenerowane z packages/design-tokens/src/tokens.ts przez `pnpm build`. Nie edytuj. */',
    '@theme {',
    ...body.map((line) => (line === '' ? '' : `  ${line}`)),
    '}',
    '',
  ].join('\n');
}
