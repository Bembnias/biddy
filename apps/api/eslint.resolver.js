// Resolver importów dla eslint-plugin-boundaries (interfejs eslint-import-resolver w wersji 2).
// Kod API to ESM ze specyfikatorami `.js`, które wskazują pliki `.ts` (moduleResolution NodeNext).
// Domyślny resolver `node` ich nie znajduje, a bez rozwiązanej ścieżki reguły granic modułów nie
// wiedzą, do którego modułu prowadzi import. Obsługujemy tylko importy względne; pakiety
// rozwiązuje następny resolver z listy (`node`, patrz eslint.config.js).
import { statSync } from 'node:fs';
import path from 'node:path';

/** Rozszerzenia źródeł TypeScript odpowiadające rozszerzeniom w specyfikatorach ESM. */
const SOURCE_EXTENSIONS = new Map([
  ['.js', ['.ts', '.tsx']],
  ['.mjs', ['.mts']],
  ['.cjs', ['.cts']],
]);

export const interfaceVersion = 2;

/**
 * @param {string} source specyfikator z importu, np. `../orders/index.js`
 * @param {string} file bezwzględna ścieżka pliku z importem
 * @returns {{ found: boolean, path?: string }}
 */
export function resolve(source, file) {
  if (!source.startsWith('./') && !source.startsWith('../')) {
    return { found: false };
  }
  const target = path.resolve(path.dirname(file), source);
  const extension = path.extname(target);
  const base = target.slice(0, target.length - extension.length);
  const candidates = [
    ...(SOURCE_EXTENSIONS.get(extension) ?? []).map((sourceExtension) => base + sourceExtension),
    target,
  ];
  const found = candidates.find(isFile);
  return found ? { found: true, path: found } : { found: false };
}

/** @param {string} candidate */
function isFile(candidate) {
  return statSync(candidate, { throwIfNoEntry: false })?.isFile() ?? false;
}
