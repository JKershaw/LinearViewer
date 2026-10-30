/**
 * LIN-4039 (Tidy 2): one answer to what's next for a parent.
 *
 * A parent's "next" is decided in one seam (`parentNextOf`). Its row (`buildRowStates`), the prompt seed the providers
 * hand the model (`focusedChild`, the frontier facts) and the descent's redirect all read it, so they name the same
 * subtask. The model keeps its own `deferTo` (LIN-328); these tests prove the seed agrees, not what the live model picks.
 *
 * Witnesses: W1 an all-Todo parent's row and seed name the same child, and Home's trimmed view still reads it as a
 * container; W2 a blocked first child is skipped by both sides (the blocked facts are synthesised from the fetched
 * relations); W3 a parked first child is named by both (the one behaviour change); W4 one container meaning; W5 one
 * place: `selectFocusSubtask(` appears in lib/ and routes/ only inside the seam's module.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRowStates } from '../../lib/task-page-loader.js';
import { parentNextOf, computeFrontierFacts, selectFocusSubtask } from '../../lib/recommendation-facts.js';
import { withInverseRelations } from '../../lib/graph-features.js';
import { rowDataByNodeKey } from '../../lib/task-board-view.js';
import { hasOpenSubtask, nextWordsOf } from '../../lib/task-state.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
import { createHomeRowStates } from '../../lib/home-row-states.js';

const NOW = new Date('2026-10-30T10:00:00.000Z');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function loop(over = {}) {
  return {
    loopId: 'l1', lineageId: 'l1', issueIdentifier: 'LIN-1', kind: 'research', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'running',
    dispatchedAt: '2026-10-30T09:00:00.000Z', takenAt: '2026-10-30T09:01:00.000Z', resolvedAt: '2026-10-30T09:01:00.000Z',
    terminalStatus: null, terminalCompletedAt: null, wakeMarker: 'pending', waitingMessage: null,
    feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null, bookkeeping: null,
    ...over,
  };
}
// A waiting session with no structured question: a park (LIN-4010), not a ruling.
const parkedLoop = (over = {}) => loop({
  wakeMarker: 'blocked', waitingMessage: '[blocked] waiting on the vendor',
  feedback: [{ message: '[blocked] waiting on the vendor', timestamp: '2026-10-30T09:05:00.000Z' }], ...over,
});

const issue = (identifier, type = 'started', extra = {}) => ({
  id: `id-${identifier}`, identifier, title: identifier, state: { name: type, type }, ...extra,
});
const node = (identifier, type = 'started', children = []) => ({ issue: issue(identifier, type), children, depth: 0 });

function states(roots, loops = {}) {
  return buildRowStates({
    roots, loopsByIdentifier: new Map(Object.entries(loops)), enrichLoop, deriveSessionWaiting, now: NOW, sessionsVisible: true,
  });
}

/** The row's named subtask, read off the row's words (`Next: <Step> on <ID>`), or null. */
const namedOn = (words) => (words && (words.match(/ on (LIN-\d+)$/) || [])[1]) || null;

/** The prompt seed's subtask for a parent: what the providers hand the model as `focusedChild`. */
const seedOf = (children) => {
  const pick = parentNextOf(children);
  return pick ? pick.identifier : null;
};

describe('LIN-4039 — the seam is the picker when nothing of the parent is asked', () => {
  test('with no own facts, parentNextOf is selectFocusSubtask exactly, and null when every child is terminal', () => {
    const open = [issue('LIN-11', 'unstarted'), issue('LIN-12', 'unstarted')];
    assert.equal(parentNextOf(open), selectFocusSubtask(open));
    const done = [issue('LIN-13', 'completed')];
    assert.equal(parentNextOf(done), null);
    assert.equal(computeFrontierFacts(done).nextChild, null);
  });

  test('the parent\'s own facts gate the pick: busy, failed or landed means the parent runs its own step', () => {
    const open = [issue('LIN-14', 'unstarted')];
    assert.equal(parentNextOf(open, { busy: true }), null);
    assert.equal(parentNextOf(open, { failed: true }), null);
    assert.equal(parentNextOf(open, { landed: true }), null);
    assert.equal(parentNextOf(open, { busy: false, failed: false, landed: false }).identifier, 'LIN-14');
  });
});

