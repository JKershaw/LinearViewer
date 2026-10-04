/**
 * LIN-3304 review addendum 1: real, checked-in byte snapshots of the router prompts.
 *
 * The seam test (stage-router.test.js) proves `buildRouterPrompt` agrees with the
 * meta template's own `routingOnly` render — new code against new code. That misses
 * a text change in a shared fragment and could not catch review finding 1 (the
 * writer-on routing prompt skipping the provider capability pass for non-Linear
 * providers). This file pins the rendered prompts themselves, as expected text
 * generated from base 75b5c924 (before the seam moved), so a one-character change
 * to either prompt, or a capability pass applied on one path only, fails.
 *
 * The matrix covers a non-Linear provider (GitHub Issues, Local, tracker flag off)
 * and the Step 0 decision-tree branches. Writer ON = buildRouterPrompt (routing-only);
 * Writer OFF = buildMetaPromptTemplate (full).
 *
 * Run with: node --test tests/unit/stage-router-prompt-snapshots.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildRouterPrompt } from '../../lib/stage-router.js';
import { buildMetaPromptTemplate } from '../../lib/prompts/meta-prompt-template.js';
import { CASES, renderCase } from '../fixtures/stage-router-prompts/cases.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = join(__dirname, '../fixtures/stage-router-prompts');
const snapshot = (id) => readFileSync(join(SNAP_DIR, `${id}.txt`), 'utf8');

describe('stage-router prompt byte snapshots (LIN-3304)', () => {
  test('every case renders byte-for-byte to its checked-in snapshot', () => {
    for (const entry of CASES) {
      const actual = renderCase(entry, { buildRouterPrompt, buildMetaPromptTemplate });
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
    const router = renderCase(github, { buildRouterPrompt, buildMetaPromptTemplate });
    assert.ok(!/\bLinear\b/.test(router), 'the writer-on routing prompt must not name Linear for GitHub');
    assert.ok(router.includes('on a GitHub Issues task.'), 'the role line is renamed to the provider display name');
  });

  test('the Step 0 variants are distinct in the writer-on snapshot', () => {
    const complete = snapshot('writer-on.linear.complete-no-open');
    const terminal = snapshot('writer-on.linear.terminal-open-child');
    assert.ok(complete.includes('already complete'), 'the completion branch is present');
    assert.ok(terminal.includes('terminal but still has open children'), 'the terminal-with-open-children branch is present');
  });

  test('the writer-off snapshots are the full template and the writer-on ones are routing-only', () => {
    const writerOff = snapshot('writer-off.linear.leaf');
    const writerOn = snapshot('writer-on.linear.leaf');
    assert.ok(writerOff.includes('## Prompt Structure'), 'the writer-off prompt carries the writing blocks');
    assert.ok(!writerOn.includes('## Prompt Structure'), 'the writer-on routing prompt carries no writing blocks');
    assert.ok(writerOn.length < writerOff.length, 'routing-only is the shorter prompt');
  });
});
