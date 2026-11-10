#!/usr/bin/env node
/**
 * LIN-4197 beat 4: records the sibling goldens, goldens-lin4197.json (the existing corpus at this commit, each
 * LIN-4197 stage run on its own, and the mixed-harness control; see lin4197-replay.js).
 *
 *   node tests/fixtures/cost-replay/record-lin4197.mjs
 *
 * This writes ONLY goldens-lin4197.json. It does not touch goldens.json, which is the LIN-4177 baseline (9e397e6b)
 * that expected-changes.json is measured from. scripts/cost-replay.mjs --record still rewrites goldens.json; do not
 * run it without re-baselining the change list.
 *
 * It seeds the pinned price catalog first (LIN-4358), as the tests that compare against this file do: unseeded, the
 * stages re-price and S5 to S13 move for a reason that has nothing to do with the change being recorded (LIN-4404).
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { recordLin4197, LIN4197_GOLDENS_HEADER } from './lin4197-replay.js';
import { seedPinnedCatalog } from '../../unit/helpers/pinned-catalog.js';

seedPinnedCatalog();

const OUT = fileURLToPath(new URL('./goldens-lin4197.json', import.meta.url));
const lin = await recordLin4197();
await writeFile(OUT, `${JSON.stringify({ header: LIN4197_GOLDENS_HEADER, ...lin }, null, 2)}\n`);
console.log(`recorded ${OUT}`);
