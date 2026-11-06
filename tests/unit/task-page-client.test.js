/**
 * LIN-3329 — public/task-page.js, the task page's self-updating client.
 *
 * A plain browser script, so — following session-pr-state-poll.test.js — the
 * real shipped source runs in a vm sandbox with fake timers and a scripted
 * fetch. Nothing is re-implemented here.
 *
 *   - `pollDelay`: 10 s while running, 45 s otherwise, nothing while hidden or
 *     done, backoff on failure;
 *   - the poll loop can only ever request the state URL;
 *   - a repaint keeps the rows the reader opened, keeps closed what they closed,
 *     and lets a new running row open itself.
 *
 * Run with: node --test tests/unit/task-page-client.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld, fireDOMContentLoaded } from './helpers/client-world.js';
import { bodyOf } from './helpers/task-page-body.js';
import { loop, NOW, PAGE_OPTIONS } from './helpers/task-page-loop.js';
import { renderTaskPage, renderTaskStatus, renderTaskContext, renderTaskTrack } from '../../lib/render-task-page.js';
import { buildTaskPageModel } from '../../lib/task-page-loader.js';
import { gatherTaskStates } from '../../lib/home-row-states.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';

/** The module's own functions: `public/task-page.js` run on loadWorld, its `module.exports` read back. Nothing re-implemented. */
function load({ window = {} } = {}) {
  return loadWorld({ scripts: ['task-page.js'], window: { ...window, module: { exports: {} } } }).window.module.exports;
}

const flush = () => new Promise(resolve => setImmediate(resolve));

function makeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    pending,
    setTimer(fn, ms) { const id = nextId++; pending.set(id, { fn, ms }); return id; },
    clearTimer(id) { pending.delete(id); },
    delays() { return [...pending.values()].map(p => p.ms); },
    async fireAll() {
      const jobs = [...pending.entries()];
      for (const [id] of jobs) pending.delete(id);
      for (const [, job] of jobs) job.fn();
      await flush();
    },
  };
}

describe('pollDelay', () => {
  const { pollDelay, FAST_MS, SLOW_MS, MAX_BACKOFF_MS } = load();
  const cases = [
    ['running, visible', ['running', true, 0], 10000],
    ['waiting, visible', ['waiting', true, 0], 45000],
    ['idle, visible', ['idle', true, 0], 45000],
    ['hidden → paused', ['running', false, 0], null],
    ['done → never', ['done', true, 0], null],
    ['one failure backs off', ['running', true, 1], 20000],
    ['backoff is capped', ['idle', true, 10], MAX_BACKOFF_MS],
  ];
  for (const [name, args, expected] of cases) {
    test(name, () => assert.equal(pollDelay(...args), expected));
  }
  test('the cadence constants are the plan\'s', () => {
    assert.equal(FAST_MS, 10000);
    assert.equal(SLOW_MS, 45000);
  });
});