describe('LIN-4039 — W1: an all-Todo parent\'s row and seed name the same child', () => {
  test('the row names the child the prompt seed starts from, and the wording says which child', () => {
    const c1 = node('LIN-21', 'unstarted');
    const c2 = node('LIN-22', 'unstarted');
    const parent = node('LIN-20', 'started', [c1, c2]);
    const s = states([parent]);
    const row = s.get('LIN-20').words;
    assert.equal(namedOn(row), 'LIN-21', `row says "${row}"`);
    assert.match(row, /^Next: Research on LIN-21$/);
    assert.equal(seedOf([c1.issue, c2.issue]), 'LIN-21');
    assert.equal(computeFrontierFacts([c1.issue, c2.issue]).nextChild, 'LIN-21');
  });

  test('on Home the trimmed view still reads a started parent as a container, and the row says so', () => {
    const parent = node('LIN-30', 'started', [node('LIN-31', 'unstarted'), node('LIN-32', 'unstarted')]);
    const s = states([parent]);
    // Home's trimmed view folds the open children into `more`: the node has no children left.
    const trimmed = { roots: [{ issue: parent.issue, children: [], depth: 0, more: 2 }] };
    const rowData = rowDataByNodeKey({ urlKey: 'ws', inProgressTrees: [trimmed], recentActivityTrees: [], projectTrees: [], rowStates: s });
    const record = rowData[Object.keys(rowData)[0]];
    assert.equal(record.container, true, 'the full tree decides container, not the trimmed view');
  });

  test('a parent whose subtasks are all done is not a container on Home (it offers its own step)', () => {
    const parent = node('LIN-40', 'started', [node('LIN-41', 'completed'), node('LIN-42', 'completed')]);
    const s = states([parent]);
    const rowData = rowDataByNodeKey({ urlKey: 'ws', inProgressTrees: [{ roots: [parent] }], recentActivityTrees: [], projectTrees: [], rowStates: s });
    assert.equal(rowData[Object.keys(rowData)[0]].container, false);
    assert.equal(hasOpenSubtask(parent.children.map((c) => c.issue)), false);
  });
});

describe('LIN-4039 — W2: a blocked first child is skipped by the row and the seed alike', () => {
  test('the blocker sits in the fetched set; its forward relation synthesises the blocked fact on both sides', () => {
    const blocker = { ...issue('LIN-51', 'started'), relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'id-LIN-52' } }] } };
    const c1 = node('LIN-52', 'unstarted');
    const c2 = node('LIN-53', 'unstarted');
    const parent = node('LIN-50', 'started', [c1, c2]);
    const [linked] = withInverseRelations([[parent, { issue: blocker, children: [], depth: 0 }]]);
    const linkedParent = linked[0];
    const s = states([linkedParent, linked[1]]);
    assert.equal(namedOn(s.get('LIN-50').words), 'LIN-53', `row says "${s.get('LIN-50').words}"`);
    assert.equal(seedOf(linkedParent.children.map((c) => c.issue)), 'LIN-53');
  });

  test('Home\'s own row-state assembly applies the same synthesis: the blocked first child is skipped on the row', async () => {
    const blocker = { ...issue('LIN-56', 'started'), relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'id-LIN-57' } }] } };
    const parent = node('LIN-55', 'started', [node('LIN-57', 'unstarted'), node('LIN-58', 'unstarted')]);
    const homeRowStates = createHomeRowStates({
      getLoopsForWorkspace: async () => [], dispatchStore: null, agentStatusStore: null, taskDecisionsStore: null,
      shelvedRulingsStore: null, enrichLoop, deriveSessionWaiting, now: () => NOW,
      onError: (message) => assert.fail(message),
    });
    const result = await homeRowStates({
      urlKey: 'ws', inProgressTrees: [{ roots: [parent] }], recentActivityTrees: [],
      projectTrees: [{ incomplete: [{ issue: blocker, children: [], depth: 0 }], completed: [] }], runControls: true,
    });
    assert.equal(namedOn(result.states.get('LIN-55').words), 'LIN-58', `row says "${result.states.get('LIN-55').words}"`);
  });

  test('withInverseRelations does not mutate the input nodes', () => {
    const blocker = { ...issue('LIN-54', 'started'), relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'id-LIN-55' } }] } };
    const target = node('LIN-55', 'unstarted');
    withInverseRelations([[{ issue: blocker, children: [], depth: 0 }, target]]);
    assert.equal(target.issue.inverseRelations, undefined);
  });
});

describe('LIN-4039 — W3: a parked first child is named by both (the one recorded behaviour change)', () => {
  test('the row and the seed agree on the parked child; the row does not hide it behind the parent\'s own step', () => {
    const c1 = node('LIN-61', 'unstarted');
    const c2 = node('LIN-62', 'unstarted');
    const parent = node('LIN-60', 'started', [c1, c2]);
    const s = states([parent], { 'LIN-61': [parkedLoop({ issueIdentifier: 'LIN-61' })] });
    assert.equal(s.get('LIN-61').state, 'parked');
    assert.equal(seedOf([c1.issue, c2.issue]), 'LIN-61');
    assert.equal(namedOn(s.get('LIN-60').words), 'LIN-61', `row says "${s.get('LIN-60').words}"`);
  });
});

describe('LIN-4039 — the wording lives in one function', () => {
  test('a task\'s own step keeps "<Step> next"; a subtask\'s step names the subtask', () => {
    assert.equal(nextWordsOf({ next: 'Research' }), 'Research next');
    assert.equal(nextWordsOf({ next: 'Research', nextOn: 'LIN-71' }), 'Next: Research on LIN-71');
  });
});

describe('LIN-4039 — W5: one place decides the pick', () => {
  test('selectFocusSubtask( is called only inside the seam\'s module, under lib/ and routes/', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) {
          const rel = path.relative(ROOT, full);
          if (rel === path.join('lib', 'recommendation-facts.js')) continue;
          if (/selectFocusSubtask\(/.test(fs.readFileSync(full, 'utf8'))) offenders.push(rel);
        }
      }
    };
    walk(path.join(ROOT, 'lib'));
    walk(path.join(ROOT, 'routes'));
    assert.deepEqual(offenders, [], 'every pick goes through parentNextOf');
  });
});
