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
 * Close-out added the producer witnesses review's ledger named: W4 the Swipe and task-page producers of the container
 * fact, `sessions.next` silenced for a container, and W1's provider half (the local provider's seed names the row's child).
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
import { orderIssuesForSwipe } from '../../lib/task-board-view.js';
import { sessionSummaryOf, createTaskPageLoader } from '../../lib/task-page-loader.js';
import { deriveSessionDecisions } from '../../routes/dashboard.js';
import { createTaskPageRoutes } from '../../routes/task-page.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { createLocalProvider } from '../fixtures/local-harness.js';
// Side-effect import: the shared nav resolves the legacy default provider.
import '../../lib/providers/linear/index.js';

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

describe('LIN-4039 — W4: the Swipe and task-page producers read the one container meaning', () => {
  // A Swipe deck over one parent card and its subtask cards; `childType` is the state every subtask is in.
  const swipeParent = (childTypes) => {
    const mk = (id, type, over = {}) => ({
      id, identifier: id.toUpperCase(), title: id, priority: 3, url: '', state: { type, name: type },
      labels: { nodes: [] }, relations: { nodes: [] }, project: { id: 'p1' }, ...over,
    });
    const children = childTypes.map((type, i) => ({ issue: mk(`c${i}`, type, { parent: { id: 'par' } }), children: [], depth: 1, isInProgress: false, projectName: 'P' }));
    const parent = { issue: mk('par', 'started'), children, depth: 0, isInProgress: true, projectName: 'P' };
    return orderIssuesForSwipe({
      projectTrees: [{ project: { id: 'p1', name: 'P' }, incomplete: [parent], completed: [] }],
      inProgressTrees: [{ projectName: 'P', roots: [parent] }], recentActivityTrees: [], urlKey: 'ws',
    }).find((card) => card.id === 'par');
  };

  test('Swipe: a parent card whose subtasks are all completed is not a container; one open subtask makes it one', () => {
    assert.equal(swipeParent(['completed', 'completed']).row.container, false);
    assert.equal(swipeParent(['completed', 'unstarted']).row.container, true);
  });

  const PARENT_CTX = (childStates) => ({
    issue: { id: 'id-par', identifier: 'LIN-80', title: 'Parent', url: null, state: { name: 'In Progress', type: 'started' }, labels: [], blockedBy: [] },
    parent: null,
    children: childStates.map((type, i) => ({ id: `id-c${i}`, identifier: `LIN-8${i + 1}`, title: `Child ${i}`, url: null, state: { name: type, type }, labels: [], blockedBy: [] })),
    comments: [],
  });
  let providerSeq = 0;
  const taskPageFor = async (ctx) => {
    const name = `lin-4039-task-page-${++providerSeq}`;
    registerProvider({
      name, ui: { inlineEdit: false, inlineCreate: false }, supports: () => true,
      fetchRecommendationContext: async () => ctx,
      fetchIssueComments: async () => [], fetchIssueFields: async () => null, fetchProjects: async () => ({ projects: [] }),
    });
    const loader = createTaskPageLoader({
      dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting, deriveSessionDecisions,
      getLoopsForIssue: async () => [], shelvedRulingsStore: null, now: () => NOW,
    });
    const router = createTaskPageRoutes({
      workspaceFromUrl: (req, res, next) => next(), getOpenRouterSource: () => 'env', getDeployInfo: () => ({}),
      loader, workspaceOwnerCheck: async () => ({ status: 'owner' }), now: () => NOW,
    });
    const layer = router.stack.find((l) => l.route?.path === '/workspace/:urlKey/task/:identifier' && l.route.methods.get);
    const req = {
      session: { workspaces: [], features: {}, accountId: 'acct-1' },
      workspace: { urlKey: 'acme', provider: name, accessToken: 'tok' },
      params: { urlKey: 'acme', identifier: 'LIN-80' }, query: {}, get: () => 'localhost',
    };
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, send(b) { this.body = b; return this; }, set() { return this; } };
    await layer.route.stack[layer.route.stack.length - 1].handle(req, res, (err) => { if (err) throw err; });
    assert.equal(res.statusCode, 200);
    return res.body;
  };
  const stateUrlOf = (html) => (html.match(/data-state-url="([^"]*)"/) || [])[1];

  test('task page: an all-done parent passes no container=1 to the state read; one open subtask does', async () => {
    const done = await taskPageFor(PARENT_CTX(['completed', 'completed']));
    assert.doesNotMatch(stateUrlOf(done), /container=1/);
    const open = await taskPageFor(PARENT_CTX(['completed', 'unstarted']));
    assert.match(stateUrlOf(open), /container=1/);
  });

  test('task page: the row record the page embeds carries the same container fact', async () => {
    const container = (html) => html.match(/&quot;container&quot;:(true|false)|"container":(true|false)/);
    const done = container(await taskPageFor(PARENT_CTX(['completed'])));
    const open = container(await taskPageFor(PARENT_CTX(['unstarted'])));
    assert.ok(done && open, 'the page embeds the owner\'s row record');
    assert.equal(done[1] || done[2], 'false');
    assert.equal(open[1] || open[2], 'true');
  });
});

describe('LIN-4039 — a container\'s own session guess is silenced (surface 3: sessions.next)', () => {
  const model = { sessions: [], guesses: ['research', 'implementation'] };
  test('sessionSummaryOf names no next step for a container, and the same model still names one for a leaf', () => {
    assert.equal(sessionSummaryOf(model, { container: true }).next, null);
    const leaf = sessionSummaryOf(model, { container: false }).next;
    assert.equal(leaf.kind, 'research');
    assert.ok(leaf.label);
  });
});

describe('LIN-4039 — W1 (provider half): the seed the provider hands the model starts from the row\'s child', () => {
  test('all-Todo children under a started parent with a finished Research: the local provider\'s focusedChild is the child the row names', async () => {
    const { provider, store } = createLocalProvider();
    await store.seed('ws-4039', {
      projects: [{ id: 'p1', name: 'Alpha', sortOrder: 1 }],
      issues: [
        { id: 'iP', identifier: 'LOCAL-1', title: 'P', projectId: 'p1', state: { name: 'In Progress', type: 'started' } },
        { id: 'iC1', identifier: 'LOCAL-2', title: 'C-1', projectId: 'p1', parentId: 'iP', state: { name: 'Todo', type: 'unstarted' } },
        { id: 'iC2', identifier: 'LOCAL-3', title: 'C-2', projectId: 'p1', parentId: 'iP', state: { name: 'Todo', type: 'unstarted' } },
      ],
    });
    const ctx = await provider.fetchRecommendationContext('ws-4039', 'LOCAL-1');
    // The row, over the same shape: P is started with its Research finished, both children Todo.
    const c1 = node('LOCAL-2', 'unstarted');
    const parent = node('LOCAL-1', 'started', [c1, node('LOCAL-3', 'unstarted')]);
    const researched = loop({ issueIdentifier: 'LOCAL-1', kind: 'research', agentState: 'done', terminalStatus: 'completed', terminalCompletedAt: '2026-10-30T09:30:00.000Z' });
    const row = states([parent], { 'LOCAL-1': [researched] }).get('LOCAL-1').words;
    assert.equal(row, 'Next: Research on LOCAL-2');
    assert.equal(ctx.focusedChild.issue.identifier, 'LOCAL-2');
    assert.equal(ctx.focusedChild.issue.identifier, row.match(/ on (LOCAL-\d+)$/)?.[1], 'the seed and the row name the same child');
  });
});
