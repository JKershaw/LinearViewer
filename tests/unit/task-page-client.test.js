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
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/task-page.js'), 'utf8');

function load({ window = {} } = {}) {
  const module = { exports: {} };
  vm.runInNewContext(SRC, { module, window, Set, Math, Promise, Date, String, isNaN, Array });
  return module.exports;
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

  function makePoller({ responses, visible = { value: true }, initial = { status: 'running', live: true }, onGone = null }) {
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

// LIN-3340: the poll must not wipe the load-time ready header, and a guest's
// client-side markdown must survive an unchanged brief.
describe('poll safety (LIN-3340)', () => {
  const { shouldKeepReady, contextNeedsRepaint } = load();

  test('the ready-to-merge header is kept only across an idle poll', () => {
    assert.equal(shouldKeepReady('true', 'idle'), true);
    assert.equal(shouldKeepReady('true', 'running'), false, 'a started close-out overrides');
    assert.equal(shouldKeepReady('true', 'waiting'), false);
    assert.equal(shouldKeepReady('false', 'idle'), false);
    assert.equal(shouldKeepReady(null, 'idle'), false);
  });

  test('the context mount repaints only on a changed signature, and never once widgets mount', () => {
    assert.equal(contextNeedsRepaint(undefined, 'abc', false), true, 'no sig: repaint');
    assert.equal(contextNeedsRepaint('abc', 'abc', false), false, 'unchanged brief is not repainted');
    assert.equal(contextNeedsRepaint('def', 'abc', false), true, 'changed brief is repainted');
    assert.equal(contextNeedsRepaint('def', 'abc', true), false, 'the owner widgets own their refresh');
  });

  test('a guest brief `<pre>` is upgraded to markdown and the upgrade is idempotent', () => {
    const module = { exports: {} };
    const document = { createElement: () => ({ className: '', innerHTML: '' }) };
    const window = { renderMarkdown: (t) => `<p>${t}</p>` };
    vm.runInNewContext(SRC, { module, window, document, Set, Math, Promise, Date, String, isNaN, Array });
    const { enhanceContextMarkdown } = module.exports;

    const pre = { textContent: 'A **brief**', parentNode: null, replacedWith: null };
    const parent = { replaceChild(div, old) { this.child = div; this.replaced = old; } };
    pre.parentNode = parent;
    let present = [pre];
    const mount = { querySelectorAll: (sel) => (sel === 'pre.sess-ctx-body' ? (present = present.filter(p => p !== parent.replaced && p)) : []) };
    parent.replaceChild = function (div, old) { this.child = div; this.replaced = old; present = []; };

    enhanceContextMarkdown(mount);
    assert.equal(parent.child.innerHTML, '<p>A **brief**</p>', 'markdown rendered');
    assert.equal(parent.replaced, pre, 'the <pre> was replaced');
    enhanceContextMarkdown(mount); // no pre left — a no-op
    assert.equal(parent.child.innerHTML, '<p>A **brief**</p>');
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

// LIN-3340 G1/F2 (review `388f4246`): the owner's brief/recap widgets must be
// mounted WITH the task's provider kind, or their GET/POST resolve the wrong
// provider. A mutation dropping `source: source` left the suite green, because
// the e2e compares pathnames only.
describe('owner widget mount threads source (LIN-3340)', () => {
  /** A doc with the owner marker and one brief + one recap panel. */
  function makeDoc({ source, marker = true } = {}) {
    const calls = [];
    const init = (lib) => (el, opts) => calls.push({ lib, el, opts });
    const window = { BriefSection: { init: init('brief') }, RecapSection: { init: init('recap') } };
    const briefEl = { dataset: { urlKey: 'dk-brief', identifier: 'LIN-50' } };
    const recapEl = { dataset: { urlKey: 'dk-recap', identifier: 'LIN-50' } };
    const doc = {
      querySelector: (sel) => (marker && sel === '[data-testid="task-page-owner-widgets"]' ? {} : null),
      querySelectorAll: (sel) => (sel === '.sess-ctx-panel.brief-section' ? [briefEl]
        : sel === '.sess-ctx-panel.recap-section' ? [recapEl] : []),
    };
    const attrs = { 'data-source': source, 'data-url-key': 'fbk', 'data-identifier': 'LIN-50' };
    const main = { getAttribute: (k) => (k in attrs ? attrs[k] : null) };
    return { doc, main, calls, window };
  }

  test('the task source reaches both widget inits (and both refresh POSTs)', () => {
    const { doc, main, calls, window } = makeDoc({ source: 'linear' });
    const { mountWidgets } = load({ window });
    assert.equal(mountWidgets(doc, main), true);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(c => c.lib).sort(), ['brief', 'recap']);
    for (const c of calls) assert.equal(c.opts.source, 'linear', `${c.lib} got the task source`);
  });

  test('a task with no data-source mounts the widgets with no source', () => {
    const { doc, main, calls, window } = makeDoc({ source: undefined });
    const { mountWidgets } = load({ window });
    mountWidgets(doc, main);
    for (const c of calls) assert.equal(c.opts.source, undefined, 'no source stays off the request');
  });

  test('a guest (no owner marker) mounts nothing', () => {
    const { doc, main, calls, window } = makeDoc({ source: 'linear', marker: false });
    const { mountWidgets } = load({ window });
    assert.equal(mountWidgets(doc, main), false);
    assert.equal(calls.length, 0);
  });
});

describe('open rows survive a repaint', () => {
  const { createOpenMemory, rememberToggle, applyOpenMemory } = load();

  /** A minimal `.task-step` row double. */
  function row(id, open) {
    const classes = new Set(open ? ['sess-run--expanded'] : []);
    const head = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    return {
      id,
      head,
      getAttribute: (k) => (k === 'data-loop-id' ? id : null),
      classList: { contains: c => classes.has(c), add: c => classes.add(c), remove: c => classes.delete(c) },
      querySelector: (sel) => (sel === '.sess-run-head' ? head : null),
      isOpen: () => classes.has('sess-run--expanded'),
    };
  }

  test('seeded from the rows rendered open', () => {
    const memory = createOpenMemory([row('a', false), row('b', true)]);
    assert.deepEqual([...memory.open], ['b']);
  });

  test('user-opened stays open, user-closed stays closed, a new running row opens itself', () => {
    const before = [row('a', false), row('b', true), row('c', false)];
    const memory = createOpenMemory(before);
    rememberToggle(memory, before[0], true);   // reader opened a finished row
    rememberToggle(memory, before[1], false);  // reader closed the running row

    // The server repaints: a/b/c rendered with their defaults (b still running →
    // open), and a new running row d arrives open.
    const after = [row('a', false), row('b', true), row('c', false), row('d', true)];
    applyOpenMemory(after, memory);
    assert.deepEqual(after.map(r => r.isOpen()), [true, false, false, true]);
    assert.equal(after[0].head.attrs['aria-expanded'], 'true');
    assert.equal(after[1].head.attrs['aria-expanded'], 'false');
  });

  test('a row the server opened is not collapsed when it finishes', () => {
    const memory = createOpenMemory([row('run', true)]);
    const after = [row('run', false)]; // now done: the server renders it closed
    applyOpenMemory(after, memory);
    assert.equal(after[0].isOpen(), true);
  });
});
