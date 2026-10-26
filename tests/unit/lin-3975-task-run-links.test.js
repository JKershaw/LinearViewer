/**
 * LIN-3975 (PR 2): every attempt on the task page links to its run page, and an attempt the run page cannot
 * resolve says so instead of linking to a 404.
 *
 *   - `inReadWindow` is the run page's own admit rule, for every shape a dispatch time takes (store ISO string,
 *     Date, epoch number): a boundary pair at the cutoff, and the unusable values;
 *   - `runIdsOf` links only the loops inside the 30-day window, built over store-shaped loops;
 *   - the rendered attempt: a link when the run is known, the plain reason when it is aged out, nothing for a guest;
 *   - `runPageHref` (server) and `window.runPageHref` (public/common.js) draw the same URL;
 *   - the server's duration (`fmtDuration`) and the client's ticking clock (`formatElapsed`) draw the same text.
 *
 * Run with: node --test tests/unit/lin-3975-task-run-links.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { inReadWindow, READ_HORIZON_MS, READ_HORIZON_DAYS } from '../../lib/read-horizon.js';
import { runPageHref } from '../../lib/task-page-href.js';
import { fmtDuration } from '../../lib/render-run-steps.js';
import { runIdsOf, buildTaskPageModel } from '../../lib/task-page-loader.js';
import { sessionIdByLoop } from '../../lib/pipeline-loops.js';
import { sessionIdOf } from '../../lib/live-console.js';
import { renderTaskTrack } from '../../lib/render-task-page.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, '../..', rel), 'utf8');
const NOW = new Date('2026-10-26T12:00:00.000Z');
const CUTOFF = new Date(NOW.getTime() - READ_HORIZON_MS);

// ─── the window predicate ────────────────────────────────────────────────────

describe('LIN-3975 — inReadWindow is the run page\'s admit rule, for every shape of dispatch time', () => {
  const shapes = {
    'store ISO string': (d) => d.toISOString(),
    Date: (d) => d,
    'epoch number': (d) => d.getTime(),
  };
  for (const [name, shape] of Object.entries(shapes)) {
    test(`${name}: the cutoff itself is in, one millisecond before it is out`, () => {
      assert.equal(inReadWindow(shape(CUTOFF), NOW), true, 'at the cutoff: kept (the run page drops only earlier)');
      assert.equal(inReadWindow(shape(new Date(CUTOFF.getTime() - 1)), NOW), false, 'one millisecond earlier: dropped');
    });
    test(`${name}: a recent dispatch is in, an old one is out`, () => {
      assert.equal(inReadWindow(shape(new Date(NOW.getTime() - 3600_000)), NOW), true);
      assert.equal(inReadWindow(shape(new Date(NOW.getTime() - (READ_HORIZON_MS + 86_400_000))), NOW), false);
    });
  }

  test('a missing or unusable dispatch time is out of the window, never a crash', () => {
    for (const bad of [null, undefined, '', 'not a date', NaN]) {
      assert.equal(inReadWindow(bad, NOW), false, `${JSON.stringify(bad)} is out`);
    }
  });

  test('the window is the shared 30-day horizon, not a literal of its own', () => {
    assert.equal(READ_HORIZON_DAYS, 30);
    const src = read('lib/read-horizon.js');
    assert.match(src, /function inReadWindow/);
    assert.match(src, /toEpochMs\(dispatchedAt\)/, 'the value is parsed first (a raw ISO string against a Date is always false)');
  });
});

// ─── the attempt-to-run map ──────────────────────────────────────────────────

/** A store-shaped loop: the dispatch time is an ISO string, as the store hands it back. */
function loop(loopId, dispatchedAt, over = {}) {
  return {
    loopId,
    issueIdentifier: 'LIN-50',
    issueId: '11111111-2222-3333-4444-555555555555',
    issueTitle: 'Build the task page',
    kind: 'implementation',
    target: 'cli',
    iteration: 1,
    source: 'history',
    historyStatus: 'taken',
    agentState: 'done',
    dispatchedAt: dispatchedAt.toISOString(),
    takenAt: dispatchedAt.toISOString(),
    resolvedAt: dispatchedAt.toISOString(),
    terminalStatus: 'done',
    terminalCompletedAt: dispatchedAt.toISOString(),
    wakeMarker: null,
    waitingMessage: null,
    feedback: [],
    telemetry: { producedArtifacts: [] },
    followUpTo: null,
    ...over,
  };
}

