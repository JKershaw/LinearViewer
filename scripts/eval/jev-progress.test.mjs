// LIN-3169 — pure-function tests for the Jev progress eval. No network, no cache files.
//   node --test scripts/eval/jev-progress.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrub, doneLooksLike, QUESTIONS, VIEWS, rps, score, ev, computeNorms, normsText, toBins } from './jev-progress-eval.mjs';

test('scrub drops post-hoc close-out sections, merge paragraphs and ticked boxes', () => {
  const desc = [
    '## Problem', 'Tests idle for 25s.', '',
    '## Acceptance', '- [x] no open handles', '',
    '## Shipped (close-out 2026-09-29)', 'Merged via PR #1609, merge commit `dab2bc7`.', '### Evidence', 'CI green.', '',
    '## Implementation Plan', 'Step one.', '', '**Completion stub.** Shipped in PR #1602 (merged as `50588ae`).', '',
    '## Dependencies', 'Blocked by LIN-3059, which must be merged first.',
  ].join('\n');
  const out = scrub(desc);
  assert.match(out, /Tests idle for 25s/);
  assert.match(out, /- \[ \] no open handles/);
  assert.doesNotMatch(out, /Shipped|dab2bc7|CI green|50588ae|Completion stub/);
  assert.match(out, /Step one/);
  assert.match(out, /must be merged first/, 'plan language about merging is not a leak');
});

test('doneLooksLike prefers the acceptance section, else the opening', () => {
  const d = doneLooksLike('Intro.\n\n## Acceptance\nThe DI witness passes. Census moves by +2. Extra.\n\n## Scope\nx');
  assert.equal(d.source, 'acceptance-section');
  assert.equal(d.text.replace(/\s+/g, ' '), 'The DI witness passes. Census moves by +2.'); // first two sentences only
  assert.equal(doneLooksLike('Stop four unit-test files idling. More detail here. And more.').source, 'description-opening');
});

test('rem2 maps "N more sessions" onto band floor(10·k/(k+N))', () => {
  const probs = { 1: 0.5, 3: 0.5 }; // k=3: 3/4 → band 7, 3/6 → band 5
  const d = QUESTIONS.rem2.map({ p: { probabilities: probs } }, { k: 3 });
  assert.equal(d[7], 0.5);
  assert.equal(d[5], 0.5);
  assert.equal(d.reduce((a, b) => a + b, 0), 1);
});

test('cdf forces a monotone survival curve before differencing', () => {
  const a = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => [`t${t}`, { noul: t === 5 ? 0.9 : t < 5 ? 0.8 : 0.1 }]));
  const d = QUESTIONS.cdf.map(a);
  assert.ok(d.every((x) => x >= 0));
  assert.ok(Math.abs(d.reduce((s, x) => s + x, 0) - 1) < 1e-9);
});

test('rps is 0 for a point mass on the truth band and grows with distance', () => {
  const point = (i) => Array.from({ length: 10 }, (_, j) => (j === i ? 1 : 0));
  assert.equal(rps(point(4), 45), 0);
  assert.ok(rps(point(6), 45) > rps(point(5), 45));
  assert.ok(Math.abs(ev(toBins(Array(10).fill(1))) - 50) < 1e-9);
});

test('score reports within-task ordering and 80% coverage', () => {
  const snaps = [{ id: 'A', truth: 25 }, { id: 'A', truth: 75 }];
  const point = (t) => Array.from({ length: 10 }, (_, j) => (j === Math.floor(t / 10) ? 1 : 0));
  const m = score(snaps, (s) => point(s.truth));
  assert.equal(m.order, 1);
  assert.equal(m.cover80, 1);
  assert.equal(m.mae, 0);
});

test('computeNorms reproduces the norms sentence shape', () => {
  const n = computeNorms([['plan', 'implementation', 'review', 'close-out'], ['implementation', 'review', 'implementation', 'review', 'close-out'], ['research', 'plan', 'implementation', 'review', 'close-out', 'review']]);
  assert.deepEqual(n, { n: 3, p25: 4, median: 5, p75: 5, afterImpl: 3, afterReview: 2 });
  assert.match(normsText(n), /usually takes 4 to 5 agent work sessions in total \(median 5\)/);
});

test('the winning view carries flags and norms but never session dates', () => {
  const s = { id: 'LIN-1', title: 't', labels: [], description: 'd', comments: [{ at: '2026-09-01T00:00:00Z', body: '## Review — Request Changes on PR #5' }], sessions: [{ kind: 'implementation', at: '2026-09-01T00:00:00Z', minutes: 9 }, { kind: 'review', at: '2026-09-02T00:00:00Z', minutes: 4 }] };
  const v = VIEWS.rawnf(s);
  assert.deepEqual(v.agentSessionsRun, ['implementation', 'review']);
  assert.equal(v.latestReviewVerdict, 'request-changes');
  assert.equal(v.reviewRoundsSoFar, 1);
  assert.match(v.workspaceNorms, /median 5/);
});
