/**
 * LIN-4016 W2 — a failing subtask: the parent's row, the count line and the subtask line agree.
 *
 * The bug this pins: a subtask's Build fails. Its row said "Build failed", the parent's row said "Build failed", the
 * count line said "1 failed", but the parent's opened task said "A subtask needs you: C-9" (the flag `needsYou` was
 * true for a failure, and the subtask line read it). Now the parent's row state carries `attention`, the one subtask
 * line, which names a failed subtask as failed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildRowStates } from '../../lib/task-page-loader.js';
import { buildInProgressCountParts, subtaskNeedingYouByNodeKey } from '../../lib/task-board-view.js';
import { buildHomeView } from '../../lib/home-view.js';
import { nodeKey } from '../../lib/tree.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';

const NOW = new Date('2026-10-30T10:06:00.000Z');

function loop(over = {}) {
  return {
    loopId: 'l1', lineageId: 'l1', issueIdentifier: 'LIN-C9', kind: 'implementation', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'running',
    dispatchedAt: '2026-10-30T10:00:00.000Z', takenAt: '2026-10-30T10:01:00.000Z', resolvedAt: '2026-10-30T10:01:00.000Z',
    terminalStatus: null, terminalCompletedAt: null, wakeMarker: 'pending', waitingMessage: null,
    feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null, bookkeeping: null,
    ...over,
  };
}
// A child whose Build failed (its latest session ended failed).
const failedBuild = (over = {}) => loop({
  kind: 'implementation', agentState: 'failed', terminalStatus: 'failed', terminalCompletedAt: '2026-10-30T10:02:00.000Z',
  resolvedAt: '2026-10-30T10:02:00.000Z', historyStatus: 'resolved', ...over,
});
// A child that waits on an open ruling.
const rulingChild = (over = {}) => loop({
  wakeMarker: 'blocked', waitingMessage: '[blocked] which way?',
  feedback: [{ message: '[blocked] which way?', timestamp: '2026-10-30T10:05:00.000Z' }],
  decision: { decision_id: 'd-1', question: 'Which way?' }, decisionCase: [], answeredDecisions: [], withdrawal: null, ...over,
});

const issue = (identifier, type = 'started') => ({
  id: `id-${identifier}`, identifier, title: `Title ${identifier}`, source: 'linear', state: { name: type, type },
});
const node = (identifier, children = [], type = 'started') => ({ issue: issue(identifier, type), children, depth: 0 });

/** Row states for a parent with the given children, and the loops each task holds (by identifier). */
function statesFor(parent, loops = {}) {
  return buildRowStates({
    roots: [parent],
    loopsByIdentifier: new Map(Object.entries(loops)),
    enrichLoop,
    deriveSessionWaiting,
    now: NOW,
    sessionsVisible: true,
  });
}

describe('LIN-4016 W2 — a parent whose subtask\'s Build failed', () => {
  const parent = node('LIN-P1', [node('LIN-C9')]);
  const loops = { 'LIN-C9': [failedBuild({ issueIdentifier: 'LIN-C9' })] };

  test('the child row says Build failed; the parent row says failed, with the same words', () => {
    const s = statesFor(parent, loops);
    assert.equal(s.get('LIN-C9').state, 'failed');
    assert.equal(s.get('LIN-C9').words, 'Build failed');
    assert.equal(s.get('LIN-P1').state, 'failed');
    assert.equal(s.get('LIN-P1').words, 'Build failed');
  });

  test('the count line says 1 failed and no waiting-on-you part', () => {
    const s = statesFor(parent, loops);
    const texts = buildInProgressCountParts([{ projectName: 'P', roots: [parent] }], s, { rulingCount: 0 }).map((p) => p.text);
    assert.deepEqual(texts, ['1 failed']);
  });

  test('the parent carries the failed subtask as its attention, and the opened task names it as failed, not as needing you', () => {
    const s = statesFor(parent, loops);
    assert.deepEqual(s.get('LIN-P1').attention, {
      identifier: 'LIN-C9', title: 'Title LIN-C9', state: 'failed', lead: 'A subtask failed', detail: ' · Build failed',
      words: 'A subtask failed: LIN-C9 · Build failed',
    });
    const byKey = subtaskNeedingYouByNodeKey({ urlKey: 'acme', inProgressTrees: [{ roots: [parent] }], rowStates: s });
    assert.equal(byKey[nodeKey(parent.issue)].words, 'A subtask failed: LIN-C9 · Build failed');
    assert.doesNotMatch(byKey[nodeKey(parent.issue)].words, /needs you/);
  });

  test('a child that needs you is named as needing you, not as failed', () => {
    const s = statesFor(node('LIN-P2', [node('LIN-C8')]), { 'LIN-C8': [rulingChild({ issueIdentifier: 'LIN-C8' })] });
    assert.equal(s.get('LIN-P2').state, 'needs-you');
    assert.equal(s.get('LIN-P2').attention.words, 'A subtask needs you: LIN-C8');
    assert.equal(s.get('LIN-P2').attention.state, 'needs-you');
  });

  test('a subtask that needs you wins over a failed one, whichever is first', () => {
    const both = node('LIN-P3', [node('LIN-C9'), node('LIN-C8')]);
    const s = statesFor(both, { 'LIN-C9': [failedBuild({ issueIdentifier: 'LIN-C9' })], 'LIN-C8': [rulingChild({ issueIdentifier: 'LIN-C8' })] });
    assert.equal(s.get('LIN-P3').attention.identifier, 'LIN-C8');
    assert.equal(s.get('LIN-P3').attention.words, 'A subtask needs you: LIN-C8');
  });

  test('the parent\'s own stage failed and a child also failed: no subtask line, the parent\'s own failure only', () => {
    const own = node('LIN-P4', [node('LIN-C9')]);
    const s = statesFor(own, { 'LIN-P4': [failedBuild({ issueIdentifier: 'LIN-P4' })], 'LIN-C9': [failedBuild({ issueIdentifier: 'LIN-C9' })] });
    assert.equal(s.get('LIN-P4').state, 'failed');
    assert.equal(s.get('LIN-P4').attention, null);
  });

  test('a parent with many other children (the "N more" fold) still names the failed child', () => {
    // The parent has six started children; the failed one is last. The trimmed Home view folds the rest.
    const quiet = Array.from({ length: 5 }, (_, i) => node(`LIN-Q${i}`));
    const parentMany = node('LIN-P5', [...quiet, node('LIN-C9')]);
    const s = statesFor(parentMany, { 'LIN-C9': [failedBuild({ issueIdentifier: 'LIN-C9' })] });
    const view = buildHomeView({ inProgressTrees: [{ projectName: 'P', roots: [parentMany] }], trees: [], states: s, topTaskId: null });
    const shownChildren = view.inProgressTrees[0].roots[0].children.map((c) => c.issue.identifier);
    assert.ok(shownChildren.includes('LIN-C9'), 'the failed child is kept as its own reason to show');
    assert.equal(s.get('LIN-P5').attention.identifier, 'LIN-C9', 'and the line names it from the full tree');
  });
});
