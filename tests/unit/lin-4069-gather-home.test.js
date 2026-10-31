/**
 * LIN-4069 (piece A of LIN-4068): the one gather, read by Home through the real readers.
 *
 * `gatherTaskStates` is pure; `createHomeRowStates` is Home's assembly over the stores; `rowDataByNodeKey` is the row
 * record the browser paints. Each case runs through those, over one fixture set. The three Done-when shapes of the
 * ticket (old sessions, a Done subtask whose last run failed, a parent more than one level deep) are here, plus the
 * LIN-4008 shape with another project and an assignee filter, and the subtree-busy action (D7).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHomeRowStates, gatherTaskStates } from '../../lib/home-row-states.js';
import { buildSubtreeIndex } from '../../lib/subtree-index.js';
import { rowDataByNodeKey } from '../../lib/task-board-view.js';
import { inReadWindow } from '../../lib/read-horizon.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
import { nodeKey } from '../../lib/tree.js';

const NOW = new Date('2026-10-31T10:00:00.000Z');
const URL_KEY = 'acme';
const daysAgo = (d, min = 0) => new Date(NOW.getTime() - d * 86400000 - min * 60000).toISOString();

let seq = 0;
function loop(id, over = {}) {
  const loopId = `l${++seq}`;
  const at = over.at || daysAgo(0, 30);
  delete over.at;
  return {
    loopId, lineageId: loopId, issueIdentifier: id, kind: 'implementation', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'running',
    dispatchedAt: at, takenAt: at, resolvedAt: at,
    terminalStatus: null, terminalCompletedAt: null, wakeMarker: 'pending', waitingMessage: null,
    feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null, bookkeeping: null,
    ...over,
  };
}
const ended = (status) => (id, kind, at) => loop(id, {
  kind, at, agentState: status, terminalStatus: status, terminalCompletedAt: at, historyStatus: 'resolved',
});
const done = ended('done');
const failed = ended('failed');
const running = (id, kind, at) => loop(id, { kind, at });

const issue = (identifier, type, parent = null, over = {}) => ({
  id: `id-${identifier}`, identifier, title: identifier, state: { name: type, type },
  parent: parent ? { id: `id-${parent}` } : null, ...over,
});

/** Home's assembly over one world, through `createHomeRowStates` and `rowDataByNodeKey`. */
async function homeOf({ issues, loops }) {
  const windowed = (ls) => ls.filter((l) => inReadWindow(l.dispatchedAt, NOW));
  const homeRowStates = createHomeRowStates({
    getLoopsForWorkspace: async () => windowed(loops), dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting, now: () => NOW,
  });
  const home = await homeRowStates({ urlKey: URL_KEY, issues, runControls: true });
  return home;
}

