/**
 * LIN-4049 (LIN-4040 S1, beat 5): the ticket's constraints that had no direct witness yet.
 *
 * - the index is built after the hidden-state drop and before the assignee filter (`fetchAndPrepareProjects`), so a
 *   filtered view still sees every child of a shown parent;
 * - a tracker child whose identifier fails `isValidIssueId` makes the page's read incomplete, so the box fails closed;
 * - Swipe's cards carry their subtree hint, so Swipe's container cards keep their box;
 * - over the cap, the box shows its plain sentence in the browser, not only in the `/state` body.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { escapeHtml } from '../../lib/utils/html.js';
import { createTaskPageLoader, sessionSummaryOf } from '../../lib/task-page-loader.js';
import { enrichLoop, deriveSessionWaiting, deriveSessionDecisions } from '../../routes/dashboard.js';
import { buildSubtreeIndex, subtreeHintsByNodeKey } from '../../lib/subtree-index.js';
import { orderIssuesForSwipe } from '../../lib/task-board-view.js';
import { nodeKey } from '../../lib/tree.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NOW = new Date('2026-10-30T10:06:00.000Z');
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('LIN-4049 — the index is built after the hidden-state drop and before the assignee filter', () => {
  test('in fetchAndPrepareProjects: the hidden filter, then the index, then the assignee filter', () => {
    const src = readFileSync(join(__dirname, '../../server.js'), 'utf8');
    const start = src.indexOf('async function fetchAndPrepareProjects(');
    const end = src.indexOf('\n}\n', start);
    const body = src.slice(start, end);
    const hidden = body.indexOf('let issues = mergedIssues.filter(issue => !isHiddenState(issue));');
    const index = body.indexOf('const subtrees = buildSubtreeIndex(issues);');
    const assignee = body.indexOf('if (assigneeName) {');
    assert.ok(hidden > -1 && index > -1 && assignee > -1, 'all three steps are present');
    assert.ok(hidden < index && index < assignee, 'drop, then index, then the assignee filter');
  });
});

/** A tracker whose root has the given children; each child's own read returns no children. */
function trackerWithChildren(childIssues) {
  const provider = {
    fetchRecommendationContext: async (_scope, identifier) => ({
      issue: { id: 'id-root', identifier, title: identifier, state: { name: 'In Progress', type: 'started' }, labels: [], blockedBy: [] },
      parent: null,
      children: identifier === 'LIN-1' ? childIssues : [],
      comments: [],
    }),
    fetchIssueComments: async () => [],
    fetchIssueFields: async () => null,
    fetchProjects: async () => ({ projects: [] }),
  };
  return provider;
}

describe('LIN-4049 — a tracker child with an invalid identifier makes the page\'s read incomplete', () => {
  test('the hint is incomplete and the box fails closed with the plain sentence', async () => {
    const provider = trackerWithChildren([
      { id: 'id-2', identifier: 'LIN-2', title: 'ok', state: { name: 'Todo', type: 'unstarted' } },
      { id: 'id-bad', identifier: 'not an id!', title: 'bad', state: { name: 'Todo', type: 'unstarted' } },
    ]);
    const loader = createTaskPageLoader({
      dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting, deriveSessionDecisions,
      getLoopsForIssue: async () => [], shelvedRulingsStore: null, taskDecisionsStore: null, now: () => NOW,
    });
    const page = await loader.loadTaskPage({ urlKey: 'acme', identifier: 'LIN-1', access: { provider, callScope: 'tok' } });
    assert.equal(page.subtree.incomplete, true, 'an identifier the index drops is a subtask the box cannot see past');

    const state = await loader.loadTaskState({
      urlKey: 'acme', identifier: 'LIN-1', edges: page.subtree.edges.map(([parent, child, type]) => ({ parent, child, type })), incomplete: true,
    });
    const summary = sessionSummaryOf(state.model, { container: state.container, rowState: state.rowState, overCap: state.overCap, incomplete: state.incomplete });
    assert.deepEqual(summary.actions, []);
    assert.match(summary.note, /could not be read/);
  });
});

