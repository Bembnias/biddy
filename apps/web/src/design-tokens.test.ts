// Kryterium F-06: kolory i typografia pochodzą wyłącznie z design tokens. Tailwind nie ma
// domyślnej palety ani fontów (theme.css z @biddy/design-tokens je zeruje), więc klasa spoza
// tokenów nie daje żadnego stylu. Ten test zamyka pozostałe furtki: wartości dowolne w klasach
// (`bg-[#fff]`, `text-[13px]`) i literały kolorów albo fontów w kodzie i CSS.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname);

interface Rule {
  readonly name: string;
  readonly pattern: RegExp;
  readonly files: RegExp;
}

const RULES: readonly Rule[] = [
  {
    name: 'kolor jako wartość dowolna w klasie Tailwinda (np. bg-[#fff], text-[rgb(…)])',
    pattern: /-\[(?:#|rgba?\(|hsla?\(|okl(?:ch|ab)\(|lab\(|lch\(|color:)/i,
    files: /\.(?:tsx?|css)$/,
  },
  {
    name: 'typografia jako wartość dowolna (text-[…], font-[…], leading-[…], tracking-[…])',
    pattern: /(?:^|[\s"'`:])(?:text|font|leading|tracking)-\[/,
    files: /\.(?:tsx?|css)$/,
  },
  {
    name: 'literał koloru (#hex, rgb(), hsl(), oklch()) poza tokenami',
    pattern: /#[0-9a-f]{3,8}\b(?![-\w])|\b(?:rgba?|hsla?|okl(?:ch|ab))\(/i,
    files: /\.(?:tsx?|css)$/,
  },
  {
    name: 'font-family, font-size albo color w CSS (użyj klas z tokenów)',
    pattern: /^\s*(?:font-family|font-size|color|background-color)\s*:/,
    files: /\.css$/,
  },
];

/** Pliki źródłowe aplikacji bez testów i pomocników testów. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter(
      (file) =>
        /\.(?:tsx?|css)$/.test(file) &&
        !/\.test\.tsx?$/.test(file) &&
        !file.startsWith(path.join(SRC, 'test')),
    );
}

function violations(rule: Rule, files: readonly string[]): string[] {
  return files
    .filter((file) => rule.files.test(file))
    .flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          rule.pattern.test(line)
            ? [`${path.relative(SRC, file)}:${index + 1}: ${line.trim()}`]
            : [],
        ),
    );
}

describe('kolory i typografia tylko z design tokens', () => {
  const files = sourceFiles(SRC);

  it('skanuje źródła aplikacji (komponenty, strony, CSS)', () => {
    expect(files.some((file) => file.endsWith('app/globals.css'))).toBe(true);
    expect(files.some((file) => file.endsWith('components/ui/button.tsx'))).toBe(true);
  });

  it.each(RULES)('brak: $name', (rule) => {
    expect(violations(rule, files)).toEqual([]);
  });

  it.each([
    ['bg-[#ff0000]', 0],
    ['hover:text-[rgb(0,0,0)]', 0],
    ['text-[13px]', 1],
    ["className='font-[Arial]'", 1],
    ["const brand = '#1f4eac';", 2],
    ['background: oklch(0.5 0.1 200);', 2],
  ])('reguły wykrywają naruszenie w „%s”', (line, ruleIndex) => {
    expect(RULES[ruleIndex]?.pattern.test(line)).toBe(true);
  });

  it.each([
    'href="#main"',
    'ring-[3px]',
    'bg-primary/90',
    'text-muted-foreground',
    'grid-cols-[1fr_auto]',
  ])('nie zgłasza poprawnego „%s”', (line) => {
    expect(RULES.some((rule) => rule.files.test('x.tsx') && rule.pattern.test(line))).toBe(false);
  });
});
