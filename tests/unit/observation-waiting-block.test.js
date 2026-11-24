/**
 * LIN-3983 PR 1: the Observation waiting block and the view/filter model.
 *
 *   - compactWaitSessions: which waiting runs get a compact row, and its text.
 *     The rule is the one the block ships, so the cases here are the ones the
 *     plan named (day-dead, open questions, message-less waits,
 *     a producer covered while another loop waits).
 *   - viewFromParams: the URL contract, including the old `?view=` values.
 *   - the block's paint, the three openLoopIds states, and the URL written
 *     when the view or filter moves.
 *
 * `public/observation.js` is a native ES module (LIN-4463 piece 4), loaded fresh per test through `importWorld`
 * (tests/unit/helpers/import-world.js) over the shared fake DOM (tests/unit/helpers/fake-dom.js). The page boots the way
 * a browser boots it: its data is on `window`, and its own DOMContentLoaded init runs, so the view, scope and filter
 * come from the page itself. The boot runs with the tab hidden, as a background tab's does, so the page's pollers make
 * no read and the open set stays null until a test reads it.
 * Run with: node --test tests/unit/observation-waiting-block.test.js
 */
import { test, describe, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readSheets, appliedDecls } from '../helpers/css-rules.js';
import { importWorld } from './helpers/import-world.js';
import { clickOn, fireDOMContentLoaded } from './helpers/client-world.js';
import { loadCommonWindow } from '../fixtures/client-common.js';

// Every world a test makes is put back after the test, last made first, so a stub a later world installed
// is removed before the earlier world's snapshot is restored.
const worlds = [];
afterEach(() => {
  while (worlds.length) worlds.pop().restore();
});

// The regions these tests paint, as the page draws them. Each is a real element in the world's document, found by
// the client with getElementById and read back by the test. The scope buttons and the active list are the feed's own
// controls: a scope press repaints the feed, which is how a card gets painted without a read.
const REGIONS_MARKUP = `
  <div id="obs-waiting" hidden></div>
  <div id="obs-waiting-rulings"></div>
  <div id="obs-waiting-runs"></div>
  <div id="obs-waiting-count"></div>
  <div id="obs-waiting-more" hidden></div>
  <div id="obs-rulings"></div>
  <div id="obs-rulings-empty"></div>
  <div id="obs-session-views"></div>
  <div id="obs-rulings-section"></div>
  <div id="obs-poll-status"></div>
  <div id="obs-view-hint"></div>
  <div id="obs-scope">
    <button type="button" data-scope="current"></button>
    <button type="button" data-scope="all"></button>
  </div>
  <ul id="obs-active"></ul>
  <p id="obs-active-empty"></p>`;

// The page's escapeHtml: quotes too, so a value written into an attribute cannot end it early.
const escapeHtml = (s) => (s == null ? '' : String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'));

const byId = (world, id) => world.document.getElementById(id);

// observation.js in a world over the shared fake, with the window stubs the page's own scripts supply. The
// location and history are the browser's, not DOM, so they stay as stubs; `world.replaced` holds every URL
// the client wrote with replaceState. `world.page` is the page's module, booted as a browser boots it.
async function makeWorld({ fetchImpl, href = 'https://harbour.test/workspace/acme/observation' } = {}) {
  const replaced = [];
  const common = loadCommonWindow();
  const world = importWorld({
    window: {
      addEventListener() {},
      matchMedia: () => ({ matches: false }),
      location: { href },
      history: { state: null, replaceState(state, title, url) { replaced.push(url); } },
      ChatUI: { appendOptions() {}, resolveCaption: () => '' },
      sourceQuery: () => '',
      renderStatusPill: common.renderStatusPill,
      renderSegmentBar: common.renderSegmentBar,
      api: async () => { throw new Error('window.api not stubbed'); }
    },
    globals: {
      escapeHtml,
      relativeTime: () => '',
      console: { warn() {}, error() {}, log() {} },
      fetch: fetchImpl || (async () => { throw new Error('no fetch stub configured'); })
    },
    timers: [],
  });
  worlds.push(world);
  world.document.body.innerHTML = REGIONS_MARKUP;
  world.replaced = replaced;
  world.window.__OBSERVATION_DATA__ = { urlKey: 'acme', workspaces: [{ urlKey: 'acme', name: 'Acme' }] };
  world.page = await world.importPage('observation.js');
  // The boot runs with the tab hidden: the page's pollers skip a hidden tab, so the boot makes no read.
  world.document.hidden = true;
  await fireDOMContentLoaded(world.document);
  world.document.hidden = false;
  return world;
}

// Values built inside the page's world carry that realm's prototypes, which
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
  test('removes the runner markers and leaves the words', async () => {
    const world = await makeWorld();
    const { stripFeedbackMarkers } = world.page;
    assert.equal(stripFeedbackMarkers('[blocked] need a ruling'), 'need a ruling');
    assert.equal(stripFeedbackMarkers('[done]  shipped [working]'), 'shipped');
  });
});

