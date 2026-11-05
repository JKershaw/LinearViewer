/**
 * LIN-4035 — the Live Console client half: one link rule, "ID · title" display,
 * and the activity section that starts collapsed.
 *
 * Run with: node --test tests/unit/lin-4035-live-console-client.test.js
 *
 * The client runs in a vm world over the shared fake DOM (tests/unit/helpers/fake-dom.js, through client-world.js),
 * loaded by the Live Console loader in helpers/live-console-world.js. The stream row is pinned as its markup string
 * (`eventRowHtml`). The lane is supplied as markup (makeLaneNode), pinned to the client source (pinLaneMarkupToClient).
 * Each test's `api` is the client's own exports, read off the world.
 *
 * Pending feed: `window.api` never resolves here (helpers/live-console-world.js), so poll() never reaches applyFeed
 * and its `style` writes stay out of reach. A test that resolves the feed has hit LIN-4271's stop: do not add `style`
 * to the fake.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { clickOn } from './helpers/client-world.js';
import { loadLiveConsole, makeLaneNode, pinLaneMarkupToClient } from './helpers/live-console-world.js';
import { renderLiveConsolePage } from '../../lib/render-live-console.js';

function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
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
    const { api } = loadLiveConsole();
    const links = linksIn(api.eventRowHtml(stream({ issueSource: 'linear' }), false));
    const task = links.find(l => l.cls === 'lc-event-task');
    assert.equal(task.href, '/workspace/ws/task/LIN-5?source=linear');
    assert.equal(task.text, 'LIN-5');
  });

  test('a row with a session still links its identifier to the task page; the run is a labelled "run ↗" link', () => {
    const { api } = loadLiveConsole();
    const html = api.eventRowHtml(stream({ sessionId: 'S1', issueSource: 'linear' }), false);
    const links = linksIn(html);
    assert.equal(links.find(l => l.cls === 'lc-event-task').href, '/workspace/ws/task/LIN-5?source=linear', 'the identifier never follows the run');
    const run = links.find(l => l.cls === 'lc-event-run');
    assert.equal(run.href, '/workspace/ws/observation/session/S1');
    assert.equal(run.text, 'run ↗');
  });

  test('a row with no session has no run link to offer', () => {
    const { api } = loadLiveConsole();
    const html = api.eventRowHtml(stream({ sessionId: null }), false);
    assert.equal(html.includes('lc-event-run'), false);
  });

  test('with no task page the identifier is plain text, not a link', () => {
    const { api } = loadLiveConsole();
    const html = api.eventRowHtml(stream({ workspaceUrlKey: '' }), false);
    assert.equal(linksIn(html).some(l => l.cls === 'lc-event-task'), false);
    assert.match(html, /<span class="lc-event-task">LIN-5<\/span>/);
  });

  test('a mixed-kind workspace opens each task in its own binding', () => {
    const { api } = loadLiveConsole();
    const jira = linksIn(api.eventRowHtml(stream({ issueSource: 'jira' }), false)).find(l => l.cls === 'lc-event-task');
    const linear = linksIn(api.eventRowHtml(stream({ issueSource: 'linear' }), false)).find(l => l.cls === 'lc-event-task');
    assert.equal(jira.href, '/workspace/ws/task/LIN-5?source=jira');
    assert.equal(linear.href, '/workspace/ws/task/LIN-5?source=linear');
  });

  test('the title is written after the identifier, as text and in the task link\'s title and aria-label', () => {
    const { api } = loadLiveConsole();
    const html = api.eventRowHtml(stream({ title: 'Ship the thing', issueSource: 'linear' }), false);
    assert.match(html, /<span class="lc-event-title" data-testid="live-console-event-title" title="Ship the thing">Ship the thing<\/span>/);
    const task = linksIn(html).find(l => l.cls === 'lc-event-task');
    assert.match(task.attrs, /aria-label="LIN-5 · Ship the thing"/);
    assert.match(task.attrs, /title="open LIN-5 · Ship the thing in its task page"/);
  });

  test('no title: no title element is written', () => {
    const { api } = loadLiveConsole();
    assert.equal(api.eventRowHtml(stream({ title: null }), false).includes('lc-event-title'), false);
  });

  test('a title is never parsed as markup', () => {
    const { api } = loadLiveConsole();
    const html = api.eventRowHtml(stream({ title: '<img src=x onerror=alert(1)>' }), false);
    assert.equal(html.includes('<img'), false, 'the title arrives as text');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  });
});

describe('the lane reads "ID · title" (LIN-4035)', () => {
  function laneHarness() {
    pinLaneMarkupToClient();
    const { api, world } = loadLiveConsole();
    return { updateLaneNode: api.updateLaneNode, li: makeLaneNode(world) };
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
    const { api, el, world } = loadLiveConsole();
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
    const { el } = loadLiveConsole({ storage });
    assert.equal(el('#live-console-activity-body').hidden, true);
    assert.equal(el('#live-console-activity-toggle').getAttribute('aria-expanded'), 'false');
    assert.equal(storage._m.has('live-console-activity'), false);
  });

  test('a remembered "open" opens the section on load', () => {
    const { el } = loadLiveConsole({ storage: memoryStorage({ 'live-console-activity': 'open' }) });
    assert.equal(el('#live-console-activity-body').hidden, false);
    assert.equal(el('#live-console-activity-toggle').getAttribute('aria-expanded'), 'true');
  });

  test('the toggle flips the section and remembers the choice in one key', async () => {
    const storage = memoryStorage();
    const { el } = loadLiveConsole({ storage });
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
    const { el } = loadLiveConsole({ throwingGetter: true });
    assert.equal(el('#live-console-activity-body').hidden, true, 'collapsed, without throwing');
    await clickOn(el('#live-console-activity-toggle'));
    assert.equal(el('#live-console-activity-body').hidden, false, 'the toggle still opens it for the session');
  });

  test('a storage that throws on write still opens and closes the section', async () => {
    const storage = { getItem: () => null, setItem() { throw new Error('quota'); } };
    const { el } = loadLiveConsole({ storage });
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
    const { api, el } = loadLiveConsole();
    api.countActivityArrivals([{ id: 'a' }, { id: 'b' }], true);
    assert.equal(count(el).hidden, true);
    assert.equal(count(el).textContent, '');
  });

  test('ids that arrive after the first feed count, and a repeat of a seen id does not', () => {
    const { api, el } = loadLiveConsole();
    api.countActivityArrivals([{ id: 'a' }], true);
    api.countActivityArrivals([{ id: 'a' }, { id: 'b' }, { id: 'c' }], true);
    assert.equal(count(el).hidden, false);
    assert.equal(count(el).textContent, '· 2 new');
    api.countActivityArrivals([{ id: 'b' }, { id: 'c' }], true);
    assert.equal(count(el).textContent, '· 2 new', 'the same ids on a later poll do not count again');
  });

  test('an id that leaves the feed and comes back is not counted twice', () => {
    const { api, el } = loadLiveConsole();
    api.countActivityArrivals([{ id: 'a' }], true);
    api.countActivityArrivals([{ id: 'a' }, { id: 'x' }], true);
    api.countActivityArrivals([{ id: 'a' }], true);
    api.countActivityArrivals([{ id: 'a' }, { id: 'x' }], true);
    assert.equal(count(el).textContent, '· 1 new');
  });

  test('a chip re-paint of the same feed (animate false) never counts', () => {
    const { api, el } = loadLiveConsole();
    api.countActivityArrivals([{ id: 'a' }], true);
    api.countActivityArrivals([{ id: 'z' }], false);
    assert.equal(count(el).hidden, true);
  });

  test('a poll that adds nothing leaves the count alone', () => {
    const { api, el } = loadLiveConsole();
    api.countActivityArrivals([{ id: 'a' }], true);
    api.countActivityArrivals([{ id: 'a' }, { id: 'b' }], true);
    api.countActivityArrivals([{ id: 'a' }, { id: 'b' }], true);
    assert.equal(count(el).textContent, '· 1 new');
  });

  test('a derived row that replaces the status row the page already counted is not counted again', () => {
    const { api, el } = loadLiveConsole();
    api.countActivityArrivals([], true);
    api.countActivityArrivals([{ id: 'ev:S', loopId: 'L1', kind: 'working' }], true);
    assert.equal(count(el).textContent, '· 1 new');
    // The status row folds into its derived moment: it leaves, and the derived row (a new id) arrives in the same poll.
    api.countActivityArrivals([{ id: 'd:L1:m1', loopId: 'L1', kind: 'working', derived: true, foldedFrom: 'ev:S' }], true);
    assert.equal(count(el).textContent, '· 1 new', 'the same moment, counted once');
  });

  test('an ownedBy fold (status row with no loopId) is counted once', () => {
    const { api, el } = loadLiveConsole();
    api.countActivityArrivals([], true);
    api.countActivityArrivals([{ id: 'ev:S', loopId: null, kind: 'done' }], true);
    assert.equal(count(el).textContent, '· 1 new');
    api.countActivityArrivals([{ id: 'd:L1:finished', loopId: 'L1', kind: 'done', derived: true, foldedFrom: 'ev:S' }], true);
    assert.equal(count(el).textContent, '· 1 new', 'the same moment, counted once');
  });

  test('a derived row with no foldedFrom counts, even when a same-loop, same-kind row left in the same poll', () => {
    const { api, el } = loadLiveConsole();
    api.countActivityArrivals([], true);
    api.countActivityArrivals([{ id: 'ev:S', loopId: 'L1', kind: 'working' }], true);
    api.countActivityArrivals([{ id: 'd:L1:m1', loopId: 'L1', kind: 'working', derived: true }], true);
    assert.equal(count(el).textContent, '· 2 new', 'a row that left for another reason does not suppress a real arrival');
  });

  test('a derived row with no status row to replace still counts', () => {
    const { api, el } = loadLiveConsole();
    api.countActivityArrivals([], true);
    api.countActivityArrivals([{ id: 'd:L1:m1', loopId: 'L1', kind: 'done', derived: true }], true);
    assert.equal(count(el).textContent, '· 1 new');
  });

  test('a derived row of a different kind from the row that left is new activity', () => {
    const { api, el } = loadLiveConsole();
    api.countActivityArrivals([], true);
    api.countActivityArrivals([{ id: 'ev:S', loopId: 'L1', kind: 'working' }], true);
    api.countActivityArrivals([{ id: 'd:L1:m2', loopId: 'L1', kind: 'done', derived: true }], true);
    assert.equal(count(el).textContent, '· 2 new');
  });
});
