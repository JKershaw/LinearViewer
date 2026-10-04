/**
 * LIN-3304 review addendum 1: real, checked-in byte snapshots of the router prompts.
 *
 * This file pins the rendered prompts themselves, so a one-character change to
 * either prompt, or a capability pass applied on one path only, fails. Writer ON =
 * the stage selector (LIN-3300), rendered from fixed tickets; Writer OFF =
 * buildMetaPromptTemplate (full), generated from base 75b5c924 and unchanged since.
 *
 * The matrix covers a non-Linear provider (GitHub Issues, Local, tracker flag off)
 * and the ticket shapes the selector's rules branch on.
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
import { buildMetaPromptTemplate } from '../../lib/prompts/meta-prompt-template.js';
import { CASES, renderCase } from '../fixtures/stage-router-prompts/cases.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = join(__dirname, '../fixtures/stage-router-prompts');
const snapshot = (id) => readFileSync(join(SNAP_DIR, `${id}.txt`), 'utf8');

describe('stage-router prompt byte snapshots (LIN-3304)', () => {
  test('every case renders byte-for-byte to its checked-in snapshot', () => {
    for (const entry of CASES) {
      const actual = renderCase(entry, { buildRouterPrompt, buildSelectorArgs, buildMetaPromptTemplate });
      assert.equal(actual, snapshot(entry.id),
        `${entry.id} drifted from its checked-in snapshot — a prompt text changed, or a capability pass ` +
        `is now applied on one path only. If the change is intended, regenerate with ` +
        `\`node scripts/eval/regen-stage-router-snapshots.mjs\` and review the diff.`);
    }
  });

  test('the snapshot set and the case matrix agree (no stale or missing files)', () => {
    const onDisk = readdirSync(SNAP_DIR).filter((f) => f.endsWith('.txt')).map((f) => f.slice(0, -4)).sort();
    assert.deepStrictEqual(onDisk, CASES.map((c) => c.id).sort(),
      'every case must have exactly one snapshot file and vice versa');
  });

  test('a non-Linear provider is renamed on BOTH paths, not just the full template', () => {
    const github = CASES.find((c) => c.id === 'writer-on.github-issues.leaf');
    const router = renderCase(github, { buildRouterPrompt, buildSelectorArgs, buildMetaPromptTemplate });
    assert.ok(!/\bLinear\b/.test(router), 'the selector must not name Linear for GitHub');
    const full = renderCase(CASES.find((c) => c.id === 'writer-off.github-issues.leaf'), { buildRouterPrompt, buildSelectorArgs, buildMetaPromptTemplate });
    assert.ok(full.includes('on a GitHub Issues task.'), 'the full template\'s role line is renamed to the provider display name');
  });

  test('the selector snapshots carry the facts each ticket shape needs (LIN-3300)', () => {
    const complete = snapshot('writer-on.linear.complete-no-open');
    const terminal = snapshot('writer-on.linear.terminal-open-child');
    const reviewed = snapshot('writer-on.linear.plan-reviewed');
    assert.ok(complete.includes('Latest code review: approve-conditional'), 'the review verdict is a code fact');
    assert.ok(complete.includes('- Subtasks: 2 (2 done, 0 in progress, 0 remaining)'), 'the node counts are facts');
    assert.ok(terminal.includes('**State:** Done (completed)') && terminal.includes('Frontier next child'), 'a terminal node with an open child sees both');
    assert.ok(reviewed.includes('**PLAN-REVIEW FACTS'), 'a plan-review verdict brings its facts');
  });

  test('the writer-off snapshots are the full template and the writer-on ones are routing-only', () => {
    const writerOff = snapshot('writer-off.linear.leaf');
    const writerOn = snapshot('writer-on.linear.leaf');
    assert.ok(writerOff.includes('## Prompt Structure'), 'the writer-off prompt carries the writing blocks');
    assert.ok(!writerOn.includes('## Prompt Structure'), 'the writer-on routing prompt carries no writing blocks');
    assert.ok(writerOn.length < writerOff.length, 'routing-only is the shorter prompt');
  });
});
