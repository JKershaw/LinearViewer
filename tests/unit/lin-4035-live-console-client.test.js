/**
 * LIN-4035 — the Live Console client half: one link rule, "ID · title" display,
 * and the activity section that starts collapsed.
 *
 * Run with: node --test tests/unit/lin-4035-live-console-client.test.js
 *
 * The client runs in a vm world over the shared fake DOM (tests/unit/helpers/fake-dom.js, through
 * client-world.js). The page is the server's own markup from renderLiveConsolePage, with the server's initial
 * state removed, so every hidden or collapsed assertion is the client's write. The stream row is pinned as its
 * markup string (`eventRowHtml`). The lane is supplied as markup, because laneNode is not exported (see
 * LANE_CONTENTS). Each test's `api` is the client's own exports, read off the world.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorld, clickOn } from './helpers/client-world.js';
import { harnessModelsBlock } from '../../lib/model-routing-harnesses.js';
import { renderLiveConsolePage } from '../../lib/render-live-console.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const CLIENT_SRC = read('public/live-console.js');

// The server's page, body only. The fake parser rejects `<!doctype …>`, so the doctype is removed first. Every
// `hidden` and `aria-expanded="false"` the server ships is removed too: the collapsed and hidden tests below must
// pass on the client's writes, not on the server's markup.
function pageBody() {
  const html = renderLiveConsolePage({ urlKey: 'ws' }).replace(/<!doctype[^>]*>/i, '');
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
  return body.replace(/<[^>]*>/g, (tag) => tag.replace(/\shidden(?=[\s>])/g, '').replace(/\saria-expanded="false"/g, ''));
}

// The lane markup laneNode builds (live-console.js, `function laneNode`), with its initial `hidden` attributes removed
// so updateLaneNode's writes are what the tests see. laneNode is not exported, and it only runs once a feed resolves,
// which the pending feed keeps out of reach, so the suite supplies the lane. laneHarness pins its classes to the
// client source: drift in laneNode turns that test red.
const LANE_CONTENTS = `
        <span class="lc-lane-bar" aria-hidden="true"></span>
        <span class="lc-lane-head">
          <a class="lc-lane-task" data-testid="live-console-lane-task" href="#"></a>
          <span class="lc-lane-title-sep" aria-hidden="true">·</span>
          <span class="lc-lane-title" data-testid="live-console-lane-title"></span>
          <a class="lc-lane-run" data-testid="live-console-lane-run" href="#">open run ↗</a>
          <span class="lc-lane-ws"></span>
        </span>
        <span class="lc-lane-stage-row">
          <span class="lc-lane-stage" data-testid="live-console-lane-stage"></span>
          <span class="lc-lane-since" data-testid="live-console-lane-since"></span>
          <span class="lc-lane-action" data-testid="live-console-lane-action"></span>
          <span class="lc-lane-tickets" data-testid="live-console-lane-tickets"></span>
        </span>
        <span class="lc-lane-mid">
          <span class="lc-lane-cred" data-testid="live-console-lane-credential"></span>
          <span class="lc-lane-hb" data-testid="live-console-heartbeat"></span>
          <span class="lc-lane-summary"></span>
        </span>`;

function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}

// Loads the real common.js, then the real live-console.js, into one world over the server's page. `storage` may be
// a throwing object to exercise the try/catch paths; `throwingGetter` makes the storage getter itself throw.
function loadClient({ storage = memoryStorage(), throwingGetter = false } = {}) {
  // `localStorage` goes on both the window and the global, as the client reads `window.localStorage` and a bare name
  // needs the global. Both are accessor properties, so a throwing getter is not read at copy time (LIN-4279).
  const storageProps = {};
  Object.defineProperty(storageProps, 'localStorage', {
    enumerable: true,
    configurable: true,
    get() {
      if (throwingGetter) throw new Error('storage denied');
      return storage;
    },
  });
  const world = loadWorld({
    window: Object.defineProperties({
      __LIVE_CONSOLE_DATA__: { urlKey: 'ws', workspaces: [] },
      __HARNESS_MODELS__: harnessModelsBlock(),
      matchMedia: () => ({ matches: false }),
      addEventListener() {},
      removeEventListener() {},
      // PENDING FEED. window.api never resolves, so poll() never reaches applyFeed. applyFeed's `style` writes
      // (live-console.js:338-340, :408, :482, :489, :516-519) stay out of reach. A later test that resolves this
      // feed has hit that stop: it must not add `style` to the fake. See LIN-4271.
      api: () => new Promise(() => {}),
    }, Object.getOwnPropertyDescriptors(storageProps)),
    scripts: ['common.js'],
    // The client's setTimeout calls are collected, not run, so no timer outlives the test.
    timers: [],
    globals: Object.defineProperties({
      module: { exports: {} },
      requestAnimationFrame: () => 0,
      cancelAnimationFrame() {},
      setInterval: () => 0,
      clearInterval() {},
    }, Object.getOwnPropertyDescriptors(storageProps)),
  });
  // The page is in place before the client boots, so every id it looks up at load is a real element.
  world.document.body.innerHTML = pageBody();
  world.run(CLIENT_SRC);
  const el = (id) => world.document.getElementById(id.replace(/^#/, ''));
  return { api: world.sandbox.module.exports, el, world };
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
  // The lane's classes, pinned to laneNode and to updateLaneNode's own selectors (live-console.js). A class that
  // laneNode drops, or that updateLaneNode starts to query and the fixture lacks, turns this red.
  function pinLaneMarkupToClient() {
    const start = CLIENT_SRC.indexOf('function laneNode(lane)');
    const template = CLIENT_SRC.slice(start, CLIENT_SRC.indexOf('updateLaneNode(li, lane);', start));
    assert.ok(template.includes('<li class="lc-lane'), 'laneNode still builds the lane the fixture mirrors');
    const queried = [...CLIENT_SRC.matchAll(/li\.querySelector\('\.([a-z-]+)'\)/g)].map(m => m[1]);
    assert.ok(queried.length > 0, 'updateLaneNode queries its lane parts');
    for (const cls of queried) {
      assert.ok(template.includes(`class="${cls}"`), `laneNode builds .${cls}`);
      assert.ok(LANE_CONTENTS.includes(`class="${cls}"`), `the lane fixture carries .${cls}`);
    }
  }
  function laneHarness() {
    pinLaneMarkupToClient();
    const { api, world } = loadClient();
    const li = world.document.createElement('li');
    li.setAttribute('class', 'lc-lane');
    li.innerHTML = LANE_CONTENTS;
    return { updateLaneNode: api.updateLaneNode, li };
  }
  const base = { task: 'LIN-5', workspaceUrlKey: 'ws', workspaceName: 'WS', summary: '', heartbeat: null };

  test('the separator shows with a title and hides without one', () => {
    const { updateLaneNode, li } = laneHarness();
    updateLaneNode(li, { ...base, title: 'Ship the thing' });
    assert.equal(li.querySelector('.lc-lane-title-sep').hidden, false);
    assert.equal(li.querySelector('.lc-lane-title').textContent, 'Ship the thing', 'the title is the title alone');
    assert.equal(li.querySelector('.lc-lane-title').getAttribute('title'), 'Ship the thing');
    updateLaneNode(li, { ...base, title: null });
    assert.equal(li.querySelector('.lc-lane-title-sep').hidden, true);
    assert.equal(li.querySelector('.lc-lane-title').getAttribute('title'), null);
  });
});

describe('the bar detail line names the task and offers both links (LIN-4035)', () => {
  function detailHarness(run, href = '/workspace/ws/observation/session/S1') {
    const { api, el, world } = loadClient();
    const { document } = world;
    // The bar node: `_run` is the run the bar carries, and its first element child is the run link.
    const div = document.createElement('div');
    div._run = run;
    const link = document.createElement('a');
    link.setAttribute('href', href);
    div.appendChild(link);
    api.showBarDetail(div);
    return el('#live-console-timeline-detail');
  }
  const run = { issueIdentifier: 'LIN-5', title: 'Ship the thing', stage: 'Build', workspaceUrlKey: 'ws', issueSource: 'linear' };

  test('reads "ID · title — stage", with the identifier linked to the task page', () => {
    const detail = detailHarness(run);
    assert.equal(detail.textContent.startsWith('LIN-5 · Ship the thing — Build'), true, detail.textContent);
    const task = detail.querySelector('.lc-timeline-detail-task');
    assert.equal(task.getAttribute('href'), '/workspace/ws/task/LIN-5?source=linear');
    assert.equal(task.textContent, 'LIN-5');
  });

  test('ends with both "open run →" and "open task →"', () => {
    const detail = detailHarness(run);
    const links = detail.querySelectorAll('.lc-timeline-detail-link');
    assert.deepEqual(links.map(l => l.textContent), ['open run →', 'open task →']);
    assert.equal(links[0].getAttribute('href'), '/workspace/ws/observation/session/S1');
    assert.equal(links[1].getAttribute('href'), '/workspace/ws/task/LIN-5?source=linear');
  });

  test('a run with no title reads "ID — stage", and with no task page the identifier is plain', () => {
    const detail = detailHarness({ issueIdentifier: 'LIN-6', stage: 'Build', workspaceUrlKey: '' });
    assert.equal(detail.textContent.startsWith('LIN-6 — Build'), true, detail.textContent);
    assert.equal(detail.querySelector('.lc-timeline-detail-task'), null);
    assert.equal(detail.querySelectorAll('.lc-timeline-detail-link').some(l => l.textContent === 'open task →'), false);
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

  test('the toggle flips the section and remembers the choice in one key', async () => {
    const storage = memoryStorage();
    const { el } = loadClient({ storage });
    const toggle = el('#live-console-activity-toggle');
    await clickOn(toggle);
    assert.equal(el('#live-console-activity-body').hidden, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(storage._m.get('live-console-activity'), 'open');
    await clickOn(toggle);
    assert.equal(el('#live-console-activity-body').hidden, true);
    assert.equal(storage._m.get('live-console-activity'), 'closed');
  });

  test('a storage that throws on read falls back to collapsed, and the toggle still works', async () => {
    const { el } = loadClient({ throwingGetter: true });
    assert.equal(el('#live-console-activity-body').hidden, true, 'collapsed, without throwing');
    await clickOn(el('#live-console-activity-toggle'));
    assert.equal(el('#live-console-activity-body').hidden, false, 'the toggle still opens it for the session');
  });

  test('a storage that throws on write still opens and closes the section', async () => {
    const storage = { getItem: () => null, setItem() { throw new Error('quota'); } };
    const { el } = loadClient({ storage });
    const toggle = el('#live-console-activity-toggle');
    await clickOn(toggle);
    assert.equal(el('#live-console-activity-body').hidden, false);
    await clickOn(toggle);
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
