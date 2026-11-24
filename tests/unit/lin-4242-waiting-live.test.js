/**
 * LIN-4242 — Home's "Waiting on you" goes live: the shared fragment, the one tick, and the owner's hidden-but-present section.
 *
 * - The page's reduction and the live fragment read one function (`createWaitingStanding`), so the rows the page draws and
 *   the rows the fragment answers with are the same, including a ruling just outside the read window.
 * - `renderWaitingSection` draws the owner's section always (hidden when empty), and nothing for a non-owner.
 * - One rulings tick: one interval after load, and the interval and the visibilitychange path both run the badge update and
 *   then the registered listeners, once each, and a hidden tab skips the interval's tick.
 *
 * - The page and the fragment are one markup over one reduction: for the same seeded state (zero, one, many, a ruling outside
 *   the window, a ruling the live-run guard drops), the page's section is the fragment's markup byte for byte, owner only.
 * - The cards take their task titles from the held issue set when it is warm (lib/open-questions.js `titlesFromIssues`, LIN-4549),
 *   else the card shows its task's identifier alone.
 *
 * The keyed merge itself (public/waiting-merge.js, which imports holdsCard itself) runs in a fake DOM in
 * tests/unit/lin-4242-waiting-merge.test.js; the live section runs in a real browser in tests/e2e/lin-4242-waiting-live.spec.js.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { withHarnessModels } from '../fixtures/harness-models.js';
import { loadWorld } from './helpers/client-world.js';
import { renderNavBar } from '../../lib/components/navbar.js';
import { createHomeRowStates, createWaitingStanding } from '../../lib/home-row-states.js';
import { renderWaitingSection } from '../../lib/waiting-section.js';
import { titlesFromIssues } from '../../lib/open-questions.js';
import '../../lib/providers/linear/index.js';
import { renderPage } from '../../lib/render.js';
import { questionRecordsOf, questionsFromLoops } from './helpers/question-records.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
const COMMON_JS_SRC = readFileSync(join(REPO, 'public/common.js'), 'utf8');

const NOW = new Date('2026-10-30T10:06:00.000Z');

function loop(over = {}) {
  return {
    loopId: 'l1', lineageId: 'l1', issueIdentifier: 'LIN-1', kind: 'implementation', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'running',
    dispatchedAt: '2026-10-30T10:00:00.000Z', takenAt: '2026-10-30T10:01:00.000Z', resolvedAt: '2026-10-30T10:01:00.000Z',
    terminalStatus: null, terminalCompletedAt: null, wakeMarker: 'pending', waitingMessage: null,
    feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null, bookkeeping: null,
    ...over,
  };
}
const rulingLoop = (identifier, over = {}) => loop({
  loopId: `r-${identifier}`, lineageId: `r-${identifier}`, issueIdentifier: identifier, agentState: 'complete',
  wakeMarker: 'blocked', waitingMessage: '[blocked] which way?',
  feedback: [{ message: '[blocked] which way?', timestamp: '2026-10-30T10:05:00.000Z' }],
  decision: { decision_id: `d-${identifier}`, question: `Which for ${identifier}?` }, decisionCase: [], withdrawal: null, ...over,
});

// LIN-4538: the standing and the person's question cards are read from question records (questionsFromLoops, one per loop
// that carries a decision); the dispatch store answers the asking run's state as a gone run.
function deps(loops) {
  return {
    getLoopsForWorkspace: async () => loops,
    dispatchStore: { isRunStopped: async () => false, runTailOf: async () => null },
    agentStatusStore: {},
    recordsStore: questionRecordsOf(questionsFromLoops(loops)),
    enrichLoop,
    deriveSessionWaiting,
    now: () => NOW,
    onError: () => {},
  };
}

describe('LIN-4242: the page and the live fragment read the Waiting set through one reduction', () => {
  test('the rows the page carries are the rows the fragment reads, and a ruling outside the read window is in neither', async () => {
    const inWindow = rulingLoop('LIN-1');
    const alsoInWindow = rulingLoop('LIN-2', { dispatchedAt: '2026-10-30T09:00:00.000Z' });
    const outside = rulingLoop('LIN-3', { dispatchedAt: '2020-01-01T00:00:00.000Z' });
    const loops = [inWindow, alsoInWindow, outside];
    const d = deps(loops);
    const standing = createWaitingStanding(d);
    const { ruling } = await standing({ urlKey: 'ws', at: NOW });
    const page = await createHomeRowStates({ ...d, waitingStanding: standing })({ urlKey: 'ws', issues: [], runControls: true });
    assert.ok(page, 'the page read succeeds');
    const keyOf = (row) => `${row.anchor.issueIdentifier}|${row.decision.decision_id}`;
    assert.deepEqual(page.rulingRows.map(keyOf), ruling.rows.map(keyOf),
      'the page and the fragment carry the same rulings, in the same order');
    assert.ok(ruling.rows.some(row => row.anchor.issueIdentifier === 'LIN-3'), 'a question still open is owed, whenever it was asked: counted, as P2b\'s question reads count it');
    assert.equal(page.rulingCount, ruling.rows.length);
  });

  test('a failed lean read leaves no rulings, on the page and in the fragment alike', async () => {
    const d = { ...deps([]), getLoopsForWorkspace: async () => { throw new Error('store down'); } };
    const standing = createWaitingStanding(d);
    const { ruling } = await standing({ urlKey: 'ws', at: NOW });
    assert.deepEqual(ruling.rows, []);
    const page = await createHomeRowStates({ ...d, waitingStanding: standing })({ urlKey: 'ws', issues: [], runControls: true });
    assert.ok(page, 'the page is still built');
    assert.equal(page.rulingCount, 0);
  });
});

describe('LIN-4242: the owner section is always drawn, hidden when empty; a non-owner gets none', () => {
  const row = (identifier) => ({
    decision: { decision_id: `d-${identifier}`, question: `Which for ${identifier}?` },
    decisionCase: [],
    anchor: { loopId: `r-${identifier}`, issueId: `id-${identifier}`, issueIdentifier: identifier, issueTitle: `Title ${identifier}`, workspaceUrlKey: 'ws', taskDecisionId: null },
    disposition: 'resumable',
    effect: 'resume',
    canReply: true,
  });

  test('the owner with zero rulings gets a hidden, empty section with its live body', () => {
    const html = renderWaitingSection({ rows: [] }, { urlKey: 'ws', owner: true });
    assert.match(html, /class="waiting-section hidden"/);
    assert.match(html, /data-testid="waiting-on-you"/);
    assert.match(html, /data-testid="waiting-body"/);
    assert.match(html, /data-url-key="ws"/);
    assert.doesNotMatch(html, /session-question-card/);
  });

  test('the owner with open questions gets a visible section, one card per question, in server order (LIN-4538)', () => {
    const html = renderWaitingSection({ rows: [], questions: [questionRow('LIN-1'), questionRow('LIN-2')] }, { urlKey: 'ws', owner: true });
    assert.doesNotMatch(html, /waiting-section hidden/);
    const wrappers = html.match(/<div class="waiting-question"/g) || [];
    assert.equal(wrappers.length, 2);
    assert.ok(html.indexOf('LIN-1') < html.indexOf('LIN-2'), 'server order is kept');
    assert.match(html, /data-testid="question-record-card"/);
  });

  test('a member (not the owner) gets nothing at all, and no question text', () => {
    assert.equal(renderWaitingSection({ questions: [questionRow('LIN-1')] }, { urlKey: 'ws', owner: false }), '');
    assert.equal(renderWaitingSection({ rows: [], questions: [] }, { urlKey: 'ws', owner: false }), '');
  });
});

/**
 * Loads public/common.js into a loadWorld over the fake DOM, with a recording setInterval and fetch, then runs its own
 * rulings-badge startup (initRulingsBadge, the function its DOMContentLoaded handler calls). The badge is the navbar's
 * real markup, so the poll starts when the badge exists.
 *
 * The world has no `CustomEvent`, and this suite does not add one. question-cards.js returns early without it
 * (question-cards.js:236, announceRulingGone), so that file's bubbling dispatchEvent stop is never reached from here.
 */