const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000);

describe('LIN-3975 — runIdsOf links only the attempts inside the run page\'s window', () => {
  test('an attempt inside the window has its run id; one older than 30 days has none', () => {
    const recent = loop('l-recent', daysAgo(2));
    const old = loop('l-old', daysAgo(45));
    const ids = runIdsOf('acme', [recent, old], NOW);
    assert.ok(ids.get('l-recent'), 'the recent attempt links');
    assert.equal(ids.has('l-old'), false, 'the old attempt has no entry, so it renders unlinked');
  });

  test('a loop that is not a session target has no run id, so it is unlinked with its own reason', () => {
    const notSession = loop('l-nosession', daysAgo(1), { target: null });
    const m = buildTaskPageModel({
      identifier: 'LIN-50', loops: [notSession], ctx: null, enrichLoop, deriveSessionWaiting,
      runIdByLoopId: runIdsOf('acme', [notSession], NOW), now: NOW,
    });
    assert.equal(m.sessions[0].runId, null);
    assert.match(renderTaskTrack(m, { now: NOW, urlKey: 'acme', runLinks: true }), /no run page for this attempt/);
  });

  // The claim that the id is the one the run page resolves is witnessed in lin-3975-run-link-resolve.test.js, which
  // reads the run by this id. Here: an in-window attempt gets a non-empty id, and that id is the ledger's (not a key built here).
  test('an in-window attempt gets the ledger\'s session id (the run page\'s own witness is in lin-3975-run-link-resolve)', () => {
    const recent = loop('l-recent', daysAgo(1));
    const ids = runIdsOf('acme', [recent], NOW);
    assert.match(ids.get('l-recent'), /^\S+$/, 'a non-empty session id');
    assert.equal(ids.get('l-recent'), sessionIdOf({ ...recent, workspaceUrlKey: 'acme' }, sessionIdByLoop([{ ...recent, workspaceUrlKey: 'acme' }], { now: NOW })), 'the Live Console key');
  });

  test('a loop with an unparseable dispatch time gets no link (it is out of the window)', () => {
    const broken = loop('l-broken', daysAgo(1), { dispatchedAt: 'not a date' });
    assert.equal(runIdsOf('acme', [broken], NOW).has('l-broken'), false);
  });

  test('the model carries each attempt\'s run id, and marks only a known-old one aged out', () => {
    const recent = loop('l-recent', daysAgo(2), { agentState: 'done' });
    const old = loop('l-old', daysAgo(45), { agentState: 'done' });
    const unknown = loop('l-unknown', daysAgo(1), { dispatchedAt: null, takenAt: null, resolvedAt: null });
    const m = buildTaskPageModel({
      identifier: 'LIN-50', loops: [recent, old, unknown], ctx: null, enrichLoop, deriveSessionWaiting,
      runIdByLoopId: runIdsOf('acme', [recent, old, unknown], NOW), now: NOW,
    });
    const by = (id) => m.sessions.find(s => s.loopId === id);
    assert.ok(by('l-recent').runId, 'the recent attempt carries its run id');
    assert.equal(by('l-recent').agedOut, false);
    assert.equal(by('l-old').runId, null);
    assert.equal(by('l-old').agedOut, true, 'a known dispatch time outside the window is aged out');
    assert.equal(by('l-unknown').agedOut, false, 'no dispatch time is not claimed to be old');
  });
});

// ─── the rendered attempt ────────────────────────────────────────────────────

function trackOf(sessions, opts) {
  const m = buildTaskPageModel({
    identifier: 'LIN-50', loops: sessions.map(s => s.loop), ctx: null, enrichLoop, deriveSessionWaiting,
    runIdByLoopId: runIdsOf('acme', sessions.map(s => s.loop), NOW), now: NOW,
  });
  return renderTaskTrack(m, { now: NOW, urlKey: 'acme', ...opts });
}