describe('createPoller', () => {
  const { createPoller } = load();
  const STATE_URL = '/workspace/acme/api/task/LIN-50/state?issueId=abc';

  function makePoller({ responses, visible = { value: true }, initial = { status: 'running', live: true }, onGone = null, unsettled = false }) {
    const timers = makeTimers();
    const urls = [];
    const applied = [];
    const queue = [...responses];
    const poller = createPoller({
      stateUrl: STATE_URL,
      fetchJson: async (url) => {
        urls.push(url);
        const next = queue.length ? queue.shift() : { status: 'running', live: true };
        if (next instanceof Error) throw next;
        return next;
      },
      apply: (s) => applied.push(s),
      isVisible: () => visible.value,
      initial,
      onGone,
      unsettled,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    return { poller, timers, urls, applied, visible };
  }

  test('every request the loop makes is the state URL — across cadences, failures and visibility', async () => {
    const fail = Object.assign(new Error('boom'), { status: 500 });
    const { poller, timers, urls, visible } = makePoller({
      responses: [{ status: 'running', live: true }, fail, { status: 'idle', live: false }, { status: 'waiting', live: false }],
    });
    poller.start();
    for (let i = 0; i < 4; i++) await timers.fireAll();
    visible.value = false; poller.onVisibilityChange(true);
    visible.value = true; poller.onVisibilityChange(false);
    await flush();
    await poller.poll();
    assert.ok(urls.length >= 5, `polled ${urls.length} times`);
    assert.deepEqual([...new Set(urls)], [STATE_URL]);
  });

  test('cadence follows the last state: 10 s while live, 45 s once nothing runs', async () => {
    const { poller, timers } = makePoller({ responses: [{ status: 'idle', live: false }] });
    poller.start();
    assert.deepEqual(timers.delays(), [10000]);
    await timers.fireAll();
    assert.deepEqual(timers.delays(), [45000]);
  });

  test('a waiting task with a live session still polls fast', async () => {
    const { poller, timers } = makePoller({ responses: [{ status: 'waiting', live: true }] });
    poller.start();
    await timers.fireAll();
    assert.deepEqual(timers.delays(), [10000]);
  });

  test('a failure backs off; success resets it', async () => {
    const { poller, timers } = makePoller({ responses: [new Error('down'), { status: 'running', live: true }] });
    poller.start();
    await timers.fireAll();
    assert.deepEqual(timers.delays(), [20000]);
    await timers.fireAll();
    assert.deepEqual(timers.delays(), [10000]);
  });

  test('hidden pauses (no timer); visible again → exactly one catch-up poll', async () => {
    const { poller, timers, urls, visible } = makePoller({ responses: [] });
    poller.start();
    visible.value = false;
    poller.onVisibilityChange(true);
    assert.equal(timers.pending.size, 0, 'paused while hidden');
    visible.value = true;
    poller.onVisibilityChange(false);
    await flush();
    assert.equal(urls.length, 1, 'one catch-up poll');
    assert.deepEqual(timers.delays(), [10000], 'then the loop resumes');
  });

  test('a page that loaded done schedules nothing', () => {
    const { poller, timers } = makePoller({ responses: [], initial: { status: 'done', live: false } });
    poller.start();
    assert.equal(timers.pending.size, 0);
  });

  // LIN-4071 review ledger (M6): a provisional first render (`data-settled="false"`) reads again soon, then falls back.
  test('an unsettled page polls at the incomplete cadence (1 s), not the idle 45 s', () => {
    const { poller, timers } = makePoller({ responses: [], initial: { status: 'idle', live: false }, unsettled: true });
    poller.start();
    assert.deepEqual(timers.delays(), [1000]);
  });

  test('a settled idle page keeps the 45 s cadence (the unsettled flag is what speeds it up)', () => {
    const { poller, timers } = makePoller({ responses: [], initial: { status: 'idle', live: false }, unsettled: false });
    poller.start();
    assert.deepEqual(timers.delays(), [45000]);
  });

  test('an unsettled page falls back to the normal cadence after 15 incomplete replies', async () => {
    const incomplete = Array.from({ length: 15 }, () => ({ incomplete: true }));
    const { poller, timers } = makePoller({ responses: incomplete, initial: { status: 'idle', live: false }, unsettled: true });
    poller.start();
    for (let i = 0; i < 14; i++) {
      await timers.fireAll();
      assert.deepEqual(timers.delays(), [1000], `still fast after ${i + 1} incomplete replies`);
    }
    await timers.fireAll();
    assert.deepEqual(timers.delays(), [45000], 'the 15th incomplete reply returns the loop to the idle cadence');
  });

  test('a complete reply ends the fast poll of an unsettled page', async () => {
    const { poller, timers } = makePoller({ responses: [{ status: 'waiting', live: false }], initial: { status: 'idle', live: false }, unsettled: true });
    poller.start();
    await timers.fireAll();
    assert.deepEqual(timers.delays(), [45000]);
  });

  test('an in-flight poll is not doubled', async () => {
    const { poller, urls } = makePoller({ responses: [] });
    const a = poller.poll();
    const b = poller.poll();
    await Promise.all([a, b]);
    assert.equal(urls.length, 1);
  });

  test('a 401 stops the loop', async () => {
    const { poller, timers } = makePoller({ responses: [Object.assign(new Error('Unauthorized'), { status: 401 })] });
    await poller.poll();
    assert.equal(timers.pending.size, 0);
  });

  // LIN-3330: a guest page whose link was revoked (or never issued) gets a 404
  // from its state endpoint — the loop stops and reports "gone".
  test('a 404 stops the loop and reports gone', async () => {
    let gone = 0;
    const { poller, timers } = makePoller({
      responses: [Object.assign(new Error('Not found'), { status: 404 })],
      onGone: () => { gone++; },
    });
    await poller.poll();
    assert.equal(gone, 1);
    assert.equal(timers.pending.size, 0, 'no further poll is scheduled');
  });

  // LIN-3330 review, ledger 2: an owner page passes no `onGone`, so a 404 is an
  // ordinary poll failure — it must not stop the loop or touch the page.
  test('a 404 without onGone (an owner page) is an ordinary failure; the loop keeps polling', async () => {
    let gone = 0;
    const { poller, timers, urls } = makePoller({
      responses: [Object.assign(new Error('Not found'), { status: 404 }), { status: 'running', live: true }],
      onGone: null,
    });
    poller.start();
    await timers.fireAll();
    assert.equal(gone, 0, 'no gone handler ran');
    assert.equal(urls.length, 1);
    assert.ok(timers.pending.size > 0, 'the loop keeps polling on failure, as before this feature');
  });
});

// LIN-3340: the poll must not leave a stale header on a merge-ready page, and a guest's
// client-side markdown must survive an unchanged brief.
describe('poll safety (LIN-3340)', () => {
  const { paintsReadyHeader, runOptsOf } = load();

  test('the ready-to-merge header is painted only across an idle poll', () => {
    assert.equal(paintsReadyHeader('true', 'idle'), true);
    assert.equal(paintsReadyHeader('true', 'running'), false, 'a started close-out overrides');
    assert.equal(paintsReadyHeader('true', 'waiting'), false);
    assert.equal(paintsReadyHeader('false', 'idle'), false);
    assert.equal(paintsReadyHeader(null, 'idle'), false);
  });

  test('LIN-3991: a failed poll keeps the ready header too, since ready outranks failed on the load', () => {
    assert.equal(paintsReadyHeader('true', 'failed'), true, 'the load shows ready, so the poll must not repaint red failed over it');
    assert.equal(paintsReadyHeader('false', 'failed'), false);
  });

  test('LIN-3975: the run control options are read from data-run-opts; no attribute, or junk, mounts nothing', () => {
    const root = (raw) => ({ getAttribute: (k) => (k === 'data-run-opts' ? raw : null) });
    assert.equal(JSON.stringify(runOptsOf(root('{"surface":"task","urlKey":"acme"}'))), '{"surface":"task","urlKey":"acme"}');
    assert.equal(runOptsOf(root(null)), null);
    assert.equal(runOptsOf(root('{not json')), null);
    assert.equal(runOptsOf(null), null);
  });

  test('a guest brief `<pre>` is upgraded to markdown and the upgrade is idempotent', () => {
    const world = loadWorld({ scripts: ['task-page.js'], window: { renderMarkdown: (t) => `<p>${t}</p>`, module: { exports: {} } } });
    const { enhanceContextMarkdown } = world.window.module.exports;
    const mount = world.document.createElement('div');
    mount.innerHTML = renderTaskContext(taskModel([loop()], { brief: { brief: 'A **brief**' } }), { urlKey: 'acme', now: NOW });
    assert.equal(mount.querySelectorAll('pre.sess-ctx-body').length, 1, 'the server draws the brief as a plain <pre>');
    enhanceContextMarkdown(mount);
    assert.equal(mount.querySelectorAll('pre.sess-ctx-body').length, 0, 'the <pre> was replaced');
    assert.match(mount.innerHTML, /<p>A \*\*brief\*\*<\/p>/, 'markdown rendered');
    const once = mount.innerHTML;
    enhanceContextMarkdown(mount); // no pre left — a no-op
    assert.equal(mount.innerHTML, once);
  });
});
describe('isGuestStateUrl (the onGone gate)', () => {
  const { isGuestStateUrl } = load();

  test('a guest share state URL reports gone', () => {
    assert.equal(isGuestStateUrl('/t/' + 'A'.repeat(43) + '/state'), true);
  });

  test('an owner state URL never reports gone', () => {
    assert.equal(isGuestStateUrl('/workspace/acme/api/task/LIN-50/state?issueId=abc'), false);
    assert.equal(isGuestStateUrl(''), false);
    assert.equal(isGuestStateUrl(null), false);
  });
});

// LIN-3447 (found by the LIN-3330 retrospective audit): the guest-only 404 gate
// was tested only in halves (`createPoller` given an `onGone`, `isGuestStateUrl`
// alone) — the join in `init()` was not, so `onGone: true ? …` and
// `onGone: false ? …` both passed. `goneHandlerFor` is now the one place that
// decides, and the second block drives the real `init()` through it.
describe('goneHandlerFor (the one decision)', () => {
  const { goneHandlerFor } = load();
  const GUEST = '/t/' + 'A'.repeat(43) + '/state';
  const OWNER = '/workspace/acme/api/task/LIN-50/state?issueId=abc';

  test('an owner state URL gets no handler, so its 404 stays a poll failure', () => {
    assert.equal(goneHandlerFor(OWNER, { innerHTML: 'page' }), null);
    assert.equal(goneHandlerFor('', { innerHTML: 'page' }), null);
    assert.equal(goneHandlerFor(null, { innerHTML: 'page' }), null);
  });

  test('a guest state URL gets a handler that replaces <main> with the gone notice', () => {
    const main = { innerHTML: '<p>the shared task</p>' };
    const onGone = goneHandlerFor(GUEST, main);
    assert.equal(typeof onGone, 'function');
    assert.equal(main.innerHTML, '<p>the shared task</p>', 'building the handler changes nothing');
    onGone();
    assert.equal(main.innerHTML, '<p class="task-share-gone" data-testid="task-share-gone">This link is no longer available.</p>');
  });
});

// ── the page on the client (LIN-4254 piece 5) ─────────────────────────────────
// Each suite below runs the shipped task-page.js on loadWorld over the server's own markup: the page is `renderTaskPage`
// (body only), and a part of it is the renderer that draws that part (`renderTaskTrack`, `renderTaskContext`).

const STATE_URL = '/workspace/acme/api/task/LIN-50/state';
const CHECK_URL = '/workspace/acme/api/run-evidence/LIN-50/check';
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Each page's gathered task state, as the route sends it (the one gatherer over the model's own loops): it carries the page's status. */
const STATES = new WeakMap();
const stateOf = (loops) => gatherTaskStates({ roots: [{ issue: { identifier: 'LIN-50', state: { type: 'started' } }, children: [] }], loops, ruling: null, at: NOW, enrichLoop, deriveSessionWaiting }).states.get('LIN-50');

/** A task model from the loader, as the page load builds it. `over` is the loader's own input (brief, recap, evidence). */
const taskModel = (loops, over = {}) => {
  const m = buildTaskPageModel({ identifier: 'LIN-50', loops, ctx: null, enrichLoop, deriveSessionWaiting, now: NOW, ...over });
  STATES.set(m, stateOf(loops));
  return m;
};

/** The close-out model a PR carries: `status` 'ready' is the ready-to-merge header and a merge-ready page. */
const closeOutOf = (status) => ({ owner: true, status, variant: 'standard', pr: { number: 41, url: 'https://github.com/acme/app/pull/41' }, urlKey: 'acme', issueIdentifier: 'LIN-50', stopAt: 'pr', state: status });

/** A task whose PR box reads `status`: the loader's evidence, and the state the box renders from (`renderTaskPullRequest`). */
function prModel(loops, status) {
  const closeOut = closeOutOf(status);
  const m = taskModel(loops, { evidence: { closeOut } });
  m.evidence = { closeOut, state: { pr: closeOut.pr, owner: true, status, urlKey: 'acme', issueIdentifier: 'LIN-50', stopAt: 'pr', variant: 'standard' } };
  STATES.set(m, stateOf(loops));
  return m;
}

/** The page as the server draws it, body only. */
const pageBody = (m, { viewer = 'owner', binding = { source: 'linear' }, stateUrl = STATE_URL, urlKey = 'acme' } = {}) =>
  bodyOf(renderTaskPage(m, { viewer, urlKey, binding, stateUrl, now: NOW, pageOptions: PAGE_OPTIONS, taskState: STATES.get(m) ?? null }));

/** A header as the state read paints it (`renderTaskStatus`), and the text a reader sees, for comparing two headers. */
const headerOf = (m) => renderTaskStatus(m, { now: NOW });
const textOf = (html) => String(html).replace(/<[^>]*>/g, ' ').replace(/&[#\w]+;/g, ' ').replace(/\s+/g, ' ').trim();

describe('init() wires the 404 gate (LIN-3447)', () => {
  const GUEST = '/t/' + 'A'.repeat(43) + '/state';
  const OWNER = '/workspace/acme/api/task/LIN-50/state?issueId=abc';

  /** Run the real DOMContentLoaded -> init() on the server's running page, then deliver one 404 to its poll. */
  async function pageThatGets404(stateUrl, viewer) {
    const timers = [];
    const fetched = [];
    const world = loadWorld({
      scripts: ['task-page.js'],
      timers,
      window: {
        addEventListener() {},
        setInterval: () => 0,
        clearInterval() {},
        api: async (url) => {
          if (url !== stateUrl) return { shares: [] }; // the owner's share list loads beside the page
          fetched.push(url);
          throw Object.assign(new Error('gone'), { status: 404 });
        },
      },
    });
    const { document: doc } = world;
    doc.body.innerHTML = pageBody(taskModel([loop()]), { viewer, stateUrl });
    await fireDOMContentLoaded(doc);
    await settle();
    const main = doc.querySelector('[data-testid="task-page"][data-state-url]');
    const before = main.innerHTML;
    assert.equal(timers.length > 0, true, 'init() started the poll loop');
    timers.shift().fn();
    await settle();
    return { main, before, fetched, timers };
  }

  test('a guest page whose state URL 404s is replaced by the gone notice and stops polling', async () => {
    const { main, fetched, timers } = await pageThatGets404(GUEST, 'guest');
    assert.deepEqual(fetched, [GUEST]);
    assert.match(main.innerHTML, /data-testid="task-share-gone"/);
    assert.match(main.innerHTML, /This link is no longer available\./);
    assert.equal(timers.length, 0, 'no further poll is scheduled once the link is gone');
  });

  test('an owner page whose state URL 404s is left intact and keeps polling', async () => {
    const { main, before, fetched, timers } = await pageThatGets404(OWNER, 'owner');
    assert.deepEqual(fetched, [OWNER]);
    assert.equal(main.innerHTML, before, 'the page is not replaced');
    assert.equal(timers.length, 1, 'the poll loop backs off and carries on');
  });
});

// LIN-3448: drive the shipped apply() from a page that did not load on the ready header, through init() and its own poller.
describe('apply(): the header after a session ends on a merge-ready page (LIN-3448)', () => {
  const RUNNING = taskModel([loop()]);
  const IDLE = taskModel([loop({ agentState: 'idle', terminalStatus: 'completed' })]);
  const FAILED = taskModel([loop({ agentState: 'idle', terminalStatus: 'failed' })]);
  const poll = (status, m) => ({ status, live: status === 'running', headerHtml: headerOf(m) });

  /**
   * One page on loadWorld: the server's page for `m` (its PR box and ready header come from the loader's evidence), the
   * real task-page.js, and `window.api` serving the queued poll states for the state URL. `realCloseOut` loads public/close-out.js
   * into the same world (case d); otherwise `window.CloseOut` is a stub whose `runCheck` is a spy.
   */
  async function makePage({ m, polls = [], realCloseOut = false, checkResult = null }) {
    const timers = [];
    const reloads = [];
    const runCheckSpy = [];
    const checkCalls = [];
    const queue = [...polls];
    const CloseOut = {
      init: (doc) => doc.querySelector('[data-testid="run-evidence-closeout"]'),
      runCheck: (box, doc) => { runCheckSpy.push({ box, doc }); return Promise.resolve(null); },
    };
    const world = loadWorld({
      scripts: realCloseOut ? ['task-page.js', 'close-out.js'] : ['task-page.js'],
      timers,
      window: {
        addEventListener() {},
        setInterval: () => 0,
        clearInterval() {},
        location: { reload: () => reloads.push(1) },
        ...(realCloseOut ? {} : { CloseOut }),
        api: async (url) => {
          if (url === STATE_URL) return queue.shift();
          if (url === CHECK_URL) {
            checkCalls.push(url);
            return typeof checkResult === 'function' ? checkResult(checkCalls.length, world.document) : { state: { status: 'ready' } };
          }
          throw new Error('unexpected url ' + url);
        },
      },
    });
    const { document: doc } = world;
    doc.body.innerHTML = pageBody(m);
    doc.defaultView = { location: { reload: () => reloads.push(1) } };
    const main = doc.querySelector('[data-testid="task-page"][data-state-url]');
    const answer = doc.querySelector('[data-testid="task-page-answer-status"]');
    const box = doc.querySelector('[data-testid="run-evidence-closeout"]');
    const readyHtml = main.getAttribute('data-ready-header');
    await fireDOMContentLoaded(doc);
    return {
      main, answer, box, readyHtml, reloads, runCheckSpy, checkCalls,
      async pollOnce() { timers.shift().fn(); await settle(); await settle(); },
    };
  }

  test('(a) load running + merge-ready, poll idle: the ready sentence, not the running one; one check', async () => {
    const page = await makePage({ m: prModel([loop()], 'ready'), polls: [poll('idle', IDLE)] });
    await page.pollOnce();
    assert.equal(textOf(page.answer.innerHTML), textOf(page.readyHtml));
    assert.doesNotMatch(page.answer.innerHTML, /running/);
    assert.equal(page.main.getAttribute('data-status'), 'waiting');
    assert.equal(page.runCheckSpy.length, 1, 'the running -> idle edge runs one check');
  });

  test('(b) load ready, poll running then idle: ready again, one check; a second idle adds none', async () => {
    const page = await makePage({ m: prModel([loop({ agentState: 'idle', terminalStatus: 'completed' })], 'ready'), polls: [poll('running', RUNNING), poll('idle', IDLE), poll('idle', IDLE)] });
    await page.pollOnce();
    assert.equal(textOf(page.answer.innerHTML), textOf(headerOf(RUNNING)), 'running paints the polled sentence');
    assert.equal(page.runCheckSpy.length, 0, 'no check while running');
    await page.pollOnce();
    assert.equal(textOf(page.answer.innerHTML), textOf(page.readyHtml));
    assert.equal(page.main.getAttribute('data-status'), 'waiting');
    assert.equal(page.runCheckSpy.length, 1);
    await page.pollOnce();
    assert.equal(textOf(page.answer.innerHTML), textOf(page.readyHtml));
    assert.equal(page.runCheckSpy.length, 1, 'never per poll');
  });

  test('(c) control: merge-ready false repaints the polled header; a page with no box makes no check', async () => {
    const page = await makePage({ m: prModel([loop({ agentState: 'idle', terminalStatus: 'completed' })], 'running'), polls: [poll('idle', IDLE)] });
    assert.equal(page.main.getAttribute('data-merge-ready'), 'false');
    await page.pollOnce();
    assert.equal(textOf(page.answer.innerHTML), textOf(headerOf(IDLE)));
    assert.equal(page.main.getAttribute('data-status'), 'idle');
    const noBox = await makePage({ m: taskModel([loop({ agentState: 'idle', terminalStatus: 'completed' })]), polls: [poll('idle', IDLE)] });
    assert.equal(noBox.box, null, 'a page with no PR has no box');
    await noBox.pollOnce();
    assert.equal(noBox.runCheckSpy.length, 0, 'a guest page has no box, so no check');
    assert.equal(textOf(noBox.answer.innerHTML), textOf(headerOf(IDLE)));
  });

  test('(d) the real close-out.js: running -> idle reloads once when the check wrote Done, never when the page is already done', async () => {
    // Check 1 is the load-time one (no Done); check 2 is the edge-triggered one.
    const page = await makePage({ m: prModel([loop()], 'ready'), realCloseOut: true, polls: [poll('idle', IDLE)],
      checkResult: (n) => (n === 1 ? { state: { status: 'ready' } } : { state: { status: 'merged' }, doneNow: true }) });
    await page.pollOnce();
    assert.equal(page.checkCalls.length, 2, 'one load check + one session-end check');
    assert.equal(page.reloads.length, 1, 'doneNow reloads through the existing path');

    const already = await makePage({ m: prModel([loop()], 'ready'), realCloseOut: true, polls: [poll('idle', IDLE)],
      checkResult: (n, doc) => { if (n > 1) doc.querySelector('[data-testid="task-page"]').setAttribute('data-status', 'done'); return n === 1 ? { state: { status: 'ready' } } : { state: { status: 'merged' }, doneNow: true }; } });
    await already.pollOnce();
    assert.equal(already.checkCalls.length, 2);
    assert.equal(already.reloads.length, 0, 'pageAlreadyDone guard holds');
  });

  test('(e) ordering: a box moved off ready (merged, not Done) means the idle poll paints the polled header, not ready', async () => {
    const page = await makePage({ m: prModel([loop()], 'ready'), polls: [poll('idle', IDLE)] });
    page.box.setAttribute('data-state', 'merged'); // a /check moved it between polls
    await page.pollOnce();
    assert.equal(page.main.getAttribute('data-merge-ready'), 'false');
    assert.equal(textOf(page.answer.innerHTML), textOf(headerOf(IDLE)));
    assert.equal(page.main.getAttribute('data-status'), 'idle');
  });

  test('(f) the session-end check moves the box to merged without Done: the polled header is repainted, not "ready"', async () => {
    // Check 1 is the load-time one (ready); check 2 is the edge one (merged, no doneNow, so no reload).
    const page = await makePage({ m: prModel([loop({ agentState: 'idle', terminalStatus: 'completed' })], 'ready'), realCloseOut: true, polls: [poll('running', RUNNING), poll('idle', IDLE)],
      checkResult: (n) => (n === 1 ? { state: { status: 'ready' } } : { state: { status: 'merged' }, doneNow: false }) });
    await page.pollOnce();
    await page.pollOnce();
    await settle();
    assert.equal(textOf(page.answer.innerHTML), textOf(headerOf(IDLE)));
    assert.equal(page.main.getAttribute('data-merge-ready'), 'false');
    assert.equal(page.main.getAttribute('data-status'), 'idle');
    assert.equal(page.reloads.length, 0);
  });

  test('(h) LIN-3991: load merge-ready, poll failed: the ready sentence is kept, and the running -> failed edge still checks', async () => {
    const page = await makePage({ m: prModel([loop({ agentState: 'idle', terminalStatus: 'completed' })], 'ready'), polls: [poll('running', RUNNING), poll('failed', FAILED)] });
    await page.pollOnce();
    await page.pollOnce();
    assert.equal(textOf(page.answer.innerHTML), textOf(page.readyHtml), 'the failed poll does not repaint the red header over ready');
    assert.equal(page.main.getAttribute('data-status'), 'waiting');
    assert.equal(page.runCheckSpy.length, 1, 'a run that ends failed re-checks the close-out box');
  });

  test('(g) a ready load seeds the edge as not-running: the first idle poll fires no check', async () => {
    const page = await makePage({ m: prModel([loop({ agentState: 'idle', terminalStatus: 'completed' })], 'ready'), polls: [poll('idle', IDLE)] });
    await page.pollOnce();
    assert.equal(page.runCheckSpy.length, 0);
    assert.equal(textOf(page.answer.innerHTML), textOf(page.readyHtml));
  });
});

// LIN-3340 G1/F2 (review `388f4246`): the owner's brief/recap widgets must be
// mounted WITH the task's provider kind, or their GET/POST resolve the wrong
// provider. A mutation dropping `source: source` left the suite green, because
// the e2e compares pathnames only.
describe('owner widget mount threads source (LIN-3340)', () => {
  /** The owner's page (or a guest's) with a brief and a recap, on loadWorld; the widgets' inits are recorded. */
  function makeDoc({ source, marker = true } = {}) {
    const calls = [];
    const init = (lib) => (el, opts) => calls.push({ lib, el, opts });
    const world = loadWorld({ scripts: ['task-page.js'], window: { BriefSection: { init: init('brief') }, RecapSection: { init: init('recap') }, module: { exports: {} } } });
    const m = taskModel([loop()], { brief: { brief: 'A brief' }, recap: null });
    const binding = source === undefined ? {} : { source };
    world.document.body.innerHTML = pageBody(m, { viewer: marker ? 'owner' : 'guest', binding, urlKey: 'fbk' });
    const doc = world.document;
    const main = doc.querySelector('[data-testid="task-page"]');
    return { doc, main, calls, mountWidgets: world.window.module.exports.mountWidgets };
  }

  test('the task source reaches both widget inits (and both refresh POSTs)', () => {
    const { doc, main, calls, mountWidgets } = makeDoc({ source: 'linear' });
    assert.equal(mountWidgets(doc, main), true);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(c => c.lib).sort(), ['brief', 'recap']);
    for (const c of calls) assert.equal(c.opts.source, 'linear', `${c.lib} got the task source`);
  });

  test('a task with no data-source mounts the widgets with no source', () => {
    const { doc, main, calls, mountWidgets } = makeDoc({ source: undefined });
    mountWidgets(doc, main);
    for (const c of calls) assert.equal(c.opts.source, undefined, 'no source stays off the request');
  });

  test('a guest (no owner marker) mounts nothing', () => {
    const { doc, main, calls, mountWidgets } = makeDoc({ source: 'linear', marker: false });
    assert.equal(mountWidgets(doc, main), false);
    assert.equal(calls.length, 0);
  });
});

/** The stage rows the server draws for `loops`, in a fresh world: `rows` are the `.task-step` items, `doc` the document. */
function trackOf(loops, now = NOW) {
  const world = loadWorld({ scripts: [] });
  world.document.body.innerHTML = renderTaskTrack(taskModel(loops), { now, urlKey: 'acme', runLinks: true });
  return { doc: world.document, rows: () => [...world.document.querySelectorAll('.task-step')] };
}
const OPEN = 'sess-run--expanded';

describe('open rows survive a repaint', () => {
  const { createOpenMemory, rememberToggle, applyOpenMemory } = load();
  const isOpen = (row) => row.classList.contains(OPEN);

  test('seeded from the rows rendered open', () => {
    const track = trackOf([loop({ loopId: 'a', kind: 'implementation' }), loop({ loopId: 'b', kind: 'review', agentState: 'idle', terminalStatus: 'completed' })]);
    const memory = createOpenMemory(track.rows());
    assert.deepEqual([...memory.open], ['a']);
  });

  test('user-opened stays open, user-closed stays closed, a new running row opens itself', () => {
    const before = trackOf([loop({ loopId: 'a', kind: 'implementation', agentState: 'idle', terminalStatus: 'completed' }), loop({ loopId: 'b', kind: 'review' }), loop({ loopId: 'c', kind: 'closeout', agentState: 'idle', terminalStatus: 'completed' })]);
    const rowsBefore = before.rows();
    const memory = createOpenMemory(rowsBefore);
    rememberToggle(memory, rowsBefore[0], true);   // reader opened a finished row
    rememberToggle(memory, rowsBefore[1], false);  // reader closed the running row

    // The server repaints: a/c finished and closed, b still running, and a new running row d arrives open.
    const after = trackOf([loop({ loopId: 'a', kind: 'implementation', agentState: 'idle', terminalStatus: 'completed' }), loop({ loopId: 'b', kind: 'review' }), loop({ loopId: 'c', kind: 'closeout', agentState: 'idle', terminalStatus: 'completed' }), loop({ loopId: 'd', kind: 'checks' })]).rows();
    applyOpenMemory(after, memory);
    assert.deepEqual(after.map(isOpen), [true, false, false, true]);
    assert.equal(after[0].querySelector('.task-stage-head').getAttribute('aria-expanded'), 'true');
    assert.equal(after[1].querySelector('.task-stage-head').getAttribute('aria-expanded'), 'false');
  });

  test('a row the server opened is not collapsed when it finishes', () => {
    const running = trackOf([loop({ loopId: 'run' })]).rows();
    const memory = createOpenMemory(running);
    const after = trackOf([loop({ loopId: 'run', agentState: 'idle', terminalStatus: 'completed' })]).rows(); // now done: the server renders it closed
    applyOpenMemory(after, memory);
    assert.equal(isOpen(after[0]), true);

    // A row the server opens on a repaint (not one seeded at the load) is remembered too: it stays open once it finishes.
    const late = createOpenMemory(trackOf([loop({ loopId: 'late', agentState: 'idle', terminalStatus: 'completed' })]).rows());
    applyOpenMemory(trackOf([loop({ loopId: 'late' })]).rows(), late);
    const finished = trackOf([loop({ loopId: 'late', agentState: 'idle', terminalStatus: 'completed' })]).rows();
    applyOpenMemory(finished, late);
    assert.equal(isOpen(finished[0]), true, 'the row the server opened stays open after it finishes');
  });
});

describe('stage rows: head, clocks and check-ins across a repaint (LIN-3356)', () => {
  const { applyOpenMemory, createOpenMemory, tickClocks, openCheckIns, restoreCheckIns } = load();
  const isOpen = (row) => row.classList.contains(OPEN);

  test('a stage head (not the legacy face head) carries aria-expanded', () => {
    const memory = createOpenMemory(trackOf([loop({ loopId: 'a' })]).rows());
    const after = trackOf([loop({ loopId: 'a', agentState: 'idle', terminalStatus: 'completed' })]).rows();
    applyOpenMemory(after, memory);
    assert.equal(after[0].querySelector('.task-stage-head').getAttribute('aria-expanded'), 'true');
  });

  test('tickClocks refreshes running counters and "started ago" labels', () => {
    const now = Date.now();
    const track = trackOf([
      loop({ loopId: 'impl', kind: 'implementation', takenAt: new Date(now - 4 * 60 * 1000).toISOString() }),
      loop({ loopId: 'rev', kind: 'review', agentState: 'idle', terminalStatus: 'completed', takenAt: new Date(now - 125 * 60 * 1000).toISOString() }),
    ], new Date(now - 60 * 1000));
    assert.deepEqual(track.doc.querySelectorAll('[data-running-since]').map((el) => el.textContent), ['running 3m'], 'drawn a minute ago');
    tickClocks(track.doc.body);
    const running = track.doc.querySelectorAll('[data-running-since]');
    assert.deepEqual(running.map((el) => el.textContent), ['running 4m']);
    assert.deepEqual(track.doc.querySelectorAll('[data-started-at]').map((el) => el.textContent), ['started 4m ago', 'started 2h 5m ago']);
  });

  test('opened check-ins are remembered by stage id and reopened after the swap', () => {
    // An autopilot row is a check-in: it is filed on the review stage that follows it (task-page-loader's groupSessions).
    const loops = () => [loop({ loopId: 'a', kind: 'implementation' }), loop({ loopId: 'ap', kind: 'autopilot' }), loop({ loopId: 'b', kind: 'review', agentState: 'idle', terminalStatus: 'completed' })];
    const before = trackOf(loops());
    const details = (doc) => doc.querySelector('.task-stage[data-loop-id="b"] details.task-checkins');
    assert.ok(details(before.doc), 'the review stage carries its check-in disclosure');
    assert.equal(details(before.doc).hasAttribute('open'), false, 'it is folded at the first paint');
    details(before.doc).setAttribute('open', '');
    const ids = openCheckIns(before.doc.body);
    assert.deepEqual([...ids], ['b']);

    const after = trackOf(loops()); // the repaint draws the disclosure closed again
    assert.equal(details(after.doc).hasAttribute('open'), false);
    restoreCheckIns(after.doc.body, ids);
    assert.equal(details(after.doc).hasAttribute('open'), true, 'the reader\'s open check-ins reopen');
  });
});

describe('repaintHeader keeps the load-time summary (LIN-3373)', () => {
  const { repaintHeader } = load();

  /** A load-time answer: the page's own header, with its summary when the brief has one. */
  function answerOf(summaryBrief) {
    const world = loadWorld({ scripts: [] });
    const m = taskModel([loop()], summaryBrief ? { brief: { brief: summaryBrief } } : {});
    world.document.body.innerHTML = `<section data-testid="task-page-answer">${headerOf(m)}</section>`;
    return world.document.querySelector('[data-testid="task-page-answer"]');
  }

  test('a header with no summary does not delete the load-time one', () => {
    const answer = answerOf('## Current\nWorking on it.');
    assert.ok(answer.querySelector('[data-testid="task-page-summary"]'), 'the load-time summary is on the page');
    repaintHeader(answer, headerOf(taskModel([loop({ agentState: 'idle', terminalStatus: 'completed' })])));
    assert.ok(answer.querySelector('[data-testid="task-page-summary"]'), 'the summary survives the repaint');
    assert.ok(answer.querySelector('[data-testid="task-page-status"] [data-testid="task-page-summary"]'), 'carried into the repainted status block');
    assert.notEqual(answer.querySelector('[data-testid="task-page-status"]').getAttribute('data-status'), 'running', 'the header was repainted');
  });

  test('a header that carries its own summary replaces it; nothing is re-added', () => {
    const answer = answerOf('## Current\nWorking on it.');
    repaintHeader(answer, headerOf(taskModel([loop()], { brief: { brief: '## Current\nNow something else.' } })));
    assert.equal(answer.querySelectorAll('[data-testid="task-page-summary"]').length, 1);
    assert.match(answer.querySelector('[data-testid="task-page-summary"]').textContent, /Now something else/, 'the new summary, not the old one');
  });

  test('no load-time summary: nothing is carried', () => {
    const answer = answerOf(null);
    repaintHeader(answer, '<div data-testid="task-page-status">x</div>');
    assert.equal(answer.querySelector('[data-testid="task-page-summary"]'), null);
  });
});
