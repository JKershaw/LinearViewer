/**
 * LIN-4024 step 3 (look), first chunk: a container's opened task runs on the container, the opened task names its
 * stage words, and a task waiting on a ruling shows its question card to the owner.
 *
 * Witnesses: `rowDataByNodeKey` decides a container from the gather's row states, and the rows that have subtasks are the
 * containers and no others (LIN-4071: the container fact is the gather's, and it reaches the browser as the row's decided
 * action, `container: true`, never as a flag); the Home mount hands each row its record and the "Another step" stage words,
 * from the page options and the rows a fold fetches (the real `homePromptOpts` and `mergeHomeRowOpts` from public/app.js).
 *
 * The placeholders are the server's own (`renderDetailsContent`, layout home), drawn on the shared fake DOM; app.js is
 * imported as the module it is (LIN-4463 piece 5), and the Sessions fold runs from public/sessions.js through loadWorld.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rowDataByNodeKey } from '../../lib/task-board-view.js';
import { buildRowStates } from '../../lib/task-page-loader.js';
import { nodeKey } from '../../lib/tree.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
import { renderDetailsContent } from '../../lib/render.js';
import { loadWorld } from './helpers/client-world.js';
import { importWorld } from './helpers/import-world.js';

const node = (identifier, children = []) => ({
  issue: { id: `id-${identifier}`, identifier, title: identifier, source: 'linear', state: { name: 'Todo', type: 'unstarted' } },
  children,
  depth: 0,
});

/** The gather's row states over `roots` (the same build Home reads), so a record's container fact is decided, not guessed. */
const statesOver = (roots) => buildRowStates({ roots, loopsByIdentifier: new Map(), enrichLoop, deriveSessionWaiting, now: new Date('2026-10-31T12:00:00.000Z') });
/** Whether a row record says it is a container: its decided action is Run to PR as a container (LIN-4071). */
const isContainer = (record) => record.action?.container === true;

describe('rowDataByNodeKey — the rows that have subtasks are the containers', () => {
  test('a row with children is a container, at any depth; a leaf is not', () => {
    const leafChild = node('LIN-3');
    const parent = node('LIN-2', [leafChild]);
    const root = node('LIN-1', [parent]);
    const byKey = rowDataByNodeKey({ inProgressTrees: [{ roots: [root] }], recentActivityTrees: [], projectTrees: [], rowStates: statesOver([root]) });
    assert.equal(isContainer(byKey[nodeKey(root.issue)]), true);
    assert.equal(isContainer(byKey[nodeKey(parent.issue)]), true);
    assert.equal(isContainer(byKey[nodeKey(leafChild.issue)]), false);
  });

  test('a project row is read too, and an empty page has no rows to record', () => {
    const project = node('LIN-9', [node('LIN-10')]);
    assert.equal(isContainer(rowDataByNodeKey({ projectTrees: [{ incomplete: [project], completed: [] }], rowStates: statesOver([project]) })[nodeKey(project.issue)]), true);
    assert.deepEqual(rowDataByNodeKey({ rowStates: null }), {});
  });
});

describe('the Home mount — each opened row gets its decision record and the stage words (public/app.js)', () => {
  // An opened task as Home draws it: the server's own placeholder (renderDetailsContent, layout home).
  const openedTask = (id) => ({ id, identifier: `LIN-${id}`, title: `Task ${id}`, url: '', source: 'linear', description: '', state: { name: 'Started', type: 'started' } });

  // app.js is a module (LIN-4463 piece 5): the page's options are window.__HOME_PROMPT_OPTS__, and each drawn placeholder's
  // opts are what the real homePromptOpts builds, the same call mountHomePromptSections makes for each row.
  async function homeWith(t, pageOpts) {
    const world = importWorld({
      window: { addEventListener() {}, __HOME_PROMPT_OPTS__: { topTaskId: 'linear:top', defaultPromptKeys: [], morePromptKeys: [], ...pageOpts } },
    });
    t.after(() => world.restore());
    const app = await world.importPage('app.js');
    const optsOf = (issues) => {
      world.document.body.innerHTML = issues.map((issue) => renderDetailsContent(issue, { urlKey: 'ws', featureFlags: {}, layout: 'home' })).join('');
      const byKey = new Map();
      for (const el of world.document.querySelectorAll('[data-prompt-mount]')) byKey.set(el.dataset.nodeKey, app.homePromptOpts(el, world.window.__HOME_PROMPT_OPTS__));
      return (issue) => byKey.get(nodeKey(issue));
    };
    return { app, world, optsOf };
  }

  test('a container row carries its decided action (Run to PR, container) in its record; a leaf row has no record, and the stage words reach both', async (t) => {
    const parent = openedTask('1');
    const leaf = openedTask('2');
    const { optsOf } = await homeWith(t, {
      rowData: { [nodeKey(parent)]: { action: { kind: 'offer', why: 'a container runs to PR', container: true }, copyStep: { label: 'plan', name: 'Plan', why: '' }, trackerWord: 'In progress' } },
      stageWords: { research: 'Research', implementation: 'Build' },
    });
    const byNode = optsOf([parent, leaf]);
    assert.equal(byNode(parent).row.action.container, true);
    assert.equal(byNode(leaf).row, null);
    assert.equal(JSON.stringify(byNode(leaf).stageWords), JSON.stringify({ research: 'Research', implementation: 'Build' }), 'the stage words name each step');
  });

  test('a fetched row\'s container flag is merged into the page map before it mounts (mergeHomeRowOpts)', async (t) => {
    const { app, world } = await homeWith(t, { rowData: {} });
    const fetched = { 'linear:fetched-parent': { action: { kind: 'offer', why: 'a container runs to PR', container: true }, copyStep: { label: 'plan', name: 'Plan', why: '' }, trackerWord: 'In progress' } };
    app.mergeHomeRowOpts({ rowData: fetched });
    app.mergeHomeRowOpts({ rowData: fetched });
    const rowData = world.window.__HOME_PROMPT_OPTS__.rowData;
    assert.equal(Object.keys(rowData).length, 1, 'merged once, not duplicated');
    assert.equal(rowData['linear:fetched-parent'].action.container, true);
  });
});

describe('the Sessions fold on Home reads as sessions (public/sessions.js)', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  // Loads the real renderer into a world; `api` answers the sessions read.
  function load(sessions, opts) {
    const world = loadWorld({
      scripts: ['sessions.js'],
      window: {
        escapeHtml: (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
        relativeTime: () => '3m ago',
        taskPageHref: () => '/workspace/acme/task/LIN-42',
        runPageHref: (urlKey, sessionId) => (urlKey && sessionId ? `/workspace/${urlKey}/observation/session/${sessionId}` : ''),
        api: async () => ({ sessions }),
      },
    });
    const container = world.makeContainer();
    world.window.SessionsSection.init(container, { urlKey: 'acme', identifier: 'LIN-42', ...opts });
    return flush().then(flush).then(() => container.innerHTML);
  }

  const SESSION = {
    // LIN-4103 beat 3: the route's row carries the box's label and the word it paints.
    loopId: 'l1', iteration: 2, promptName: 'Prompt', stage: 'implementation', agentState: 'running', kind: 'implementation', label: 'Build', state: 'running', word: 'running',
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