describe('LIN-3975 — an attempt links to its run page, or says why it cannot', () => {
  const recent = loop('l-recent', daysAgo(2));
  const old = loop('l-old', daysAgo(45));

  test('an owner or member gets a link to the run page of an in-window attempt', () => {
    const html = trackOf([{ loop: recent }], { runLinks: true });
    const runId = runIdsOf('acme', [recent], NOW).get('l-recent');
    const href = `/workspace/acme/observation/session/${encodeURIComponent(runId)}`;
    assert.match(html, new RegExp(`<a class="task-stage-run" data-testid="task-page-attempt-run" href="${href.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}">open run ›</a>`));
  });

  test('an aged-out attempt says so in plain words, with no link', () => {
    const html = trackOf([{ loop: old }], { runLinks: true });
    assert.match(html, /data-testid="task-page-attempt-unlinked">older than 30 days: no run page</);
    assert.doesNotMatch(html, /task-stage-run" data-testid="task-page-attempt-run"/);
  });

  test('a guest (no run page to open) gets neither the link nor the reason', () => {
    const html = trackOf([{ loop: recent }, { loop: old }], { runLinks: false });
    assert.doesNotMatch(html, /task-page-attempt-run|task-page-attempt-unlinked|observation\/session/);
  });

  test('the reason names the window from READ_HORIZON_DAYS, so it cannot drift', () => {
    assert.match(trackOf([{ loop: old }], { runLinks: true }), new RegExp(`older than ${READ_HORIZON_DAYS} days`));
  });
});

// ─── one server twin, one duration ───────────────────────────────────────────

/** `window.runPageHref` from public/common.js, run in a sandbox so the test uses the browser's own source. */
function clientRunPageHref() {
  const src = read('public/common.js');
  const start = src.indexOf('window.runPageHref = function runPageHref');
  const end = src.indexOf('};', start) + 2;
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src.slice(start, end), sandbox);
  return sandbox.window.runPageHref;
}

describe('LIN-3975 — the server and the browser draw the same run link', () => {
  test('runPageHref equals window.runPageHref for ordinary and awkward ids', () => {
    const client = clientRunPageHref();
    for (const [urlKey, sessionId] of [['acme', 'sess-1'], ['my ws', 'a/b c'], ['x', '2026-10-26_run:1']]) {
      assert.equal(runPageHref(urlKey, sessionId), client(urlKey, sessionId), `${urlKey} / ${sessionId}`);
    }
    assert.equal(runPageHref('', 'x'), '');
    assert.equal(runPageHref('acme', ''), '');
  });
});

describe('LIN-3975 — one duration format: the server\'s and the ticking clock\'s', () => {
  test('the page\'s running clock (formatElapsed) equals fmtDuration for every span it can show', () => {
    const src = read('public/task-page.js');
    const module = { exports: {} };
    vm.runInNewContext(src, { module, window: {}, document: { addEventListener() {} }, setTimeout() {}, setInterval() {}, console }, { filename: 'task-page.js' });
    const { formatElapsed } = module.exports;
    for (const ms of [0, 999, 45_000, 59_000, 60_000, 6 * 60_000, 6 * 60_000 + 30_000, 59 * 60_000, 60 * 60_000, 4 * 3600_000 + 4 * 60_000, 26 * 3600_000]) {
      assert.equal(formatElapsed(ms), fmtDuration(ms), `${ms} ms`);
    }
  });

  test('the duration words are fmtDuration\'s: no formatSpan, and the running suffix is not spelled in minutes or hours', () => {
    const renderer = read('lib/render-task-page.js');
    assert.doesNotMatch(renderer, /formatSpan/);
    const runningFor = /function runningFor\(startedAt, now\) \{([\s\S]*?)\n\}/.exec(read('lib/task-page-loader.js'));
    assert.ok(runningFor, 'runningFor is found');
    assert.match(runningFor[1], /fmtDuration/);
    assert.doesNotMatch(runningFor[1], /minute|hour/);
  });
});
