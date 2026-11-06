/**
 * LIN-3331 — the client twin reaches the client surfaces.
 *
 * Loads the REAL public/common.js (so `window.taskPageHref` is the shipped
 * builder) alongside the shipped browser scripts, then asserts each in-scope
 * client surface emits a `<surface>-task-page-link` whose href is built by the
 * helper and carries the issue's source kind (`?source=<kind>`). These are the
 * one-assertion-per-surface checks the plan calls for; the server-rendered
 * surfaces are covered in render.test.js / render-session.test.js.
 *
 * Every surface runs in a client world (tests/unit/helpers/client-world.js over the one fake DOM, LIN-4310): the
 * swipe card is the server's own markup (helpers/swipe-page.js), and the Live Console lane is the client's own builder.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withHarnessModels } from '../fixtures/harness-models.js';
import { loadWorld } from './helpers/client-world.js';
import { loadLiveConsole, makeLaneNode } from './helpers/live-console-world.js';
import { swipePageBody } from './helpers/swipe-page.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const COMMON_SRC = read('public/common.js');

/**
 * A client world with the real common.js already loaded. The stubs are the window and global calls a page's own scripts
 * make at load (matchMedia, the storage and timer stubs), each set before common.js runs, as the page sets them.
 */
function worldWithCommon(windowStubs = {}) {
  const world = loadWorld({
    scripts: [],
    window: { matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {}, ...windowStubs },
    globals: {
      localStorage: { getItem: () => null, setItem() {} },
      module: { exports: {} },
      setInterval: () => 0,
      clearInterval() {},
      cancelAnimationFrame() {},
    },
  });
  world.run(withHarnessModels(COMMON_SRC));
  return world;
}

describe('Swipe card task-page link (LIN-3331)', () => {
  function renderCard(issue, urlKey = 'ws') {
    const world = loadWorld({
      scripts: [],
      window: { __SWIPE_DATA__: { issues: [issue], filters: [{ key: 'all', label: 'All' }], urlKey } },
      globals: { location: { search: '', href: '' }, history: { replaceState() {} } },
    });
    world.document.body.innerHTML = swipePageBody({ urlKey });
    world.run(withHarnessModels(COMMON_SRC));
    world.window.renderMarkdown = (s) => world.window.escapeHtml(s);
    world.window.stripCodeBlockWrapper = (s) => s;
    world.run(read('public/swipe.js'));
    return world.document.getElementById('swipe-card').innerHTML;
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
  const world = worldWithCommon();

  test('builds the href with the shared helper, carrying the source', () => {
    const html = world.sandbox.renderQueueRow({ id: 'd1', promptName: 'P', dispatchedAt: '2026-01-01T00:00:00Z', issueIdentifier: 'LIN-7', issueSource: 'linear', issueBindingScope: 'team-a' }, 'ws');
    assert.match(html, /data-testid="queue-item-task-page-link"[^>]*href="\/workspace\/ws\/task\/LIN-7\?source=linear"/);
  });

  test('no identifier means no link', () => {
    const html = world.sandbox.renderQueueRow({ id: 'd1', promptName: 'P', dispatchedAt: '2026-01-01T00:00:00Z' }, 'ws');
    assert.ok(!html.includes('queue-item-task-page-link'));
  });
});

describe('Sessions section task-page link (LIN-3331)', () => {
  test('the list header links to the task page, carrying the source', async () => {
    const world = worldWithCommon({ api: async () => ({ sessions: [] }) });
    const container = world.makeContainer();
    world.run(read('public/sessions.js'));
    world.sandbox.SessionsSection.init(container, { urlKey: 'ws', identifier: 'LIN-7', source: 'linear', bindingScope: 'team-a' });
    await new Promise((r) => setImmediate(r));
    assert.match(container.innerHTML, /data-testid="sessions-task-page-link"[^>]*href="\/workspace\/ws\/task\/LIN-7\?source=linear"/);
  });
});

describe('Observation task-block task-page link (LIN-3331)', () => {
  const world = worldWithCommon();
  world.run(read('public/observation.js'));
  const { renderTaskBlock } = world.sandbox.module.exports;

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
  const world = worldWithCommon();
  world.run(read('public/dispatch.js'));

  function renderHistory(items) {
    const container = world.makeContainer();
    world.sandbox.renderDispatchHistoryList(container, items, items.length, 0, 'ws');
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
  // The lane is the client's own laneNode (LIN-4310), in the client world the page loads over.
  function laneHarness(lane = {}) {
    const { api, world } = loadLiveConsole();
    const li = makeLaneNode(world, lane);
    return { updateLaneNode: api.updateLaneNode, li };
  }

  // LIN-3977: the lane has ONE task link (to the task page); the separate "task ↗"
  // link is gone. The LIN-3331 contract is unchanged: the link carries the source,
  // and a repaint with no task removes its href.
  test('a lane with a task and a source links the task page, carrying the source', () => {
    const { li } = laneHarness({ task: 'LIN-5', workspaceUrlKey: 'ws', workspaceName: 'WS', issueSource: 'linear', issueBindingScope: 'team-a' });
    const link = li.querySelector('.lc-lane-task');
    assert.equal(link.getAttribute('href'), '/workspace/ws/task/LIN-5?source=linear');
  });

  test('a repaint with the task gone removes the task link href', () => {
    const { updateLaneNode, li } = laneHarness();
    updateLaneNode(li, { task: 'LIN-5', workspaceUrlKey: 'ws' });
    const link = li.querySelector('.lc-lane-task');
    assert.equal(link.getAttribute('href'), '/workspace/ws/task/LIN-5', 'linked while the lane has a task');
    // The same node is reused across polls; a repaint with no task must clear it.
    updateLaneNode(li, { workspaceUrlKey: 'ws' });
    assert.equal(link.getAttribute('href'), null, 'href removed when the task is absent');
  });
});
