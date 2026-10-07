/**
 * LIN-3331 — the client twin reaches the client surfaces.
 *
 * Loads the REAL public/common.js (so `window.taskPageHref` is the shipped
 * builder) alongside the shipped browser scripts, then asserts each in-scope
 * client surface emits a `<surface>-task-page-link` whose href is built by the
 * helper and carries the issue's binding pair. These are the one-assertion-per-
 * surface checks the plan calls for; the server-rendered surfaces are covered
 * in render.test.js / render-session.test.js.
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
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    addEventListener() {},
    remove() {},
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
    document: { title: '', getElementById: (id) => el(`#${id}`), querySelector: (sel) => el(sel), addEventListener() {} },
    history: { replaceState() {} },
    setTimeout: () => 0,
    clearTimeout() {},
    requestAnimationFrame: () => 0,
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

  test('carries the issue binding pair', () => {
    const html = renderCard({ id: 'issue-1', identifier: 'LIN-1', title: 'T', stateType: 'unstarted', source: 'linear', bindingScope: 'team-a' });
    assert.match(html, /data-testid="swipe-task-page-link"[^>]*href="\/workspace\/ws\/task\/LIN-1\?source=linear&amp;bindingScope=team-a"/);
  });

  test('no link on the landing card (no workspace)', () => {
    const html = renderCard({ id: 'issue-1', identifier: 'LIN-1', title: 'T', stateType: 'unstarted' }, null);
    assert.ok(!html.includes('swipe-task-page-link'), 'landing card omits the link');
  });
});

describe('Queue row task-page link (LIN-3331)', () => {
  const { sandbox } = sandboxWithCommon();

  test('builds the href with the shared helper, carrying the pair', () => {
    const html = sandbox.renderQueueRow({ id: 'd1', promptName: 'P', dispatchedAt: '2026-01-01T00:00:00Z', issueIdentifier: 'LIN-7', issueSource: 'linear', issueBindingScope: 'team-a' }, 'ws');
    assert.match(html, /data-testid="queue-item-task-page-link"[^>]*href="\/workspace\/ws\/task\/LIN-7\?source=linear&amp;bindingScope=team-a"/);
  });

  test('no identifier means no link', () => {
    const html = sandbox.renderQueueRow({ id: 'd1', promptName: 'P', dispatchedAt: '2026-01-01T00:00:00Z' }, 'ws');
    assert.ok(!html.includes('queue-item-task-page-link'));
  });
});

describe('Sessions section task-page link (LIN-3331)', () => {
  test('the list header links to the task page, carrying the pair', async () => {
    const container = makeEl();
    const { sandbox } = sandboxWithCommon();
    sandbox.api = async () => ({ sessions: [] });
    vm.runInContext(read('public/sessions.js'), sandbox, { filename: 'sessions.js' });
    sandbox.SessionsSection.init(container, { urlKey: 'ws', identifier: 'LIN-7', source: 'linear', bindingScope: 'team-a' });
    await new Promise((r) => setImmediate(r));
    assert.match(container.innerHTML, /data-testid="sessions-task-page-link"[^>]*href="\/workspace\/ws\/task\/LIN-7\?source=linear&amp;bindingScope=team-a"/);
  });
});
