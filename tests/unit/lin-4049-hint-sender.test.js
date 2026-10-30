/**
 * LIN-4049 (LIN-4040 S1, beat 3): the subtree hint, end to end, from its two senders to the `/state` response.
 *
 * Witnesses, each driven through the real code rather than a hand-built hint:
 *   - the Home path: the row's server-built subtree (the index, via `rowDataByNodeKey`) goes into the browser's own
 *     state read (`prompt-section.js`'s `readTaskState`); the browser's request is served by the real `/state` route and
 *     loader; the box it paints offers no run while a grandchild runs;
 *   - the task-page path: the page's state URL carries the subtree the page read once; `/state` serves it;
 *   - the two senders agree on nodes and child order, so Home's row and the opened task name the same state;
 *   - over the cap, both surfaces fail closed with the plain sentence; an unreadable subtree fails closed too;
 *   - `container=1` is gone from both senders and from the server;
 *   - the `/state` read itself never calls the provider (the poll does not repeat the tracker read).
 *
 * A positive control (a leaf with nothing running) shows the box does paint its run button when the server offers one, so
 * the empty box above is the server's decision and not a broken painter.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createTaskPageRoutes } from '../../routes/task-page.js';
import { createTaskPageLoader } from '../../lib/task-page-loader.js';
import { enrichLoop, deriveSessionWaiting, deriveSessionDecisions } from '../../routes/dashboard.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { buildSubtreeIndex, SUBTREE_READ_CAP } from '../../lib/subtree-index.js';
import { createHomeRowStates } from '../../lib/home-row-states.js';
import { rowDataByNodeKey } from '../../lib/task-board-view.js';
import { nodeKey } from '../../lib/tree.js';
import { isHiddenState } from '../../lib/providers/state-map.js';
import { escapeHtml } from '../../lib/utils/html.js';
// Side-effect import: the shared nav resolves the legacy default provider.
import '../../lib/providers/linear/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/prompt-section.js'), 'utf8');
const NOW = new Date('2026-10-30T10:06:00.000Z');
const URL_KEY = 'acme';
const flush = () => new Promise((r) => setTimeout(r, 0));

// ─── one tracker, as both senders see it ─────────────────────────────────────

// LIN-1 (started) has LIN-2 (Todo, with LIN-4 Todo under it, running) and LIN-3 (Done). LIN-9 is a lone Todo leaf.
const TREE = [
  ['LIN-1', 'started', null],
  ['LIN-2', 'unstarted', 'LIN-1'],
  ['LIN-3', 'completed', 'LIN-1'],
  ['LIN-4', 'unstarted', 'LIN-2'],
  ['LIN-9', 'unstarted', null],
];
const RUNNING = new Set(['LIN-4']);

const issueOf = ([identifier, type, parent]) => ({
  id: `id-${identifier}`, identifier, title: identifier, state: { name: type, type },
  ...(parent ? { parent: { id: `id-${parent}`, identifier: parent } } : {}),
});
const childrenCtxOf = (identifier) => TREE.filter(([, , parent]) => parent === identifier).map(issueOf);

function loop(identifier, over = {}) {
  return {
    loopId: `${identifier}-l`, lineageId: `${identifier}-l`, issueIdentifier: identifier, kind: 'implementation', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'running',
    dispatchedAt: '2026-10-30T10:00:00.000Z', takenAt: '2026-10-30T10:01:00.000Z', resolvedAt: '2026-10-30T10:01:00.000Z',
    terminalStatus: null, terminalCompletedAt: null, wakeMarker: 'pending', waitingMessage: null,
    feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null, bookkeeping: null,
    ...over,
  };
}
const loopsFor = (identifier) => (RUNNING.has(identifier) ? [loop(identifier)] : []);

// The provider the page reads through: each call returns the identifier's own context with its direct children.
let providerSeq = 0;
function trackerProvider({ failOn = null, tree = null } = {}) {
  const name = `fake-hint-sender-${++providerSeq}`;
  const calls = [];
  const byId = tree || TREE;
  const ctxOf = (identifier) => {
    const row = byId.find(([id]) => id === identifier);
    if (!row) throw new Error(`Issue not found: ${identifier}`);
    const [, type] = row;
    const children = byId.filter(([, , parent]) => parent === identifier).map(issueOf);
    return { issue: { ...issueOf(row), url: null, labels: [], blockedBy: [] }, parent: null, children, comments: [] };
  };
  registerProvider({
    name,
    ui: { inlineEdit: false, inlineCreate: false },
    supports: () => true,
    fetchRecommendationContext: async (scope, identifier) => {
      calls.push(identifier);
      if (identifier === failOn) throw new Error('tracker down');
      return ctxOf(identifier);
    },
    fetchIssueComments: async () => [],
    fetchIssueFields: async () => null,
    fetchProjects: async () => ({ projects: [] }),
  });
  return { name, calls };
}

function loaderWith(getLoops = (urlKey, identifier) => loopsFor(identifier)) {
  return createTaskPageLoader({
    dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting, deriveSessionDecisions,
    getLoopsForIssue: async (urlKey, identifier) => getLoops(urlKey, identifier),
    shelvedRulingsStore: null, taskDecisionsStore: null, now: () => NOW,
  });
}

// The route, as the server mounts it. Both the page and the state read go through it.
const router = (loader) => createTaskPageRoutes({
  workspaceFromUrl: (req, res, next) => next(), getOpenRouterSource: () => 'env', getDeployInfo: () => ({}),
  loader, workspaceOwnerCheck: async () => ({ status: 'owner' }), now: () => NOW,
});
function handlerOf(r, path) {
  const layer = r.stack.find((l) => l.route?.path === path && l.route.methods.get);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
async function call(r, path, { provider, identifier, query = {} }) {
  const req = {
    session: { workspaces: [], features: {}, accountId: 'acct-1' },
    workspace: { urlKey: URL_KEY, provider },
    params: { urlKey: URL_KEY, identifier }, query, get: () => 'localhost',
  };
  const res = {
    statusCode: 200, body: null, jsonBody: null,
    status(c) { this.statusCode = c; return this; },
    send(b) { this.body = b; return this; },
    json(b) { this.jsonBody = b; return this; },
    set() { return this; },
  };
  await handlerOf(r, path)(req, res, (err) => { if (err) throw err; });
  return res;
}
const PAGE = '/workspace/:urlKey/task/:identifier';
const STATE = '/workspace/:urlKey/api/task/:identifier/state';

/** The `/state` query string a URL carries, as the server parses it (the attribute's `&amp;` unescaped). */
const queryOf = (url) => Object.fromEntries(new URL(url.replace(/&amp;/g, '&'), 'http://x').searchParams);

