/**
 * LIN-4560 beat 4: live transcripts without a reload.
 *
 *   - lib/dispatch-watch.js `holdForChange`: the one wait loop the proxy watch and its signed-in twin share.
 *   - The twin, `GET /workspace/:urlKey/api/dispatch/transcripts?ids=…&wait=…` (routes/dispatch.js): each run's own entries
 *     as the pages first drew them (masked, quiet/waiting/blocked), keyed on the row id, held until one of them changes.
 *   - A driving session posting three entries while `GET /api/proxy/dispatch/:id?wait=` is held reads them in order; and
 *     that read masks a row stored before intake masking.
 *   - public/transcript-live.js: the follower (one read in flight, paused while hidden, one last read at done, stopped on
 *     401) and the in-place redraw (scroll and opened threads kept); and both pages drawing a followed run's new entries.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4560-live-transcripts.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { holdForChange, clampWaitSeconds } from '../../lib/dispatch-watch.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { FIXTURE_SECRETS } from '../fixtures/secret-scan-fixtures.js';
import { MASK } from '../../lib/mask-secrets.js';
import { TRANSCRIPT_WATCH_MAX_IDS } from '../../lib/transcript.js';
import { renderStatusPill } from '../../lib/components/status-pill.js';
import { renderSurface } from '../../lib/components/surface.js';
import { importWorld } from './helpers/import-world.js';
import { pageHtml, loopWith, own, child } from '../fixtures/lin-4559-run-page.js';

const URLKEY = 'acme';
const TOKEN = 'consumer-1';
const makeStore = () => new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
async function taken(store, fields = { prompt: 'p' }) {
  const doc = await store.addItem(URLKEY, fields);
  await store.takeItem(doc._id, URLKEY, TOKEN);
  return doc;
}
const post = (store, id, message, extra = {}) => store.addFeedback(id, URLKEY, { message, ...extra }, TOKEN);

function dispatchApp(store) {
  const app = express();
  app.use((req, res, next) => { req.session = { accountId: 'acct-1' }; next(); });
  app.use(createDispatchRoutes({
    dispatchQueueStore: store, dispatchTokenStore: {}, userPreferencesStore: {}, proxyTokenStore: {},
    workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: URLKEY }; next(); },
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
  }));
  return app;
}

function proxyApp(store) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: { validateToken: async () => ({ tokenId: 't1', urlKey: URLKEY, label: 'test', scope: 'readWrite', createdBy: 'u1' }) },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {}, dispatchQueueStore: store,
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  }));
  return app;
}

/** A loopback server for the whole test (addressed the way it was bound, LIN-2023); `get(path)` reads JSON. */
async function serve(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    async get(path) {
      const res = await fetch(`${base}${path}`, { headers: { Authorization: 'Bearer anything' } });
      return { status: res.status, body: JSON.parse((await res.text()).trim() || 'null') };
    },
    async close() { server.closeAllConnections(); await new Promise((r) => server.close(r)); },
  };
}

// ── The shared wait loop ──────────────────────────────────────────────────────────────────────────────────────────────

describe('holdForChange (lib/dispatch-watch.js): the one wait loop', () => {
  test('returns at the first change, re-reading the body only when the token moved', async () => {
    let token = 0, reads = 0, value = 'a';
    setTimeout(() => { token = 1; value = 'b'; }, 30);
    const out = await holdForChange({ initial: 'a', token: 0, waitSeconds: 2, pollMs: 10, readToken: async () => token, readSnapshot: async () => { reads++; return value; }, changed: (v) => v !== 'a' });
    assert.equal(out.reason, 'change');
    assert.equal(out.current, 'b');
    assert.equal(reads, 1);
  });

  test('times out with the initial snapshot when nothing moves; a client gone away aborts; a body gone mid-wait ends it', async () => {
    const idle = await holdForChange({ initial: 'a', token: 0, waitSeconds: 0.05, pollMs: 10, readToken: async () => 0, readSnapshot: async () => 'x', changed: () => true });
    assert.deepEqual([idle.reason, idle.current], ['timeout', 'a']);
    const gone = await holdForChange({ initial: 'a', token: 0, waitSeconds: 1, pollMs: 10, readToken: async () => 0, readSnapshot: async () => 'x', changed: () => true, isGone: () => true });
    assert.deepEqual(gone, { aborted: true });
    const vanished = await holdForChange({ initial: 'a', token: 0, waitSeconds: 1, pollMs: 10, readToken: async () => 1, readSnapshot: async () => null, changed: () => true });
    assert.deepEqual([vanished.reason, vanished.current], ['timeout', 'a']);
  });

  test('clampWaitSeconds: garbage and non-positive are 0, the rest capped', () => {
    assert.deepEqual(['x', '-3', '0', '7.9', '999'].map((v) => clampWaitSeconds(v)), [0, 0, 0, 7, 50]);
  });
});

