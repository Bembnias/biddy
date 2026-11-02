// Nowy cennik POK bez deployu (F-13), do czasu panelu admina (F-34):
//
//   pnpm --filter @biddy/api fees:publish -- --file cennik.json --from 2027-01-01T00:00:00+01:00
//   (na Render, w powłoce usługi API: node dist/fees-publish.js --file … --from …)
//
// Plik to cennik w formacie `feeScheduleSchema` z @biddy/shared, np.
// {"currency":"PLN","fixedFee":299,"tiers":[{"upTo":100000,"bp":700},{"upTo":null,"bp":400}],"vatRateBp":2300}
// Bez `--confirm` skrypt tylko pokazuje porównanie POK dla przykładowych kwot. Z `--confirm`
// zamyka bieżący cennik w chwili `--from` i zapisuje nowy (FeeScheduleService.publish).
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import {
  calculatePok,
  type FeeSchedule,
  feeScheduleSchema,
  formatMoney,
  money,
} from '@biddy/shared';
import { drizzle } from 'drizzle-orm/node-postgres';
import { z } from 'zod';

import { envSchema } from './infra/config/index.js';
import { createPool } from './infra/db/database.js';
import { DomainError } from './infra/http/index.js';
import { FeeScheduleService } from './modules/payments/index.js';

const PREFIX = '[fees:publish]';
/** Przykładowe kwoty z PROJECT.md §3.1 i §3.2 (grosze). */
const SAMPLE_AMOUNTS = [2_000, 10_000, 100_000, 300_000, 1_000_000];

function fail(message: string): never {
  console.error(`${PREFIX} ${message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    from: { type: 'string' },
    note: { type: 'string' },
    confirm: { type: 'boolean', default: false },
  },
});

const env = z
  .object({ DATABASE_URL: envSchema.shape.DATABASE_URL })
  .safeParse({ DATABASE_URL: process.env['DATABASE_URL']?.trim() || undefined });
if (!env.success) {
  fail('Brak lub niepoprawny DATABASE_URL.');
}
if (values.file === undefined || values.from === undefined) {
  fail(
    'Użycie: fees:publish --file cennik.json --from <data ISO ze strefą> [--note "…"] [--confirm]',
  );
}
const validFrom = z.iso.datetime({ offset: true }).safeParse(values.from);
if (!validFrom.success) {
  fail(
    `--from: oczekiwano daty ISO 8601 ze strefą, np. 2027-01-01T00:00:00+01:00 (jest: ${values.from}).`,
  );
}

let input: unknown;
try {
  input = JSON.parse(await readFile(values.file, 'utf8'));
} catch (error) {
  fail(
    `Nie da się odczytać ${values.file}: ${error instanceof Error ? error.message : String(error)}`,
  );
}
const parsed = feeScheduleSchema.safeParse(input);
if (!parsed.success) {
  fail(
    `Błędny cennik:\n${parsed.error.issues.map((issue) => `  • ${issue.path.join('.') || '(całość)'}: ${issue.message}`).join('\n')}`,
  );
}
const schedule: FeeSchedule = parsed.data;

const pool = createPool({ url: env.data.DATABASE_URL, poolMax: 2 });
try {
  const service = new FeeScheduleService(drizzle(pool, { casing: 'snake_case' }));
  const current = await service.current(schedule.currency);
  console.log(
    `${PREFIX} POK brutto: bieżący cennik → nowy (od ${new Date(validFrom.data).toISOString()})`,
  );
  for (const amount of SAMPLE_AMOUNTS) {
    const itemsTotal = money(amount, schedule.currency);
    const before = current === undefined ? '—' : formatMoney(calculatePok(itemsTotal, current).fee);
    const after = formatMoney(calculatePok(itemsTotal, schedule).fee);
    console.log(`  ${formatMoney(itemsTotal).padStart(14)}: ${before.padStart(10)} → ${after}`);
  }
  if (!values.confirm) {
    console.log(`${PREFIX} Podgląd: nic nie zapisano. Dodaj --confirm, żeby opublikować cennik.`);
  } else {
    const published = await service.publish({
      schedule,
      validFrom: new Date(validFrom.data),
      ...(values.note === undefined ? {} : { note: values.note }),
    });
    console.log(
      `${PREFIX} Opublikowano cennik ${published.id}` +
        (current === undefined
          ? '.'
          : `; ${current.id} obowiązuje do ${published.validFrom.toISOString()}.`),
    );
  }
} catch (error) {
  if (error instanceof DomainError) {
    fail(
      `${error.detail}${(error.errors ?? []).map((item) => `\n  • ${item.path}: ${item.message}`).join('')}`,
    );
  }
  throw error;
} finally {
  await pool.end();
}