/** The task page's state URL, as the page renders it into `data-state-url`. */
const stateUrlOf = (html) => ((html.match(/data-state-url="([^"]*)"/) || [])[1] || '').replace(/&amp;/g, '&');

// ─── the browser: the real prompt-section.js, in a sandbox, with its state read served by the real route ────────

function makeContainer() {
  const listeners = {};
  let html = '';
  return {
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; },
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; },
    querySelector() { return null; },
    contains() { return true; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
  };
}

/** Mount the run control for one row, with `serve(url)` answering the browser's own requests. */
async function mountRow({ row, serve }) {
  const window = {
    escapeHtml: (x) => (x == null ? '' : escapeHtml(String(x))),
    stripCodeBlockWrapper: (x) => x,
    renderMarkdown: (x) => String(x == null ? '' : x),
    api: async (url) => {
      if (url.includes('/api/task/')) return serve(url);
      if (url.includes('/api/task-mode/')) return { lastCopy: null };
      if (url.includes('/api/dispatch/preview')) return { kind: 'implementation', harness: 'claude-code', words: {}, sources: {}, group: null, description: '' };
      if (url.includes('/api/dispatch/decision-panel')) return { html: '', words: null, withoutEffort: [], targets: ['cli', 'web'], optionWords: { harness: {}, model: {} } };
      if (url.includes('/api/dispatch/presets')) return { presets: [] };
      return {};
    },
    ProxyToggle: { isActive: () => true, setActive() {}, maybeAppend: async (raw) => raw },
    renderDispatchDisclosure: () => '',
    readDispatchExecControls: () => ({ model: null, harness: null }),
    isPinnedToBottom: () => false,
    taskPageHref: () => '/workspace/acme/task/LIN-42',
    toast: () => {},
  };
  const sandbox = {
    window, AbortController, URLSearchParams, TextDecoder, TextEncoder, Blob: class {}, URL,
    document: { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } },
    requestAnimationFrame: (cb) => { cb(); return 1; },
    setTimeout: (fn, ms) => { const t = globalThis.setTimeout(fn, ms); if (t && t.unref) t.unref(); return t; },
    clearTimeout,
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'prompt-section.js' });
  const PromptSection = sandbox.window.PromptSection;
  const c = makeContainer();
  PromptSection.init(c, {
    urlKey: URL_KEY, surface: 'home', dispatchEnabled: true, runSetup: false, hasAI: true, aiState: 'ok', isLocalhost: false,
    promptMeta: { plan: 'Plan', implementation: 'Build', research: 'Research', scoping: 'Scoping', review: 'Review' },
    stageWords: { plan: 'Plan', implementation: 'Build', research: 'Research', scoping: 'Scoping', review: 'Review' },
    defaultPromptKeys: ['look-into', 'research', 'plan', 'implementation'], morePromptKeys: ['review', 'scoping'],
    issue: { id: row.issueId, identifier: row.identifier, title: row.identifier, url: '', source: 'linear', stateType: row.stateType },
    row: row.record,
  });
  for (let i = 0; i < 4; i += 1) await flush();
  return c.innerHTML;
}