describe('compactWaitSessions — which waiting runs get a compact row (LIN-3983)', () => {
  test('a waiting run whose only wait is not an open question gets a row with its producer message', async () => {
    const world = await makeWorld();
    const { compactWaitSessions } = world.page;
    const rows = compactWaitSessions([waitingSession()], new Set());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sessionId, 's-1');
    assert.equal(rows[0].message, 'need a ruling before removing the route');
    assert.equal(rows[0].title, 'Remove the old route');
  });

  test('a wait whose loop is an open question gets no row: the ruling row speaks for it', async () => {
    const world = await makeWorld();
    const { compactWaitSessions } = world.page;
    assert.deepEqual(plain(compactWaitSessions([waitingSession()], new Set(['loop-p']))), []);
  });

  test('a day-dead run never gets a row: its status is stale, though its wait flag is still set (LIN-608, F5.1)', async () => {
    const world = await makeWorld();
    const { compactWaitSessions } = world.page;
    // `waiting` is not gated on staleness in the feed, so the real shape is stale AND waiting.
    assert.deepEqual(plain(compactWaitSessions([waitingSession({ status: 'stale', waiting: true })], new Set())), []);
  });

  test('a finished run never gets a row', async () => {
    const world = await makeWorld();
    const { compactWaitSessions } = world.page;
    assert.deepEqual(plain(compactWaitSessions([waitingSession({ status: 'done', waiting: false, waitingLoopIds: [] })], new Set())), []);
  });

  test('a message-less wait gets the fixed fallback text (no message)', async () => {
    const world = await makeWorld();
    const { compactWaitSessions } = world.page;
    const rows = compactWaitSessions([waitingSession({ waitingMessage: null, producerLoopId: null })], new Set());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].message, '');
  });

  test('when the producer is covered by a ruling but another loop of the run waits, the row shows the fallback', async () => {
    const world = await makeWorld();
    const { compactWaitSessions } = world.page;
    const session = waitingSession({ waitingLoopIds: ['loop-p', 'loop-b'] });
    const rows = compactWaitSessions([session], new Set(['loop-p']));
    assert.equal(rows.length, 1, 'loop-b is not covered, so the run gets a row');
    assert.equal(rows[0].message, '', 'the producer’s own question is on the ruling row, so the row does not repeat it');
  });

  test('a session from an older payload without waitingLoopIds gets no row rather than a wrong one', async () => {
    const world = await makeWorld();
    const { compactWaitSessions } = world.page;
    const old = waitingSession();
    delete old.waitingLoopIds;
    assert.deepEqual(plain(compactWaitSessions([old], new Set())), []);
  });
});