describe('LIN-4069: Home reads the one gather', () => {
  test('old sessions: a Build that failed 45 days ago reads next on Home, and the box offers the step it names', async () => {
    const home = await homeOf({
      issues: [issue('T-1', 'started')],
      loops: [done('T-1', 'research', daysAgo(46)), failed('T-1', 'implementation', daysAgo(45))],
    });
    const row = home.states.get('T-1');
    assert.equal(row.state, 'next');
    assert.equal(row.action.kind, 'step');
    assert.equal(row.action.step.kind, 'research', 'the offer is the step the windowed state names, not Build again');
  });

  test('a Done subtask whose last run failed reads done, and its parent rolls nothing up from it', async () => {
    const home = await homeOf({
      issues: [issue('P-2', 'started'), issue('C-2', 'completed', 'P-2')],
      loops: [done('C-2', 'implementation', daysAgo(2)), failed('C-2', 'review', daysAgo(1))],
    });
    assert.equal(home.states.get('C-2').state, 'done');
    assert.equal(home.states.get('C-2').finished, true);
    assert.notEqual(home.states.get('P-2').state, 'failed', 'the failure stays on the finished child');
  });

  test('a Done child with a running close-out makes its parent read running, and the parent offers no run', async () => {
    const home = await homeOf({
      issues: [issue('P-5', 'started'), issue('C-5', 'completed', 'P-5')],
      loops: [done('C-5', 'implementation', daysAgo(1)), running('C-5', 'close-out', daysAgo(0, 5))],
    });
    const parent = home.states.get('P-5');
    assert.equal(parent.state, 'running');
    assert.equal(parent.action, null, 'busy: a running subtree offers nothing (D7)');
  });

  test('three levels under a Backlog parent, a subtask in another project, and an assignee: the grandchild runs and the parent reads running', async () => {
    const issues = [
      issue('P-3', 'backlog', null, { project: { id: 'proj-a' } }),
      issue('C-3', 'unstarted', 'P-3', { project: { id: 'proj-b' }, assignee: { name: 'Sam' } }),
      issue('G-3', 'started', 'C-3', { project: { id: 'proj-b' } }),
    ];
    const home = await homeOf({ issues, loops: [running('G-3', 'implementation', daysAgo(0, 10))] });
    assert.equal(home.states.get('P-3').state, 'running');
    assert.equal(home.states.get('C-3').state, 'running');
    assert.equal(home.states.get('G-3').state, 'running');
    assert.equal(home.states.get('P-3').container, true);
  });

  test('the index is built over the set BEFORE the assignee filter: a filtered set that drops the grandchild is wrong (mutation)', async () => {
    const issues = [
      issue('P-3', 'backlog', null),
      issue('C-3', 'unstarted', 'P-3', { assignee: { name: 'Sam' } }),
      issue('G-3', 'started', 'C-3'),
    ];
    const loops = [running('G-3', 'implementation', daysAgo(0, 10))];
    const whole = gatherTaskStates({ issues, loops, at: NOW, enrichLoop, deriveSessionWaiting });
    assert.equal(whole.states.get('P-3').state, 'running', 'the whole set: the parent sees the running grandchild');
    // The mutation: the index built after a filter that keeps only the matched task and its ancestor.
    const filtered = issues.filter((i) => i.identifier !== 'G-3');
    const mutated = gatherTaskStates({ issues: filtered, loops, at: NOW, enrichLoop, deriveSessionWaiting });
    assert.notEqual(mutated.states.get('P-3').state, 'running', 'with the grandchild filtered out, the parent cannot see it: the witness detects a post-filter index');
  });

  test('a lean whole-life input and a 30-day input give equal states, including a boundary loop (N2)', () => {
    const issues = [issue('T-7', 'started'), issue('T-8', 'started', 'T-7')];
    const boundary = [
      done('T-8', 'implementation', daysAgo(31)),
      failed('T-8', 'review', daysAgo(29)),
      running('T-8', 'review', daysAgo(0, 4)),
      done('T-7', 'research', daysAgo(40)),
    ];
    const windowedInput = boundary.filter((l) => inReadWindow(l.dispatchedAt, NOW));
    const fromWhole = gatherTaskStates({ issues, loops: boundary, at: NOW, enrichLoop, deriveSessionWaiting }).states;
    const fromWindow = gatherTaskStates({ issues, loops: windowedInput, at: NOW, enrichLoop, deriveSessionWaiting }).states;
    for (const id of ['T-7', 'T-8']) {
      assert.equal(fromWhole.get(id).state, fromWindow.get(id).state, `${id} state`);
      assert.deepEqual(fromWhole.get(id).action, fromWindow.get(id).action, `${id} action`);
    }
  });

  test('the row record carries the gatherer’s action, so the page-load run control offers what the box will', async () => {
    const issues = [issue('P-3', 'backlog', null), issue('C-3', 'unstarted', 'P-3'), issue('G-3', 'started', 'C-3')];
    const home = await homeOf({ issues, loops: [running('G-3', 'implementation', daysAgo(0, 10))] });
    const inProgressTrees = [{ projectName: 'Proj', roots: buildSubtreeIndex(issues) }];
    const byKey = rowDataByNodeKey({ urlKey: URL_KEY, inProgressTrees, recentActivityTrees: [], projectTrees: [], rowStates: home.states });
    assert.equal(byKey[nodeKey(issues[0])].action, null, 'the parent is busy');
    assert.equal(byKey[nodeKey(issues[2])].action, home.states.get('G-3').action);
    assert.equal(byKey[nodeKey(issues[0])].container, true);
  });

  test('the index covers every descendant at every depth, including terminal children', () => {
    const issues = [
      issue('R-1', 'started'),
      issue('M-1', 'completed', 'R-1'),
      issue('L-1', 'started', 'M-1'),
      issue('L-2', 'canceled', 'M-1'),
    ];
    const roots = buildSubtreeIndex(issues);
    const names = (node) => [node.issue.identifier, ...node.children.flatMap(names)];
    // The index keeps terminal children; the cancelled/hidden drop happens upstream, before the index is built.
    assert.deepEqual(names(roots[0]), ['R-1', 'M-1', 'L-1', 'L-2'], 'every descendant at every depth, in identifier order');
  });
});

describe('LIN-4069: a finished task offers no run on Home (LIN-4042)', () => {
  test('a Done leaf and a finished container both carry a null action on the row record', async () => {
    const issues = [
      issue('D-1', 'completed'),
      issue('P-9', 'completed'),
      issue('C-9', 'started', 'P-9'),
    ];
    const home = await homeOf({ issues, loops: [] });
    assert.equal(home.states.get('D-1').action, null, 'a Done leaf offers no run');
    assert.equal(home.states.get('P-9').action, null, 'a finished container offers no Run to PR');
    assert.equal(home.states.get('P-9').finished, true);
  });
});
