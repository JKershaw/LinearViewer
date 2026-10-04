#!/usr/bin/env node
/**
 * Regenerate the checked-in router-prompt byte snapshots (LIN-3304, addendum 1).
 *
 * Run this only when the router prompt text knowingly changes, then review the
 * diff: these files are the witness that the routing prompt is byte-stable. They
 * were first generated from base 75b5c924 (before the seam moved) so the current
 * code is proven byte-identical to the pre-change output, not merely self-consistent.
 *
 * Usage: node scripts/eval/regen-stage-router-snapshots.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildRouterPrompt } from '../../lib/stage-router.js';
import { CASES, renderCase } from '../../tests/fixtures/stage-router-prompts/cases.mjs';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/stage-router-prompts');

for (const entry of CASES) {
  const text = renderCase(entry, { buildRouterPrompt });
  writeFileSync(join(outDir, `${entry.id}.txt`), text);
  console.log(`wrote ${entry.id}.txt (${Buffer.byteLength(text)} bytes)`);
}