// ── The signed-in twin ────────────────────────────────────────────────────────────────────────────────────────────────

describe('GET /workspace/:urlKey/api/dispatch/transcripts: the signed-in twin', () => {
  test('refuses no ids, too many ids and a control character', async () => {
    const srv = await serve(dispatchApp(makeStore()));
    try {
      for (const q of ['', '?ids=', `?ids=${Array.from({ length: 26 }, (_, i) => `id${i}`).join(',')}`, '?ids=a%01b']) {
        assert.equal((await srv.get(`/workspace/${URLKEY}/api/dispatch/transcripts${q}`)).status, 400, q);
      }
    } finally { await srv.close(); }
  });

  test('without wait: each run\'s own entries as the pages draw them, masked, keyed on the row id; an unknown id left out', async () => {
    const store = makeStore();
    const run = await taken(store);
    await post(store, run._id, 'Looked at it.', { kind: 'assistant-text' });
    await post(store, run._id, '{"inputTokens":3}', { kind: 'usage' });
    await post(store, run._id, 'Searching.', { kind: 'agent-text', agent: 'a1' });
    // A row stored before intake masking: written straight onto the document, as the old rows were.
    store.historyCollection._docs.find((d) => d._id === run._id).feedback.push({ message: `old ${FIXTURE_SECRETS.githubPat}`, timestamp: new Date(), kind: 'assistant-text' });
    const srv = await serve(dispatchApp(store));
    try {
      const { status, body } = await srv.get(`/workspace/${URLKEY}/api/dispatch/transcripts?ids=${run._id},nope`);
      assert.equal(status, 200);
      assert.equal(body.rows.length, 1);
      const [row] = body.rows;
      assert.equal(row.id, run._id);
      assert.equal(row.live, true);
      assert.equal(row.face, undefined, "a live run carries no settled face");
      assert.deepEqual(row.entries.map((e) => e.message.slice(0, 12)), ['Looked at it', '{"inputToken', 'Searching.', 'old [redacte']);
      assert.equal(row.entries[1].quiet, true);
      assert.equal(row.entries[2].agent, 'a1');
      assert.ok(!JSON.stringify(body).includes(FIXTURE_SECRETS.githubPat) && row.entries[3].message.includes(MASK));
      assert.equal(body.reason, undefined, 'no hold, no reason');
    } finally { await srv.close(); }
  });

  test('with every run finished it answers at once (terminal), live false', async () => {
    const store = makeStore();
    const run = await taken(store);
    await post(store, run._id, '[done] landed', { kind: 'status' });
    const srv = await serve(dispatchApp(store));
    try {
      const t0 = Date.now();
      const { body } = await srv.get(`/workspace/${URLKEY}/api/dispatch/transcripts?ids=${run._id}&wait=10`);
      assert.ok(Date.now() - t0 < 1000);
      assert.equal(body.reason, 'terminal');
      assert.equal(body.rows[0].live, false);
      // A finished run carries how it settled: its wire status and its run-page face, drawn by the page's renderers.
      assert.equal(body.rows[0].status, 'done');
      assert.equal(body.rows[0].face.state, 'done');
      assert.match(body.rows[0].face.status, /data-testid="session-run-status"[^>]*>.*done<\/span>$/);
      assert.match(body.rows[0].face.times, /data-testid="session-run-completed">completed /);
    } finally { await srv.close(); }
  });

  test('have: a page behind the store is answered at once; a page up to date is held; a count list of the wrong length is refused', async () => {
    const store = makeStore();
    const run = await taken(store);
    await post(store, run._id, 'one', { kind: 'assistant-text' });
    await post(store, run._id, 'two', { kind: 'assistant-text' });
    const srv = await serve(dispatchApp(store));
    try {
      let t0 = Date.now();
      const behind = await srv.get(`/workspace/${URLKEY}/api/dispatch/transcripts?ids=${run._id}&have=1&wait=6`);
      assert.ok(Date.now() - t0 < 1000, 'answered at once');
      assert.equal(behind.body.reason, 'change');
      assert.deepEqual(behind.body.rows[0].entries.map((e) => e.message), ['one', 'two']);
      t0 = Date.now();
      const upToDate = await srv.get(`/workspace/${URLKEY}/api/dispatch/transcripts?ids=${run._id}&have=2&wait=2`);
      assert.ok(Date.now() - t0 >= 1900, 'held the window');
      assert.equal(upToDate.body.reason, 'timeout');
      assert.equal((await srv.get(`/workspace/${URLKEY}/api/dispatch/transcripts?ids=${run._id}&have=1,2`)).status, 400);
    } finally { await srv.close(); }
  });

  test('held: returns on a new entry for any followed run, with every entry in order; a run reaching done reads live false', async () => {
    const store = makeStore();
    const a = await taken(store);
    const b = await taken(store);
    await post(store, a._id, 'a: one', { kind: 'assistant-text' });
    const srv = await serve(dispatchApp(store));
    try {
      setTimeout(() => { post(store, b._id, 'b: one', { kind: 'assistant-text' }); }, 300);
      const first = await srv.get(`/workspace/${URLKEY}/api/dispatch/transcripts?ids=${a._id},${b._id}&wait=6`);
      assert.equal(first.body.reason, 'change');
      assert.deepEqual(first.body.rows.map((r) => [r.id, r.entries.map((e) => e.message)]), [[a._id, ['a: one']], [b._id, ['b: one']]]);
      setTimeout(() => { post(store, a._id, '[done] landed', { kind: 'status' }); }, 300);
      const second = await srv.get(`/workspace/${URLKEY}/api/dispatch/transcripts?ids=${a._id},${b._id}&wait=6`);
      assert.equal(second.body.reason, 'change');
      const rowA = second.body.rows.find((r) => r.id === a._id);
      assert.equal(rowA.live, false);
      assert.deepEqual(rowA.entries.map((e) => e.message), ['a: one', '[done] landed']);
    } finally { await srv.close(); }
  });
});

