#!/usr/bin/env node
/**
 * Regenerate the checked-in router-prompt byte snapshots (LIN-3304, addendum 1).
 *
 * Run this only when the router prompt text knowingly changes, then review the
 * diff: these files are the witness that the routing prompt (the stage selector since
 * LIN-3300) is byte-stable.
 *
 * Usage: node scripts/eval/regen-stage-router-snapshots.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildRouterPrompt } from '../../lib/stage-router.js';
import { buildSelectorArgs } from '../../lib/openrouter.js';
import { CASES, renderCase } from '../../tests/fixtures/stage-router-prompts/cases.mjs';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/stage-router-prompts');

for (const entry of CASES) {
  const text = renderCase(entry, { buildRouterPrompt, buildSelectorArgs });
  writeFileSync(join(outDir, `${entry.id}.txt`), text);
  console.log(`wrote ${entry.id}.txt (${Buffer.byteLength(text)} bytes)`);
}