function loadCommon() {
  const intervals = [];
  const fetches = [];
  const world = loadWorld({
    scripts: [],
    window: {
      setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
      clearInterval: () => {},
      addEventListener() {},
      matchMedia: () => ({ matches: false }),
    },
    globals: {
      fetch: (url) => { fetches.push(String(url)); return Promise.resolve({ ok: true, json: () => Promise.resolve({ workspaceCount: 3 }) }); },
    },
  });
  world.run(withHarnessModels(COMMON_JS_SRC));
  world.document.body.innerHTML = renderNavBar({ workspaces: [], urlKey: 'ws', featureFlags: { runControls: true } });
  assert.equal(world.run('typeof CustomEvent'), 'undefined', 'the world has no CustomEvent');
  return { world, intervals, fetches };
}

describe('LIN-4242: one rulings tick, through one path', () => {
  test('startup starts a single interval; a tick runs the badge update, then each listener once, with the urlKey', () => {
    const { world, intervals, fetches } = loadCommon();
    const seen = [];
    world.window.onRulingsTick((urlKey) => seen.push(['a', urlKey]));
    world.window.onRulingsTick((urlKey) => seen.push(['b', urlKey]));
    world.run('initRulingsBadge()');
    world.run('initRulingsBadge()'); // a second startup does not start a second interval
    assert.equal(intervals.length, 1, 'one interval after load');
    assert.equal(intervals[0].ms, 5000);
    intervals[0].fn();
    assert.deepEqual(seen, [['a', 'ws'], ['b', 'ws']], 'each listener runs once, with the urlKey');
    assert.ok(fetches.some(url => url.includes('/api/dashboard/rulings')), 'the badge update ran first');
  });

  test('a hidden tab skips the interval tick; a listener that throws does not stop the others', () => {
    const { world, intervals } = loadCommon();
    const seen = [];
    world.window.onRulingsTick(() => { throw new Error('boom'); });
    world.window.onRulingsTick(() => seen.push('after-throw'));
    world.run('initRulingsBadge()');
    world.document.hidden = true;
    intervals[0].fn();
    assert.deepEqual(seen, [], 'no tick while hidden');
    world.document.hidden = false;
    intervals[0].fn();
    assert.deepEqual(seen, ['after-throw']);
  });

  test('visibilitychange runs the same tick as the interval (badge, then the listeners), and adds no timer', () => {
    const { world, intervals, fetches } = loadCommon();
    const seen = [];
    world.window.onRulingsTick((urlKey) => seen.push(urlKey));
    world.run('initRulingsBadge()');
    const before = fetches.length;
    const visibility = world.document.listenersOf('visibilitychange');
    assert.equal(visibility.length, 1);
    visibility[0]();
    assert.deepEqual(seen, ['ws'], 'the listener runs from the visibility path too');
    assert.equal(fetches.length, before + 1, 'and the badge is updated first, by the same tick');
    assert.equal(intervals.length, 1, 'still one interval');
  });
});

