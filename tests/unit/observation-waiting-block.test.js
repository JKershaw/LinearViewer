/**
 * LIN-3983 PR 1: the Observation waiting block and the view/filter model.
 *
 *   - compactWaitSessions: which waiting runs the waiting line counts beside the
 *     questions. The cases here are the ones the plan named (day-dead, open
 *     questions, message-less waits, a producer covered while another loop waits).
 *   - viewFromParams: the URL contract, including the old `?view=` values
 *     (`?view=rulings` opens the Questions tab, LIN-4553).
 *   - the line's paint (one line since LIN-4553: "N questions waiting →" and
 *     "N runs waiting →"), the three openLoopIds states, and the URL written
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
  <p id="obs-waiting" hidden>
    <a id="obs-waiting-questions" href="?view=questions" hidden></a>
    <span id="obs-waiting-sep" hidden></span>
    <a id="obs-waiting-runs" href="?filter=all" hidden></a>
  </p>
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

describe('compactWaitSessions — which waiting runs the line counts (LIN-3983, LIN-4553)', () => {
  test('a waiting run whose only wait is not an open question is counted, with its run and title', async () => {
    const world = await makeWorld();
    const { compactWaitSessions } = world.page;
    const rows = compactWaitSessions([waitingSession()], new Set());
    assert.deepEqual(plain(rows), [{ sessionId: 's-1', workspaceUrlKey: 'acme', title: 'Remove the old route' }]);
  });

  test('a wait whose loop is an open question is not counted: the question count speaks for it', async () => {
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

  test('a message-less wait is still counted', async () => {
    const world = await makeWorld();
    const { compactWaitSessions } = world.page;
    const rows = compactWaitSessions([waitingSession({ waitingMessage: null, producerLoopId: null })], new Set());
    assert.equal(rows.length, 1);
  });

  test('when the producer is covered by a question but another loop of the run waits, the run is counted', async () => {
    const world = await makeWorld();
    const { compactWaitSessions } = world.page;
    const session = waitingSession({ waitingLoopIds: ['loop-p', 'loop-b'] });
    const rows = compactWaitSessions([session], new Set(['loop-p']));
    assert.equal(rows.length, 1, 'loop-b is not covered, so the run is counted');
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

  test('?view=questions opens the Questions tab, and the old ?view=rulings still does (LIN-4553)', async () => {
    assert.deepEqual(plain(parse('view=questions')), { view: 'questions', filter: 'autopilot' });
    assert.deepEqual(plain(parse('view=rulings')), { view: 'questions', filter: 'autopilot' });
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

// LIN-4553: a question row as the rulings feed sends it.
const questionRow = (n) => ({
  kind: 'question', questionId: `q-${n}`, short: `Q${n}?`, asks: `Q${n}?`, question: `Q${n}?`, options: [], state: 'resumable', interactive: true,
  ticket: `LIN-${n}`, title: `Task ${n}`,
  anchor: { workspaceUrlKey: 'acme', taskId: `task-${n}`, runId: `run-${n}`, loopId: null, issueId: null, issueIdentifier: `LIN-${n}`, target: null }
});

describe('the waiting line paint (LIN-3983, one line since LIN-4553)', () => {
  test('waitingLineWords: counts in words, singular and plural, and where the runs link goes', async () => {
    const world = await makeWorld();
    const { waitingLineWords } = world.page;
    assert.deepEqual(plain(waitingLineWords({ questions: 0, runs: [] })), { questions: '', runs: '', runHref: null });
    assert.deepEqual(plain(waitingLineWords({ questions: 1, runs: [] })), { questions: '1 question waiting →', runs: '', runHref: null });
    const one = [{ sessionId: 's-1', workspaceUrlKey: 'acme', title: 'x' }];
    assert.deepEqual(plain(waitingLineWords({ questions: 5, runs: one })),
      { questions: '5 questions waiting →', runs: '1 run waiting →', runHref: '/workspace/acme/observation/session/s-1' });
    const two = [...one, { sessionId: 's-2', workspaceUrlKey: 'acme', title: 'y' }];
    assert.equal(waitingLineWords({ questions: 0, runs: two }).runHref, null, 'several runs link to the All filter, not to one run');
  });

  test('the line is absent when nothing waits', async () => {
    const world = await makeWorld();
    const { renderWaitingBlock, setOpenLoopIds } = world.page;
    setOpenLoopIds(new Set());
    renderWaitingBlock();
    assert.equal(byId(world, 'obs-waiting').hidden, true);
  });

  test('a waiting run no question speaks for is counted on the line, linking to its run page', async () => {
    const world = await makeWorld();
    const { renderWaitingBlock, setOpenLoopIds, sessionIndex } = world.page;
    sessionIndex.set('s-1', waitingSession());
    setOpenLoopIds(new Set());
    renderWaitingBlock();
    assert.equal(byId(world, 'obs-waiting').hidden, false);
    const runs = byId(world, 'obs-waiting-runs');
    assert.equal(runs.hidden, false);
    assert.equal(runs.textContent, '1 run waiting →');
    assert.equal(runs.getAttribute('href'), '/workspace/acme/observation/session/s-1');
    assert.equal(byId(world, 'obs-waiting-questions').hidden, true, 'no question waits, so no question count');
    assert.equal(byId(world, 'obs-waiting-sep').hidden, true);
  });

  test('no waiting run is counted while openLoopIds is still loading (null), so none double-counts a question', async () => {
    const world = await makeWorld();
    const { renderWaitingBlock, sessionIndex } = world.page;
    sessionIndex.set('s-1', waitingSession());
    renderWaitingBlock();
    assert.equal(byId(world, 'obs-waiting').hidden, true);
    assert.equal(byId(world, 'obs-waiting-runs').hidden, true);
  });

  test('off the runs view the line is hidden, whatever it holds', async () => {
    const world = await makeWorld();
    const { renderWaitingBlock, setOpenLoopIds, sessionIndex, switchView } = world.page;
    sessionIndex.set('s-1', waitingSession());
    setOpenLoopIds(new Set());
    renderWaitingBlock();
    assert.equal(byId(world, 'obs-waiting').hidden, false);
    switchView('questions');
    assert.equal(byId(world, 'obs-waiting').hidden, true);
  });

  test('a failed first rulings read settles openLoopIds to empty, so waiting runs are still counted', async () => {
    const world = await makeWorld({ fetchImpl: async () => jsonResponse({}, { ok: false, status: 500 }) });
    const { pollRulings, sessionIndex, getOpenLoopIds } = world.page;
    sessionIndex.set('s-1', waitingSession());
    assert.equal(getOpenLoopIds(), null);
    await pollRulings();
    await flush();
    assert.equal(getOpenLoopIds().size, 0, 'settled to the empty set');
    assert.equal(byId(world, 'obs-waiting').hidden, false, 'the run is still counted');
    assert.equal(byId(world, 'obs-poll-status').textContent, '', 'a line read never touches the live pill');
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

  test('five open questions are one line, "5 questions waiting →", and no card is drawn on Runs', async () => {
    const rows = [1, 2, 3, 4, 5].map(questionRow);
    const world = await makeWorld({ fetchImpl: async () => jsonResponse({ rulings: rows, openLoopIds: [] }) });
    const { pollRulings } = world.page;
    // The page's own rulings read fills the count, as it does on a load.
    await pollRulings();
    await flush();
    const line = byId(world, 'obs-waiting');
    assert.equal(line.hidden, false);
    const questions = byId(world, 'obs-waiting-questions');
    assert.equal(questions.hidden, false);
    assert.equal(questions.textContent, '5 questions waiting →');
    assert.equal(line.querySelectorAll('[data-testid="question-record-card"]').length, 0, 'the cards are on the Questions tab only');
    assert.equal(byId(world, 'obs-rulings').children.length, 0, 'the Questions tab is not painted from the Runs view');
  });

  test('"N questions waiting →" opens the Questions tab in place, which then draws every card', async () => {
    const rows = [1, 2].map(questionRow);
    const world = await makeWorld({ fetchImpl: async () => jsonResponse({ rulings: rows, openLoopIds: [] }) });
    const { pollRulings } = world.page;
    await pollRulings();
    await flush();
    // The page's own boot bound the line's links (initControls); the click is handled in place.
    await clickOn(byId(world, 'obs-waiting-questions'));
    await flush();
    assert.match(world.replaced.at(-1), /[?&]view=questions/);
    assert.equal(byId(world, 'obs-waiting').hidden, true);
    assert.equal(byId(world, 'obs-rulings').children.length, 2);
  });

  test('questions and an uncovered waiting run share the one line, with a separator', async () => {
    const world = await makeWorld({ fetchImpl: async () => jsonResponse({ rulings: [questionRow(1)], openLoopIds: [] }) });
    const { pollRulings, sessionIndex } = world.page;
    sessionIndex.set('s-1', waitingSession());
    await pollRulings();
    await flush();
    assert.equal(byId(world, 'obs-waiting-questions').textContent, '1 question waiting →');
    assert.equal(byId(world, 'obs-waiting-runs').textContent, '1 run waiting →');
    assert.equal(byId(world, 'obs-waiting-sep').hidden, false);
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
    switchView('questions');
    assert.match(world.replaced.at(-1), /[?&]view=questions/);
    switchView('runs');
    assert.doesNotMatch(world.replaced.at(-1), /view=|filter=/);
    setFilter('standalone');
    assert.match(world.replaced.at(-1), /[?&]filter=standalone/);
  });

  test('the URL keeps the other parameters the page was opened with', async () => {
    const world = await makeWorld({ href: 'https://harbour.test/workspace/acme/observation?source=x' });
    const { switchView } = world.page;
    switchView('questions');
    assert.match(world.replaced.at(-1), /source=x/);
    assert.match(world.replaced.at(-1), /view=questions/);
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
    switchView('questions');
    await flush();
    calls = 0; // count only the supplement's own reads below
    await pollWaitingSupplement();
    await pollWaitingSupplement();
    assert.equal(calls, 0, 'off the autopilot filter the supplement never fetches');
    switchView('runs');
    setFilter('autopilot');
    await flush();
    switchView('questions');
    await flush();
    calls = 0; // the Questions tab's own poll is not the supplement's
    await pollWaitingSupplement();
    assert.equal(calls, 0, 'on the Questions view the supplement never fetches');
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

  test('on the standalone filter an autopilot run waiting on a plain [blocked] stays on the line (decision 8(i))', async () => {
    const autopilotWait = waitingSession({ sessionId: 'ap-1', standalone: false, waitingLoopIds: ['loop-ap'], producerLoopId: 'loop-ap' });
    const world = await makeWorld({
      fetchImpl: async () => jsonResponse({ active: [autopilotWait], recent: [], rulings: [] })
    });
    const { setFilter, setOpenLoopIds } = world.page;
    setOpenLoopIds(new Set());
    setFilter('standalone'); // the filter change polls the feed, which fills the block's session list
    await flush();
    const block = byId(world, 'obs-waiting');
    assert.equal(block.hidden, false, 'the line is shown on the standalone filter');
    assert.equal(byId(world, 'obs-waiting-runs').getAttribute('href'), '/workspace/acme/observation/session/ap-1');
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

  test('the waiting line is not amber either, so what needs a person is not the quietest', async () => {
    const body = appliedDecls(OBSERVATION, '.obs-waiting');
    assert.doesNotMatch([...body.values()].join(' '), /--amber/);
    assert.equal(body.get('border-left'), '4px solid var(--brand)');
  });
});