// The row's record, as the server builds it for Home (`rowDataByNodeKey`), from the index of the same fetched set.
function homeRowFor(identifier, issues, loopsOf = loopsFor) {
  const roots = buildSubtreeIndex(issues.filter((issue) => !isHiddenState(issue)));
  // Home's index is built from the set after the hidden-state drop (`fetchAndPrepareProjects`), so the same drop runs here.
  const rowDataFor = async () => {
    const homeStates = createHomeRowStates({
      getLoopsForWorkspace: async () => issues.flatMap(({ identifier }) => loopsOf(identifier)), dispatchStore: null, agentStatusStore: null,
      taskDecisionsStore: null, shelvedRulingsStore: null, enrichLoop, deriveSessionWaiting, now: () => NOW,
      onError: (message) => { throw new Error(message); },
    });
    const home = await homeStates({ urlKey: URL_KEY, subtrees: roots, inProgressTrees: [], recentActivityTrees: [], projectTrees: [{ incomplete: roots, completed: [] }], runControls: true });
    return rowDataByNodeKey({ urlKey: URL_KEY, inProgressTrees: [], recentActivityTrees: [], projectTrees: [{ incomplete: roots, completed: [] }], rowStates: home.states, subtrees: roots });
  };
  return rowDataFor().then((rowData) => {
    const issue = issues.find((i) => i.identifier === identifier);
    return { issueId: issue.id, identifier, stateType: issue.state.type, record: rowData[nodeKey(issue)] };
  });
}

const ALL_ISSUES = TREE.map(issueOf);

// ─── the witnesses ───────────────────────────────────────────────────────────

