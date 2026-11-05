/**
 * LIN-4242 — Home's "Waiting on you" goes live: the shared fragment, the one tick, and the owner's hidden-but-present section.
 *
 * - The page's reduction and the live fragment read one function (`createWaitingStanding`), so the rows the page draws and
 *   the rows the fragment answers with are the same, including a ruling just outside the read window.
 * - `renderWaitingSection` draws the owner's section always (hidden when empty), and nothing for a non-owner.
 * - One rulings tick: one interval after load, and the interval and the visibilitychange path both run the badge update and
 *   then the registered listeners, once each, and a hidden tab skips the interval's tick.
 *
 * The keyed merge itself (public/question-cards.js mergeWaitingCards) and the live section are exercised in a real browser by
 * tests/e2e/lin-4242-waiting-live.spec.js, where the DOM is real.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { withHarnessModels } from '../fixtures/harness-models.js';
import { createHomeRowStates, createWaitingStanding } from '../../lib/home-row-states.js';
import { renderWaitingSection } from '../../lib/waiting-section.js';
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
  decision: { decision_id: `d-${identifier}`, question: `Which for ${identifier}?` }, decisionCase: [], answeredDecisions: [], withdrawal: null, ...over,
});

function deps(loops) {
  return {
    getLoopsForWorkspace: async () => loops,
    dispatchStore: {},
    agentStatusStore: {},
    taskDecisionsStore: { listUnansweredForWorkspaces: async () => [], listNewestScanPerTask: async () => ({}) },
    shelvedRulingsStore: { listForWorkspaces: async () => [] },
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
    assert.ok(!ruling.rows.some(row => row.anchor.issueIdentifier === 'LIN-3'), 'the ruling outside the window is in neither');
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

  test('the owner with rulings gets a visible section, one keyed card per ruling, in server order', () => {
    const html = renderWaitingSection({ rows: [row('LIN-1'), row('LIN-2')] }, { urlKey: 'ws', owner: true });
    assert.doesNotMatch(html, /waiting-section hidden/);
    const wrappers = html.match(/<div class="waiting-card">/g) || [];
    assert.equal(wrappers.length, 2);
    assert.ok(html.indexOf('LIN-1') < html.indexOf('LIN-2'), 'server order is kept');
    assert.match(html, /data-testid="session-question-card"/);
  });

  test('a member (not the owner) gets nothing at all, and no ruling text', () => {
    assert.equal(renderWaitingSection({ rows: [row('LIN-1')] }, { urlKey: 'ws', owner: false }), '');
    assert.equal(renderWaitingSection({ rows: [] }, { urlKey: 'ws', owner: false }), '');
  });
});

/**
 * Loads public/common.js into a vm with a recording fake window, document and timer, then runs its own rulings-badge
 * startup (the function the DOMContentLoaded handler calls). The badge element is present, so the poll starts.
 */
function loadCommon() {
  const intervals = [];
  const docListeners = {};
  const badge = { dataset: { urlKey: 'ws' }, querySelector: () => ({ textContent: '', classList: { toggle() {} } }), classList: { toggle() {} } };
  const fetches = [];
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval: () => {},
    fetch: (url) => { fetches.push(String(url)); return Promise.resolve({ ok: true, json: () => Promise.resolve({ workspaceCount: 3 }) }); },
    document: {
      hidden: false,
      addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
      querySelector: (sel) => (sel === '[data-rulings-badge]' ? badge : null),
      querySelectorAll: () => [],
      createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, style: {}, setAttribute() {}, addEventListener() {}, appendChild() {} }),
      body: { appendChild() {} },
    },
    window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
  };
  sandbox.window.document = sandbox.document;
  vm.createContext(sandbox);
  vm.runInContext(withHarnessModels(COMMON_JS_SRC), sandbox, { filename: 'common.js' });
  return { sandbox, intervals, docListeners, fetches };
}

describe('LIN-4242: one rulings tick, through one path', () => {
  test('startup starts a single interval; a tick runs the badge update, then each listener once, with the urlKey', () => {
    const { sandbox, intervals, fetches } = loadCommon();
    const seen = [];
    sandbox.window.onRulingsTick((urlKey) => seen.push(['a', urlKey]));
    sandbox.window.onRulingsTick((urlKey) => seen.push(['b', urlKey]));
    vm.runInContext('initRulingsBadge()', sandbox);
    vm.runInContext('initRulingsBadge()', sandbox); // a second startup does not start a second interval
    assert.equal(intervals.length, 1, 'one interval after load');
    assert.equal(intervals[0].ms, 5000);
    intervals[0].fn();
    assert.deepEqual(seen, [['a', 'ws'], ['b', 'ws']], 'each listener runs once, with the urlKey');
    assert.ok(fetches.some(url => url.includes('/api/dashboard/rulings')), 'the badge update ran first');
  });

  test('a hidden tab skips the interval tick; a listener that throws does not stop the others', () => {
    const { sandbox, intervals, docListeners } = loadCommon();
    const seen = [];
    sandbox.window.onRulingsTick(() => { throw new Error('boom'); });
    sandbox.window.onRulingsTick(() => seen.push('after-throw'));
    vm.runInContext('initRulingsBadge()', sandbox);
    sandbox.document.hidden = true;
    intervals[0].fn();
    assert.deepEqual(seen, [], 'no tick while hidden');
    sandbox.document.hidden = false;
    intervals[0].fn();
    assert.deepEqual(seen, ['after-throw']);
  });

  test('visibilitychange runs the same tick as the interval (badge, then the listeners), and adds no timer', () => {
    const { sandbox, intervals, docListeners, fetches } = loadCommon();
    const seen = [];
    sandbox.window.onRulingsTick((urlKey) => seen.push(urlKey));
    vm.runInContext('initRulingsBadge()', sandbox);
    const before = fetches.length;
    const visibility = docListeners.visibilitychange;
    assert.equal(visibility.length, 1);
    visibility[0]();
    assert.deepEqual(seen, ['ws'], 'the listener runs from the visibility path too');
    assert.equal(fetches.length, before + 1, 'and the badge is updated first, by the same tick');
    assert.equal(intervals.length, 1, 'still one interval');
  });
});
