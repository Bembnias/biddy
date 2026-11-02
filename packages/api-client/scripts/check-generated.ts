// `pnpm api:check` (także w CI): czy apps/api/openapi.json i packages/api-client/src/generated
// zgadzają się z aktualnym kodem API. Generuje kontrakt i klienta od nowa w katalogu
// tymczasowym (ten sam układ ścieżek co w repozytorium, więc importy w wygenerowanym kodzie są
// identyczne) i porównuje pliki. Niczego nie zmienia w repozytorium. Zmiana DTO bez
// `pnpm api:generate` kończy się tu błędem.
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PREFIX = '[api:check]';
const PACKAGE_DIR = path.resolve(import.meta.dirname, '..');
const REPO_DIR = path.resolve(PACKAGE_DIR, '../..');
const API_DIR = path.join(REPO_DIR, 'apps/api');
const SPEC = 'apps/api/openapi.json';
const GENERATED = 'packages/api-client/src/generated';
/**
 * Pliki pakietu, które czyta orval: konfiguracja, mutator (fetcher) oraz package.json
 * i tsconfig.json (z nich wynikają m.in. rozszerzenia `.js` w importach).
 */
const ORVAL_INPUTS = ['orval.config.ts', 'src/fetcher.ts', 'package.json', 'tsconfig.json'];

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`${PREFIX} Polecenie nie powiodło się: ${command} ${args.join(' ')}`);
    console.error(result.stdout, result.stderr);
    process.exit(1);
  }
}

/** Pliki katalogu (ścieżki względne, posortowane); pusty, gdy katalogu nie ma. */
function listFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();
}

/** Różnice między wygenerowanym (`fresh`) a zapisanym w repozytorium (`committed`) drzewem. */
function compare(relative: string, fresh: string, committed: string): string[] {
  const freshFiles = new Set(listFiles(fresh));
  const committedFiles = new Set(listFiles(committed));
  const problems: string[] = [];
  for (const file of new Set([...freshFiles, ...committedFiles])) {
    const shown = path.join(relative, file);
    if (!committedFiles.has(file)) {
      problems.push(`${shown}: brak w repozytorium`);
    } else if (!freshFiles.has(file)) {
      problems.push(`${shown}: nadmiarowy (nie powstaje z kontraktu)`);
    } else if (
      readFileSync(path.join(fresh, file), 'utf8') !==
      readFileSync(path.join(committed, file), 'utf8')
    ) {
      problems.push(`${shown}: inna treść`);
    }
  }
  return problems.sort();
}

const workspace = mkdtempSync(path.join(tmpdir(), 'biddy-api-check-'));
try {
  // 1. Kontrakt OpenAPI z aktualnego kodu API.
  const freshSpec = path.join(workspace, SPEC);
  mkdirSync(path.dirname(freshSpec), { recursive: true });
  run(
    process.execPath,
    ['--import', '@swc-node/register/esm-register', 'src/openapi-export.ts', freshSpec],
    API_DIR,
  );

  // 2. Klient z tego kontraktu w kopii pakietu (orval czyta ../../apps/api/openapi.json).
  const freshPackage = path.join(workspace, 'packages/api-client');
  for (const file of ORVAL_INPUTS) {
    cpSync(path.join(PACKAGE_DIR, file), path.join(freshPackage, file), { recursive: true });
  }
  symlinkSync(path.join(PACKAGE_DIR, 'node_modules'), path.join(freshPackage, 'node_modules'));
  const orvalPackage = createRequire(path.join(PACKAGE_DIR, 'package.json')).resolve(
    'orval/package.json',
  );
  run(
    process.execPath,
    [path.join(path.dirname(orvalPackage), 'dist/bin/orval.mjs'), '--config', 'orval.config.ts'],
    freshPackage,
  );

  // 3. Porównanie z repozytorium.
  const problems = [
    ...compare('apps/api', path.dirname(freshSpec), API_DIR).filter((problem) =>
      problem.startsWith(`${SPEC}:`),
    ),
    ...compare(GENERATED, path.join(workspace, GENERATED), path.join(REPO_DIR, GENERATED)),
  ];
  if (problems.length > 0) {
    console.error(`${PREFIX} Klient API jest nieaktualny względem kodu API:`);
    for (const problem of problems) {
      console.error(`  • ${problem}`);
    }
    console.error(
      `${PREFIX} Uruchom \`pnpm api:generate\` i dodaj zmienione pliki do commita (kontrakt i klient zmieniają się razem z DTO).`,
    );
    process.exitCode = 1;
  } else {
    console.log(`${PREFIX} Kontrakt OpenAPI i wygenerowany klient są aktualne.`);
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