describe('LIN-4049 — the Home sender: the browser\'s own state read, served by the real route', () => {
  test('a started parent whose grandchild runs: the box offers no run, from the row\'s hint', async () => {
    const provider = trackerProvider();
    const loader = loaderWith();
    const route = router(loader);
    const row = await homeRowFor('LIN-1', ALL_ISSUES);
    assert.ok(row.record.subtree.edges.length > 0, 'the row carries its subtree');
    const seen = [];
    const html = await mountRow({
      row,
      serve: async (url) => {
        seen.push(url);
        const res = await call(route, STATE, { provider: provider.name, identifier: 'LIN-1', query: queryOf(url) });
        return res.jsonBody;
      },
    });
    assert.ok(seen.some((u) => /\/api\/task\/LIN-1\/state/.test(u)), 'the browser read the state');
    assert.doesNotMatch(seen.join(' '), /container=1/, 'no container=1 is sent');
    assert.doesNotMatch(html, /Run to PR/, 'the parent with a running grandchild names no step it cannot run');
    assert.doesNotMatch(html, /data-action="go"/, 'and offers no go');
  });

  test('positive control: a lone Todo leaf with nothing running offers its next step, so the empty box above is the server\'s decision', async () => {
    const provider = trackerProvider();
    const route = router(loaderWith());
    const row = await homeRowFor('LIN-9', ALL_ISSUES);
    assert.equal(row.record.subtree, null, 'a leaf sends no subtree');
    const html = await mountRow({
      row,
      serve: async (url) => (await call(route, STATE, { provider: provider.name, identifier: 'LIN-9', query: queryOf(url) })).jsonBody,
    });
    assert.match(html, /data-action="run-step-next"/, 'the leaf offers its next step: its run button paints');
  });
});

describe('LIN-4049 — the task-page sender: the page reads its subtree once, and the poll is the hint', () => {
  test('the page\'s state URL carries the subtree, and /state decides the box from it with no tracker read', async () => {
    const provider = trackerProvider();
    const route = router(loaderWith());
    const page = await call(route, PAGE, { provider: provider.name, identifier: 'LIN-1' });
    assert.equal(page.statusCode, 200);
    const url = stateUrlOf(page.body);
    assert.doesNotMatch(url, /container=1/);
    assert.ok(queryOf(url).subtree, 'the state URL carries the hint');

    const before = provider.calls.length;
    const state = await call(route, STATE, { provider: provider.name, identifier: 'LIN-1', query: queryOf(url) });
    assert.equal(provider.calls.length, before, '/state makes no tracker read');
    assert.deepEqual(state.jsonBody.sessions.actions, [], 'the box offers nothing while the grandchild runs');
    assert.equal(state.jsonBody.taskState.state, 'running');
  });

  test('the two senders name the same subtree: Home\'s row hint and the page\'s hint carry the same edges in the same order', async () => {
    const provider = trackerProvider();
    const route = router(loaderWith());
    const page = await call(route, PAGE, { provider: provider.name, identifier: 'LIN-1' });
    const pageEdges = JSON.parse(queryOf(stateUrlOf(page.body)).subtree).edges;
    const row = await homeRowFor('LIN-1', ALL_ISSUES);
    assert.deepEqual(pageEdges, row.record.subtree.edges);
    assert.deepEqual(pageEdges, [['LIN-1', 'LIN-2', 'unstarted'], ['LIN-1', 'LIN-3', 'completed'], ['LIN-2', 'LIN-4', 'unstarted']]);
  });
});

