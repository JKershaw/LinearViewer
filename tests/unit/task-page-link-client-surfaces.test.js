/**
 * LIN-3331 — the client twin reaches the client surfaces.
 *
 * Loads the REAL public/common.js (so `window.taskPageHref` is the shipped
 * builder) alongside the shipped browser scripts, then asserts each in-scope
 * client surface emits a `<surface>-task-page-link` whose href is built by the
 * helper and carries the issue's source kind (`?source=<kind>`). These are the
 * one-assertion-per-surface checks the plan calls for; the server-rendered
 * surfaces are covered in render.test.js / render-session.test.js.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const COMMON_SRC = read('public/common.js');

function makeEl() {
  return {
    innerHTML: '',
    textContent: '',
    hidden: false,
    className: '',
    dataset: {},
    style: {},
    _attrs: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k] ?? null; },
    removeAttribute(k) { delete this._attrs[k]; },
    addEventListener() {},
    remove() {},
    appendChild() {},
    insertAdjacentHTML() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

/** A browser-ish sandbox with the real common.js already loaded. */
function sandboxWithCommon(extra = {}) {
  const els = new Map();
  const el = (key) => { if (!els.has(key)) els.set(key, makeEl()); return els.get(key); };
  const sandbox = {
    location: { search: '', href: '' },
    document: {
      title: '',
      hidden: false,
      getElementById: (id) => el(`#${id}`),
      querySelector: (sel) => el(sel),
      querySelectorAll: () => [],
      createElement: () => makeEl(),
      addEventListener() {},
    },
    history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    removeEventListener() {},
    module: { exports: {} },
    console,
    ...extra,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(COMMON_SRC, sandbox, { filename: 'common.js' });
  return { sandbox, el };
}

describe('Swipe card task-page link (LIN-3331)', () => {
  function renderCard(issue, urlKey = 'ws') {
    const { sandbox, el } = sandboxWithCommon({
      __SWIPE_DATA__: { issues: [issue], filters: [{ key: 'all', label: 'All' }], urlKey },
    });
    sandbox.renderMarkdown = (s) => sandbox.escapeHtml(s);
    sandbox.stripCodeBlockWrapper = (s) => s;
    vm.runInContext(read('public/swipe.js'), sandbox, { filename: 'swipe.js' });
    return el('#swipe-card').innerHTML;
  }

  test('renders a task-page link for a plain issue', () => {
    const html = renderCard({ id: 'issue-1', identifier: 'LIN-1', title: 'Say hello', stateType: 'unstarted' });
    assert.match(html, /data-testid="swipe-task-page-link"[^>]*href="\/workspace\/ws\/task\/LIN-1"/);
  });

  test('carries the issue source', () => {
    const html = renderCard({ id: 'issue-1', identifier: 'LIN-1', title: 'T', stateType: 'unstarted', source: 'linear', bindingScope: 'team-a' });
    assert.match(html, /data-testid="swipe-task-page-link"[^>]*href="\/workspace\/ws\/task\/LIN-1\?source=linear"/);
    assert.ok(!html.includes('bindingScope'), 'the pair-era scope is ignored');
  });

  test('no link on the landing card (no workspace)', () => {
    const html = renderCard({ id: 'issue-1', identifier: 'LIN-1', title: 'T', stateType: 'unstarted' }, null);
    assert.ok(!html.includes('swipe-task-page-link'), 'landing card omits the link');
  });
});

describe('Queue row task-page link (LIN-3331)', () => {
  const { sandbox } = sandboxWithCommon();

  test('builds the href with the shared helper, carrying the source', () => {
    const html = sandbox.renderQueueRow({ id: 'd1', promptName: 'P', dispatchedAt: '2026-01-01T00:00:00Z', issueIdentifier: 'LIN-7', issueSource: 'linear', issueBindingScope: 'team-a' }, 'ws');
    assert.match(html, /data-testid="queue-item-task-page-link"[^>]*href="\/workspace\/ws\/task\/LIN-7\?source=linear"/);
  });

  test('no identifier means no link', () => {
    const html = sandbox.renderQueueRow({ id: 'd1', promptName: 'P', dispatchedAt: '2026-01-01T00:00:00Z' }, 'ws');
    assert.ok(!html.includes('queue-item-task-page-link'));
  });
});

describe('Sessions section task-page link (LIN-3331)', () => {
  test('the list header links to the task page, carrying the source', async () => {
    const container = makeEl();
    const { sandbox } = sandboxWithCommon();
    sandbox.api = async () => ({ sessions: [] });
    vm.runInContext(read('public/sessions.js'), sandbox, { filename: 'sessions.js' });
    sandbox.SessionsSection.init(container, { urlKey: 'ws', identifier: 'LIN-7', source: 'linear', bindingScope: 'team-a' });
    await new Promise((r) => setImmediate(r));
    assert.match(container.innerHTML, /data-testid="sessions-task-page-link"[^>]*href="\/workspace\/ws\/task\/LIN-7\?source=linear"/);
  });
});

describe('Observation task-block task-page link (LIN-3331)', () => {
  const { sandbox } = sandboxWithCommon();
  vm.runInContext(read('public/observation.js'), sandbox, { filename: 'observation.js' });
  const { renderTaskBlock } = sandbox.module.exports;

  test('carries the run source on obs-task-page-link', () => {
    const html = renderTaskBlock({ workspaceUrlKey: 'ws' }, 'LIN-1', null, [
      { loopId: 'l1', issueSource: 'linear', issueBindingScope: 'team-a' },
    ]);
    assert.match(html, /data-testid="obs-task-page-link"[^>]*href="\/workspace\/ws\/task\/LIN-1\?source=linear"/);
    assert.ok(!html.includes('bindingScope'), 'the pair-era scope is ignored');
  });

  test('falls back to a plain link when no run carries the source', () => {
    const html = renderTaskBlock({ workspaceUrlKey: 'ws' }, 'LIN-1', null, [{ loopId: 'l1' }]);
    assert.match(html, /data-testid="obs-task-page-link"[^>]*href="\/workspace\/ws\/task\/LIN-1"/);
    assert.ok(!/obs-task-page-link[^>]*\?/.test(html), 'no query string without a source');
  });
});

describe('Dispatch history task-page link (LIN-3331)', () => {
  const { sandbox } = sandboxWithCommon();
  vm.runInContext(read('public/dispatch.js'), sandbox, { filename: 'dispatch.js' });

  function renderHistory(items) {
    const container = makeEl();
    sandbox.renderDispatchHistoryList(container, items, items.length, 0, 'ws');
    return container.innerHTML;
  }

  test('carries the item source on history-task-page-link', () => {
    const html = renderHistory([{
      status: 'done', issueIdentifier: 'LIN-7', issueSource: 'linear', issueBindingScope: 'team-a',
      promptName: 'P', dispatchedAt: '2026-01-01T00:00:00Z', resolvedAt: '2026-01-01T00:01:00Z',
    }]);
    assert.match(html, /data-testid="history-task-page-link"[^>]*href="\/workspace\/ws\/task\/LIN-7\?source=linear"/);
  });

  test('no identifier means no link', () => {
    const html = renderHistory([{
      status: 'done', promptName: 'P', dispatchedAt: '2026-01-01T00:00:00Z', resolvedAt: '2026-01-01T00:01:00Z',
    }]);
    assert.ok(!html.includes('history-task-page-link'));
  });
});

describe('Live Console lane task-page link (LIN-3331)', () => {
  function laneHarness() {
    const { sandbox } = sandboxWithCommon({
      __LIVE_CONSOLE_DATA__: { urlKey: 'ws', workspaces: [] },
      PULSE_SPAN_RUNGS_MS: [180000],
      api: async () => new Promise(() => {}),
    });
    vm.runInContext(read('public/live-console.js'), sandbox, { filename: 'live-console.js' });
    const { updateLaneNode } = sandbox.module.exports;
    const anchors = {};
    const li = { querySelector: (sel) => { if (!anchors[sel]) anchors[sel] = makeEl(); return anchors[sel]; } };
    return { updateLaneNode, li, anchors };
  }

  test('a lane with a task and a source shows the link, carrying the source', () => {
    const { updateLaneNode, li, anchors } = laneHarness();
    updateLaneNode(li, { task: 'LIN-5', workspaceUrlKey: 'ws', workspaceName: 'WS', issueSource: 'linear', issueBindingScope: 'team-a' });
    const link = anchors['.lc-lane-task-page'];
    assert.equal(link.hidden, false, 'link shown');
    assert.equal(link.getAttribute('href'), '/workspace/ws/task/LIN-5?source=linear');
  });

  test('a repaint with the task gone hides the link and removes the href', () => {
    const { updateLaneNode, li, anchors } = laneHarness();
    updateLaneNode(li, { task: 'LIN-5', workspaceUrlKey: 'ws' });
    const link = anchors['.lc-lane-task-page'];
    assert.equal(link.hidden, false, 'shown while the lane has a task');
    // The same node is reused across polls; a repaint with no task must clear it.
    updateLaneNode(li, { workspaceUrlKey: 'ws' });
    assert.equal(link.hidden, true, 'hidden when the task is absent');
    assert.equal(link.getAttribute('href'), null, 'href removed on hide');
  });
});