describe('viewFromParams — the URL contract, with the old tab names (LIN-3983)', () => {
  let viewFromParams;
  before(async () => { ({ viewFromParams } = (await makeWorld()).page); });
  const parse = (qs) => viewFromParams(new URLSearchParams(qs));

  test('a bare URL opens on runs with the autopilot filter', async () => {
    assert.deepEqual(plain(parse('')), { view: 'runs', filter: 'autopilot' });
  });

  test('the rulings view keeps its name', async () => {
    assert.deepEqual(plain(parse('view=rulings')), { view: 'rulings', filter: 'autopilot' });
  });

  test('a link to a retired tab opens on runs (LIN-4540)', async () => {
    assert.deepEqual(plain(parse('view=due')), { view: 'runs', filter: 'autopilot' });
  });

  test('?view=sessions (the old Sessions tab) opens on runs with the all filter', async () => {
    assert.deepEqual(plain(parse('view=sessions')), { view: 'runs', filter: 'all' });
  });

  test('?view=autopilot (the old Autopilot tab) opens on runs with the autopilot filter', async () => {
    assert.deepEqual(plain(parse('view=autopilot')), { view: 'runs', filter: 'autopilot' });
  });

  test('an explicit filter is read on runs, and an unknown one falls back', async () => {
    assert.deepEqual(plain(parse('filter=standalone')), { view: 'runs', filter: 'standalone' });
    assert.deepEqual(plain(parse('view=sessions&filter=standalone')), { view: 'runs', filter: 'standalone' });
    assert.deepEqual(plain(parse('filter=nonsense')), { view: 'runs', filter: 'autopilot' });
  });

  test('an unknown view opens on runs', async () => {
    assert.deepEqual(plain(parse('view=garbage')), { view: 'runs', filter: 'autopilot' });
  });
});

describe('the waiting block paint (LIN-3983)', () => {
  test('the block is absent when nothing waits', async () => {
    const world = await makeWorld();
    const { renderWaitingBlock, setOpenLoopIds } = world.page;
    setOpenLoopIds(new Set());
    renderWaitingBlock();
    assert.equal(byId(world, 'obs-waiting').hidden, true);
  });

  test('a waiting run with no ruling row shows as a compact row, under the runs view', async () => {
    const world = await makeWorld();
    const { renderWaitingBlock, setOpenLoopIds, sessionIndex } = world.page;
    sessionIndex.set('s-1', waitingSession());
    setOpenLoopIds(new Set());
    renderWaitingBlock();
    const block = byId(world, 'obs-waiting');
    assert.equal(block.hidden, false);
    assert.equal(byId(world, 'obs-waiting-count').textContent, '1');
    assert.match(byId(world, 'obs-waiting-runs').innerHTML, /data-session-id="s-1"/);
    assert.match(byId(world, 'obs-waiting-runs').innerHTML, /reply on its run page/);
  });

  test('no compact rows paint while openLoopIds is still loading (null), so none duplicates a ruling row', async () => {
    const world = await makeWorld();
    const { renderWaitingBlock, sessionIndex } = world.page;
    sessionIndex.set('s-1', waitingSession());
    renderWaitingBlock();
    assert.equal(byId(world, 'obs-waiting').hidden, true);
    assert.equal(byId(world, 'obs-waiting-runs').innerHTML, '', 'no compact row is painted');
  });

  test('off the runs view the block is hidden, whatever it holds', async () => {
    const world = await makeWorld();
    const { renderWaitingBlock, setOpenLoopIds, sessionIndex, switchView } = world.page;
    sessionIndex.set('s-1', waitingSession());
    setOpenLoopIds(new Set());
    renderWaitingBlock();
    assert.equal(byId(world, 'obs-waiting').hidden, false);
    switchView('rulings');
    assert.equal(byId(world, 'obs-waiting').hidden, true);
  });

  test('a failed first rulings read settles openLoopIds to empty, so waiting runs still get rows', async () => {
    const world = await makeWorld({ fetchImpl: async () => jsonResponse({}, { ok: false, status: 500 }) });
    const { pollRulings, sessionIndex, getOpenLoopIds } = world.page;
    sessionIndex.set('s-1', waitingSession());
    assert.equal(getOpenLoopIds(), null);
    await pollRulings();
    await flush();
    assert.equal(getOpenLoopIds().size, 0, 'settled to the empty set');
    assert.equal(byId(world, 'obs-waiting').hidden, false, 'the run is still shown');
    assert.equal(byId(world, 'obs-poll-status').textContent, '', 'a block read never touches the live pill');
  });

  test('a later rulings failure keeps the last open set', async () => {
    let ok = true;
    const world = await makeWorld({
      fetchImpl: async () => (ok
        ? jsonResponse({ rulings: [], openLoopIds: ['loop-p'] })
        : jsonResponse({}, { ok: false, status: 500 }))
    });
    const { pollRulings, getOpenLoopIds } = world.page;
    await pollRulings();
    await flush();
    ok = false;
    await pollRulings();
    await flush();
    assert.deepEqual([...getOpenLoopIds()], ['loop-p']);
  });

  test('the block shows at most three ruling rows and says how many more are on the Rulings tab', async () => {
    // LIN-4541: a ruling row is an open question record.
    const rows = [1, 2, 3, 4, 5].map(n => ({
      kind: 'question', questionId: `q-${n}`, asks: `Q${n}?`, question: `Q${n}?`, options: [], state: 'resumable', interactive: true,
      anchor: { workspaceUrlKey: 'acme', taskId: `task-${n}`, runId: `run-${n}`, loopId: null, issueId: null, issueIdentifier: `LIN-${n}`, target: null }
    }));
    const world = await makeWorld({ fetchImpl: async () => jsonResponse({ rulings: rows, openLoopIds: [] }) });
    const { renderWaitingBlock, setOpenLoopIds, pollRulings } = world.page;
    // The page's own rulings read fills the rows the block shows, as it does on a load.
    await pollRulings();
    await flush();
    setOpenLoopIds(new Set());
    renderWaitingBlock();
    assert.equal(byId(world, 'obs-waiting-rulings').children.length, 3);
    const more = byId(world, 'obs-waiting-more');
    assert.equal(more.hidden, false);
    assert.equal(more.textContent, '2 more in Rulings →');
  });
});

