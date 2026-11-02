// `pnpm --filter @biddy/web lighthouse` (po `pnpm build`): Lighthouse strony głównej w profilu
// mobilnym (domyślny: Moto G Power, 4G, spowolniony CPU), jak w kryterium F-06 i PROJECT.md §19.
// Uruchamia `next start` na wolnym porcie (albo bada LIGHTHOUSE_URL), robi 3 pomiary i porównuje
// medianę z progami. Raport HTML ostatniego pomiaru trafia do .lighthouse/.
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { chromium } from '@playwright/test';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';

const PREFIX = '[lighthouse]';
const RUNS = 3;
/** Progi z kryteriów F-06; pozostałe kategorie tylko raportujemy. */
const THRESHOLDS: Readonly<Record<string, number>> = { performance: 0.9, accessibility: 0.9 };
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const APP_DIR = path.resolve(import.meta.dirname, '..');
const REPORT_DIR = path.join(APP_DIR, '.lighthouse');

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  server.close();
  await once(server, 'close');
  if (address === null || typeof address === 'string') {
    throw new Error('Nie udało się zarezerwować wolnego portu');
  }
  return address.port;
}

async function startServer(): Promise<{ url: string; server: ChildProcess }> {
  const port = await freePort();
  const server = spawn(
    'pnpm',
    ['exec', 'next', 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    {
      cwd: APP_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const url = `http://127.0.0.1:${port}/`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error('next start zakończył się przed startem (czy był `pnpm build`?)');
    }
    try {
      if ((await fetch(url)).ok) {
        return { url, server };
      }
    } catch {
      // Serwer jeszcze nie nasłuchuje.
    }
    await delay(500);
  }
  server.kill('SIGTERM');
  throw new Error(`next start nie odpowiedział pod ${url}`);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function main(): Promise<number> {
  const external = process.env['LIGHTHOUSE_URL'];
  const { url, server } =
    external === undefined ? await startServer() : { url: external, server: undefined };
  // Chromium z Playwright (`pnpm exec playwright install chromium`), chyba że podano CHROME_PATH.
  const chrome = await launch({
    chromePath: process.env['CHROME_PATH'] ?? chromium.executablePath(),
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
  });
  const scores: Record<string, number[]> = Object.fromEntries(CATEGORIES.map((id) => [id, []]));
  const failedAudits: string[] = [];
  try {
    for (let run = 1; run <= RUNS; run += 1) {
      const result = await lighthouse(url, {
        port: chrome.port,
        output: 'html',
        logLevel: 'error',
        onlyCategories: CATEGORIES,
      });
      if (result === undefined) {
        throw new Error('Lighthouse nie zwrócił wyniku');
      }
      for (const id of CATEGORIES) {
        scores[id]?.push(result.lhr.categories[id]?.score ?? 0);
      }
      if (run === RUNS) {
        mkdirSync(REPORT_DIR, { recursive: true });
        writeFileSync(path.join(REPORT_DIR, 'home.html'), String(result.report));
        // Niezaliczone audyty (z wagą w wyniku kategorii), żeby od razu było widać przyczynę.
        for (const id of CATEGORIES) {
          for (const ref of result.lhr.categories[id]?.auditRefs ?? []) {
            const audit = result.lhr.audits[ref.id];
            if (
              ref.weight > 0 &&
              audit?.score !== null &&
              audit?.score !== undefined &&
              audit.score < 0.9
            ) {
              failedAudits.push(`${id}: ${audit.title}`);
            }
          }
        }
      }
      const metric = (id: string) => result.lhr.audits[id]?.displayValue ?? '?';
      console.log(
        `${PREFIX} Pomiar ${run}/${RUNS}: ${CATEGORIES.map((id) => `${id} ${Math.round((result.lhr.categories[id]?.score ?? 0) * 100)}`).join(', ')}` +
          ` | FCP ${metric('first-contentful-paint')}, LCP ${metric('largest-contentful-paint')}, TBT ${metric('total-blocking-time')}, CLS ${metric('cumulative-layout-shift')}, JS ${metric('total-byte-weight')}`,
      );
    }
  } finally {
    chrome.kill();
    server?.kill('SIGTERM');
  }

  let failed = false;
  for (const id of CATEGORIES) {
    const value = median(scores[id] ?? []);
    const threshold = THRESHOLDS[id];
    const ok = threshold === undefined || value >= threshold;
    failed ||= !ok;
    console.log(
      `${PREFIX} ${ok ? '✓' : '✗'} ${id}: ${Math.round(value * 100)}${threshold === undefined ? '' : ` (próg ${threshold * 100})`}`,
    );
  }
  for (const audit of failedAudits) {
    console.log(`${PREFIX}   niezaliczone: ${audit}`);
  }
  console.log(
    `${PREFIX} Raport: ${path.relative(process.cwd(), path.join(REPORT_DIR, 'home.html'))}`,
  );
  return failed ? 1 : 0;
}

process.exitCode = await main();
