/**
 * LIN-3983 PR 1: the Observation waiting block and the view/filter model.
 *
 *   - compactWaitSessions: which waiting runs get a compact row, and its text.
 *     The rule is the one the block ships, so the cases here are the ones the
 *     plan named (day-dead, shelved-free open questions, message-less waits,
 *     a producer covered while another loop waits).
 *   - viewFromParams: the URL contract, including the old `?view=` values.
 *   - the block's paint, the three openLoopIds states, and the URL written
 *     when the view or filter moves.
 *
 * `public/observation.js` is vm-sandboxed as in the other Observation tests.
 * Run with: node --test tests/unit/observation-waiting-block.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FakeElement } from '../fixtures/observation-dom-shim.js';
import { buildSessionPayload } from '../../routes/dashboard-feed.js';
import { collectUnansweredDecisions, openDecisionLoopIds, MAX_STAMP_LOOP_IDS } from '../../lib/unanswered-decisions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OBSERVATION_JS_SRC = readFileSync(join(__dirname, '../../public/observation.js'), 'utf8');

function makeSandbox({ fetchImpl, href = 'https://harbour.test/workspace/acme/observation' } = {}) {
  const nodes = new Map();
  for (const id of ['obs-waiting', 'obs-waiting-rulings', 'obs-waiting-runs', 'obs-waiting-count',
    'obs-waiting-more', 'obs-rulings', 'obs-rulings-empty', 'obs-session-views', 'obs-rulings-section',
    'obs-due-section', 'obs-poll-status', 'obs-view-hint']) {
    nodes.set(id, new FakeElement('div'));
  }
  nodes.get('obs-waiting').hidden = true;
  nodes.get('obs-waiting-more').hidden = true;
  const replaced = [];
  const sandbox = {
    module: { exports: {} },
    window: {
      addEventListener() {},
      matchMedia: () => ({ matches: false }),
      location: { href },
      history: { state: null, replaceState(state, title, url) { replaced.push(url); } },
      ChatUI: { appendOptions() {}, resolveCaption: () => '' },
      sourceQuery: () => '',
      api: async () => { throw new Error('window.api not stubbed'); }
    },
    document: {
      createElement: (tag) => new FakeElement(tag),
      addEventListener() {},
      getElementById: (id) => nodes.get(id) || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      hidden: false
    },
    escapeHtml: (s) => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')),
    relativeTime: () => '',
    console: { warn() {}, error() {}, log() {} },
    fetch: fetchImpl || (async () => { throw new Error('no fetch stub configured'); }),
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    AbortController
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(OBSERVATION_JS_SRC, sandbox, { filename: 'observation.js' });
  vm.runInContext('observationData = { urlKey: "acme", workspaces: [{ urlKey: "acme", name: "Acme" }] };', sandbox);
  sandbox.__nodes = nodes;
  sandbox.__replaced = replaced;
  return sandbox;
}

// Values built inside the vm context carry that realm's prototypes, which
// assert.deepEqual compares strictly. A JSON copy brings them back to this realm.
const plain = (v) => JSON.parse(JSON.stringify(v));

const flush = async (times = 8) => {
  for (let i = 0; i < times; i++) await new Promise(r => setImmediate(r));
};

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

function waitingSession(over = {}) {
  return {
    sessionId: 's-1',
    workspaceUrlKey: 'acme',
    workspaceName: 'Acme',
    seedTitle: 'Remove the old route',
    status: 'waiting',
    waiting: true,
    waitingMessage: '[blocked] need a ruling before removing the route',
    producerLoopId: 'loop-p',
    waitingLoopIds: ['loop-p'],
    standalone: true,
    ...over
  };
}

describe('stripFeedbackMarkers', () => {
  test('removes the runner markers and leaves the words', () => {
    const sandbox = makeSandbox();
    const { stripFeedbackMarkers } = sandbox.module.exports;
    assert.equal(stripFeedbackMarkers('[blocked] need a ruling'), 'need a ruling');
    assert.equal(stripFeedbackMarkers('[done]  shipped [working]'), 'shipped');
  });
});

describe('compactWaitSessions — which waiting runs get a compact row (LIN-3983)', () => {
  test('a waiting run whose only wait is not an open question gets a row with its producer message', () => {
    const { module } = makeSandbox();
    const { compactWaitSessions } = module.exports;
    const rows = compactWaitSessions([waitingSession()], new Set());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sessionId, 's-1');
    assert.equal(rows[0].message, 'need a ruling before removing the route');
    assert.equal(rows[0].title, 'Remove the old route');
  });

  test('a wait whose loop is an open question gets no row: the ruling row speaks for it', () => {
    const { module } = makeSandbox();
    const { compactWaitSessions } = module.exports;
    assert.deepEqual(plain(compactWaitSessions([waitingSession()], new Set(['loop-p']))), []);
  });

  test('a day-dead run never gets a row: its status is stale, though its wait flag is still set (LIN-608, F5.1)', () => {
    const { module } = makeSandbox();
    const { compactWaitSessions } = module.exports;
    // `waiting` is not gated on staleness in the feed, so the real shape is stale AND waiting.
    assert.deepEqual(plain(compactWaitSessions([waitingSession({ status: 'stale', waiting: true })], new Set())), []);
  });

  test('a finished run never gets a row', () => {
    const { module } = makeSandbox();
    const { compactWaitSessions } = module.exports;
    assert.deepEqual(plain(compactWaitSessions([waitingSession({ status: 'done', waiting: false, waitingLoopIds: [] })], new Set())), []);
  });

  test('a message-less wait gets the fixed fallback text (no message)', () => {
    const { module } = makeSandbox();
    const { compactWaitSessions } = module.exports;
    const rows = compactWaitSessions([waitingSession({ waitingMessage: null, producerLoopId: null })], new Set());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].message, '');
  });

  test('when the producer is covered by a ruling but another loop of the run waits, the row shows the fallback', () => {
    const { module } = makeSandbox();
    const { compactWaitSessions } = module.exports;
    const session = waitingSession({ waitingLoopIds: ['loop-p', 'loop-b'] });
    const rows = compactWaitSessions([session], new Set(['loop-p']));
    assert.equal(rows.length, 1, 'loop-b is not covered, so the run gets a row');
    assert.equal(rows[0].message, '', 'the producer’s own question is on the ruling row, so the row does not repeat it');
  });

  test('a session from an older payload without waitingLoopIds gets no row rather than a wrong one', () => {
    const { module } = makeSandbox();
    const { compactWaitSessions } = module.exports;
    const old = waitingSession();
    delete old.waitingLoopIds;
    assert.deepEqual(plain(compactWaitSessions([old], new Set())), []);
  });
});

describe('viewFromParams — the URL contract, with the old tab names (LIN-3983)', () => {
  const { viewFromParams } = (() => makeSandbox().module.exports)();
  const parse = (qs) => viewFromParams(new URLSearchParams(qs));

  test('a bare URL opens on runs with the autopilot filter', () => {
    assert.deepEqual(plain(parse('')), { view: 'runs', filter: 'autopilot' });
  });

  test('the rulings and due views keep their names', () => {
    assert.deepEqual(plain(parse('view=rulings')), { view: 'rulings', filter: 'autopilot' });
    assert.deepEqual(plain(parse('view=due')), { view: 'due', filter: 'autopilot' });
  });

  test('?view=sessions (the old Sessions tab) opens on runs with the all filter', () => {
    assert.deepEqual(plain(parse('view=sessions')), { view: 'runs', filter: 'all' });
  });

  test('?view=autopilot (the old Autopilot tab) opens on runs with the autopilot filter', () => {
    assert.deepEqual(plain(parse('view=autopilot')), { view: 'runs', filter: 'autopilot' });
  });

  test('an explicit filter is read on runs, and an unknown one falls back', () => {
    assert.deepEqual(plain(parse('filter=standalone')), { view: 'runs', filter: 'standalone' });
    assert.deepEqual(plain(parse('view=sessions&filter=standalone')), { view: 'runs', filter: 'standalone' });
    assert.deepEqual(plain(parse('filter=nonsense')), { view: 'runs', filter: 'autopilot' });
  });

  test('an unknown view opens on runs', () => {
    assert.deepEqual(plain(parse('view=garbage')), { view: 'runs', filter: 'autopilot' });
  });
});

describe('the waiting block paint (LIN-3983)', () => {
  test('the block is absent when nothing waits', () => {
    const sandbox = makeSandbox();
    const { renderWaitingBlock, setOpenLoopIds } = sandbox.module.exports;
    setOpenLoopIds(new Set());
    renderWaitingBlock();
    assert.equal(sandbox.__nodes.get('obs-waiting').hidden, true);
  });

  test('a waiting run with no ruling row shows as a compact row, under the runs view', () => {
    const sandbox = makeSandbox();
    const { renderWaitingBlock, setOpenLoopIds, sessionIndex } = sandbox.module.exports;
    sessionIndex.set('s-1', waitingSession());
    setOpenLoopIds(new Set());
    renderWaitingBlock();
    const block = sandbox.__nodes.get('obs-waiting');
    assert.equal(block.hidden, false);
    assert.equal(sandbox.__nodes.get('obs-waiting-count').textContent, '1');
    assert.match(sandbox.__nodes.get('obs-waiting-runs').innerHTML, /data-session-id="s-1"/);
    assert.match(sandbox.__nodes.get('obs-waiting-runs').innerHTML, /reply on its run page/);
  });

  test('no compact rows paint while openLoopIds is still loading (null), so none duplicates a ruling row', () => {
    const sandbox = makeSandbox();
    const { renderWaitingBlock, sessionIndex } = sandbox.module.exports;
    sessionIndex.set('s-1', waitingSession());
    renderWaitingBlock();
    assert.equal(sandbox.__nodes.get('obs-waiting').hidden, true);
    assert.equal(sandbox.__nodes.get('obs-waiting-runs').innerHTML, '', 'no compact row is painted');
  });

  test('off the runs view the block is hidden, whatever it holds', () => {
    const sandbox = makeSandbox();
    const { renderWaitingBlock, setOpenLoopIds, sessionIndex, switchView } = sandbox.module.exports;
    sessionIndex.set('s-1', waitingSession());
    setOpenLoopIds(new Set());
    renderWaitingBlock();
    assert.equal(sandbox.__nodes.get('obs-waiting').hidden, false);
    switchView('rulings');
    assert.equal(sandbox.__nodes.get('obs-waiting').hidden, true);
  });

  test('a failed first rulings read settles openLoopIds to empty, so waiting runs still get rows', async () => {
    const sandbox = makeSandbox({ fetchImpl: async () => jsonResponse({}, { ok: false, status: 500 }) });
    const { pollRulings, sessionIndex, openLoopIds } = sandbox.module.exports;
    sessionIndex.set('s-1', waitingSession());
    assert.equal(openLoopIds(), null);
    await pollRulings();
    await flush();
    assert.equal(openLoopIds().size, 0, 'settled to the empty set');
    assert.equal(sandbox.__nodes.get('obs-waiting').hidden, false, 'the run is still shown');
    assert.equal(sandbox.__nodes.get('obs-poll-status').textContent, '', 'a block read never touches the live pill');
  });

  test('a later rulings failure keeps the last open set', async () => {
    let ok = true;
    const sandbox = makeSandbox({
      fetchImpl: async () => (ok
        ? jsonResponse({ rulings: [], openLoopIds: ['loop-p'] })
        : jsonResponse({}, { ok: false, status: 500 }))
    });
    const { pollRulings, openLoopIds } = sandbox.module.exports;
    await pollRulings();
    await flush();
    ok = false;
    await pollRulings();
    await flush();
    assert.deepEqual([...openLoopIds()], ['loop-p']);
  });

  test('the block shows at most three ruling rows and says how many more are on the Rulings tab', () => {
    const sandbox = makeSandbox();
    const { renderWaitingBlock, setOpenLoopIds, renderedRulingRows } = sandbox.module.exports;
    const rows = [1, 2, 3, 4, 5].map(n => ({
      decision: { decision_id: `d-${n}`, question: `Q${n}?`, options: [] },
      decisionCase: [],
      anchor: { loopId: `l-${n}`, workspaceUrlKey: 'acme', issueIdentifier: `LIN-${n}`, source: null },
      disposition: 'task-bound',
      canReply: false,
      alternate: null,
      suggestedDismissal: null
    }));
    vm.runInContext(`lastRulings = ${JSON.stringify(rows)};`, sandbox);
    setOpenLoopIds(new Set());
    renderWaitingBlock();
    assert.equal(sandbox.__nodes.get('obs-waiting-rulings').children.length, 3);
    assert.equal(renderedRulingRows.size, 5, 'the other two stay tracked for the tab');
    const more = sandbox.__nodes.get('obs-waiting-more');
    assert.equal(more.hidden, false);
    assert.equal(more.textContent, '2 more in Rulings →');
  });
});

describe('the runs filter and the URL (LIN-3983)', () => {
  test('the autopilot filter reads the plain feed; the others read the sessions source', () => {
    const sandbox = makeSandbox();
    const { sessionsUrl, setFilter } = sandbox.module.exports;
    assert.equal(sessionsUrl('acme'), '/workspace/acme/api/dashboard/sessions');
    setFilter('standalone');
    assert.equal(sessionsUrl('acme'), '/workspace/acme/api/dashboard/sessions?view=sessions');
  });

  test('moving between standalone and all keeps the feed; moving to or from autopilot resets it', () => {
    const sandbox = makeSandbox();
    const { setFilter, sessionIndex, sessionsUrl } = sandbox.module.exports;
    setFilter('standalone');
    sessionIndex.set('s-1', waitingSession());
    setFilter('all');
    assert.equal(sessionIndex.size, 1, 'standalone → all shares a source, so the feed is kept');
    setFilter('autopilot');
    assert.equal(sessionIndex.size, 0, 'all → autopilot changes source, so the feed is torn down');
    assert.equal(sessionsUrl('acme'), '/workspace/acme/api/dashboard/sessions');
  });

  test('a view change writes the view into the URL, and a bare runs/autopilot view writes none', () => {
    const sandbox = makeSandbox();
    const { switchView, setFilter } = sandbox.module.exports;
    switchView('rulings');
    assert.match(sandbox.__replaced.at(-1), /[?&]view=rulings/);
    switchView('runs');
    assert.doesNotMatch(sandbox.__replaced.at(-1), /view=|filter=/);
    setFilter('standalone');
    assert.match(sandbox.__replaced.at(-1), /[?&]filter=standalone/);
  });

  test('the URL keeps the other parameters the page was opened with', () => {
    const sandbox = makeSandbox({ href: 'https://harbour.test/workspace/acme/observation?source=x&view=due' });
    const { switchView } = sandbox.module.exports;
    switchView('rulings');
    assert.match(sandbox.__replaced.at(-1), /source=x/);
    assert.match(sandbox.__replaced.at(-1), /view=rulings/);
  });

  test('a filter change that keeps the source re-polls that source', async () => {
    const calls = [];
    const sandbox = makeSandbox({
      fetchImpl: async (url) => { calls.push(url); return jsonResponse({ active: [], recent: [], rulings: [] }); }
    });
    const { setFilter } = sandbox.module.exports;
    setFilter('standalone');
    await flush();
    const before = calls.length;
    setFilter('all');
    await flush();
    assert.ok(calls.length - before >= 1, 'the feed is re-polled on a filter change');
    assert.ok(calls.slice(before).every(u => /view=sessions/.test(u) || /rulings/.test(u)));
  });
});

describe('the standalone waiting read (decision 8, LIN-3983)', () => {
  test('it makes no request off the autopilot filter or off the runs view', async () => {
    let calls = 0;
    const sandbox = makeSandbox({ fetchImpl: async () => { calls++; return jsonResponse({ active: [] }); } });
    const { pollWaitingSupplement, setFilter, switchView } = sandbox.module.exports;
    setFilter('standalone');
    switchView('due');
    await flush();
    calls = 0; // count only the supplement's own reads below
    await pollWaitingSupplement();
    await pollWaitingSupplement();
    assert.equal(calls, 0, 'off the autopilot filter the supplement never fetches');
    switchView('runs');
    setFilter('autopilot');
    await flush();
    switchView('due');
    await flush();
    calls = 0; // the due tab's own one-shot load is not the supplement's
    await pollWaitingSupplement();
    assert.equal(calls, 0, 'on the due view the supplement never fetches');
  });

  test('on the autopilot filter it adds the standalone waits, and keeps the block as it was when it fails', async () => {
    let ok = true;
    const sandbox = makeSandbox({
      fetchImpl: async () => (ok
        ? jsonResponse({ active: [waitingSession({ sessionId: 'sa-1' }), { ...waitingSession({ sessionId: 'ap-1' }), standalone: false }] })
        : jsonResponse({}, { ok: false, status: 500 }))
    });
    const { pollWaitingSupplement, standaloneWaitSupplement, setOpenLoopIds } = sandbox.module.exports;
    setOpenLoopIds(new Set());
    await pollWaitingSupplement();
    await flush();
    assert.deepEqual([...standaloneWaitSupplement.keys()], ['sa-1'], 'only standalone runs are added');
    assert.equal(sandbox.__nodes.get('obs-waiting').hidden, false);
    ok = false;
    await pollWaitingSupplement();
    await flush();
    assert.deepEqual([...standaloneWaitSupplement.keys()], ['sa-1'], 'a failed read keeps what it had');
  });

  test('on the standalone filter an autopilot run waiting on a plain [blocked] stays in the block (decision 8(i))', async () => {
    const autopilotWait = waitingSession({ sessionId: 'ap-1', standalone: false, waitingLoopIds: ['loop-ap'], producerLoopId: 'loop-ap' });
    const sandbox = makeSandbox({
      fetchImpl: async () => jsonResponse({ active: [autopilotWait], recent: [], rulings: [] })
    });
    const { setFilter, setOpenLoopIds } = sandbox.module.exports;
    setOpenLoopIds(new Set());
    setFilter('standalone'); // the filter change polls the feed, which fills the block's session list
    await flush();
    const block = sandbox.__nodes.get('obs-waiting');
    assert.equal(block.hidden, false, 'the block is shown on the standalone filter');
    assert.match(sandbox.__nodes.get('obs-waiting-runs').innerHTML, /data-session-id="ap-1"/);
  });
});

// ─── The block's rule, over the real builder (LIN-3983 PR 1, step 8) ────────
//
// Each fixture is one loop set, the rulings route's input. The run payloads come
// from `buildSessionPayload` (what the client receives), the open set and rows
// from `openDecisionLoopIds` and `collectUnansweredDecisions` over the SAME
// loops, and `compactWaitSessions` decides the compact rows. Nothing here writes
// an open-set by hand, so a drift between the builder and the block fails here.

const WS = { urlKey: 'acme', name: 'Acme' };
const NOW = new Date();
const RECENT = new Date(Date.now() - 60 * 1000).toISOString();
const LONG_AGO = '2020-01-01T00:00:00.000Z';
const WAIT_TEXT = '[blocked] need a ruling before removing the route';
const PLAIN_TEXT = 'need a ruling before removing the route';
const decision = (decisionId = 'd-1') => ({ decision_id: decisionId, question: 'Remove the route now?' });
const answered = (decisionId, outcome = 'answered') => [{ decisionId, raisedAt: null, resolvedAt: RECENT, outcome }];
const withdrawnFor = (decisionId) => ({ decisionId, timestamp: RECENT, reason: 'no longer needed' });
const shelfFor = (decisionId, loopId) => ({
  urlKey: 'acme', decisionId, decisionLoopId: loopId, lapseCount: 0,
  resurfaceAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
});

// One loop of session S. A `blocked` loop carries the runner's [blocked] wake and its message.
function loop(over = {}) {
  return {
    loopId: 'p', lineageId: null, kind: 'worker', followUpTo: null, sessionId: 'S',
    issueIdentifier: 'LIN-900', workspaceUrlKey: 'acme', dispatchedAt: RECENT, resolvedAt: null,
    decision: null, decisionCase: [], answeredDecisions: [], withdrawal: null,
    wakeMarker: null, waitingMessage: null,
    ...over
  };
}
const blocked = (over = {}) => loop({ wakeMarker: 'blocked', waitingMessage: WAIT_TEXT, ...over });

// The worker/autopilot pair of LIN-3959: the worker's sessionId names the autopilot.
const joinedAutopilot = (over = {}) => loop({
  loopId: 'ap', lineageId: 'ap', kind: 'autopilot', sessionId: 'ap', decision: decision(), ...over
});
const joinedWorker = (over = {}) => loop({
  loopId: 'w', lineageId: 'W', kind: 'worker', sessionId: 'ap', decision: decision(), ...over
});

const FIXTURES = {
  dayDead: () => ({ loops: [blocked({ loopId: 'p', dispatchedAt: LONG_AGO, resolvedAt: LONG_AGO })] }),
  shelved: () => ({ loops: [blocked({ loopId: 'p', decision: decision() })], shelved: [shelfFor('d-1', 'p')] }),
  messageLessOpen: () => ({ loops: [blocked({ loopId: 'p', decision: decision(), waitingMessage: null })] }),
  messageLessPlain: () => ({ loops: [blocked({ loopId: 'p', waitingMessage: null })] }),
  producerPlainOtherOpen: () => ({
    loops: [blocked({ loopId: 'a' }), blocked({ loopId: 'b', decision: decision(), waitingMessage: null })]
  }),
  dismissed: () => ({ loops: [blocked({ loopId: 'p', decision: decision(), answeredDecisions: answered('d-1', 'dismissed') })] }),
  withdrawnThenPlain: () => ({
    loops: [blocked({ loopId: 'p', decision: decision(), withdrawal: withdrawnFor('d-1'), waitingMessage: '[blocked] a plain wait now' })]
  }),
  answeredNoFollowUp: () => ({ loops: [blocked({ loopId: 'p', decision: decision(), answeredDecisions: answered('d-1') })] }),
  siblingAnswered: () => ({
    loops: [
      blocked({ loopId: 'p', lineageId: 'L', decision: decision() }),
      loop({ loopId: 'q', lineageId: 'L', decision: decision(), answeredDecisions: answered('d-1') })
    ]
  }),
  joinedAnsweredOnWorker: () => ({
    loops: [joinedWorker({ answeredDecisions: answered('d-1') }), joinedAutopilot({ wakeMarker: 'blocked', waitingMessage: WAIT_TEXT })]
  }),
  joinedWithdrawnWorker: () => ({
    loops: [joinedWorker({ wakeMarker: 'blocked', waitingMessage: WAIT_TEXT, withdrawal: withdrawnFor('d-1') }), joinedAutopilot()]
  }),
  joinedOverStampCap: () => ({
    loops: [
      joinedWorker({ loopId: 'w0', lineageId: 'W0', wakeMarker: 'blocked', waitingMessage: WAIT_TEXT }),
      ...Array.from({ length: MAX_STAMP_LOOP_IDS }, (_, i) => joinedWorker({ loopId: `w${i + 1}`, lineageId: `W${i + 1}` })),
      joinedAutopilot()
    ]
  }),
  supersededAndNonWaiting: () => ({
    loops: [blocked({ loopId: 'a' }), loop({ loopId: 'b', followUpTo: 'a' }), blocked({ loopId: 'c' })]
  })
};

// The agreement property, written against outputs only: every waiting loop of a
// waiting run is open (its ruling row speaks for it) or its run gets a compact row,
// and every loop a ruling row stamps is open. Shelving hides a row, never the loop.
function assertAgreement(payloads, rows, openIds, compact) {
  const compactRuns = new Set(compact.map(r => String(r.sessionId)));
  for (const s of payloads) {
    if (s.status !== 'waiting') continue;
    for (const id of s.waitingLoopIds) {
      assert.ok(openIds.has(id) || compactRuns.has(String(s.sessionId)), `waiting loop ${id} is shown on the block`);
    }
  }
  for (const row of rows) {
    for (const id of row.stampLoopIds ?? [row.stampLoopId]) assert.ok(openIds.has(id), `row stamp ${id} is in the open set`);
  }
}

const { compactWaitSessions: compactOverBuilder } = makeSandbox().module.exports;

// Runs the block's whole rule over one loop set, and checks agreement before returning.
function runBlock({ loops, shelved = [] }) {
  const bySession = new Map();
  for (const l of loops) {
    if (!bySession.has(l.sessionId)) bySession.set(l.sessionId, []);
    bySession.get(l.sessionId).push(l);
  }
  const payloads = plain([...bySession].map(([sessionId, sessionLoops]) =>
    buildSessionPayload({ sessionId, loops: sessionLoops }, WS, false)));
  const rows = collectUnansweredDecisions({ loops, shelvedRulings: shelved }, { now: NOW });
  const openIds = openDecisionLoopIds(loops);
  const compact = plain(compactOverBuilder(payloads, openIds));
  assertAgreement(payloads, rows, openIds, compact);
  return { payloads, rows, openIds: [...openIds].sort(), compact };
}

describe('the waiting block over the real builder (LIN-3983, step 8)', () => {
  test('(1) a day-dead wait gets no compact row: the run is stale, though its wait flag is set (F5.1)', () => {
    const { payloads, compact } = runBlock(FIXTURES.dayDead());
    assert.equal(payloads[0].status, 'stale');
    assert.equal(payloads[0].waiting, true, 'the wait flag is not gated on staleness, so the gate is on status');
    assert.deepEqual(compact, []);
  });

  test('(2) a shelved question: no ruling row and no compact row, the same as before the shelve (F1)', () => {
    const before = runBlock({ loops: FIXTURES.shelved().loops });
    const after = runBlock(FIXTURES.shelved());
    assert.equal(before.rows.length, 1);
    assert.equal(after.rows.length, 0, 'the shelve hides the row');
    assert.deepEqual(after.openIds, ['p'], 'the open set is shelf-free');
    assert.deepEqual(after.openIds, before.openIds);
    assert.deepEqual(after.compact, before.compact);
    assert.deepEqual(after.compact, [], 'the shelved wait is not a compact row');
  });

  test('(3) a message-less open question: one ruling row, no compact row, and still none once shelved (F5.2)', () => {
    const open = runBlock(FIXTURES.messageLessOpen());
    assert.equal(open.rows.length, 1);
    assert.deepEqual(open.compact, []);
    const shelvedNow = runBlock({ ...FIXTURES.messageLessOpen(), shelved: [shelfFor('d-1', 'p')] });
    assert.equal(shelvedNow.rows.length, 0);
    assert.deepEqual(shelvedNow.compact, []);
  });

  test('(4) a message-less wait with no question: one compact row with the fixed fallback (no message)', () => {
    const { rows, compact } = runBlock(FIXTURES.messageLessPlain());
    assert.equal(rows.length, 0);
    assert.equal(compact.length, 1);
    assert.equal(compact[0].message, '');
  });

  test('(5) a plain producer and another loop with a ruling row: the producer gets its row once, the ruling once (F4)', () => {
    const { payloads, rows, openIds, compact } = runBlock(FIXTURES.producerPlainOtherOpen());
    assert.equal(payloads[0].producerLoopId, 'a');
    assert.deepEqual(openIds, ['b']);
    assert.equal(rows.length, 1, 'one ruling row, for b');
    assert.equal(compact.length, 1, 'one compact row, for the run');
    assert.equal(compact[0].message, PLAIN_TEXT, 'a is not covered, so its message shows');
  });

  test('(6) a question dismissed through the dismiss route, on a run still blocked: one compact row, no ruling row (F6)', () => {
    const { rows, openIds, compact } = runBlock(FIXTURES.dismissed());
    assert.equal(rows.length, 0);
    assert.deepEqual(openIds, []);
    assert.equal(compact.length, 1);
    assert.equal(compact[0].message, PLAIN_TEXT);
  });

  test('(7) a question withdrawn, then a plain [blocked]: the run gets its compact row with the new message', () => {
    const { rows, openIds, compact } = runBlock(FIXTURES.withdrawnThenPlain());
    assert.equal(rows.length, 0);
    assert.deepEqual(openIds, []);
    assert.equal(compact.length, 1);
    assert.equal(compact[0].message, 'a plain wait now');
  });

  test('(8) an answer with no follow-up dispatch that ever landed: no ruling row, one compact row, the card says waiting (F6)', () => {
    const { payloads, rows, openIds, compact } = runBlock(FIXTURES.answeredNoFollowUp());
    assert.equal(rows.length, 0);
    assert.deepEqual(openIds, []);
    assert.equal(payloads[0].status, 'waiting');
    assert.equal(compact.length, 1);
  });

  test('(9) an answer stamped on a sibling loop of the lineage: the producer leaves the open set and gets its compact row (F6)', () => {
    const { rows, openIds, compact } = runBlock(FIXTURES.siblingAnswered());
    assert.equal(rows.length, 0);
    assert.deepEqual(openIds, []);
    assert.equal(compact.length, 1);
    assert.equal(compact[0].message, PLAIN_TEXT);
  });

  test('(10) pressing Dismiss on a block ruling row with the run still blocked: the row leaves and one compact row appears (F6)', () => {
    const before = runBlock({ loops: [blocked({ loopId: 'p', decision: decision() })] });
    const after = runBlock({ loops: [blocked({ loopId: 'p', decision: decision(), answeredDecisions: answered('d-1', 'dismissed') })] });
    assert.equal(before.rows.length, 1);
    assert.equal(before.compact.length, 0);
    assert.equal(after.rows.length, 0);
    assert.equal(after.compact.length, 1, 'exactly one compact row');
  });

  test('(11) a joined cluster answered on the worker copy only, the autopilot still blocked: one compact row, no ruling row (F7)', () => {
    const { rows, openIds, compact, payloads } = runBlock(FIXTURES.joinedAnsweredOnWorker());
    assert.equal(rows.length, 0);
    assert.deepEqual(openIds, [], 'the answer closes the joined row, so the autopilot is not open');
    assert.equal(payloads[0].producerLoopId, 'ap');
    assert.equal(compact.length, 1);
    assert.equal(compact[0].message, PLAIN_TEXT);
  });

  test('(12) a joined cluster with the worker withdrawn and the autopilot open: one joined row, both open, no compact row (F7)', () => {
    const { rows, openIds, compact, payloads } = runBlock(FIXTURES.joinedWithdrawnWorker());
    assert.equal(rows.length, 1, 'one joined row');
    assert.deepEqual(openIds, ['ap', 'w']);
    assert.deepEqual(payloads[0].waitingLoopIds, ['w']);
    assert.deepEqual(compact, [], 'the withdrawn worker is open with its cluster, so its row speaks for it');
  });

  test('(13) a cluster with more copies than MAX_STAMP_LOOP_IDS: the open set holds every copy, the row caps its stamps, the block is unchanged', () => {
    const { rows, openIds, compact } = runBlock(FIXTURES.joinedOverStampCap());
    assert.equal(openIds.length, MAX_STAMP_LOOP_IDS + 2, 'every copy and the autopilot');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].stampLoopIds.length, MAX_STAMP_LOOP_IDS);
    assert.deepEqual(compact, [], 'the compact-row decision reads cluster members, not the stamp list');
  });

  test('waitingLoopIds names the live waits: a superseded loop and a non-waiting loop are both left out', () => {
    const { payloads } = runBlock(FIXTURES.supersededAndNonWaiting());
    assert.deepEqual(payloads[0].waitingLoopIds, ['c']);
  });

  test('waitingLoopIds names the one wait of a run that is waiting', () => {
    const { payloads } = runBlock({ loops: [blocked({ loopId: 'p' })] });
    assert.deepEqual(payloads[0].waitingLoopIds, ['p']);
  });

  test('waitingLoopIds is empty for a run that is not waiting', () => {
    const { payloads } = runBlock({ loops: [loop({ loopId: 'p' })] });
    assert.deepEqual(payloads[0].waitingLoopIds, []);
    assert.equal(payloads[0].waiting, false);
  });

  test('waitingLoopIds is empty for a finished run, even with a lingering [blocked] loop', () => {
    const { payloads } = runBlock({ loops: [blocked({ loopId: 'p', agentState: 'complete' })] });
    assert.equal(payloads[0].waiting, false);
    assert.deepEqual(payloads[0].waitingLoopIds, []);
  });

  test('the agreement property holds over every fixture above', () => {
    for (const build of Object.values(FIXTURES)) runBlock(build());
  });
});

describe('the waiting accent is the strongest on the page (LIN-3983, outcome 1)', () => {
  const CSS = readFileSync(join(__dirname, '../../public/observation.css'), 'utf8');
  const ruleBody = (selector) => {
    const escaped = selector.replace(/[.[\]"=]/g, '\\$&');
    const match = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    return match ? match[1] : null;
  };

  test('a waiting card has its own, thicker accent, and it is not the in-progress amber', () => {
    const body = ruleBody('.obs-session[data-status="waiting"]');
    assert.ok(body, 'a waiting-card accent rule exists');
    assert.match(body, /border-left-width:\s*4px/);
    assert.doesNotMatch(body, /--amber/);
    assert.notEqual(ruleBody('.obs-session[data-status="in-progress"]'), null);
  });

  test('the waiting block is not amber either, so the card that needs a person is not the quietest', () => {
    const body = ruleBody('.obs-waiting');
    assert.ok(body, 'the block rule exists');
    assert.doesNotMatch(body, /--amber/);
    assert.match(body, /border-left:\s*4px solid var\(--brand\)/);
  });
});
