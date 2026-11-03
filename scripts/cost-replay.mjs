#!/usr/bin/env node
/**
 * LIN-4177: the cost replay. Runs every replayed surface over the fixture corpus
 * (tests/fixtures/cost-replay/corpus.js) and either records the goldens or checks the current code
 * against them.
 *
 *   node scripts/cost-replay.mjs --record   write tests/fixtures/cost-replay/goldens.json
 *   node scripts/cost-replay.mjs            check: list every path that differs from the goldens
 *
 * The check exits 1 when anything differs. Which differences are intended is pinned separately, by
 * tests/fixtures/cost-replay/expected-changes.json (the change list), in tests/unit/cost-replay.test.js.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runReplay } from '../tests/fixtures/cost-replay/harness.js';
import { diffReplay } from '../tests/fixtures/cost-replay/diff.js';

const GOLDENS = fileURLToPath(new URL('../tests/fixtures/cost-replay/goldens.json', import.meta.url));

const current = await runReplay();

if (process.argv.includes('--record')) {
  await writeFile(GOLDENS, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`recorded goldens: ${GOLDENS}`);
  console.log(`mixed-harness lineages: ${current.mixedHarness.lineages.length} (${current.mixedHarness.lineages.join(', ') || 'none'})`);
  process.exit(0);
}

const golden = JSON.parse(await readFile(GOLDENS, 'utf8'));
const diffs = diffReplay(golden, current);
console.log(`mixed-harness lineages: ${current.mixedHarness.lineages.length} (${current.mixedHarness.lineages.join(', ') || 'none'})`);
if (diffs.length === 0) {
  console.log('replay: identical to goldens');
  process.exit(0);
}
console.log(`replay: ${diffs.length} differing path(s)`);
for (const path of diffs) console.log(`  ${path}`);
process.exit(1);