describe('the runs filter and the URL (LIN-3983)', () => {
  test('the autopilot filter reads the plain feed; the others read the sessions source', async () => {
    const world = await makeWorld();
    const { sessionsUrl, setFilter } = world.page;
    assert.equal(sessionsUrl('acme'), '/workspace/acme/api/dashboard/sessions');
    setFilter('standalone');
    assert.equal(sessionsUrl('acme'), '/workspace/acme/api/dashboard/sessions?view=sessions');
  });

  test('moving between standalone and all keeps the feed; moving to or from autopilot resets it', async () => {
    const world = await makeWorld();
    const { setFilter, sessionIndex, sessionsUrl } = world.page;
    setFilter('standalone');
    sessionIndex.set('s-1', waitingSession());
    setFilter('all');
    assert.equal(sessionIndex.size, 1, 'standalone → all shares a source, so the feed is kept');
    setFilter('autopilot');
    assert.equal(sessionIndex.size, 0, 'all → autopilot changes source, so the feed is torn down');
    assert.equal(sessionsUrl('acme'), '/workspace/acme/api/dashboard/sessions');
  });

  test('a view change writes the view into the URL, and a bare runs/autopilot view writes none', async () => {
    const world = await makeWorld();
    const { switchView, setFilter } = world.page;
    switchView('rulings');
    assert.match(world.replaced.at(-1), /[?&]view=rulings/);
    switchView('runs');
    assert.doesNotMatch(world.replaced.at(-1), /view=|filter=/);
    setFilter('standalone');
    assert.match(world.replaced.at(-1), /[?&]filter=standalone/);
  });

  test('the URL keeps the other parameters the page was opened with', async () => {
    const world = await makeWorld({ href: 'https://harbour.test/workspace/acme/observation?source=x' });
    const { switchView } = world.page;
    switchView('rulings');
    assert.match(world.replaced.at(-1), /source=x/);
    assert.match(world.replaced.at(-1), /view=rulings/);
  });

  test('a filter change that keeps the source re-polls that source', async () => {
    const calls = [];
    const world = await makeWorld({
      fetchImpl: async (url) => { calls.push(url); return jsonResponse({ active: [], recent: [], rulings: [] }); }
    });
    const { setFilter } = world.page;
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
    const world = await makeWorld({ fetchImpl: async () => { calls++; return jsonResponse({ active: [] }); } });
    const { pollWaitingSupplement, setFilter, switchView } = world.page;
    setFilter('standalone');
    switchView('rulings');
    await flush();
    calls = 0; // count only the supplement's own reads below
    await pollWaitingSupplement();
    await pollWaitingSupplement();
    assert.equal(calls, 0, 'off the autopilot filter the supplement never fetches');
    switchView('runs');
    setFilter('autopilot');
    await flush();
    switchView('rulings');
    await flush();
    calls = 0; // the rulings tab's own poll is not the supplement's
    await pollWaitingSupplement();
    assert.equal(calls, 0, 'on the rulings view the supplement never fetches');
  });

  test('on the autopilot filter it adds the standalone waits, and keeps the block as it was when it fails', async () => {
    let ok = true;
    const world = await makeWorld({
      fetchImpl: async () => (ok
        ? jsonResponse({ active: [waitingSession({ sessionId: 'sa-1' }), { ...waitingSession({ sessionId: 'ap-1' }), standalone: false }] })
        : jsonResponse({}, { ok: false, status: 500 }))
    });
    const { pollWaitingSupplement, standaloneWaitSupplement, setOpenLoopIds } = world.page;
    setOpenLoopIds(new Set());
    await pollWaitingSupplement();
    await flush();
    assert.deepEqual([...standaloneWaitSupplement.keys()], ['sa-1'], 'only standalone runs are added');
    assert.equal(byId(world, 'obs-waiting').hidden, false);
    ok = false;
    await pollWaitingSupplement();
    await flush();
    assert.deepEqual([...standaloneWaitSupplement.keys()], ['sa-1'], 'a failed read keeps what it had');
  });

  test('on the standalone filter an autopilot run waiting on a plain [blocked] stays in the block (decision 8(i))', async () => {
    const autopilotWait = waitingSession({ sessionId: 'ap-1', standalone: false, waitingLoopIds: ['loop-ap'], producerLoopId: 'loop-ap' });
    const world = await makeWorld({
      fetchImpl: async () => jsonResponse({ active: [autopilotWait], recent: [], rulings: [] })
    });
    const { setFilter, setOpenLoopIds } = world.page;
    setOpenLoopIds(new Set());
    setFilter('standalone'); // the filter change polls the feed, which fills the block's session list
    await flush();
    const block = byId(world, 'obs-waiting');
    assert.equal(block.hidden, false, 'the block is shown on the standalone filter');
    assert.match(byId(world, 'obs-waiting-runs').innerHTML, /data-session-id="ap-1"/);
  });
});

describe('the waiting accent is the strongest on the page (LIN-3983, outcome 1)', () => {
  // The sheets the observation page loads, in order; a rule is asked for by what applies to it (LIN-4015).
  const OBSERVATION = readSheets(['/style.css', '/observation.css']);

  test('a waiting card has its own, thicker accent, and it is not the in-progress amber', async () => {
    const body = appliedDecls(OBSERVATION, '.obs-session[data-status="waiting"]');
    assert.equal(body.get('border-left-width'), '4px');
    assert.doesNotMatch([...body.values()].join(' '), /--amber/);
    assert.ok(appliedDecls(OBSERVATION, '.obs-session[data-status="in-progress"]'), 'the in-progress card has a rule');
  });

  test('the waiting block is not amber either, so the card that needs a person is not the quietest', async () => {
    const body = appliedDecls(OBSERVATION, '.obs-waiting');
    assert.doesNotMatch([...body.values()].join(' '), /--amber/);
    assert.equal(body.get('border-left'), '4px solid var(--brand)');
  });
});
