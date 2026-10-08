#!/usr/bin/env node
/**
 * scripts/figure-theme.mjs  (LIN-3351)
 *
 * Applies the dark-mode theme block to every Library figure SVG
 * (`npm run figures:theme`). Idempotent. `--check` rewrites nothing and exits 1
 * listing any figure that is untreated or stale. Re-run after (re)generating a
 * figure: the generators write single-theme light SVGs.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { themeSvg } from './lib/figure-theme.mjs';

export const FIGURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'papers', 'harbour', 'figures');

export function listFigures(dir = FIGURES_DIR) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? listFigures(join(dir, e.name)) : e.name.endsWith('.svg') ? [join(dir, e.name)] : []);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const stale = [];
  for (const file of listFigures()) {
    const before = readFileSync(file, 'utf8');
    const after = themeSvg(before);
    if (after === before) continue;
    stale.push(relative(FIGURES_DIR, file));
    if (!check) writeFileSync(file, after);
  }
  if (check && stale.length) {
    console.error(`Untreated or stale figures (run \`npm run figures:theme\`):\n  ${stale.join('\n  ')}`);
    process.exit(1);
  }
  console.log(check ? 'All figures themed.' : `Themed ${stale.length} figure(s).`);
}
