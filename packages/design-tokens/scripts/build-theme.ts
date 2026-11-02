// Część `pnpm build`: zapisuje motyw Tailwind CSS 4 z tokenów do dist/theme.css (po tsdown,
// który czyści dist/).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { themeCss } from '../src/theme-css.js';

const output = path.resolve(import.meta.dirname, '../dist/theme.css');
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, themeCss());
console.log(`[design-tokens] Zapisano ${path.relative(process.cwd(), output)}`);