// ── The driving session's read ────────────────────────────────────────────────────────────────────────────────────────

describe('a driving session reads a run\'s entries in order through GET /api/proxy/dispatch/:id?wait=', () => {
  test('three entries posted while the read is held are read in order, each once', async () => {
    const store = makeStore();
    const run = await taken(store);
    const srv = await serve(proxyApp(store));
    try {
      const sent = ['step 1: read the plan', 'step 2: tried railway', 'step 3: opened the PR'];
      sent.forEach((message, i) => setTimeout(() => { post(store, run._id, message, { kind: 'assistant-text' }); }, 400 + i * 1700));
      const read = [];
      let seen = 0;
      const deadline = Date.now() + 15000;
      while (read.length < sent.length && Date.now() < deadline) {
        const { status, body } = await srv.get(`/api/proxy/dispatch/${run._id}?wait=4`);
        assert.equal(status, 200);
        for (const f of body.feedback.slice(seen)) read.push(f.message);
        seen = body.feedback.length;
      }
      assert.deepEqual(read, sent);
    } finally { await srv.close(); }
  });

  test('the read masks a row stored before intake masking; a clean entry is unchanged', async () => {
    const store = makeStore();
    const run = await taken(store);
    await post(store, run._id, 'a clean line', { kind: 'assistant-text' });
    store.historyCollection._docs.find((d) => d._id === run._id).feedback.push({ message: `found ${FIXTURE_SECRETS.githubPat}`, url: `https://example.com/?t=${FIXTURE_SECRETS.githubPat}`, urlLabel: 'PR', timestamp: new Date() });
    const srv = await serve(proxyApp(store));
    try {
      const { body } = await srv.get(`/api/proxy/dispatch/${run._id}`);
      assert.equal(body.feedback[0].message, 'a clean line');
      assert.ok(!JSON.stringify(body.feedback).includes(FIXTURE_SECRETS.githubPat));
      assert.ok(body.feedback[1].message.includes(MASK) && body.feedback[1].url.includes(MASK));
      assert.equal(body.feedback[1].urlLabel, 'PR');
    } finally { await srv.close(); }
  });
});

