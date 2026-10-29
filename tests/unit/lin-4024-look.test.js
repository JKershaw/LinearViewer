/**
 * LIN-4024 step 3 (look), first chunk: a container's opened task runs on the container, the opened task names its
 * stage words, and a task waiting on a ruling shows its question card to the owner.
 *
 * Witnesses: `containerNodeKeysOf` marks the rows that have subtasks and no others; the Home mount hands each row its
 * container flag and the "Another step" stage words, from the page options and the rows a fold fetches (the real
 * `mountHomePromptSections` and `mergeHomeRowOpts` from public/app.js).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { containerNodeKeysOf } from '../../lib/task-board-view.js';
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

describe('containerNodeKeysOf — the rows that have subtasks are the containers', () => {
  test('a row with children is a container, at any depth; a leaf is not', () => {
    const leafChild = node('LIN-3');
    const parent = node('LIN-2', [leafChild]);
    const root = node('LIN-1', [parent]);
    const keys = containerNodeKeysOf({ inProgressTrees: [{ roots: [root] }], recentActivityTrees: [], projectTrees: [] });
    assert.deepEqual(keys.sort(), [nodeKey(root.issue), nodeKey(parent.issue)].sort());
    assert.equal(keys.includes(nodeKey(leafChild.issue)), false);
  });

  test('a project row is read too, and an empty page has none', () => {
    const project = node('LIN-9', [node('LIN-10')]);
    assert.deepEqual(containerNodeKeysOf({ projectTrees: [{ incomplete: [project], completed: [] }] }), [nodeKey(project.issue)]);
    assert.deepEqual(containerNodeKeysOf({}), []);
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

  test('a container row is flagged isContainer; a leaf row is not, and the stage words reach both', () => {
    const { inits, mount } = mountWith({
      containerNodeKeys: ['linear:parent'],
      stageWords: { research: 'Research', implementation: 'Build' },
    });
    mount([placeholder('linear:parent', '1'), placeholder('linear:leaf', '2')]);
    const byNode = (key) => inits.find((i) => i.el.dataset.nodeKey === key).opts;
    assert.equal(byNode('linear:parent').isContainer, true);
    assert.equal(byNode('linear:leaf').isContainer, false);
    assert.equal(JSON.stringify(byNode('linear:leaf').stageWords), JSON.stringify({ research: 'Research', implementation: 'Build' }), 'the stage words name each step');
  });

  test('a fetched row\'s container flag is merged into the page map before it mounts (mergeHomeRowOpts)', () => {
    const { inits, mount } = mountWith({ containerNodeKeys: [] });
    const sandbox = {
      window: { __HOME_PROMPT_OPTS__: { containerNodeKeys: [] } },
    };
    vm.createContext(sandbox);
    vm.runInContext(`${functionSource(APP, 'mergeHomeRowOpts')}\nthis.mergeHomeRowOpts = mergeHomeRowOpts;`, sandbox);
    sandbox.mergeHomeRowOpts({ containerNodeKeys: ['linear:fetched-parent'] });
    sandbox.mergeHomeRowOpts({ containerNodeKeys: ['linear:fetched-parent'] });
    // The page map is built inside the vm context, so compare its JSON, not a cross-realm array.
    assert.equal(JSON.stringify(sandbox.window.__HOME_PROMPT_OPTS__.containerNodeKeys), '["linear:fetched-parent"]', 'merged once, not duplicated');
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

  test('Swipe keeps its own fold, with the machine label and the prompt name (its bytes are unchanged)', async () => {
    const html = await load([SESSION], {});
    assert.match(html, /dispatched sessions/);
    assert.match(html, /Prompt/);
  });
});
