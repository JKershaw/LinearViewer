/**
 * LIN-3304 review addendum 1: real, checked-in byte snapshots of the router prompt.
 *
 * This file pins the rendered routing prompt itself — since LIN-3300 the stage
 * selector, the only prompt a recommendation call sends — so a one-character change to
 * the prompt, or a skipped provider capability pass (review finding 1), fails. The
 * matrix covers a non-Linear provider (GitHub Issues, Local, tracker flag off) and the
 * ticket shapes the rules branch on (leaf, finished node, node with an open subtask, a
 * plan with a plan-review verdict).
 *
 * Run with: node --test tests/unit/stage-router-prompt-snapshots.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildRouterPrompt } from '../../lib/stage-router.js';
import { buildSelectorArgs } from '../../lib/openrouter.js';
import { CASES, renderCase } from '../fixtures/stage-router-prompts/cases.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = join(__dirname, '../fixtures/stage-router-prompts');
const snapshot = (id) => readFileSync(join(SNAP_DIR, `${id}.txt`), 'utf8');

describe('stage-router prompt byte snapshots (LIN-3304)', () => {
  test('every case renders byte-for-byte to its checked-in snapshot', () => {
    for (const entry of CASES) {
      const actual = renderCase(entry, { buildRouterPrompt, buildSelectorArgs });
      assert.equal(actual, snapshot(entry.id),
        `${entry.id} drifted from its checked-in snapshot — a prompt text changed, or the capability pass ` +
        `was skipped. If the change is intended, regenerate with ` +
        `\`node scripts/eval/regen-stage-router-snapshots.mjs\` and review the diff.`);
    }
  });

  test('the snapshot set and the case matrix agree (no stale or missing files)', () => {
    const onDisk = readdirSync(SNAP_DIR).filter((f) => f.endsWith('.txt')).map((f) => f.slice(0, -4)).sort();
    assert.deepStrictEqual(onDisk, CASES.map((c) => c.id).sort(),
      'every case must have exactly one snapshot file and vice versa');
  });

  test('a non-Linear provider is renamed in the routing prompt', () => {
    const github = CASES.find((c) => c.id === 'router.github-issues.leaf');
    const router = renderCase(github, { buildRouterPrompt, buildSelectorArgs });
    assert.ok(!/\bLinear\b/.test(router), 'the routing prompt must not name Linear for GitHub');
    assert.ok(router.includes('for one GitHub Issues ticket.'), 'the role line is renamed to the provider display name');
  });

  test('the ticket shapes are distinct where the rules branch', () => {
    assert.ok(snapshot('router.linear.complete-no-open').includes('- Latest code review: approve-conditional'), 'the finished node carries its code review');
    assert.ok(snapshot('router.linear.terminal-open-child').includes('- Frontier next child'), 'the open-child node carries its frontier');
    assert.ok(snapshot('router.linear.plan-reviewed').includes('- Plan-review verdicts: 1 (1 request changes)'), 'the planned leaf carries its verdicts');
  });

  test('the routing prompt carries no prompt-writing blocks', () => {
    const leaf = snapshot('router.linear.leaf');
    assert.ok(!leaf.includes('## Prompt Structure'), 'no prompt skeleton');
    assert.ok(!leaf.includes('Quality rules for generated prompts'), 'no quality rules');
    assert.ok(!/\n## Prompt\n/.test(leaf), 'no `## Prompt` reply section');
  });
});
