// Spójność konfiguracji wdrożenia (F-09): obrazy Docker (apps/api/Dockerfile, apps/web/Dockerfile),
// Blueprint Render (render.yaml) i stos Dokploy (infra/dokploy) z resztą repozytorium. Rozjazd
// wychodzi w CI, a nie dopiero przy deployu.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  FAKE_PAYMENTS_WEBHOOK_PATH,
  FAKE_SHIPPING_WEBHOOK_PATH,
  loadConfig,
} from '../../src/infra/config/index.js';

const root = (file: string) => fileURLToPath(new URL(`../../../../${file}`, import.meta.url));
const read = (file: string) => readFileSync(root(file), 'utf8');

const dockerfile = read('apps/api/Dockerfile');
const webDockerfile = read('apps/web/Dockerfile');
const blueprint = read('render.yaml');
const compose = read('infra/dokploy/docker-compose.yml');
const deployWorkflow = read('.github/workflows/deploy-dokploy.yml');

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

  it('obraz zawiera każdy pakiet workspace, którego API używa w runtime (także pośrednio)', () => {
    const runtime = new Set<string>();
    const visit = (manifestPath: string) => {
      const manifest = JSON.parse(read(manifestPath)) as { dependencies?: Record<string, string> };
      for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
        const directory = name.replace('@biddy/', '');
        if (version.startsWith('workspace:') && !runtime.has(directory)) {
          runtime.add(directory);
          visit(`packages/${directory}/package.json`);
        }
      }
    };
    visit('apps/api/package.json');
    expect([...runtime]).toEqual(expect.arrayContaining(['shared', 'emails', 'design-tokens']));
    for (const name of runtime) {
      expect(dockerfile, name).toContain(`/repo/packages/${name}/dist ./packages/${name}/dist`);
      expect(blueprint, name).toContain(`- packages/${name}/**`);
    }
  });

  it('pakiety workspace w obrazie mają swoje zależności produkcyjne (node_modules)', () => {
    const packages = [
      ...dockerfile.matchAll(/^COPY --from=builder .*\/repo\/packages\/([\w-]+)\/dist /gm),
    ].map(([, name]) => name ?? '');
    expect(packages).toContain('shared');
    for (const name of packages) {
      const manifest = JSON.parse(read(`packages/${name}/package.json`)) as {
        dependencies?: Record<string, string>;
      };
      if (Object.keys(manifest.dependencies ?? {}).length > 0) {
        expect(dockerfile, name).toContain(
          `COPY --from=production-deps --chown=node:node /repo/packages/${name}/node_modules ./packages/${name}/node_modules`,
        );
      }
    }
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

  it('staging: DEPLOYMENT_ENV=staging i webhooki FakeGateway na publiczny adres API (F-23)', () => {
    expect(blueprint).toMatch(/- key: DEPLOYMENT_ENV\n {8}value: staging\n/);
    const webhook = /- key: PAYMENTS_FAKE_WEBHOOK_URL\n {8}value: (.+)\n/.exec(blueprint)?.[1];
    const apiUrl = /- key: API_PUBLIC_URL\n {8}value: (.+)\n/.exec(blueprint)?.[1];
    expect(webhook).toBe(`${apiUrl ?? ''}${FAKE_PAYMENTS_WEBHOOK_PATH}`);
    const shipping = /- key: SHIPPING_FAKE_WEBHOOK_URL\n {8}value: (.+)\n/.exec(blueprint)?.[1];
    expect(shipping).toBe(`${apiUrl ?? ''}${FAKE_SHIPPING_WEBHOOK_PATH}`);
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

describe('apps/web/Dockerfile', () => {
  it('Node i Turborepo w tych samych wersjach co obraz API', () => {
    for (const arg of ['NODE_IMAGE', 'TURBO_VERSION']) {
      const version = (file: string) => new RegExp(`^ARG ${arg}=(.+)$`, 'm').exec(file)?.[1];
      expect(version(webDockerfile), arg).toBeDefined();
      expect(version(webDockerfile), arg).toBe(version(dockerfile));
    }
  });

  it('buduje samodzielny serwer Next.js (output standalone) i uruchamia go jako node', () => {
    expect(webDockerfile).toMatch(/NEXT_OUTPUT=standalone/);
    expect(read('apps/web/next.config.ts')).toMatch(
      /process\.env\.NEXT_OUTPUT === 'standalone'[\s\S]*?output: 'standalone'/,
    );
    // Turborepo przekazuje do buildu tylko zmienne z listy env (inaczej cache pomija zmianę).
    expect(read('turbo.json')).toMatch(/"@biddy\/web#build"[\s\S]*?"NEXT_OUTPUT"/);
    expect(webDockerfile).toContain('CMD ["node", "apps/web/server.js"]');
    expect(webDockerfile).toMatch(/^USER node$/m);
  });
});

// Stos Dokploy: compose czytany prostym parserem linii (bez zależności od biblioteki YAML).
const composeLines = compose.split('\n');
const envExample = Object.fromEntries(
  [...read('infra/dokploy/.env.example').matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)].map(
    ([, name, value]) => [name ?? '', value ?? ''],
  ),
);
/** Zmienne `${NAZWA}`, `${NAZWA:-domyślna}` i `${NAZWA:?komunikat}` użyte w compose (bez komentarzy). */
const composeConfig = composeLines.filter((line) => !line.trimStart().startsWith('#')).join('\n');
const references = [...composeConfig.matchAll(/\$\{([A-Z][A-Z0-9_]*)(:[?-][^}]*)?\}/g)].map(
  ([, name, modifier]) => ({ name: name ?? '', required: modifier?.startsWith(':?') ?? false }),
);
const requiredVariables = new Set(references.filter((ref) => ref.required).map((ref) => ref.name));
/**
 * Compose wymusza `:?` tylko część zmiennych. Token SMSAPI jest opcjonalny w compose (na stagingu
 * może go zastąpić SMS_LOG_ONLY=true), ale konfiguracja API wymaga go przy SMS_LOG_ONLY=false.
 */
const requiredByConfig = new Set([...requiredVariables, 'SMSAPI_TOKEN']);
/** Przykładowe sekrety o wymaganym formacie (klucz danych do wypłat: 32 bajty w base64, F-27). */
const EXAMPLE_SECRETS: Readonly<Record<string, string>> = {
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};
/** Zmienne stosu jak w szablonie; puste wymagane (sekrety) dostają przykładową wartość. */
const stackVariables: Record<string, string> = Object.fromEntries(
  Object.entries(envExample).map(([name, value]) => [
    name,
    value === '' && requiredByConfig.has(name)
      ? (EXAMPLE_SECRETS[name] ?? `przykladowa-wartosc-${name.toLowerCase()}-0123456789`)
      : value,
  ]),
);

/** Podstawia zmienne stosu tak jak Docker Compose (`:?` bez wartości przerywa deploy). */
function interpolate(value: string): string {
  return value
    .replace(/^'(.*)'$/, '$1')
    .replace(
      /\$\{([A-Z][A-Z0-9_]*)(?::([?-])([^}]*))?\}/g,
      (_match, name: string, kind?: string, fallback?: string) => {
        const given = stackVariables[name] ?? '';
        if (given !== '' || kind === undefined) {
          return given;
        }
        if (kind === '?') {
          throw new Error(`brak wymaganej zmiennej ${name}`);
        }
        return fallback ?? '';
      },
    );
}

/**
 * Pary `NAZWA: wartość` z bloku pod linią `header` (szukaną od linii `after`), po podstawieniu
 * zmiennych. Blok kończy się na pierwszej linii z wcięciem nie większym niż nagłówek.
 */
function composeEnv(header: string, after?: string): Record<string, string> {
  const from = after === undefined ? 0 : composeLines.indexOf(after);
  const start = composeLines.findIndex((line, index) => index > from - 1 && line === header);
  expect(start, header).toBeGreaterThan(-1);
  const indentOf = (line: string) => /^ */.exec(line)?.[0].length ?? 0;
  const entries: Record<string, string> = {};
  for (const line of composeLines.slice(start + 1)) {
    if (indentOf(line) <= indentOf(header)) {
      break;
    }
    const entry = /^\s+([A-Z][A-Z0-9_]*): (.*)$/.exec(line);
    if (entry) {
      entries[entry[1] ?? ''] = interpolate(entry[2] ?? '');
    }
  }
  return entries;
}

const sharedEnv = composeEnv('x-api-env: &api-env');
const apiEnv = { ...sharedEnv, ...composeEnv('    environment:', '  api:') };
const webEnv = composeEnv('    environment:', '  web:');

describe('infra/dokploy (stos na serwerze z Dokploy)', () => {
  it('każda zmienna z compose jest opisana w szablonie .env.example i odwrotnie', () => {
    const used = new Set(references.map((ref) => ref.name));
    expect([...used].filter((name) => !(name in envExample))).toEqual([]);
    expect(Object.keys(envExample).filter((name) => !used.has(name))).toEqual([]);
  });

  it('API i worker przechodzą walidację konfiguracji produkcyjnej ze zmiennymi z szablonu', () => {
    expect(apiEnv['NODE_ENV']).toBe('production');
    expect(loadConfig(apiEnv, 'api').env).toBe('production');
    expect(compose).toMatch(/^ {2}worker:\n(?: {4}.*\n)*? {4}environment: \*api-env$/m);
    expect(loadConfig(sharedEnv, 'worker').env).toBe('production');
  });

  it('staging z szablonu działa z FakeGateway i FakeShipping; BIDDY_ENV=production je blokuje (F-23, F-24)', () => {
    const worker = loadConfig(sharedEnv, 'worker');
    expect(worker.deployment).toBe('staging');
    expect(worker.payments.defaultProvider).toBe('fake');
    expect(worker.payments.fake.enabled).toBe(true);
    expect(worker.shipping.defaultProvider).toBe('fake');
    expect(worker.shipping.fake.enabled).toBe(true);
    expect(sharedEnv['DEPLOYMENT_ENV']).toBe(stackVariables['BIDDY_ENV']);
    const production = { ...apiEnv, DEPLOYMENT_ENV: 'production' };
    expect(() => loadConfig(production, 'api')).toThrow(/PAYMENTS_DEFAULT_PROVIDER/);
    expect(() => loadConfig(production, 'api')).toThrow(/SHIPPING_DEFAULT_PROVIDER/);
  });

  it('staging z SMS_LOG_ONLY=true działa bez tokenu SMSAPI; produkcja odrzuca atrapę SMS (F-08)', () => {
    expect(loadConfig(apiEnv, 'api').sms.kind).toBe('smsapi');
    const logOnly = { ...apiEnv, SMSAPI_TOKEN: '', SMS_LOG_ONLY: 'true' };
    expect(loadConfig(logOnly, 'api').sms).toEqual({ kind: 'log' });
    expect(() => loadConfig({ ...logOnly, DEPLOYMENT_ENV: 'production' }, 'api')).toThrow(
      /SMS_LOG_ONLY/,
    );
  });

  it('adresy Redisa, Meilisearch i API wskazują aliasy usług z tego stosu', () => {
    const aliases = [...compose.matchAll(/aliases: \['(.+)'\]/g)].map(([, alias]) =>
      interpolate(alias ?? ''),
    );
    const urls = [
      sharedEnv['REDIS_QUEUE_URL'],
      sharedEnv['REDIS_CACHE_URL'],
      sharedEnv['MEILI_URL'],
      webEnv['API_INTERNAL_URL'],
      sharedEnv['PAYMENTS_FAKE_WEBHOOK_URL'],
      sharedEnv['SHIPPING_FAKE_WEBHOOK_URL'],
    ];
    for (const url of urls) {
      expect(aliases, url).toContain(new URL(url ?? '').hostname);
    }
    expect(new URL(webEnv['API_INTERNAL_URL'] ?? '').port).toBe(apiEnv['API_PORT']);
    // Webhooki FakeGateway idą na port API i ścieżkę endpointu webhooków (F-23).
    const webhook = new URL(sharedEnv['PAYMENTS_FAKE_WEBHOOK_URL'] ?? '');
    expect(webhook.port).toBe(apiEnv['API_PORT']);
    expect(webhook.pathname).toBe(FAKE_PAYMENTS_WEBHOOK_PATH);
    const shipping = new URL(sharedEnv['SHIPPING_FAKE_WEBHOOK_URL'] ?? '');
    expect(shipping.port).toBe(apiEnv['API_PORT']);
    expect(shipping.pathname).toBe(FAKE_SHIPPING_WEBHOOK_PATH);
  });

  it('migracje i worker wskazują istniejące pliki, a API startuje dopiero po migracjach', () => {
    const commands = [...compose.matchAll(/^ {4}command: \[('node'.*)\]$/gm)].map(([, args]) =>
      (args ?? '').replaceAll(/'|,/g, ''),
    );
    expect(commands).toEqual([
      'node dist/infra/db/migrate.js',
      'node --import ./dist/instrument.js dist/worker.js',
    ]);
    for (const file of commands.flatMap(sourceOf)) {
      expect(existsSync(root(file)), file).toBe(true);
    }
    expect(compose.match(/migrate:\n {8}condition: service_completed_successfully/g)).toHaveLength(
      2,
    );
  });

  it('workflow wdrożenia buduje obrazy, których używa compose', () => {
    expect(compose).toContain('/biddy-api:${BIDDY_TAG:-staging}');
    expect(compose).toContain('/biddy-web-${BIDDY_ENV:-staging}:${BIDDY_TAG:-staging}');
    expect(deployWorkflow).toContain('name="$REGISTRY/biddy-api"');
    expect(deployWorkflow).toContain('name="$REGISTRY/biddy-web-$BIDDY_ENV"');
    // Tag `staging` (najnowszy) i `sha-<commit>` (wycofanie), jak opisuje .env.example.
    expect(deployWorkflow).toContain('echo "$name:sha-$SHA"');
    expect(deployWorkflow).toContain('echo "$name:$BIDDY_ENV"');
    // Wdrożenie i wycofanie idą przez skrypt, który czeka na wersję w /health.
    expect(deployWorkflow).toContain('.github/scripts/dokploy-deploy.sh "$SHA"');
    expect(existsSync(root('.github/scripts/dokploy-deploy.sh'))).toBe(true);
  });

  it('argumenty buildu w workflow istnieją w Dockerfile (literówka nie przechodzi po cichu)', () => {
    const block = /build-args: \|\n((?: {12}.*\n)+)/.exec(deployWorkflow)?.[1] ?? '';
    const args = [...block.matchAll(/^ +([A-Z_]+)=/gm)].map(([, name]) => name ?? '');
    expect(args.length).toBeGreaterThan(5);
    for (const name of args) {
      expect(`${dockerfile}\n${webDockerfile}`, name).toMatch(new RegExp(`^ARG ${name}=`, 'm'));
    }
  });
});