describe('LIN-4049 — Swipe\'s cards carry their subtree hint', () => {
  test('a container card\'s row record carries the same hint Home\'s row does', () => {
    const issues = [
      { id: 'id-1', identifier: 'LIN-1', title: 'Parent', state: { name: 'In Progress', type: 'started' }, source: undefined },
      { id: 'id-2', identifier: 'LIN-2', title: 'Child', state: { name: 'Todo', type: 'unstarted' }, parent: { id: 'id-1' }, source: undefined },
    ];
    const roots = buildSubtreeIndex(issues);
    const projectTrees = [{ project: { id: 'p', name: 'P' }, incomplete: roots, completed: [] }];
    const cards = orderIssuesForSwipe({ projectTrees, inProgressTrees: [], recentActivityTrees: [], urlKey: 'acme', subtrees: roots });
    const parent = cards.find((card) => card.identifier === 'LIN-1');
    assert.ok(parent, 'the parent is a card');
    assert.deepEqual(parent.row.subtree, subtreeHintsByNodeKey(roots).get(nodeKey(roots[0].issue)));
    assert.deepEqual(parent.row.subtree.edges, [['LIN-1', 'LIN-2', 'unstarted']]);
  });
});

describe('LIN-4049 — over the cap, the box shows its plain sentence in the browser', () => {
  const SRC = readFileSync(join(__dirname, '../../public/prompt-section.js'), 'utf8');

  function makeContainer() {
    let html = '';
    return {
      get innerHTML() { return html; },
      set innerHTML(v) { html = v; },
      dataset: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      setAttribute() {}, getAttribute() { return null; },
      querySelector() { return null; },
      contains() { return true; },
      addEventListener() {}, removeEventListener() {},
    };
  }

  test('a state read whose box offers nothing and carries the note paints the note', async () => {
    const note = `This task has more subtasks than the run box checks, so it offers no run. Open a subtask to run it.`;
    const window = {
      escapeHtml: (x) => (x == null ? '' : escapeHtml(String(x))),
      stripCodeBlockWrapper: (x) => x,
      renderMarkdown: (x) => String(x == null ? '' : x),
      api: async (url) => {
        if (url.includes('/api/task/')) {
          return {
            status: 'idle', live: false, headerHtml: '', stripHtml: '', homeStatusHtml: '', trackHtml: '',
            sessions: { count: 0, next: null, last: null, offered: null, excluded: [], queued: null, busy: true, actions: [], canStop: false, running: null, finished: false, note },
          };
        }
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
    const c = makeContainer();
    sandbox.window.PromptSection.init(c, {
      urlKey: 'acme', surface: 'home', dispatchEnabled: true, runSetup: false, hasAI: true, aiState: 'ok', isLocalhost: false,
      promptMeta: { plan: 'Plan', implementation: 'Build', research: 'Research', scoping: 'Scoping', review: 'Review' },
      stageWords: { plan: 'Plan', implementation: 'Build', research: 'Research', scoping: 'Scoping', review: 'Review' },
      defaultPromptKeys: ['look-into', 'research', 'plan', 'implementation'], morePromptKeys: ['review', 'scoping'],
      issue: { id: 'uuid-42', identifier: 'LIN-42', title: 'T', url: '', source: 'linear', stateType: 'started' },
      row: { container: true, finished: false, attention: null, subtree: { edges: [], incomplete: false } },
    });
    for (let i = 0; i < 4; i += 1) await flush();
    assert.match(c.innerHTML, /data-testid="opened-task-note"/, 'the note element paints');
    assert.ok(c.innerHTML.includes(escapeHtml(note)), 'with the plain sentence');
    assert.doesNotMatch(c.innerHTML, /data-action="run-step-next"|data-action="go"/, 'and no run');
  });
});
