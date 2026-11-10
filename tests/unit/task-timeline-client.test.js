/**
 * LIN-4405: public/task-page.js's "Sessions on one clock" refresher, the page's one request besides the state poll.
 *
 * The real shipped source runs in the vm (tests/unit/helpers/client-world.js), with fake timers. Pins:
 *  - a changed `trackHtml` asks for the fragment, and a running lane asks every window, but every reason is coalesced
 *    into at most one fetch per 60 s window (survey item 5: a running chip changes the track about once a minute);
 *  - the timer stops with the poll: paused while hidden, stopped on done, 401 or a revoked link;
 *  - through `init()`: the section's `data-timeline-url` is fetched on a changed track and its mount repainted, keeping
 *    an opened lane open.
 *
 * Run with: node --test tests/unit/task-timeline-client.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld, fireDOMContentLoaded } from './helpers/client-world.js';
import { bodyOf } from './helpers/task-page-body.js';
import { loop, NOW, PAGE_OPTIONS } from './helpers/task-page-loop.js';
import { renderTaskPage } from '../../lib/render-task-page.js';
import { renderTaskTimeline } from '../../lib/render-task-timeline.js';
import { buildTaskPageModel } from '../../lib/task-page-loader.js';
import { taskTimeline } from '../../lib/task-timeline.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';

function load() {
  return loadWorld({ scripts: ['task-page.js'], window: { module: { exports: {} } } }).window.module.exports;
}
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness({ running = false, fail = null } = {}) {
  const { createTimelineRefresher, TIMELINE_WINDOW_MS } = load();
  let clock = 1_000_000;
  let nextId = 1;
  const pending = new Map();
  const fetched = [];
  const applied = [];
  const state = { running };
  const refresher = createTimelineRefresher({
    url: '/timeline',
    fetchJson: async (url) => { fetched.push({ url, at: clock }); if (fail) throw fail; return { timelineHtml: `<p>${fetched.length}</p>` }; },
    apply: (html) => applied.push(html),
    isRunning: () => state.running,
    now: () => clock,
    setTimer: (fn, ms) => { const id = nextId++; pending.set(id, { fn, ms }); return id; },
    clearTimer: (id) => { pending.delete(id); },
  });
  return {
    refresher, fetched, applied, state, pending, WINDOW: TIMELINE_WINDOW_MS,
    delays: () => [...pending.values()].map(p => p.ms),
    async advance(ms) {
      clock += ms;
      for (const [id, job] of [...pending.entries()]) { pending.delete(id); job.fn(); }
      await flush();
    },
  };
}

describe('createTimelineRefresher', () => {
  test('the first track only seeds; a changed track fetches once; an unchanged one does nothing', async () => {
    const h = harness();
    h.refresher.noteTrack('<ol>a</ol>');
    assert.equal(h.fetched.length, 0, 'the page load drew this history already');
    h.refresher.noteTrack('<ol>b</ol>');
    await flush();
    assert.equal(h.fetched.length, 1);
    assert.deepEqual(h.applied, ['<p>1</p>']);
    h.refresher.noteTrack('<ol>b</ol>');
    await flush();
    assert.equal(h.fetched.length, 1);
    assert.deepEqual(h.delays(), [], 'nothing runs: no timer while no lane runs');
  });

  test('changes inside the window coalesce into one trailing fetch at its end', async () => {
    const h = harness();
    h.refresher.noteTrack('a');
    h.refresher.noteTrack('b');
    await flush();
    assert.equal(h.fetched.length, 1);
    h.refresher.noteTrack('c');
    h.refresher.noteTrack('d');
    h.refresher.noteTrack('e');
    await flush();
    assert.equal(h.fetched.length, 1, 'no second fetch inside the window');
    assert.deepEqual(h.delays(), [h.WINDOW], 'one trailing fetch, armed for the end of the window');
    await h.advance(h.WINDOW);
    assert.equal(h.fetched.length, 2);
    assert.equal(h.fetched[1].at - h.fetched[0].at, h.WINDOW);
  });

  test('a running lane re-reads once per window, and a track change in that window rides the same fetch', async () => {
    const h = harness({ running: true });
    h.refresher.start();
    assert.equal(h.fetched.length, 0, 'the load is fresh: the first re-read is a window later');
    assert.deepEqual(h.delays(), [h.WINDOW]);
    h.refresher.noteTrack('a');
    h.refresher.noteTrack('b');
    await flush();
    assert.equal(h.fetched.length, 0, 'the change waits for the armed fetch');
    await h.advance(h.WINDOW);
    assert.equal(h.fetched.length, 1);
    assert.deepEqual(h.delays(), [h.WINDOW], 'still running: the next window is armed');
    h.state.running = false;
    await h.advance(h.WINDOW);
    assert.equal(h.fetched.length, 2);
    assert.deepEqual(h.delays(), [], 'no lane runs: the timer stops');
  });

  test('stop clears the timer for good; pause clears it and resume asks again while a lane runs', async () => {
    const h = harness({ running: true });
    h.refresher.start();
    h.refresher.pause();
    assert.deepEqual(h.delays(), [], 'a hidden tab has no timer');
    h.refresher.noteTrack('a');
    h.refresher.noteTrack('b');
    await flush();
    assert.equal(h.fetched.length, 0, 'nothing is fetched while hidden');
    await h.advance(h.WINDOW);
    h.refresher.resume();
    await flush();
    assert.equal(h.fetched.length, 1, 'shown again with a running lane: one catch-up read');
    h.refresher.stop();
    assert.deepEqual(h.delays(), []);
    h.refresher.noteTrack('c');
    h.refresher.resume();
    await h.advance(h.WINDOW * 3);
    assert.equal(h.fetched.length, 1, 'stopped means stopped');
  });

  test('a 401 or a revoked link (404) stops it, as the poll stops', async () => {
    for (const status of [401, 404]) {
      const h = harness({ running: true, fail: Object.assign(new Error('x'), { status }) });
      h.refresher.noteTrack('a');
      h.refresher.noteTrack('b');
      await flush();
      assert.equal(h.fetched.length, 1);
      assert.deepEqual(h.delays(), [], `${status}: no next window`);
      assert.equal(h.refresher.state().stopped, true);
    }
  });

  test('any other failure keeps the paint and tries again next window while a lane runs', async () => {
    const h = harness({ running: true, fail: Object.assign(new Error('x'), { status: 500 }) });
    h.refresher.noteTrack('a');
    h.refresher.noteTrack('b');
    await flush();
    assert.deepEqual(h.applied, []);
    assert.deepEqual(h.delays(), [h.WINDOW]);
  });
});

describe('init(): the section is re-read and repainted from its fragment', () => {
  const MIN = 60 * 1000;
  const T = NOW.getTime();
  const runningTimeline = () => taskTimeline({
    sessions: [{
      rootItemId: 'r1', kind: 'implementation', dispatchedAt: new Date(T - 20 * MIN).toISOString(), model: 'claude-opus-5-5', costUsd: 1, durationMs: null, telemetry: true, incomplete: false,
      dispatches: [{ itemId: 'r1', kind: 'implementation', dispatchedAt: new Date(T - 20 * MIN).toISOString(), followUpTo: null, byModel: null, requests: 2, costUsd: 1, firstRequestAt: new Date(T - 19 * MIN).toISOString(), lastRequestAt: new Date(T - 1 * MIN).toISOString() }],
    }],
    openItemIds: ['r1'], now: NOW, totalUsd: 1, pricedUsd: 1,
  });

  test('a changed track fetches data-timeline-url and repaints the mount; an opened lane stays open; done stops it', async () => {
    const STATE_URL = '/workspace/acme/api/task/LIN-50/state';
    const TIMELINE_URL = '/workspace/acme/api/task/LIN-50/timeline';
    const timers = [];
    const fetched = [];
    const states = [];
    const world = loadWorld({
      scripts: ['task-page.js'],
      timers,
      window: {
        addEventListener() {},
        setInterval: () => 0,
        clearInterval() {},
        api: async (url) => {
          fetched.push(url);
          if (url === STATE_URL) return states.shift();
          if (url === TIMELINE_URL) return { timelineHtml: renderTaskTimeline(runningTimeline()).replace('1 session', '1 session (repainted)') };
          return { shares: [] };
        },
      },
    });
    const { document: doc } = world;
    const model = { ...buildTaskPageModel({ identifier: 'LIN-50', loops: [loop()], ctx: null, enrichLoop, deriveSessionWaiting, now: NOW }), timeline: runningTimeline() };
    doc.body.innerHTML = bodyOf(renderTaskPage(model, { viewer: 'owner', urlKey: 'acme', binding: {}, stateUrl: STATE_URL, timelineUrl: TIMELINE_URL, now: NOW, pageOptions: PAGE_OPTIONS }));
    await fireDOMContentLoaded(doc);
    await flush();
    const mount = doc.querySelector('[data-testid="task-timeline-mount"]');
    assert.ok(mount, 'the section is on the page');
    mount.querySelector('details').open = true;

    // The poll's timers are the ones that are not the refresher's 60 s window.
    const live = (t) => !t.cancelled && !t.fired;
    const fire = async (t) => { t.fired = true; t.fn(); await flush(); await flush(); };
    const firePoll = () => fire(timers.filter(t => live(t) && t.ms !== 60000).pop());
    const windowTimer = () => timers.filter(t => live(t) && t.ms === 60000).pop();
    assert.ok(windowTimer(), 'a running lane on load arms one re-read a window later');

    // Two polls: the first seeds the track, the second carries a changed one. The change rides the armed window.
    states.push({ status: 'running', live: true, trackHtml: '<ol>one</ol>', headerHtml: '' }, { status: 'running', live: true, trackHtml: '<ol>two</ol>', headerHtml: '' });
    await firePoll();
    await firePoll();
    assert.equal(fetched.filter(u => u === TIMELINE_URL).length, 0, 'coalesced: no read before the window ends');
    await fire(windowTimer());
    assert.equal(fetched.filter(u => u === TIMELINE_URL).length, 1, 'one fragment read');
    assert.match(mount.innerHTML, /1 session \(repainted\)/);
    assert.equal(mount.querySelector('[data-testid="task-timeline-lane"] details').open, true, 'the opened lane stays open');
    assert.ok(windowTimer(), 'still running: the next window is armed');

    // A done reply stops the refresher: its timer is cleared and no further read happens.
    states.push({ status: 'done', live: false, trackHtml: '<ol>three</ol>', headerHtml: '' });
    await firePoll();
    assert.equal(windowTimer(), undefined, 'done: the window timer is cleared');
    assert.equal(fetched.filter(u => u === TIMELINE_URL).length, 1);
  });
});