// ── Conformance: the page section and the live fragment (witness 3) ──────────

/** An open question, as the owner's section draws it (lib/open-questions.js openQuestionsFor's row; LIN-4538). */
const questionRow = (identifier) => ({
  questionId: `q-${identifier}`, asks: `Which for ${identifier}?`, options: ['a', 'b'], recommended: 'a', ifUnanswered: 'pick a',
  taskId: `task-${identifier}`, ticket: identifier, runId: `r-${identifier}`, askedAt: '2026-10-30T10:05:00.000Z',
  state: 'gone', reason: 'no-session', interactive: true,
});
const waitingRow = questionRow;

const SCENARIOS = {
  zero: { loops: [], expected: 0 },
  one: { loops: [rulingLoop('LIN-1')], expected: 1 },
  many: {
    loops: [rulingLoop('LIN-1'), rulingLoop('LIN-2', { dispatchedAt: '2026-10-30T09:00:00.000Z' }), rulingLoop('LIN-3')],
    expected: 3,
  },
  outsideWindow: { loops: [rulingLoop('LIN-1'), rulingLoop('LIN-4', { dispatchedAt: '2020-01-01T00:00:00.000Z' })], expected: 2 },
};

/** Home's page with the given rulings, as the page is built: the owner's flag decides the section. */
function pageHtmlFor(page, runControls) {
  const homeView = {
    inProgressTrees: [], trees: [], upNext: [], recent: { nodes: [], remaining: 0 },
    waiting: { rows: page.rulingRows, ids: page.rulingRows.map(r => r.anchor.issueIdentifier), contextIds: [], questions: page.questions },
  };
  return renderPage([], [], [], 'Org', { urlKey: 'ws', workspaces: [], featureFlags: { runControls }, homeView, rulingCount: page.rulingCount });
}

