#!/usr/bin/env node
/**
 * Regenerate meta-prompt.baseline.txt (Arm A) from the LIVE routing prompt
 * (lib/stage-router.js buildRouterPrompt, the one prompt a recommendation call sends
 * since LIN-3300).
 *
 * Run this whenever the router prompt changes, so the eval's baseline stays a faithful
 * snapshot. After shipping a proven candidate, run this then
 * `cp meta-prompt.baseline.txt meta-prompt.candidate.txt` to reset A==B.
 *
 * The snapshot is for a LEAF task (no subtasks/comments), featureFlags:{} —
 * exactly what the proxy passes — with {{ISSUE_CONTEXT}} / {{IDENTIFIER}} left as
 * placeholders the harness fills per case.
 */
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildRouterPrompt } from '../../lib/stage-router.js';
import { buildSelectorArgs } from '../../lib/openrouter.js';

// The facts a leaf with no comments and no plan gets (LIN-3300: the selector's facts).
const leaf = buildSelectorArgs({ identifier: '{{IDENTIFIER}}', title: '', state: {}, labels: [] }, {});
const text = buildRouterPrompt({ ...leaf, view: '{{ISSUE_CONTEXT}}', featureFlags: {} });

const out = join(dirname(fileURLToPath(import.meta.url)), 'meta-prompt.baseline.txt');
writeFileSync(out, text);
console.log(`wrote baseline snapshot: ${text.length} chars -> ${out}`);
