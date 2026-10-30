/**
 * LIN-4024 step 3 (look), first chunk: a container's opened task runs on the container, the opened task names its
 * stage words, and a task waiting on a ruling shows its question card to the owner.
 *
 * Witnesses: `rowDataByNodeKey` marks the rows that have subtasks and no others (LIN-4016: as each row's decision record,
 * `container`); the Home mount hands each row its record and the "Another step" stage words, from the page options and
 * the rows a fold fetches (the real `mountHomePromptSections` and `mergeHomeRowOpts` from public/app.js).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { rowDataByNodeKey } from '../../lib/task-board-view.js';
import { nodeKey } from '../../lib/tree.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(join(__dirname, '../../public/app.js'), 'utf8');

// The function's source, cut from its declaration to its closing brace at column 0.
function functionSource(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is declared in public/app.js`);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end + 2);
}

const node = (identifier, children = []) => ({
  issue: { id: `id-${identifier}`, identifier, title: identifier, source: 'linear', state: { name: 'Todo', type: 'unstarted' } },
  children,
  depth: 0,
});

describe('rowDataByNodeKey — the rows that have subtasks are the containers', () => {
  test('a row with children is a container, at any depth; a leaf is not', () => {
    const leafChild = node('LIN-3');
    const parent = node('LIN-2', [leafChild]);
    const root = node('LIN-1', [parent]);
    const byKey = rowDataByNodeKey({ inProgressTrees: [{ roots: [root] }], recentActivityTrees: [], projectTrees: [], rowStates: null });
    assert.equal(byKey[nodeKey(root.issue)].container, true);
    assert.equal(byKey[nodeKey(parent.issue)].container, true);
    assert.equal(byKey[nodeKey(leafChild.issue)].container, false);
  });

  test('a project row is read too, and an empty page has no rows to record', () => {
    const project = node('LIN-9', [node('LIN-10')]);
    assert.equal(rowDataByNodeKey({ projectTrees: [{ incomplete: [project], completed: [] }], rowStates: null })[nodeKey(project.issue)].container, true);
    assert.deepEqual(rowDataByNodeKey({ rowStates: null }), {});
  });
});

describe('the Home mount — each opened row gets its container flag and the stage words (public/app.js)', () => {
  // A row placeholder as the server emits it: identity on data attributes, one per opened task.
  const placeholder = (nodeKeyValue, issueId) => ({
    dataset: { issueId, identifier: `LIN-${issueId}`, title: `Task ${issueId}`, url: '', source: 'linear', stateType: 'started', nodeKey: nodeKeyValue, instanceKey: nodeKeyValue },
    closest: () => null,
  });

  function mountWith(pageOpts) {
    const inits = [];
    const sandbox = {
      window: {
        __HOME_PROMPT_OPTS__: { topTaskId: 'linear:top', defaultPromptKeys: [], morePromptKeys: [], ...pageOpts },
        PromptSection: { init: (el, opts) => { inits.push({ el, opts }); return {}; } },
      },
      document: {},
    };
    vm.createContext(sandbox);
    vm.runInContext(`${functionSource(APP, 'mountHomePromptSections')}\nthis.mountHomePromptSections = mountHomePromptSections;`, sandbox);
    return { inits, mount: (rows) => sandbox.mountHomePromptSections({ querySelectorAll: () => rows }) };
  }

  test('a container row carries container in its record; a leaf row does not, and the stage words reach both', () => {
    const { inits, mount } = mountWith({
      rowData: { 'linear:parent': { container: true, finished: false, attention: null, copyStep: { label: 'plan', name: 'Plan', why: '' }, trackerWord: 'In progress' } },
      stageWords: { research: 'Research', implementation: 'Build' },
    });
    mount([placeholder('linear:parent', '1'), placeholder('linear:leaf', '2')]);
    const byNode = (key) => inits.find((i) => i.el.dataset.nodeKey === key).opts;
    assert.equal(byNode('linear:parent').row.container, true);
    assert.equal(byNode('linear:leaf').row, null);
    assert.equal(JSON.stringify(byNode('linear:leaf').stageWords), JSON.stringify({ research: 'Research', implementation: 'Build' }), 'the stage words name each step');
  });

  test('a fetched row\'s container flag is merged into the page map before it mounts (mergeHomeRowOpts)', () => {
    const { inits, mount } = mountWith({ rowData: {} });
    const sandbox = {
      window: { __HOME_PROMPT_OPTS__: { rowData: {} } },
    };
    vm.createContext(sandbox);
    vm.runInContext(`${functionSource(APP, 'mergeHomeRowOpts')}\nthis.mergeHomeRowOpts = mergeHomeRowOpts;`, sandbox);
    const fetched = { 'linear:fetched-parent': { container: true, finished: false, attention: null, copyStep: { label: 'plan', name: 'Plan', why: '' }, trackerWord: 'In progress' } };
    sandbox.mergeHomeRowOpts({ rowData: fetched });
    sandbox.mergeHomeRowOpts({ rowData: fetched });
    // The page map is built inside the vm context, so compare its JSON, not a cross-realm array.
    assert.equal(Object.keys(sandbox.window.__HOME_PROMPT_OPTS__.rowData).length, 1, 'merged once, not duplicated');
    assert.equal(sandbox.window.__HOME_PROMPT_OPTS__.rowData['linear:fetched-parent'].container, true);
    assert.equal(inits.length, 0, 'the merge alone mounts nothing');
    mount([]);
  });
});

describe('the Sessions fold on Home reads as sessions (public/sessions.js)', () => {
  const SESSIONS = readFileSync(join(__dirname, '../../public/sessions.js'), 'utf8');
  const flush = () => new Promise((r) => setTimeout(r, 0));

  // Loads the real renderer over a fake container; `api` answers the sessions read.
  function load(sessions, opts) {
    let html = '';
    const container = {
      get innerHTML() { return html; },
      set innerHTML(v) { html = v; },
      classList: { add() {} },
      setAttribute() {},
      querySelector() { return null; },
    };
    const window = {
      escapeHtml: (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
      relativeTime: () => '3m ago',
      taskPageHref: () => '/workspace/acme/task/LIN-42',
      runPageHref: (urlKey, sessionId) => (urlKey && sessionId ? `/workspace/${urlKey}/observation/session/${sessionId}` : ''),
      api: async () => ({ sessions }),
    };
    const sandbox = { window, console };
    vm.createContext(sandbox);
    vm.runInContext(SESSIONS, sandbox, { filename: 'sessions.js' });
    sandbox.window.SessionsSection.init(container, { urlKey: 'acme', identifier: 'LIN-42', ...opts });
    return flush().then(flush).then(() => html);
  }

  const SESSION = {
    loopId: 'l1', iteration: 2, promptName: 'Prompt', stage: 'implementation', agentState: 'running',
    dispatchedAt: '2026-10-29T10:00:00.000Z',
    feedback: [
      { message: '[decision] {"decision_id":"lin4012-rc","question":"Re-dispatch?"}', timestamp: null },
      { message: '[blocked] the research session was cancelled', timestamp: null },
      { message: 'Checked the migration by hand', timestamp: null },
    ],
  };

  test('Home: stage word, state word and time; no prompt name, iteration, [blocked] tag or decision JSON', async () => {
    const html = await load([SESSION], { home: true, stageWords: { implementation: 'Build' } });
    assert.equal(html.includes('dispatched sessions'), false, 'no machine label');
    assert.match(html, /session-stage">Build</, 'the stage word names the step');
    assert.match(html, /session-state-word">running</);
    assert.equal(html.includes('Prompt'), false, 'the prompt name is not shown');
    assert.equal(html.includes('#2'), false, 'the iteration is not shown');
    assert.equal(html.includes('[blocked]'), false, 'the [blocked] tag is dropped');
    assert.equal(html.includes('decision_id'), false, 'decision JSON is not shown');
    assert.equal(html.includes('[decision]'), false, 'decision lines are not shown');
    assert.match(html, /the research session was cancelled/, 'the line a person wrote stays, without its tag');
    assert.match(html, /Checked the migration by hand/);
  });

  test('Home: each session links to its run page, by the session id the route sends; no link without one', async () => {
    const linked = await load([{ ...SESSION, sessionId: 'sess-7' }], { home: true, urlKey: 'acme' });
    assert.match(linked, /<a class="session-run-link" data-testid="sessions-run-link" href="\/workspace\/acme\/observation\/session\/sess-7">run ↗<\/a>/);
    const unlinked = await load([{ ...SESSION, sessionId: null }], { home: true, urlKey: 'acme' });
    assert.equal(unlinked.includes('session-run-link'), false, 'a run with no session id has no link to draw');
  });

  test('Swipe keeps its own fold, with the machine label and the prompt name (its bytes are unchanged)', async () => {
    const html = await load([SESSION], {});
    assert.match(html, /dispatched sessions/);
    assert.match(html, /Prompt/);
  });
});