describe('LIN-4242 witness 3: the page section and the live fragment are one markup over one reduction', () => {
  for (const [name, { loops, expected }] of Object.entries(SCENARIOS)) {
    test(`${name}, owner: the page draws the fragment's markup byte for byte, with ${expected} card(s)`, async () => {
      // Witness: a page that reads the standing on its own without the live-run guard (the raw reduction, no predicate)
      // carries the liveGuard scenario's ruling with effect null, so the page and the fragment differ and this fails.
      const d = deps(loops);
      const standing = createWaitingStanding(d);
      const { ruling, questions } = await standing({ urlKey: 'ws', at: NOW, accountId: 'acct-owner' });
      const page = await createHomeRowStates({ ...d, waitingStanding: standing })({ urlKey: 'ws', issues: [], runControls: true, accountId: 'acct-owner' });
      assert.equal(questions.length, expected, 'the owner is asked the expected questions');
      assert.equal(page.questions.length, expected, 'the page carries the expected questions');
      assert.equal(page.rulingCount, expected, 'the count is the open questions');
      // The route's answer: renderWaitingSection over the same reads, with the held titles (none here, so the fallback).
      const fragment = renderWaitingSection({ rows: ruling.rows, questions: page.questions }, { urlKey: 'ws', owner: true });
      const html = pageHtmlFor(page, true);
      assert.ok(html.includes(fragment), 'the page section is the fragment markup, byte for byte');
      assert.equal((html.match(/data-testid="waiting-question"/g) || []).length, expected);
      if (expected === 0) assert.match(html, /class="waiting-section hidden" role="region"/, 'the empty owner section is drawn hidden');
    });
  }

  test('a member or a keyless owner gets no section on the page, and the fragment is never drawn for them', async () => {
    const d = deps(SCENARIOS.many.loops);
    const standing = createWaitingStanding(d);
    for (const runControls of [false, undefined]) {
      const page = await createHomeRowStates({ ...d, waitingStanding: standing })({ urlKey: 'ws', issues: [], runControls });
      assert.deepEqual(page.rulingRows, [], 'the page reads no rulings for them');
      const html = pageHtmlFor(page, runControls);
      assert.doesNotMatch(html, /data-testid="waiting-on-you"/);
      assert.doesNotMatch(html, /session-question-card/);
      assert.equal(renderWaitingSection({ questions: [waitingRow('LIN-1')] }, { urlKey: 'ws', owner: false }), '');
    }
  });
});

// LIN-4549: waitingTitlesOf moved into the one reader's lookup (lib/open-questions.js titlesFromIssues): the same rules, now the
// `titlesOf` every caller of openQuestionsFor passes. The card draws the title itself (lib/question-record-card.js).
describe('LIN-4242: the task lines take their titles from the held issue set when it is warm', () => {
  test('titlesFromIssues names only the wanted identifiers, first match wins, and a missing title is left out', () => {
    const issues = [
      { identifier: 'LIN-1', title: 'First title' },
      { identifier: 'LIN-1', title: 'Second title' },
      { identifier: 'LIN-2', title: undefined },
      { identifier: 'LIN-9', title: 'Not waiting' },
    ];
    assert.deepEqual({ ...titlesFromIssues(issues)(['LIN-1', 'LIN-2']) }, { 'LIN-1': 'First title' });
    assert.deepEqual({ ...titlesFromIssues(null)(['LIN-1']) }, {});
  });

  test('a waiting card reads its held title, and with none shows its identifier alone (no blank gap, no repeat)', () => {
    const held = renderWaitingSection({ questions: [{ ...waitingRow('LIN-1'), title: 'Held title' }] }, { urlKey: 'ws', owner: true });
    assert.match(held, /data-testid="question-record-card-task-title">Held title</);
    const cold = renderWaitingSection({ questions: [{ ...waitingRow('LIN-1'), title: null }] }, { urlKey: 'ws', owner: true });
    assert.match(cold, /data-testid="question-record-card-task-id">LIN-1</, 'the line names the ticket');
    assert.doesNotMatch(cold, /question-record-card-task-title/, 'and no title span when the title is unknown');
  });
});
