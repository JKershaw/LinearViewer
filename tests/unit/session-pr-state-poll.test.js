/**
 * LIN-3251 (LIN-2948 S1b) beat 3 — the session page's PR-state client poll.
 *
 * public/session.js is a plain browser script, so — following the house pattern
 * in session-question-card-effect.test.js — the real shipped source is
 * vm-sandboxed with a minimal `session-pr-state` element, fake timers and a
 * scripted fetch. Nothing is re-implemented here.
 *
 * Run with: node --test tests/unit/session-pr-state-poll.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_JS_SRC = readFileSync(join(__dirname, '../../public/session.js'), 'utf8');

const NEUTRAL = 'Checking for a pull request…';
const OPEN_COPY = 'Nothing has been merged. PR #12 is open: checks passing.';

const flush = () => new Promise(resolve => setImmediate(resolve));

function makeEl(over = {}) {
  return Object.assign({
    dataset: {}, textContent: '',
    addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }
  }, over);
}

function makePrStateEl({ live = true, url = '/workspace/ws/api/run/run-1/pr-state' } = {}) {
  const line = makeEl({ textContent: NEUTRAL });
  const el = makeEl({
    dataset: { prStateUrl: url, runLive: String(live) },
    querySelector(sel) { return sel === '[data-testid="session-pr-line"]' ? line : null; }
  });
  return { el, line };
}

// Fake timers: no real 60 s sleeps. `fireAll` runs the pending jobs once; any
// timer a job schedules during its own run stays pending (never stacked within
// one fire).
function makeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    pending,
    setTimeout(fn, ms) { const id = nextId++; pending.set(id, { fn, ms }); return id; },
    clearTimeout(id) { pending.delete(id); },
    setInterval() { return 0; },
    count() { return pending.size; },
    delay() { const jobs = [...pending.values()]; return jobs.length ? jobs[jobs.length - 1].ms : null; },
    async fireAll() {
      const jobs = [...pending.values()];
      pending.clear();
      for (const job of jobs) await job.fn();
    }
  };
}

function makeFetch() {
  const calls = [];
  let responses = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    const spec = responses.length ? responses.shift() : { state: 'open', number: 12, message: OPEN_COPY };
    if (spec && spec.throw) throw new Error('network');
    if (spec && spec.ok === false) return { ok: false, json: async () => ({}) };
    const payload = spec && spec.payload !== undefined ? spec.payload : spec;
    return { ok: true, json: async () => payload };
  };
  return {
    fetchImpl, calls,
    setResponses(list) { responses = list.slice(); }
  };
}

function makeSandbox({ el, line, timers, fetchImpl, visibility = 'visible' }) {
  const listeners = {};
  const document = {
    visibilityState: visibility,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    querySelector(sel) { return sel === '[data-testid="session-pr-state"]' ? el : null; },
    querySelectorAll() { return []; },
    createElement() { return makeEl(); }
  };
  const sandbox = {
    module: { exports: {} },
    window: {},
    document,
    setTimeout: timers.setTimeout.bind(timers),
    clearTimeout: timers.clearTimeout.bind(timers),
    setInterval: timers.setInterval.bind(timers),
    fetch: fetchImpl,
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(SESSION_JS_SRC, sandbox, { filename: 'session.js' });
  return {
    api: sandbox.module.exports,
    document,
    dispatch(type) { (listeners[type] || []).forEach(fn => fn()); }
  };
}

describe('session PR-state poll (LIN-3251 beat 3)', () => {
  test('pollAction: schedule while live+visible, pause when hidden, stop when terminal or finished', () => {
    const { el, line } = makePrStateEl();
    const { api } = makeSandbox({ el, line, timers: makeTimers(), fetchImpl: makeFetch().fetchImpl });
    assert.equal(api.pollAction(true, null, true), 'schedule');
    assert.equal(api.pollAction(true, 'open', true), 'schedule');
    assert.equal(api.pollAction(true, 'unknown', true), 'schedule');
    assert.equal(api.pollAction(true, 'none', true), 'schedule');
    assert.equal(api.pollAction(true, null, false), 'pause');
    assert.equal(api.pollAction(true, 'merged', true), 'stop');
    assert.equal(api.pollAction(true, 'closed', true), 'stop');
    assert.equal(api.pollAction(false, 'open', true), 'stop');
  });

  test('a finished run does exactly one initial fetch and then no timer', async () => {
    const timers = makeTimers();
    const { el, line } = makePrStateEl({ live: false });
    const f = makeFetch();
    f.setResponses([{ state: 'open', number: 12, message: OPEN_COPY }]);
    const { api } = makeSandbox({ el, line, timers, fetchImpl: f.fetchImpl });

    api.initPrState();
    await flush();

    assert.equal(f.calls.length, 1, 'exactly one initial fetch');
    assert.equal(timers.count(), 0, 'no timer for a finished run');
    assert.equal(line.textContent, OPEN_COPY, 'the initial neutral line is replaced');
  });

  test('the poll stops once the response says merged', async () => {
    const timers = makeTimers();
    const { el, line } = makePrStateEl({ live: true });
    const f = makeFetch();
    f.setResponses([{ state: 'merged', number: 12, message: 'PR #12 was merged.' }]);
    const sandbox = makeSandbox({ el, line, timers, fetchImpl: f.fetchImpl });

    sandbox.api.initPrState();
    await flush();

    assert.equal(f.calls.length, 1);
    assert.equal(timers.count(), 0, 'no timer after merged');
    assert.equal(line.textContent, 'PR #12 was merged.');

    // A later visibility change must not revive the poll.
    sandbox.dispatch('visibilitychange');
    await flush();
    assert.equal(f.calls.length, 1, 'stopped for good after merged');
    assert.equal(timers.count(), 0, 'still no timer');
  });

  test('it does not poll while the tab is hidden and resumes on visible', async () => {
    const timers = makeTimers();
    const { el, line } = makePrStateEl({ live: true });
    const f = makeFetch();
    const sandbox = makeSandbox({ el, line, timers, fetchImpl: f.fetchImpl, visibility: 'hidden' });

    sandbox.api.initPrState();
    await flush();

    assert.equal(f.calls.length, 1, 'one initial fetch even while hidden');
    assert.equal(timers.count(), 0, 'paused while hidden');

    sandbox.document.visibilityState = 'visible';
    sandbox.dispatch('visibilitychange');
    await flush();

    assert.equal(f.calls.length, 2, 'fetch once immediately on becoming visible');
    assert.equal(timers.count(), 1, 'cadence resumed');
    assert.equal(timers.delay(), 60000, '60 s cadence');

    await timers.fireAll();
    await flush();
    assert.equal(f.calls.length, 3, 'one tick later');
    assert.equal(timers.count(), 1, 'never stacks a second timer');
  });

  test('the initial neutral line is replaced by the route copy after the first fetch', async () => {
    const timers = makeTimers();
    const { el, line } = makePrStateEl({ live: true });
    const f = makeFetch();
    f.setResponses([{ state: 'open', number: 12, message: OPEN_COPY }]);
    const { api } = makeSandbox({ el, line, timers, fetchImpl: f.fetchImpl });

    assert.equal(line.textContent, NEUTRAL, 'neutral before the fetch');
    api.initPrState();
    await flush();
    assert.equal(line.textContent, OPEN_COPY, 'route copy after the fetch');
  });

  test('a failed request leaves the line untouched and retries on the next tick', async () => {
    const timers = makeTimers();
    const { el, line } = makePrStateEl({ live: true });
    const f = makeFetch();
    f.setResponses([{ throw: true }, { state: 'open', number: 12, message: OPEN_COPY }]);
    const { api } = makeSandbox({ el, line, timers, fetchImpl: f.fetchImpl });

    api.initPrState();
    await flush();

    assert.equal(f.calls.length, 1);
    assert.equal(line.textContent, NEUTRAL, 'a failed request makes no claim');
    assert.equal(timers.count(), 1, 'a retry is scheduled');

    await timers.fireAll();
    await flush();
    assert.equal(f.calls.length, 2, 'retried on the next tick');
    assert.equal(line.textContent, OPEN_COPY, 'the retry fills the line');
  });
});
