// dispatch-legs.test.mjs — LIN-4426. The dispatch classification and the inputs policy, as pure functions.
//
// Run by hand only:  node --test docs/papers/harbour/task-size-and-cost-scripts/dispatch-legs.test.mjs
// Not wired into CI: the unit runner takes only the globs in package.json, and this folder is none of them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AFTER_RE, DEFAULT_INPUTS, checkAfterWording, classifyDispatch, bucketOfKind, lineageBucketOf, takeTaskSizeInputs,
} from './dispatch-legs.mjs';

const AFTER = 'A short, read-only follow-up for research (the Survey; see docs/plans/survey.md) on branch x.';
const ONE_MORE = 'One more short, read-only follow-up for the same research, on the build.';

test('AFTER_RE matches both after-answer openings and nothing else', () => {
  assert.ok(AFTER_RE.test(AFTER));
  assert.ok(AFTER_RE.test(ONE_MORE));
  assert.ok(!AFTER_RE.test('A short, read-only follow-up for the Survey, reworded'));
  assert.ok(!AFTER_RE.test('Please fix the lint in lib/x.js'));
});

test('classifyDispatch: after-answers go to Survey before any kind mapping', () => {
  assert.equal(classifyDispatch({ kind: 'custom', firstLine: AFTER, lineageBucket: 'diff' }), 'survey');
  assert.equal(classifyDispatch({ kind: 'custom', firstLine: ONE_MORE, lineageBucket: 'orchestration' }), 'survey');
});

test('classifyDispatch: survey-* kinds go to Survey; other custom dispatches inherit their lineage bucket', () => {
  assert.equal(classifyDispatch({ kind: 'survey-task', firstLine: undefined, lineageBucket: 'diff' }), 'survey');
  assert.equal(classifyDispatch({ kind: 'custom', firstLine: 'Please fix the lint', lineageBucket: 'diff' }), 'diff');
  // custom is a key of BUCKET_OF_KIND (→ orchestration): it must not be mapped on its own.
  assert.equal(classifyDispatch({ kind: 'custom', firstLine: 'Please fix the lint', lineageBucket: 'before' }), 'before');
});

test('classifyDispatch: own-kind dispatches use the shared mapping (leftover → after, wake → orchestration)', () => {
  assert.equal(classifyDispatch({ kind: 'leftover', lineageBucket: 'diff' }), 'after');
  assert.equal(classifyDispatch({ kind: 'wake', lineageBucket: 'diff' }), 'orchestration');
  assert.equal(classifyDispatch({ kind: 'implementation', lineageBucket: 'before' }), 'diff');
});

test('classifyDispatch: a custom dispatch needs its prompt first line', () => {
  assert.throws(() => classifyDispatch({ kind: 'custom', lineageBucket: 'diff' }), /prompt first line/);
});

test('bucketOfKind refuses a kind the shared mapping does not name (bucketOf would fall back silently)', () => {
  assert.equal(bucketOfKind('implementation'), 'diff');
  assert.throws(() => bucketOfKind('frobnicate'), /"frobnicate" is missing from BUCKET_OF_KIND/);
});

test('lineageBucketOf: a custom-founded lineage takes its coded leg, and an uncoded one throws', () => {
  assert.equal(lineageBucketOf({ kind: 'custom', rootItemId: 'cr' }, { cr: 'work' }), 'diff');
  assert.equal(lineageBucketOf({ kind: 'custom', rootItemId: 'cr' }, { cr: 'floor' }), 'before');
  assert.equal(lineageBucketOf({ kind: 'custom', rootItemId: 'cr' }, { cr: 'survey' }), 'survey');
  assert.throws(() => lineageBucketOf({ kind: 'custom', rootItemId: 'cr' }, {}), /cr has no leg in the inputs/);
  assert.throws(() => lineageBucketOf({ kind: 'custom', rootItemId: 'cr' }, { cr: 'nope' }), /must be one of floor, work, keepAlive, survey/);
});

test('lineageBucketOf: a kind-founded lineage uses the mapping, and a survey-* founder is Survey', () => {
  assert.equal(lineageBucketOf({ kind: 'implementation', rootItemId: 'r' }, {}), 'diff');
  assert.equal(lineageBucketOf({ kind: 'survey-place', rootItemId: 'r' }, {}), 'survey');
  assert.throws(() => lineageBucketOf({ kind: 'frobnicate', rootItemId: 'r' }, {}), /missing from BUCKET_OF_KIND/);
});

test('checkAfterWording: drifted after-answer wording throws; the real wording and unrelated lines pass', () => {
  assert.doesNotThrow(() => checkAfterWording(AFTER, 'p'));
  assert.doesNotThrow(() => checkAfterWording('Please fix the lint', 'p'));
  assert.throws(() => checkAfterWording('A short, read-only follow-up for the Survey, reworded', 'p'), /drifted/);
});

test('takeTaskSizeInputs: an explicit --inputs is read; without it the v1 default applies; a folder with its own inputs.json refuses the default', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lin4426-inputs-'));
  try {
    const own = path.join(dir, 'inputs.json');
    writeFileSync(own, JSON.stringify({ window_start: 'W', attribution: 'dispatch' }));
    const explicit = takeTaskSizeInputs(['EV', '--inputs', own], 'u', [dir]);
    assert.equal(explicit.inputs.attribution, 'dispatch');
    assert.deepEqual(explicit.positional, ['EV']);

    const empty = mkdtempSync(path.join(os.tmpdir(), 'lin4426-empty-'));
    try {
      const implicit = takeTaskSizeInputs(['EV'], 'u', [empty]);
      assert.equal(implicit.inputsPath, DEFAULT_INPUTS);
      assert.equal(implicit.inputs.version, 'v1');
      assert.deepEqual(implicit.positional, ['EV']);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }

    assert.throws(() => takeTaskSizeInputs(['EV'], 'u', [dir]), /refusing the implicit default inputs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
