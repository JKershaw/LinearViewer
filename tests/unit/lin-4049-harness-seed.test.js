/**
 * LIN-4049 (LIN-4040 S1, beat 4): the subtree seed, read through the real local provider and store, and the read counts
 * the ticket names.
 *
 * `subtreeLocalSeed` (tests/fixtures/local-harness.js) is the one extension of the canonical seed for the subtree cases:
 * a deep chain (LOCAL-30 > 31 > 32 > 33), an over-cap parent (LOCAL-40 with cap + 1 children), and a subtask in another
 * project (LOCAL-50's child LOCAL-51 is in Local Beta). `defaultLocalSeed` stays as it was.
 *
 * Witnesses: the seed's shape, read from the store; the deep chain read by the page and a running leaf three levels down
 * blocking the box; the over-cap parent failing closed on both surfaces; the other-project subtask in the hint; and the
 * read counts (one tracker read per descendant on a page load and none on the poll; one stored read per descendant on the
 * poll; rulings read once per poll).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalProvider, subtreeLocalSeed, defaultLocalSeed } from '../fixtures/local-harness.js';
import { buildSubtreeIndex, subtreeHintsByNodeKey, SUBTREE_READ_CAP } from '../../lib/subtree-index.js';
import { createTaskPageLoader, sessionSummaryOf } from '../../lib/task-page-loader.js';
import { enrichLoop, deriveSessionWaiting, deriveSessionDecisions } from '../../routes/dashboard.js';
import { isHiddenState } from '../../lib/providers/state-map.js';
import { nodeKey } from '../../lib/tree.js';

const URL_KEY = 'harness-seed';
const NOW = new Date('2026-10-30T10:06:00.000Z');

/** The real local provider over a real store, seeded with the subtree seed. */
async function seeded() {
  const { provider, store } = createLocalProvider();
  await store.seed(URL_KEY, subtreeLocalSeed(URL_KEY));
  return { provider, store };
}

/** The provider the loader reads through, with every tracker read recorded by identifier. */
function countingProvider(provider) {
  const reads = [];
  const wrapper = Object.create(provider);
  wrapper.fetchRecommendationContext = (token, identifier, opts) => {
    reads.push(identifier);
    return provider.fetchRecommendationContext(token, identifier, opts);
  };
  return { wrapper, reads };
}

function runningLoop(identifier) {
  return {
    loopId: `${identifier}-l`, lineageId: `${identifier}-l`, issueIdentifier: identifier, kind: 'implementation', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'running',
    dispatchedAt: '2026-10-30T10:00:00.000Z', takenAt: '2026-10-30T10:01:00.000Z', resolvedAt: '2026-10-30T10:01:00.000Z',
    terminalStatus: null, terminalCompletedAt: null, wakeMarker: 'pending', waitingMessage: null,
    feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null, bookkeeping: null,
  };
}

/** A loader over the seed's stored sessions. `counts` records each stored read by identifier and each ruling read. */
function loaderWith({ loopsOf = () => [], counts = { loops: new Map(), rulings: 0 } } = {}) {
  const taskDecisionsStore = {
    listUnansweredForWorkspaces: async () => { counts.rulings += 1; return []; },
    listNewestScanPerTask: async () => ({}),
  };
  return createTaskPageLoader({
    dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting, deriveSessionDecisions,
    getLoopsForIssue: async (_urlKey, identifier) => {
      counts.loops.set(identifier, (counts.loops.get(identifier) || 0) + 1);
      return loopsOf(identifier);
    },
    taskDecisionsStore, shelvedRulingsStore: null, now: () => NOW,
  });
}

/** The index's issues, as Home builds them from a fetch: the store's docs, with canceled issues dropped (`isHiddenState`). */
async function indexIssuesOf(store) {
  const docs = await store.listIssues(URL_KEY);
  return docs
    .filter((doc) => !isHiddenState({ state: doc.state }))
    .map((doc) => ({
      id: doc._id, identifier: doc.identifier, state: doc.state, projectId: doc.projectId,
      parent: doc.parentId ? { id: doc.parentId } : null,
    }));
}

