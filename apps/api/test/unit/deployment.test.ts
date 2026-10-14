// Spójność konfiguracji wdrożenia (F-09): obraz Docker (apps/api/Dockerfile) i Blueprint Render
// (render.yaml) z resztą repozytorium. Rozjazd wychodzi w CI, a nie dopiero przy deployu.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = (file: string) => fileURLToPath(new URL(`../../../../${file}`, import.meta.url));
const read = (file: string) => readFileSync(root(file), 'utf8');

const dockerfile = read('apps/api/Dockerfile');
const blueprint = read('render.yaml');

/** Polecenie z dist/ (np. `node dist/infra/db/migrate.js`) → plik źródłowy w src/. */
function sourceOf(command: string): string[] {
  return [...command.matchAll(/(?:\.\/)?dist\/(\S+)\.js/g)].map(
    ([, file]) => `apps/api/src/${file ?? ''}.ts`,
  );
}

describe('apps/api/Dockerfile', () => {
  it('Node w wersji głównej z .nvmrc', () => {
    const image = /^ARG NODE_IMAGE=node:(\d+)\.\d+\.\d+-alpine[\d.]+$/m.exec(dockerfile);
    expect(image?.[1]).toBe(read('.nvmrc').trim());
  });

  it('Turborepo w wersji z katalogu pnpm', () => {
    const turbo = /^ARG TURBO_VERSION=(.+)$/m.exec(dockerfile)?.[1];
    const catalog = /^ {2}turbo: (.+)$/m.exec(read('pnpm-workspace.yaml'))?.[1];
    expect(turbo).toBe(catalog);
  });

  it('domyślne CMD uruchamia API z instrumentacją Sentry, a obraz zawiera migracje SQL', () => {
    expect(dockerfile).toContain(
      'CMD ["node", "--import", "./dist/instrument.js", "dist/main.js"]',
    );
    expect(dockerfile).toMatch(/COPY .*\/repo\/apps\/api\/drizzle \.\/apps\/api\/drizzle/);
    expect(dockerfile).toMatch(/^USER node$/m);
  });
});

describe('render.yaml', () => {
  it('migracje, worker i API wskazują istniejące pliki', () => {
    const commands = [...blueprint.matchAll(/^\s+(?:preDeployCommand|dockerCommand): (.+)$/gm)].map(
      ([, command]) => command ?? '',
    );
    expect(commands).toEqual(
      expect.arrayContaining([
        'node dist/infra/db/migrate.js',
        'node --import ./dist/instrument.js dist/worker.js',
      ]),
    );
    for (const file of commands.flatMap(sourceOf)) {
      expect(existsSync(root(file)), file).toBe(true);
    }
  });

  it('API i worker deployują się po zielonym CI, z migracjami przed startem', () => {
    expect(blueprint.match(/^ +autoDeployTrigger: checksPass$/gm)).toHaveLength(2);
    expect(
      blueprint.match(/^ +preDeployCommand: node dist\/infra\/db\/migrate\.js$/gm),
    ).toHaveLength(2);
  });

  it('Redis kolejek ma noeviction (inaczej worker nie wystartuje)', () => {
    expect(blueprint).toMatch(/name: biddy-staging-queues[\s\S]*?maxmemoryPolicy: noeviction/);
  });

  it('vercel.json: region Frankfurt, turbo-ignore w wersji Turborepo z katalogu', () => {
    const vercel = JSON.parse(read('apps/web/vercel.json')) as {
      regions: string[];
      ignoreCommand: string;
    };
    const catalog = /^ {2}turbo: (.+)$/m.exec(read('pnpm-workspace.yaml'))?.[1];
    expect(vercel.regions).toEqual(['fra1']);
    expect(vercel.ignoreCommand).toContain(`turbo-ignore@${catalog ?? ''} `);
  });

  it('API i worker mają ten sam buildFilter (ten sam obraz)', () => {
    const filters = [...blueprint.matchAll(/^ {4}buildFilter:\n((?: {6}.*\n)+)/gm)].map(
      ([, filter]) => filter,
    );
    expect(filters).toHaveLength(2);
    expect(filters[0]).toBe(filters[1]);
  });

  it('buildFilter obejmuje pakiety workspace, od których zależy API', () => {
    const manifest = JSON.parse(read('apps/api/package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const workspace = Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })
      .filter(([, version]) => version.startsWith('workspace:'))
      .map(([name]) => name.replace('@biddy/', ''));
    expect(workspace.length).toBeGreaterThan(0);
    for (const name of workspace) {
      expect(blueprint).toContain(`- packages/${name}/**`);
    }
  });
});