describe('LIN-4049 — fail closed: over the cap, and when the subtree cannot be read whole', () => {
  const WIDE = [['LIN-1', 'started', null], ...Array.from({ length: SUBTREE_READ_CAP + 2 }, (_, i) => [`LIN-${100 + i}`, 'unstarted', 'LIN-1'])];

  test('over the cap, Home and the page both send a hint the server reads as over the cap: no run, and the plain sentence', async () => {
    const provider = trackerProvider({ tree: WIDE });
    const route = router(loaderWith((urlKey, identifier) => []));
    const issues = WIDE.map(issueOf);
    const row = await homeRowFor('LIN-1', issues);
    assert.equal(row.record.subtree.edges.length, SUBTREE_READ_CAP + 1, 'the hint stops at cap + 1');
    const fromHome = await call(route, STATE, { provider: provider.name, identifier: 'LIN-1', query: { subtree: JSON.stringify(row.record.subtree) } });
    assert.deepEqual(fromHome.jsonBody.sessions.actions, []);
    assert.match(fromHome.jsonBody.sessions.note, /more subtasks than the run box checks/);

    const page = await call(route, PAGE, { provider: provider.name, identifier: 'LIN-1' });
    const fromPage = await call(route, STATE, { provider: provider.name, identifier: 'LIN-1', query: queryOf(stateUrlOf(page.body)) });
    assert.deepEqual(fromPage.jsonBody.sessions.actions, []);
    assert.match(fromPage.jsonBody.sessions.note, /more subtasks than the run box checks/);
  });

  test('a child the page cannot read: the hint is incomplete, and the box fails closed with its own sentence', async () => {
    const provider = trackerProvider({ failOn: 'LIN-2' });
    const route = router(loaderWith());
    const page = await call(route, PAGE, { provider: provider.name, identifier: 'LIN-1' });
    const state = await call(route, STATE, { provider: provider.name, identifier: 'LIN-1', query: queryOf(stateUrlOf(page.body)) });
    assert.deepEqual(state.jsonBody.sessions.actions, []);
    assert.match(state.jsonBody.sessions.note, /could not be read/);
  });

  test('a canceled child is left out on both surfaces, as the index leaves it out', async () => {
    const CANCELLED = [['LIN-1', 'started', null], ['LIN-2', 'canceled', 'LIN-1'], ['LIN-3', 'unstarted', 'LIN-1']];
    const provider = trackerProvider({ tree: CANCELLED });
    const route = router(loaderWith(() => []));
    const page = await call(route, PAGE, { provider: provider.name, identifier: 'LIN-1' });
    assert.deepEqual(JSON.parse(queryOf(stateUrlOf(page.body)).subtree).edges, [['LIN-1', 'LIN-3', 'unstarted']]);
    const row = await homeRowFor('LIN-1', CANCELLED.map(issueOf));
    assert.deepEqual(row.record.subtree.edges, [['LIN-1', 'LIN-3', 'unstarted']]);
  });
});

describe('LIN-4049 — container=1 is gone from both senders and from the server', () => {
  test('no source the state read touches mentions container=1', () => {
    for (const rel of ['routes/task-page.js', 'public/prompt-section.js', 'lib/task-page-loader.js', 'lib/task-state.js']) {
      const src = readFileSync(join(__dirname, '../..', rel), 'utf8');
      assert.doesNotMatch(src, /container=1/, rel);
    }
  });
});

describe('LIN-4049 — the page descends past a terminal child, as the index does', () => {
  // LIN-3 is Done, but its own subtask LIN-5 runs: the index keeps LIN-3, and its row rolls the running work up to LIN-1.
  const DONE_PARENT = [['LIN-1', 'started', null], ['LIN-3', 'completed', 'LIN-1'], ['LIN-5', 'started', 'LIN-3']];
  const runsUnder = (identifier) => (identifier === 'LIN-5' ? [loop('LIN-5')] : []);

  test('a Done child whose subtask runs: both senders carry the grandchild, and the parent\'s box offers no run', async () => {
    const provider = trackerProvider({ tree: DONE_PARENT });
    const route = router(loaderWith((_urlKey, identifier) => runsUnder(identifier)));
    const page = await call(route, PAGE, { provider: provider.name, identifier: 'LIN-1' });
    const pageEdges = JSON.parse(queryOf(stateUrlOf(page.body)).subtree).edges;
    assert.deepEqual(pageEdges, [['LIN-1', 'LIN-3', 'completed'], ['LIN-3', 'LIN-5', 'started']]);

    const row = await homeRowFor('LIN-1', DONE_PARENT.map(issueOf), runsUnder);
    assert.deepEqual(row.record.subtree.edges, pageEdges, 'the two senders name the same subtree');

    const state = await call(route, STATE, { provider: provider.name, identifier: 'LIN-1', query: queryOf(stateUrlOf(page.body)) });
    assert.equal(state.jsonBody.taskState.state, 'running', 'the row says running, through the Done child');
    assert.deepEqual(state.jsonBody.sessions.actions, []);
  });
});