const edgesOf = (subtree) => subtree.edges.map(([parent, child, type]) => ({ parent, child, type }));

describe('LIN-4049 — the seed: preserved and extended once', () => {
  test('preserved: defaultLocalSeed is unchanged, four issues, its counts intact', () => {
    assert.equal(defaultLocalSeed(URL_KEY).issues.length, 4);
    assert.deepEqual(defaultLocalSeed(URL_KEY).issues.map((i) => i.identifier), ['LOCAL-1', 'LOCAL-2', 'LOCAL-3', 'LOCAL-4']);
  });

  test('extended: the deep chain, the over-cap parent and the other-project subtask are in the store, and the index holds them', async () => {
    const { store } = await seeded();
    const roots = buildSubtreeIndex(await indexIssuesOf(store));
    const find = (identifier, nodes = roots) => nodes.map((n) => (n.issue.identifier === identifier ? n : find(identifier, n.children))).find(Boolean) || null;

    const deep = find('LOCAL-30');
    assert.deepEqual(deep.children.map((n) => n.issue.identifier), ['LOCAL-31']);
    assert.deepEqual(deep.children[0].children.map((n) => n.issue.identifier), ['LOCAL-32']);
    assert.deepEqual(deep.children[0].children[0].children.map((n) => n.issue.identifier), ['LOCAL-33'], 'a descendant three levels down');

    assert.equal(find('LOCAL-40').children.length, SUBTREE_READ_CAP + 1, 'the over-cap parent has cap + 1 children');

    const other = find('LOCAL-50');
    const child = other.children.find((n) => n.issue.identifier === 'LOCAL-51');
    assert.ok(child, 'the other-project subtask is a child of its parent in the index');
    assert.notEqual(child.issue.projectId, other.issue.projectId, 'and it sits in a different project from its parent');
  });
});

describe('LIN-4049 — a deep descendant: the page reads it, and a running leaf three levels down blocks the box', () => {
  test('the page\'s hint reaches the leaf, the poll sees it running, and the box offers no action', async () => {
    const { provider, store } = await seeded();
    const { wrapper, reads } = countingProvider(provider);
    const loader = loaderWith({ loopsOf: (id) => (id === 'LOCAL-33' ? [runningLoop('LOCAL-33')] : []) });
    const page = await loader.loadTaskPage({ urlKey: URL_KEY, identifier: 'LOCAL-30', access: { provider: wrapper, callScope: URL_KEY } });
    assert.ok(page.subtree.edges.some(([parent, child]) => parent === 'LOCAL-32' && child === 'LOCAL-33'), 'the hint carries the leaf');

    const state = await loader.loadTaskState({ urlKey: URL_KEY, identifier: 'LOCAL-30', edges: edgesOf(page.subtree), incomplete: page.subtree.incomplete });
    assert.equal(state.rowState.state, 'running', 'the parent rolls up the running leaf');
    const summary = sessionSummaryOf(state.model, { container: state.container, rowState: state.rowState, overCap: state.overCap, incomplete: state.incomplete });
    assert.deepEqual(summary.actions, []);
    assert.ok(reads.includes('LOCAL-33'), 'the page read reached the leaf');
  });
});

