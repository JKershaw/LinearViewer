/**
 * LIN-3107 — tests for the distilled-state builder and the eval's deterministic helpers.
 *
 * Run: node --test scripts/eval/jev-routing-state.test.mjs
 *
 * These exercise the state builder against hand-built fixtures (node facts, session fit,
 * frontier child, divergence marker, leaf/node/all-terminal defer eligibility) and the
 * harness's grading + gold-override seams. They use the exported, shared facts seam
 * (lib/recommendation-facts.js); production is never imported beyond that read-only seam.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDistilledState, summarizeTrail } from './jev-routing-state.mjs';
import { gradeAnswer, applyOverrides, loadCases, wilson, mcNemar, newcombeDifference, GOLD_OVERRIDES, assertNoServerImport, resolveOutDir } from './jev-routing-eval.mjs';

const STARTED = { name: 'In Progress', type: 'started' };
const DONE = { name: 'Done', type: 'completed' };
const TODO = { name: 'Todo', type: 'unstarted' };

const leaf = (identifier, description, comments = []) => ({
  issue: { id: identifier, identifier, title: 't', description, state: { ...STARTED }, labels: [] },
  parent: null, siblings: [], siblingsTotal: 0, project: null,
  children: [], comments, focusedChild: null,
});

const node = (identifier, children, description = '', focusId = null) => ({
  issue: { id: identifier, identifier, title: 't', description, state: { ...STARTED }, labels: [] },
  parent: null, siblings: [], siblingsTotal: 0, project: null,
  children,
  comments: [],
  focusedChild: focusId ? { issue: children.find((c) => c.identifier === focusId), comments: [] } : null,
});

test('node facts reuse assembleNodeFacts counts', () => {
  const state = buildDistilledState(node('N-1', [
    { id: 'a', identifier: 'N-1a', title: 'a', state: { ...DONE } },
    { id: 'b', identifier: 'N-1b', title: 'b', state: { ...STARTED } },
    { id: 'c', identifier: 'N-1c', title: 'c', state: { ...TODO } },
  ], 'fits one session', 'N-1b'));
  assert.equal(state.hasSubtasks, true);
  assert.equal(state.nodeFacts.subtaskCount, 3);
  assert.equal(state.nodeFacts.completedCount, 1);
  assert.equal(state.nodeFacts.inProgressCount, 1);
  assert.equal(state.nodeFacts.remainingCount, 2);
  assert.equal(state.nodeFacts.hasOpenChildren, true);
  assert.equal(state.nodeFacts.frontierFacts.openCount, 2);
});

test('session fit is extracted from the description', () => {
  assert.equal(buildDistilledState(leaf('L-1', 'Session fit: needs multiple sessions')).sessionFit, 'needs multiple sessions');
  assert.equal(buildDistilledState(leaf('L-2', 'This fits one focused session.')).sessionFit, 'fits one session');
  assert.equal(buildDistilledState(leaf('L-3', 'no fit statement here')).sessionFit, null);
});

test('frontier child is the selectFocusSubtask pick (in-progress first)', () => {
  const state = buildDistilledState(node('N-2', [
    { id: 'x', identifier: 'N-2x', title: 'x', state: { ...TODO } },
    { id: 'y', identifier: 'N-2y', title: 'y', state: { ...STARTED } },
  ], '', 'N-2y'));
  assert.equal(state.deferTarget, 'N-2y');
  assert.equal(state.nodeFacts.frontierFacts.nextChild, 'N-2y');
});

test('divergence marker flags a later comment that refutes an earlier finding', () => {
  const trail = summarizeTrail([
    { user: 'a', createdAt: '2026-01-01T00:00:00Z', body: 'Investigation: root cause is the module-load stall. Plan: bound the wait.' },
    { user: 'b', createdAt: '2026-01-02T00:00:00Z', body: 'Live capture REFUTES that cause; the proposed cause does not fire and is unvalidated.' },
  ]);
  assert.equal(trail.divergenceMarker.flagged, true);
  assert.ok(trail.divergenceMarker.commentIndexes.includes(1));
  const calm = summarizeTrail([
    { user: 'a', createdAt: '2026-01-01T00:00:00Z', body: 'Plan ready, fits one session.' },
    { user: 'b', createdAt: '2026-01-02T00:00:00Z', body: 'Implemented; PR open, CI green.' },
  ]);
  assert.equal(calm.divergenceMarker.flagged, false);
});

test('defer eligibility: leaf is false/null', () => {
  const state = buildDistilledState(leaf('L-4', 'a leaf'));
  assert.equal(state.deferEligible, false);
  assert.equal(state.deferTarget, null);
});

test('defer eligibility: node with a non-terminal child is true/named', () => {
  const state = buildDistilledState(node('N-3', [
    { id: 'p', identifier: 'N-3p', title: 'p', state: { ...DONE } },
    { id: 'q', identifier: 'N-3q', title: 'q', state: { ...TODO } },
  ], '', 'N-3q'));
  assert.equal(state.deferEligible, true);
  assert.equal(state.deferTarget, 'N-3q');
});

test('defer eligibility: node with ALL-terminal children is false/null', () => {
  const state = buildDistilledState(node('N-4', [
    { id: 'm', identifier: 'N-4m', title: 'm', state: { ...DONE } },
    { id: 'n', identifier: 'N-4n', title: 'n', state: { ...DONE } },
  ], 'all children complete'));
  assert.equal(state.deferEligible, false);
  assert.equal(state.deferTarget, null);
  assert.equal(state.nodeFacts.hasOpenChildren, false);
});

test('grading: a leaf defer is a miss for every arm', () => {
  const caseObj = { gold: { expect: ['implement'], avoid: null, loop: false } };
  assert.equal(gradeAnswer(caseObj, 'defer', false).hit, false);
  assert.equal(gradeAnswer(caseObj, 'bug', false).hit, false);
  assert.equal(gradeAnswer(caseObj, 'implement', false).hit, true);
});

test('grading: implementation normalizes to implement for both gold and answer', () => {
  const caseObj = { gold: { expect: ['implement'], avoid: null, loop: false } };
  assert.equal(gradeAnswer(caseObj, 'implementation', false).hit, true);
  assert.equal(gradeAnswer({ gold: { expect: ['implementation'] } }, 'implement', false).hit, true);
});

test('grading: node defer is scored on action only', () => {
  const caseObj = { gold: { expect: ['defer'], avoid: null, loop: false } };
  assert.equal(gradeAnswer(caseObj, 'defer', true).hit, true);
  assert.equal(gradeAnswer(caseObj, 'defer', false).hit, false);
});

test('gold overrides: binding corrections are present and shaped right', () => {
  assert.deepEqual(GOLD_OVERRIDES['LIN-385@breakdown'].expect, ['plan-review']);
  assert.deepEqual(GOLD_OVERRIDES['FIX-830-pos'].expect, ['breakdown', 'plan-review']);
  assert.equal(GOLD_OVERRIDES['LIN-571'].avoid, 'plan');
  assert.equal(GOLD_OVERRIDES['LIN-571'].loop, true);

  const cases = [
    { id: 'LIN-571', gold: { expect: ['breakdown', 'implementation'], avoid: 'plan', loop: true, deferTarget: null } },
    { id: 'LIN-385@breakdown', gold: { expect: ['breakdown'], avoid: null, loop: false, deferTarget: null } },
    { id: 'FIX-830-pos', gold: { expect: ['breakdown'], avoid: null, loop: false, deferTarget: null } },
  ];
  const applied = applyOverrides(cases);
  assert.equal(applied.length, 3);
  assert.deepEqual(cases[0].gold.expect, ['plan-review']);
  assert.equal(cases[0].gold.avoid, 'plan');
  assert.equal(cases[0].gold.loop, true);
  assert.deepEqual(cases[1].gold.expect, ['plan-review']);
  assert.deepEqual(cases[2].gold.expect, ['breakdown', 'plan-review']);
});

test('fixture loader yields the full 66-strong widened population', () => {
  const cases = loadCases();
  const counts = cases.reduce((m, c) => { m[c.source] = (m[c.source] || 0) + 1; return m; }, {});
  assert.equal(counts.A, 7);
  assert.equal(counts.B, 30);
  assert.equal(counts.C, 24);
  assert.equal(counts.D, 5);
  assert.equal(cases.length, 66);
  const applied = applyOverrides(cases);
  assert.deepEqual(applied.map((a) => a.id).sort(), ['FIX-830-pos', 'LIN-385@breakdown', 'LIN-571', 'SYN-12']);
});

test('harness never imports server.js', () => {
  assert.equal(assertNoServerImport(), true);
});

test('output dir: DRY cannot default to the canonical jev-routing-out evidence', () => {
  const here = '/repo/scripts/eval';
  const canonical = join(here, 'jev-routing-out');
  // Non-DRY default stays canonical.
  assert.equal(resolveOutDir(false, undefined, here), canonical);
  // DRY default must leave the canonical dir alone.
  const dry = resolveOutDir(true, undefined, here);
  assert.notEqual(dry, canonical);
  assert.ok(dry.startsWith(tmpdir()), `dry default should be under tmpdir, got ${dry}`);
  assert.ok(!dry.endsWith('jev-routing-out'), `dry default must not be the canonical dir, got ${dry}`);
  // An explicit OUT_DIR always wins, DRY or not.
  assert.equal(resolveOutDir(true, '/tmp/explicit', here), '/tmp/explicit');
  assert.equal(resolveOutDir(false, '/tmp/explicit', here), '/tmp/explicit');
});

test('statistics: wilson bounds a proportion, McNemar/Newcombe behave on a known 2x2', () => {
  const w = wilson(30, 66);
  assert.ok(w.lo < 30 / 66 && w.hi > 30 / 66);
  const m = mcNemar([[true, false], [true, false], [false, true], [false, false]]);
  assert.equal(m.b, 2);
  assert.equal(m.c, 1);
  const n = newcombeDifference(10, 2, 3, 5);
  assert.ok(n.lo <= n.delta && n.delta <= n.hi);
});