// ── The follower and the redraw (public/transcript-live.js) ───────────────────────────────────────────────────────────

let world = null;
afterEach(() => { if (world) world.restore(); world = null; });

const HOST = { renderStatusPill, renderSurface, formatLocalTime: () => '' };

/** A follower over a scripted fetch and collected timers. `answers` are consumed in order. */
async function follower({ ids = ['r1'], answers = [], visible = () => true } = {}) {
  world = importWorld({ window: HOST });
  const live = await world.importPage('transcript-live.js');
  const calls = [];
  const applied = [];
  const timers = [];
  const pending = [];
  const f = live.createTranscriptFollower({
    urlKey: 'ws',
    liveIds: () => ids,
    apply: (row) => applied.push(row),
    fetchJson: (url) => { calls.push(url); const a = answers.shift(); return new Promise((resolve, reject) => pending.push(() => (a instanceof Error ? reject(a) : resolve(a)))); },
    visible,
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  });
  const settle = async () => { while (pending.length) { pending.shift()(); await new Promise((r) => setImmediate(r)); } };
  const fire = async () => { const t = timers.shift(); if (t) t.fn(); await new Promise((r) => setImmediate(r)); };
  return { f, calls, applied, timers, settle, fire, live };
}
const row = (id, n, live = true) => ({ id, live, entries: Array.from({ length: n }, (_, i) => ({ message: `${id} ${i}`, kind: 'assistant-text' })) });

describe('createTranscriptFollower: one read in flight, paused while hidden, one last read at done', () => {
  test('coalesced: a poke while a read is in flight starts no second read; the answer schedules the next read', async () => {
    const t = await follower({ answers: [{ rows: [row('r1', 1)] }] });
    t.f.start(); await t.fire();
    t.f.poke(); t.f.poke();
    assert.equal(t.calls.length, 1);
    assert.match(t.calls[0], /\/workspace\/ws\/api\/dispatch\/transcripts\?ids=r1&have=-1&wait=25$/, 'unknown count: -1, so the server answers at once');
    await t.settle();
    assert.equal(t.applied.length, 1);
    assert.deepEqual(t.timers.map((x) => x.ms), [0], 'the next held read follows at once');
  });

  test('a run is redrawn only when its entries or liveness changed', async () => {
    const t = await follower({ answers: [{ rows: [row('r1', 1)] }, { rows: [row('r1', 1)] }, { rows: [row('r1', 2)] }] });
    t.f.start(); await t.fire(); await t.settle();
    await t.fire(); await t.settle();
    await t.fire(); await t.settle();
    assert.deepEqual(t.applied.map((r) => r.entries.length), [1, 2]);
  });

  test('done: drawn settled, one more read at once (no hold), then not followed again', async () => {
    const t = await follower({ answers: [{ rows: [row('r1', 2, false)] }, { rows: [row('r1', 3, false)] }] });
    t.f.start(); await t.fire(); await t.settle();
    assert.equal(t.applied[0].live, false);
    await t.fire();
    assert.match(t.calls[1], /wait=0$/, 'the last read is not held');
    await t.settle();
    assert.deepEqual(t.applied.map((r) => r.entries.length), [2, 3], 'the final entries land');
    assert.deepEqual(t.timers, [], 'nothing left to follow');
    assert.deepEqual(t.f.state().done, ['r1']);
  });

  test('hidden: no read; showing again reads at once', async () => {
    let shown = false;
    const t = await follower({ answers: [{ rows: [row('r1', 1)] }], visible: () => shown });
    t.f.start(); await t.fire();
    assert.equal(t.calls.length, 0);
    shown = true;
    t.f.poke();
    assert.equal(t.calls.length, 1);
  });

  test('a followed run the answer leaves out is followed no more: one read, no tight loop (finding-8a88d629)', async () => {
    const t = await follower({ ids: ['gone'], answers: [{ rows: [], reason: 'terminal' }] });
    t.f.start(); await t.fire(); await t.settle();
    assert.equal(t.calls.length, 1);
    assert.deepEqual(t.f.state().following, []);
    assert.deepEqual(t.timers, [], 'nothing scheduled');
  });

  test('more live runs than one read carries each get a turn: 30 live ids are all read within two answers (finding-61478544)', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `r${i + 1}`);
    const asked = (url) => decodeURIComponent(url.match(/ids=([^&]*)/)[1]).split(',');
    assert.equal(ids.length > 25, true);
    const w = await follower({ ids, answers: [{ rows: ids.slice(0, 25).map((id) => row(id, 1)) }, { rows: [] }] });
    w.f.start(); await w.fire(); await w.settle();
    await w.fire();
    assert.equal(asked(w.calls[0]).length, TRANSCRIPT_WATCH_MAX_IDS, 'a read carries no more than the cap');
    const all = new Set([...asked(w.calls[0]), ...asked(w.calls[1])]);
    assert.equal(all.size, 30, 'every one of the 30 ids appeared within two reads');
  });

  test('a 401 stops for good; another failure retries after a pause', async () => {
    const unauthorized = Object.assign(new Error('Unauthorized'), { status: 401 });
    const a = await follower({ answers: [unauthorized] });
    a.f.start(); await a.fire(); await a.settle();
    assert.equal(a.f.state().stopped, true);
    assert.deepEqual(a.timers, []);
    const b = await follower({ answers: [Object.assign(new Error('boom'), { status: 503 })] });
    b.f.start(); await b.fire(); await b.settle();
    assert.equal(b.f.state().stopped, false);
    assert.deepEqual(b.timers.map((x) => x.ms), [b.live.TRANSCRIPT_RETRY_MS]);
  });
});