describe('LIN-4049 — over the cap, the box fails closed on both surfaces, with the seed', () => {
  test('the page reads the root only, sends cap + 1 edges, and the box says why', async () => {
    const { provider, store } = await seeded();
    const { wrapper, reads } = countingProvider(provider);
    const loader = loaderWith();
    const page = await loader.loadTaskPage({ urlKey: URL_KEY, identifier: 'LOCAL-40', access: { provider: wrapper, callScope: URL_KEY } });
    assert.deepEqual(reads, ['LOCAL-40'], 'over the cap the walk stops: nothing below the root is read');
    assert.equal(page.subtree.edges.length, SUBTREE_READ_CAP + 1);

    const state = await loader.loadTaskState({ urlKey: URL_KEY, identifier: 'LOCAL-40', edges: edgesOf(page.subtree), incomplete: page.subtree.incomplete });
    assert.equal(state.overCap, true);
    const summary = sessionSummaryOf(state.model, { container: state.container, rowState: state.rowState, overCap: state.overCap });
    assert.deepEqual(summary.actions, []);
    assert.match(summary.note, /more subtasks than the run box checks/);
  });

  test('Home\'s index hint for the same parent is over the cap too, and the box says the same', async () => {
    const { store } = await seeded();
    const roots = buildSubtreeIndex(await indexIssuesOf(store));
    const parent = roots.flatMap(function walk(n) { return [n, ...n.children.flatMap(walk)]; }).find((n) => n.issue.identifier === 'LOCAL-40');
    const hint = subtreeHintsByNodeKey(roots).get(nodeKey(parent.issue));
    assert.equal(hint.edges.length, SUBTREE_READ_CAP + 1, 'Home\'s hint stops at cap + 1');

    const loader = loaderWith();
    const state = await loader.loadTaskState({
      urlKey: URL_KEY, identifier: 'LOCAL-40', edges: hint.edges.map(([parentId, child, type]) => ({ parent: parentId, child, type })), incomplete: false,
    });
    assert.equal(state.overCap, true);
    const summary = sessionSummaryOf(state.model, { container: state.container, rowState: state.rowState, overCap: state.overCap });
    assert.deepEqual(summary.actions, []);
    assert.match(summary.note, /more subtasks than the run box checks/);
  });
});

describe('LIN-4049 — a subtask in another project is in the hint, as the index holds it', () => {
  test('the page\'s hint for the parent in Local Project carries its child in Local Beta', async () => {
    const { provider } = await seeded();
    const { wrapper } = countingProvider(provider);
    const loader = loaderWith();
    const page = await loader.loadTaskPage({ urlKey: URL_KEY, identifier: 'LOCAL-50', access: { provider: wrapper, callScope: URL_KEY } });
    assert.deepEqual(page.subtree.edges, [['LOCAL-50', 'LOCAL-51', 'unstarted']]);
  });
});

describe('LIN-4049 — read counts', () => {
  test('a page load reads the tracker once per descendant, in breadth-first order; the poll reads the tracker not at all', async () => {
    const { provider } = await seeded();
    const { wrapper, reads } = countingProvider(provider);
    const counts = { loops: new Map(), rulings: 0 };
    const loader = loaderWith({ counts });
    const page = await loader.loadTaskPage({ urlKey: URL_KEY, identifier: 'LOCAL-30', access: { provider: wrapper, callScope: URL_KEY } });
    assert.deepEqual(reads, ['LOCAL-30', 'LOCAL-31', 'LOCAL-32', 'LOCAL-33'], 'the task, then each descendant once');

    const before = reads.length;
    counts.loops.clear();
    counts.rulings = 0;
    await loader.loadTaskState({ urlKey: URL_KEY, identifier: 'LOCAL-30', edges: edgesOf(page.subtree), incomplete: page.subtree.incomplete });
    assert.equal(reads.length, before, 'the poll makes no tracker read');
  });

  test('a poll reads each descendant\'s sessions once from the store, and the rulings once for the whole subtree', async () => {
    const counts = { loops: new Map(), rulings: 0 };
    const loader = loaderWith({ counts });
    await loader.loadTaskState({
      urlKey: URL_KEY, identifier: 'LOCAL-30',
      edges: [
        { parent: 'LOCAL-30', child: 'LOCAL-31', type: 'unstarted' },
        { parent: 'LOCAL-31', child: 'LOCAL-32', type: 'unstarted' },
        { parent: 'LOCAL-32', child: 'LOCAL-33', type: 'unstarted' },
      ],
      incomplete: false,
    });
    assert.deepEqual([...counts.loops.keys()].sort(), ['LOCAL-30', 'LOCAL-31', 'LOCAL-32', 'LOCAL-33']);
    assert.ok([...counts.loops.values()].every((n) => n === 1), 'one stored read per identifier');
    assert.equal(counts.rulings, 1, 'the rulings are read once per poll, not once per descendant');
  });
});
