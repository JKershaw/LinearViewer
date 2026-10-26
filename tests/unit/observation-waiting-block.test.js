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

  test('a day-dead run never gets a row, since its status is idle, not waiting (LIN-608)', () => {
    const { module } = makeSandbox();
    const { compactWaitSessions } = module.exports;
    assert.deepEqual(plain(compactWaitSessions([waitingSession({ status: 'stale', waiting: false })], new Set())), []);
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
});