describe('redrawTranscript keeps the reader\'s place', () => {
  async function list() {
    world = importWorld({ window: HOST });
    const live = await world.importPage('transcript-live.js');
    const ul = world.document.createElement('ul');
    world.document.body.appendChild(ul);
    return { live, ul };
  }
  const entries = (n, kid = 0) => [
    ...Array.from({ length: n }, (_, i) => ({ message: `own ${i}`, kind: 'assistant-text', timestamp: null })),
    ...Array.from({ length: kid }, (_, i) => ({ message: `kid ${i}`, kind: 'agent-text', agent: 'a1', timestamp: null })),
  ];

  test('an opened child thread stays open, and the in-progress marker moves to the newest bubble', async () => {
    const { live, ul } = await list();
    live.redrawTranscript(ul, entries(1, 1), true);
    ul.querySelector('[data-agent="a1"] details').setAttribute('open', '');
    live.redrawTranscript(ul, entries(2, 2), true);
    assert.equal(ul.querySelector('[data-agent="a1"] details').hasAttribute('open'), true);
    const bubbles = ul.querySelectorAll('[data-testid="transcript-entry"]');
    assert.deepEqual(bubbles.map((li) => !!li.querySelector('.status-pill--in-progress')), [false, true]);
    live.redrawTranscript(ul, entries(3), false);
    assert.equal(ul.querySelectorAll('.status-pill--in-progress').length, 0, 'done: no marker left');
  });

  test('a reader scrolled up keeps their place; a reader at the bottom follows the new entries; an empty list stays hidden', async () => {
    const { live, ul } = await list();
    Object.assign(ul, { scrollHeight: 500, clientHeight: 100, scrollTop: 40 });
    live.redrawTranscript(ul, entries(2), true);
    assert.equal(ul.scrollTop, 40);
    Object.assign(ul, { scrollTop: 400 });
    live.redrawTranscript(ul, entries(3), true);
    assert.equal(ul.scrollTop, 500);
    live.redrawTranscript(ul, [], true);
    assert.equal(ul.hidden, true);
  });
});

// ── Both pages draw a followed run's new entries ──────────────────────────────────────────────────────────────────────

