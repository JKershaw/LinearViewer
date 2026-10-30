/**
 * LIN-4035 — the Live Console client half: one link rule, "ID · title" display,
 * and the activity section that starts collapsed.
 *
 * Run with: node --test tests/unit/lin-4035-live-console-client.test.js
 *
 * The client runs in a node:vm sandbox (the seam the LIN-3331 and LIN-3977 tests
 * use). There is no DOM parser here, so the stream row is pinned as its markup
 * string (`eventRowHtml`), and the detail line and the lane are driven through
 * their real element writes.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { withHarnessModels } from '../fixtures/harness-models.js';
import { renderLiveConsolePage } from '../../lib/render-live-console.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const COMMON_SRC = read('public/common.js');
const CLIENT_SRC = read('public/live-console.js');

// A tiny element: enough DOM for the client's writes, with real child tracking so
// the detail line's text can be read back.
class FakeEl {
  constructor(tag = 'div') {
    this.tag = tag;
    this.className = '';
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.children = [];
    this._attrs = {};
    this._listeners = {};
    this._text = '';
    this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return this._attrs[k] ?? null; }
  removeAttribute(k) { delete this._attrs[k]; }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  fire(type) { for (const fn of this._listeners[type] || []) fn({}); }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); return node; }
  remove() {}
  insertBefore() {}
  insertAdjacentHTML() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  get firstElementChild() { return null; }
}

// Element text as a reader sees it: text nodes plus each child element's text.
const textOf = (node) => (typeof node === 'string' ? node : node.children.length ? node.children.map(textOf).join('') : node.textContent);

function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}

// Loads the real common.js and live-console.js in a fresh sandbox. `storage` may
// be a throwing object to exercise the try/catch paths.
function loadClient({ storage = memoryStorage(), throwingGetter = false } = {}) {
  const els = new Map();
  const byKey = (key) => { if (!els.has(key)) els.set(key, new FakeEl()); return els.get(key); };
  const sandbox = {
    location: { search: '', href: '' },
    document: {
      title: '', hidden: false,
      getElementById: (id) => byKey(`#${id}`),
      querySelector: (sel) => byKey(sel),
      querySelectorAll: () => [],
      createElement: (tag) => new FakeEl(tag),
      addEventListener() {},
    },
    history: { replaceState() {} },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false }),
    addEventListener() {}, removeEventListener() {},
    module: { exports: {} },
    console,
    __LIVE_CONSOLE_DATA__: { urlKey: 'ws', workspaces: [] },
    PULSE_SPAN_RUNGS_MS: [180000],
    api: async () => new Promise(() => {}),
  };
  if (throwingGetter) {
    Object.defineProperty(sandbox, 'localStorage', { configurable: true, get() { throw new Error('storage denied'); } });
  } else {
    sandbox.localStorage = storage;
  }
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(withHarnessModels(COMMON_SRC), sandbox, { filename: 'common.js' });
  vm.runInContext(CLIENT_SRC, sandbox, { filename: 'live-console.js' });
  // `el('live-console-more')` or `el('#live-console-more')`: the element the client looked up by id.
  return { api: sandbox.module.exports, el: (id) => byKey(`#${id.replace(/^#/, '')}`), sandbox };
}

const stream = (over = {}) => ({
  id: 'ev:1', kind: 'done', action: 'implementation', actionWord: 'finished', summary: 'shipped',
  task: 'LIN-5', workspaceUrlKey: 'ws', workspaceName: 'WS', iso: '2026-10-30T10:00:00.000Z',
  ...over,
});

// The stream row's markup, read back as the links and text it carries.
function linksIn(html) {
  return [...html.matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)].map(([, attrs, text]) => ({
    attrs,
    href: (attrs.match(/href="([^"]*)"/) || [])[1] || null,
    cls: (attrs.match(/class="([^"]*)"/) || [])[1] || null,
    text,
  }));
}

describe('the stream row names its task, and its run is a separate link (LIN-4035)', () => {
  test('the identifier links to the task page, with the event\'s own source', () => {
    const { api } = loadClient();
    const links = linksIn(api.eventRowHtml(stream({ issueSource: 'linear' }), false));
    const task = links.find(l => l.cls === 'lc-event-task');
    assert.equal(task.href, '/workspace/ws/task/LIN-5?source=linear');
    assert.equal(task.text, 'LIN-5');
  });

  test('a row with a session still links its identifier to the task page; the run is a labelled "run ↗" link', () => {
    const { api } = loadClient();
    const html = api.eventRowHtml(stream({ sessionId: 'S1', issueSource: 'linear' }), false);
    const links = linksIn(html);
    assert.equal(links.find(l => l.cls === 'lc-event-task').href, '/workspace/ws/task/LIN-5?source=linear', 'the identifier never follows the run');
    const run = links.find(l => l.cls === 'lc-event-run');
    assert.equal(run.href, '/workspace/ws/observation/session/S1');
    assert.equal(run.text, 'run ↗');
  });

  test('a row with no session has no run link to offer', () => {
    const { api } = loadClient();
    const html = api.eventRowHtml(stream({ sessionId: null }), false);
    assert.equal(html.includes('lc-event-run'), false);
  });

  test('with no task page the identifier is plain text, not a link', () => {
    const { api } = loadClient();
    const html = api.eventRowHtml(stream({ workspaceUrlKey: '' }), false);
    assert.equal(linksIn(html).some(l => l.cls === 'lc-event-task'), false);
    assert.match(html, /<span class="lc-event-task">LIN-5<\/span>/);
  });

  test('a mixed-kind workspace opens each task in its own binding', () => {
    const { api } = loadClient();
    const jira = linksIn(api.eventRowHtml(stream({ issueSource: 'jira' }), false)).find(l => l.cls === 'lc-event-task');
    const linear = linksIn(api.eventRowHtml(stream({ issueSource: 'linear' }), false)).find(l => l.cls === 'lc-event-task');
    assert.equal(jira.href, '/workspace/ws/task/LIN-5?source=jira');
    assert.equal(linear.href, '/workspace/ws/task/LIN-5?source=linear');
  });

  test('the title is written after the identifier, as text and in the task link\'s title and aria-label', () => {
    const { api } = loadClient();
    const html = api.eventRowHtml(stream({ title: 'Ship the thing', issueSource: 'linear' }), false);
    assert.match(html, /<span class="lc-event-title" data-testid="live-console-event-title" title="Ship the thing">Ship the thing<\/span>/);
    const task = linksIn(html).find(l => l.cls === 'lc-event-task');
    assert.match(task.attrs, /aria-label="LIN-5 · Ship the thing"/);
    assert.match(task.attrs, /title="open LIN-5 · Ship the thing in its task page"/);
  });

  test('no title: no title element is written', () => {
    const { api } = loadClient();
    assert.equal(api.eventRowHtml(stream({ title: null }), false).includes('lc-event-title'), false);
  });

  test('a title is never parsed as markup', () => {
    const { api } = loadClient();
    const html = api.eventRowHtml(stream({ title: '<img src=x onerror=alert(1)>' }), false);
    assert.equal(html.includes('<img'), false, 'the title arrives as text');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  });
});

describe('the lane reads "ID · title" (LIN-4035)', () => {
  function laneHarness() {
    const { api } = loadClient();
    const anchors = {};
    const li = { classList: { toggle() {} }, querySelector: (sel) => { if (!anchors[sel]) anchors[sel] = new FakeEl(); return anchors[sel]; } };
    return { updateLaneNode: api.updateLaneNode, li, anchors };
  }
  const base = { task: 'LIN-5', workspaceUrlKey: 'ws', workspaceName: 'WS', summary: '', heartbeat: null };

  test('the separator shows with a title and hides without one', () => {
    const { updateLaneNode, li, anchors } = laneHarness();
    updateLaneNode(li, { ...base, title: 'Ship the thing' });
    assert.equal(anchors['.lc-lane-title-sep'].hidden, false);
    assert.equal(anchors['.lc-lane-title'].textContent, 'Ship the thing', 'the title is the title alone');
    assert.equal(anchors['.lc-lane-title'].getAttribute('title'), 'Ship the thing');
    updateLaneNode(li, { ...base, title: null });
    assert.equal(anchors['.lc-lane-title-sep'].hidden, true);
    assert.equal(anchors['.lc-lane-title'].getAttribute('title'), null);
  });
});

describe('the bar detail line names the task and offers both links (LIN-4035)', () => {
  function detailHarness(run, href = '/workspace/ws/observation/session/S1') {
    const { api, el } = loadClient();
    const div = { _run: run, firstElementChild: { getAttribute: (k) => (k === 'href' ? href : null) } };
    api.showBarDetail(div);
    return el('#live-console-timeline-detail');
  }
  const run = { issueIdentifier: 'LIN-5', title: 'Ship the thing', stage: 'Build', workspaceUrlKey: 'ws', issueSource: 'linear' };

  test('reads "ID · title — stage", with the identifier linked to the task page', () => {
    const detail = detailHarness(run);
    assert.equal(textOf(detail).startsWith('LIN-5 · Ship the thing — Build'), true, textOf(detail));
    const task = detail.children.find(c => c.className === 'lc-timeline-detail-task');
    assert.equal(task.getAttribute('href'), '/workspace/ws/task/LIN-5?source=linear');
    assert.equal(task.textContent, 'LIN-5');
  });

  test('ends with both "open run →" and "open task →"', () => {
    const detail = detailHarness(run);
    const links = detail.children.filter(c => c.className === 'lc-timeline-detail-link');
    assert.deepEqual(links.map(l => l.textContent), ['open run →', 'open task →']);
    assert.equal(links[0].getAttribute('href'), '/workspace/ws/observation/session/S1');
    assert.equal(links[1].getAttribute('href'), '/workspace/ws/task/LIN-5?source=linear');
  });

  test('a run with no title reads "ID — stage", and with no task page the identifier is plain', () => {
    const detail = detailHarness({ issueIdentifier: 'LIN-6', stage: 'Build', workspaceUrlKey: '' });
    assert.equal(textOf(detail).startsWith('LIN-6 — Build'), true, textOf(detail));
    assert.equal(detail.children.some(c => c.className === 'lc-timeline-detail-task'), false);
    assert.equal(detail.children.some(c => c.textContent === 'open task →'), false);
  });
});

describe('the activity section starts collapsed, on every width (LIN-4035)', () => {
  test('the server HTML is collapsed: the toggle says so and the body and "view earlier" are hidden', () => {
    const html = renderLiveConsolePage({ urlKey: 'ws' });
    assert.match(html, /<button type="button" class="lc-section-label lc-activity-toggle" id="live-console-activity-toggle"[^>]*aria-expanded="false" aria-controls="live-console-activity-body"/);
    assert.match(html, /<div class="lc-activity-body" id="live-console-activity-body" data-testid="live-console-activity-body" hidden>/);
    assert.match(html, /<div class="lc-more" id="live-console-more" hidden>/);
    const body = html.indexOf('id="live-console-activity-body"');
    assert.ok(html.indexOf('id="live-console-stream"') > body, 'the stream lives inside the body');
  });

  test('nothing is stored, and the section stays collapsed, when no choice was remembered', () => {
    const storage = memoryStorage();
    const { el } = loadClient({ storage });
    assert.equal(el('#live-console-activity-body').hidden, true);
    assert.equal(el('#live-console-activity-toggle').getAttribute('aria-expanded'), 'false');
    assert.equal(storage._m.has('live-console-activity'), false);
  });

  test('a remembered "open" opens the section on load', () => {
    const { el } = loadClient({ storage: memoryStorage({ 'live-console-activity': 'open' }) });
    assert.equal(el('#live-console-activity-body').hidden, false);
    assert.equal(el('#live-console-activity-toggle').getAttribute('aria-expanded'), 'true');
  });

  test('the toggle flips the section and remembers the choice in one key', () => {
    const storage = memoryStorage();
    const { el } = loadClient({ storage });
    const toggle = el('#live-console-activity-toggle');
    toggle.fire('click');
    assert.equal(el('#live-console-activity-body').hidden, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(storage._m.get('live-console-activity'), 'open');
    toggle.fire('click');
    assert.equal(el('#live-console-activity-body').hidden, true);
    assert.equal(storage._m.get('live-console-activity'), 'closed');
  });

  test('a storage that throws on read falls back to collapsed, and the toggle still works', () => {
    const { el } = loadClient({ throwingGetter: true });
    assert.equal(el('#live-console-activity-body').hidden, true, 'collapsed, without throwing');
    el('#live-console-activity-toggle').fire('click');
    assert.equal(el('#live-console-activity-body').hidden, false, 'the toggle still opens it for the session');
  });

  test('a storage that throws on write still opens and closes the section', () => {
    const storage = { getItem: () => null, setItem() { throw new Error('quota'); } };
    const { el } = loadClient({ storage });
    const toggle = el('#live-console-activity-toggle');
    toggle.fire('click');
    assert.equal(el('#live-console-activity-body').hidden, false);
    toggle.fire('click');
    assert.equal(el('#live-console-activity-body').hidden, true);
  });
});

describe('"N new" counts arrivals after the first feed, cumulatively (LIN-4035)', () => {
  const count = (el) => el('#live-console-activity-new');

  test('the first feed is the baseline: nothing counts, and the count stays hidden', () => {
    const { api, el } = loadClient();
    api.countActivityArrivals([{ id: 'a' }, { id: 'b' }], true);
    assert.equal(count(el).hidden, true);
    assert.equal(count(el).textContent, '');
  });

  test('ids that arrive after the first feed count, and a repeat of a seen id does not', () => {
    const { api, el } = loadClient();
    api.countActivityArrivals([{ id: 'a' }], true);
    api.countActivityArrivals([{ id: 'a' }, { id: 'b' }, { id: 'c' }], true);
    assert.equal(count(el).hidden, false);
    assert.equal(count(el).textContent, '· 2 new');
    api.countActivityArrivals([{ id: 'b' }, { id: 'c' }], true);
    assert.equal(count(el).textContent, '· 2 new', 'the same ids on a later poll do not count again');
  });

  test('an id that leaves the feed and comes back is not counted twice', () => {
    const { api, el } = loadClient();
    api.countActivityArrivals([{ id: 'a' }], true);
    api.countActivityArrivals([{ id: 'a' }, { id: 'x' }], true);
    api.countActivityArrivals([{ id: 'a' }], true);
    api.countActivityArrivals([{ id: 'a' }, { id: 'x' }], true);
    assert.equal(count(el).textContent, '· 1 new');
  });

  test('a chip re-paint of the same feed (animate false) never counts', () => {
    const { api, el } = loadClient();
    api.countActivityArrivals([{ id: 'a' }], true);
    api.countActivityArrivals([{ id: 'z' }], false);
    assert.equal(count(el).hidden, true);
  });

  test('a poll that adds nothing leaves the count alone', () => {
    const { api, el } = loadClient();
    api.countActivityArrivals([{ id: 'a' }], true);
    api.countActivityArrivals([{ id: 'a' }, { id: 'b' }], true);
    api.countActivityArrivals([{ id: 'a' }, { id: 'b' }], true);
    assert.equal(count(el).textContent, '· 1 new');
  });

  test('a derived row that replaces the status row the page already counted is not counted again', () => {
    const { api, el } = loadClient();
    api.countActivityArrivals([], true);
    api.countActivityArrivals([{ id: 'ev:S', loopId: 'L1', kind: 'working' }], true);
    assert.equal(count(el).textContent, '· 1 new');
    // The status row folds into its derived moment: it leaves, and the derived row (a new id) arrives in the same poll.
    api.countActivityArrivals([{ id: 'd:L1:m1', loopId: 'L1', kind: 'working', derived: true, foldedFrom: 'ev:S' }], true);
    assert.equal(count(el).textContent, '· 1 new', 'the same moment, counted once');
  });

  test('an ownedBy fold (status row with no loopId) is counted once', () => {
    const { api, el } = loadClient();
    api.countActivityArrivals([], true);
    api.countActivityArrivals([{ id: 'ev:S', loopId: null, kind: 'done' }], true);
    assert.equal(count(el).textContent, '· 1 new');
    api.countActivityArrivals([{ id: 'd:L1:finished', loopId: 'L1', kind: 'done', derived: true, foldedFrom: 'ev:S' }], true);
    assert.equal(count(el).textContent, '· 1 new', 'the same moment, counted once');
  });

  test('a derived row with no foldedFrom counts, even when a same-loop, same-kind row left in the same poll', () => {
    const { api, el } = loadClient();
    api.countActivityArrivals([], true);
    api.countActivityArrivals([{ id: 'ev:S', loopId: 'L1', kind: 'working' }], true);
    api.countActivityArrivals([{ id: 'd:L1:m1', loopId: 'L1', kind: 'working', derived: true }], true);
    assert.equal(count(el).textContent, '· 2 new', 'a row that left for another reason does not suppress a real arrival');
  });

  test('a derived row with no status row to replace still counts', () => {
    const { api, el } = loadClient();
    api.countActivityArrivals([], true);
    api.countActivityArrivals([{ id: 'd:L1:m1', loopId: 'L1', kind: 'done', derived: true }], true);
    assert.equal(count(el).textContent, '· 1 new');
  });

  test('a derived row of a different kind from the row that left is new activity', () => {
    const { api, el } = loadClient();
    api.countActivityArrivals([], true);
    api.countActivityArrivals([{ id: 'ev:S', loopId: 'L1', kind: 'working' }], true);
    api.countActivityArrivals([{ id: 'd:L1:m2', loopId: 'L1', kind: 'done', derived: true }], true);
    assert.equal(count(el).textContent, '· 2 new');
  });
});
