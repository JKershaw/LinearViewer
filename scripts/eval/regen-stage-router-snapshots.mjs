#!/usr/bin/env node
/**
 * Regenerate the checked-in router-prompt byte snapshots (LIN-3304, addendum 1).
 *
 * Run this only when the router prompt text knowingly changes, then review the
 * diff: these files are the witness that the stage selector (writer on) and the
 * writer-off full prompt are byte-stable. The writer-off files were first generated
 * from base 75b5c924 (before the seam moved); LIN-3300 regenerated the selector ones.
 *
 * Usage: node scripts/eval/regen-stage-router-snapshots.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildRouterPrompt } from '../../lib/stage-router.js';
import { buildSelectorArgs } from '../../lib/openrouter.js';
import { buildMetaPromptTemplate } from '../../lib/prompts/meta-prompt-template.js';
import { CASES, renderCase } from '../../tests/fixtures/stage-router-prompts/cases.mjs';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/stage-router-prompts');

for (const entry of CASES) {
  const text = renderCase(entry, { buildRouterPrompt, buildSelectorArgs, buildMetaPromptTemplate });
  writeFileSync(join(outDir, `${entry.id}.txt`), text);
  console.log(`wrote ${entry.id}.txt (${Buffer.byteLength(text)} bytes)`);
}