describe('the run page and Dispatch history draw a followed run\'s new entries in place', () => {
  test('run page: the live row is followed by its row id; a new entry appears, the marker moves, done settles it', async () => {
    const answers = [];
    const calls = [];
    const timers = [];
    world = importWorld({ window: { ...HOST, QuestionCards: {}, api: (url) => { calls.push(url); return Promise.resolve(answers.shift() || { rows: [] }); } }, timers });
    const loop = loopWith([own('first', 1)]);
    world.document.body.innerHTML = pageHtml(loop).match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
    world.document.visibilityState = 'visible';
    const page = await world.importPage('session.js');
    page.captureLiveRuns();
    page.renderRunTranscripts();
    answers.push({ rows: [{ id: 'loop-1', live: true, entries: [{ message: 'first', kind: 'assistant-text' }, { message: 'second', kind: 'assistant-text' }, { message: 'Searching.', kind: 'agent-text', agent: 'a1' }] }] });
    const follower = page.initLiveTranscripts();
    assert.equal(calls.length, 0, 'the first read waits one start window after load');
    assert.equal(timers[0].ms, 3000);
    timers.shift().fn();
    await new Promise((r) => setImmediate(r));
    follower.stop();
    assert.match(calls[0], /\/workspace\/ws\/api\/dispatch\/transcripts\?ids=loop-1&have=1&wait=25/, 'the page says it drew one entry');
    const tx = world.document.querySelector('[data-testid="session-run-transcript"]');
    const bubbles = tx.querySelectorAll('[data-testid="transcript-entry"]');
    assert.deepEqual(bubbles.map((li) => li.querySelector('.sess-tx-msg').textContent), ['first', 'second']);
    assert.deepEqual(bubbles.map((li) => !!li.querySelector('.status-pill--in-progress')), [false, true]);
    assert.equal(tx.querySelectorAll('[data-testid="transcript-agent-thread"]').length, 1);
  });

  test('run page: a look-alike row planted in an agent\'s words is never followed (rows are captured before markdown)', async () => {
    const calls = [];
    const timers = [];
    world = importWorld({ window: { ...HOST, QuestionCards: {}, renderMarkdown: (t) => t, api: (url) => { calls.push(url); return new Promise(() => {}); } }, timers });
    const planted = '<div class="sess-run" data-status="running" data-loop-id="someone-else">x</div>';
    world.document.body.innerHTML = pageHtml(loopWith([own(planted, 1)])).match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
    const page = await world.importPage('session.js');
    page.captureLiveRuns();
    page.renderRunTranscripts();
    assert.ok(world.document.querySelector('[data-loop-id="someone-else"]'), 'the look-alike is on the page');
    const follower = page.initLiveTranscripts();
    timers.shift().fn();
    follower.stop();
    assert.match(calls[0], /ids=loop-1&/);
    assert.doesNotMatch(calls[0], /someone-else/);
  });

  test('Dispatch history: a live row with no words yet gets its list on its first entry', async () => {
    world = importWorld({ window: { ...HOST, escapeHtml: (s) => String(s), relativeTime: () => '', taskPageHref: () => null, addEventListener() {} } });
    const dispatch = await world.importPage('dispatch.js');
    const container = world.document.createElement('div');
    container.className = 'history-list';
    world.document.body.appendChild(container);
    dispatch.renderDispatchHistoryList(container, [{ id: 'row-9', status: 'taken', outcome: 'taken', promptName: 'implementation', dispatchedAt: null, resolvedAt: null, feedback: [] }], 1, 0, 'ws');
    assert.deepEqual(dispatch.liveHistoryIds(), ['row-9']);
    assert.equal(container.querySelector('[data-testid="history-transcript"]'), null);
    dispatch.applyLiveHistoryRow({ id: 'row-9', live: true, entries: [] });
    assert.equal(container.querySelector('[data-testid="history-transcript"]'), null, 'no words yet: no empty list');
    dispatch.applyLiveHistoryRow({ id: 'row-9', live: true, entries: [{ message: 'hello', kind: 'assistant-text' }] });
    const list = container.querySelector('[data-testid="history-transcript"]');
    assert.equal(list.hidden, false);
    assert.equal(list.querySelector('.sess-tx-msg').textContent, 'hello');
    assert.ok(list.querySelector('.status-pill--in-progress'));
  });
});
