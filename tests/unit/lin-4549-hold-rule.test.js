/**
 * LIN-4549 (LIN-4546 piece 1, finding-7a603e81): one keep-a-card-across-a-repaint rule for the question card, on every host.
 *
 * Three hosts repaint a question card: Home's live Waiting refresh (the merge, public/waiting-merge.js; in beat 3 it was in
 * public/question-cards.js),
 * Observation's rulings poll (public/observation.js renderRulings), and Home's opened task (public/prompt-section.js, its state
 * poll). Each had its own rule for which card survives the repaint, and they disagreed. The one rule (public/question-records.js
 * holdsCard) keeps today's union: a card the reader has typed in, chosen an option on, holds focus in, whose controls are off
 * (a request out), whose answer is in flight, or that is settled ([data-settled]). An idle card is replaced.
 *
 * Each host is driven through its own real repaint, with a real question record card (lib/question-record-card.js) put in one
 * state, and the test asks whether the same node is still on the page afterwards. The states are the union's parts, one at a
 * time, plus the idle card the rule must let go. Before the rule was one, each host failed the states its own copy left out
 * (the report of LIN-4549 beat 3 lists them).
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { renderWaitingSection } from '../../lib/waiting-section.js';
import { renderQuestionRecordCard } from '../../lib/question-record-card.js';
import { escapeHtml } from '../../lib/utils/html.js';
import * as QR from '../../public/question-records.js';
import { createFakeDom } from './helpers/fake-dom.js';
import { importWorld } from './helpers/import-world.js';
import { promptSectionWorld } from './helpers/prompt-section-world.js';
import { serverSessions, serverRow } from '../fixtures/task-decision.js';

const row = (asks = 'Which way?') => ({
  questionId: 'q-1', asks, options: ['left', 'right'], recommended: 'left', ifUnanswered: 'pick left',
  taskId: 'task-1', ticket: 'LIN-1', runId: 'run-1', askedAt: '2026-11-24T09:00:00.000Z', state: 'resumable', reason: null, interactive: true,
});

/** The union's parts, each put on a card on its own. `kept` is what the one rule says. */
const STATES = {
  idle: { kept: false, apply() {} },
  'typed words': { kept: true, apply(card) { card.querySelector('[data-testid="question-record-card-input"]').value = 'half a sentence'; } },
  'a chosen option': {
    kept: true,
    apply(card) {
      const option = card.querySelectorAll('[data-testid="question-record-card-option"]')[1];
      option.setAttribute('aria-pressed', 'true');
      card.dataset.option = option.dataset.optionId;
    },
  },
  'focus inside': { kept: true, apply(card, document) { document.activeElement = card.querySelector('[data-testid="question-record-card-input"]'); } },
  'a disabled control': { kept: true, apply(card) { card.querySelectorAll('button, textarea').forEach((el) => { el.disabled = true; }); } },
  'an answer in flight': { kept: true, apply(card) { card.dataset.answerInFlight = 'true'; } },
  // The route refused this card's answer as settled elsewhere (`ruling-settled`): nothing is left for the reader to give, so even
  // its chosen option and focus on its Answer button do not hold it (tests/e2e/lin-4242-waiting-live.spec.js "a stale card").
  'refused as settled elsewhere (with a chosen option and focus)': {
    kept: false,
    apply(card, document) {
      STATES['a chosen option'].apply(card);
      document.activeElement = card.querySelector('[data-testid="question-record-card-answer"]');
      card.dataset.settledElsewhere = 'true';
    },
  },
  settled: {
    kept: true,
    apply(card) { card.dataset.settled = 'true'; card.querySelectorAll('button, textarea').forEach((el) => { el.disabled = true; }); },
  },
};

// Every world a test makes is put back after it, last made first.
const worlds = [];
afterEach(() => { while (worlds.length) worlds.pop().restore(); });

// ── Home: the live Waiting refresh ─────────────────────────────────────────
// The merge never re-renders a card the server still lists; the rule decides whether a card the server no longer lists (answered
// elsewhere, withdrawn) is taken out from under the reader. A Home card stays a `.waiting-question` wrapper.
// The merge is a module (public/waiting-merge.js, LIN-4549 beat 4) that asks the rule itself; a fresh instance per world.
let mergeInstance = 0;
async function homeWorld() {
  const dom = createFakeDom();
  dom.parse(renderWaitingSection({ rows: [], questions: [row()] }, { urlKey: 'ws', owner: true }), dom.document.body);
  const merge = await import(`../../public/waiting-merge.js?world=${mergeInstance += 1}`);
  return { document: dom.document, body: dom.document.querySelector('.waiting-body'), merge };
}

describe('LIN-4549 — Home: the live Waiting refresh keeps a card by the one rule', () => {
  for (const [name, state] of Object.entries(STATES)) {
    test(`${name}: ${state.kept ? 'kept' : 'taken out'} when the refresh no longer lists it`, async () => {
      const { document, body, merge } = await homeWorld();
      const wrapper = body.querySelector('.waiting-question');
      const card = wrapper.querySelector('[data-testid="question-record-card"]');
      state.apply(card, document);
      merge.mergeWaitingCards(body, renderWaitingSection({ rows: [], questions: [] }, { urlKey: 'ws', owner: true }));
      assert.equal(wrapper.isConnected, state.kept, `${name}: the card is ${state.kept ? 'still' : 'no longer'} on Home`);
      if (state.kept) assert.ok(wrapper.classList.contains('waiting-question'), 'a kept Home card stays a .waiting-question');
    });
  }
});

// ── Observation: the rulings poll ──────────────────────────────────────────

async function observationWorld() {
  const world = importWorld({
    window: { addEventListener() {}, matchMedia: () => ({ matches: false }), api: async () => ({}) },
    globals: {
      escapeHtml: (s) => (s == null ? '' : String(s)),
      relativeTime: (ts) => (ts ? `rel(${ts})` : ''),
      console: { warn() {}, error() {}, log() {} },
      fetch: async () => ({ ok: true, json: async () => ({}) }),
    },
    timers: [],
  });
  worlds.push(world);
  world.document.body.innerHTML = '<ul id="obs-rulings"></ul><p id="obs-rulings-empty"></p><ul id="obs-waiting-rulings"></ul>';
  world.page = await world.importPage('observation.js');
  return world;
}
const rulingRow = (asks) => ({ kind: 'question', ...row(asks), anchor: { workspaceUrlKey: 'ws', taskId: 'task-1', runId: 'run-1', issueIdentifier: 'LIN-1' } });

describe('LIN-4549 — Observation: the rulings poll keeps a card by the one rule', () => {
  for (const [name, state] of Object.entries(STATES)) {
    test(`${name}: ${state.kept ? 'kept' : 'rebuilt'} across the poll's repaint`, async () => {
      const world = await observationWorld();
      const list = world.document.getElementById('obs-rulings');
      world.page.renderRulings([rulingRow('Which way?')]);
      const li = list.children[0];
      state.apply(li.querySelector('[data-testid="question-record-card"]'), world.document);
      world.page.renderRulings([rulingRow('Which way, now?')]);
      assert.equal(list.children[0] === li, state.kept, `${name}: the poll ${state.kept ? 'kept' : 'rebuilt'} the row`);
    });
  }
});

// ── The opened task: Home's state poll ─────────────────────────────────────
const RUNNING = { loopId: 'loop-1', kind: 'implementation', label: 'Build', state: 'running', since: '2026-11-05T10:00:00.000Z', target: 'cli' };
const HOME = {
  filledRung: 'pr',
  urlKey: 'acme', surface: 'home', dispatchEnabled: true, runSetup: false, hasAI: true, aiState: 'ok', isLocalhost: false,
  promptMeta: { plan: 'Plan', implementation: 'implement', research: 'Research', scoping: 'Scoping', review: 'Review', 'plan-review': 'plan-review' },
  stageWords: { plan: 'Plan', implementation: 'Build', research: 'Research', scoping: 'Scoping', review: 'Review', 'plan-review': 'Plan review' },
  defaultPromptKeys: ['look-into', 'research', 'plan', 'implementation'],
  morePromptKeys: ['review', 'scoping', 'plan-review'],
  issue: { id: 'uuid-42', identifier: 'LIN-42', title: 'T', url: '', source: 'linear', stateType: 'started' },
  row: serverRow({ stateType: 'started' }),
};
const flush = () => new Promise((r) => setImmediate(r));
const flushN = async (n) => { for (let i = 0; i < n; i++) await flush(); };
const stateWith = (questionHtml) => ({
  status: 'running', live: true, homeStatusHtml: '', headerHtml: '', questionHtml,
  sessions: serverSessions({ count: 1, running: RUNNING, next: null, last: null, offered: null, busy: true, excluded: [] }),
});
const recordCard = (asks) => renderQuestionRecordCard(row(asks), { urlKey: 'acme' });

async function openedTask(t) {
  const timers = [];
  let current = stateWith(recordCard('Which way?'));
  const world = await promptSectionWorld(t, {
    window: {
      escapeHtml: (x) => (x == null ? '' : escapeHtml(String(x))),
      stripCodeBlockWrapper: (x) => x,
      renderMarkdown: (x) => String(x == null ? '' : x),
      api: async (url) => {
        if (url.includes('/api/task/')) return current;
        if (url.includes('/api/dispatch/preview')) return { kind: 'implementation', harness: 'claude-code', words: {}, sources: {}, group: null, description: '' };
        if (url.includes('/api/dispatch/decision-panel')) return { html: '', words: null, withoutEffort: [], targets: ['cli', 'web'], optionWords: { harness: {}, model: {} } };
        if (url.includes('/api/dispatch/presets')) return { presets: [] };
        if (url.includes('/api/task-mode/')) return { lastCopy: null };
        return {};
      },
      ProxyToggle: { isActive: () => true, setActive() {}, maybeAppend: async (raw) => raw },
      renderDispatchDisclosure: () => '',
      readDispatchExecControls: () => ({ model: null, harness: null }),
      isPinnedToBottom: () => false,
      taskPageHref: () => '/workspace/acme/task/LIN-42',
      toast: () => {},
    },
    classic: ['question-cards.js'],
    timers,
    globals: {
      CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
      localStorage: { getItem: () => null, setItem() {} },
    },
  });
  world.PromptSection.init(world.makeContainer(), HOME);
  await flushN(3);
  const card = () => world.document.querySelector('[data-question-slot] [data-testid="question-record-card"]');
  assert.ok(card(), 'the opened task draws the question record card');
  return {
    document: world.document,
    card,
    poll: async (next) => {
      current = next;
      const poll = timers.find((x) => x.ms === 10000 && !x.cancelled && !x.fired);
      assert.ok(poll, 'a run poll is armed while the task runs');
      poll.fired = true;
      poll.fn();
      await flushN(3);
    },
  };
}

describe('LIN-4549 — the opened task: the state poll keeps a card by the one rule', () => {
  for (const [name, state] of Object.entries(STATES)) {
    test(`${name}: ${state.kept ? 'kept' : 'replaced'} across the repaint`, async (t) => {
      const h = await openedTask(t);
      const old = h.card();
      state.apply(old, h.document);
      await h.poll(stateWith(recordCard('Which way, now?')));
      assert.equal(h.card() === old, state.kept, `${name}: the repaint ${state.kept ? 'kept' : 'replaced'} the card`);
    });
  }

  // The successor of keepsReaderPlace(card, null) (lin-4242-waiting-merge before LIN-4549): a repaint whose state draws no card
  // never puts the old one back, however much it holds.
  test('a repaint that draws no card does not keep the old one, however much it holds', async (t) => {
    const h = await openedTask(t);
    const old = h.card();
    STATES['typed words'].apply(old);
    await h.poll(stateWith(''));
    assert.equal(h.card(), null, 'no card in the slot');
    assert.equal(old.isConnected, false, 'the old card is not put back');
  });

  test('another question\'s card is never kept, however much the old one holds', async (t) => {
    const h = await openedTask(t);
    const old = h.card();
    STATES['typed words'].apply(old);
    await h.poll(stateWith(renderQuestionRecordCard({ ...row('Another?'), questionId: 'q-2' }, { urlKey: 'acme' })));
    assert.notEqual(h.card(), old, 'the key gate comes first');
    assert.equal(h.card().dataset.questionId, 'q-2');
  });
});

// ── The rule itself ────────────────────────────────────────────────────────
describe('LIN-4549 — the one rule (public/question-records.js)', () => {
  test('holdsCard is the union; holdsReaderInput is its input half (what Home\'s placement reads), without settled or disabled', () => {
    assert.equal(typeof QR.holdsCard, 'function', 'the rule is exported from public/question-records.js');
    const dom = createFakeDom();
    for (const [name, state] of Object.entries(STATES)) {
      dom.document.body.innerHTML = recordCard('Which way?');
      const card = dom.document.querySelector('[data-testid="question-record-card"]');
      state.apply(card, dom.document);
      assert.equal(QR.holdsCard(card), state.kept, `holdsCard: ${name}`);
      const input = ['typed words', 'a chosen option', 'focus inside', 'an answer in flight'].includes(name);
      assert.equal(QR.holdsReaderInput(card), input, `holdsReaderInput: ${name}`);
    }
  });

  test('a settled card answered with an option holds its place but not the reader\'s input (placement goes on)', () => {
    const dom = createFakeDom();
    dom.document.body.innerHTML = recordCard('Which way?');
    const card = dom.document.querySelector('[data-testid="question-record-card"]');
    STATES['a chosen option'].apply(card);
    assert.equal(QR.holdsReaderInput(card), true, 'open, with a chosen option: mid-answer');
    STATES.settled.apply(card);
    assert.equal(QR.holdsReaderInput(card), false, 'settled: the pressed option is the answer given, not input');
    assert.equal(QR.holdsCard(card), true, 'and the card itself is still kept');
  });

  test('focus is read from the element given (the caller\'s capture before a write that blurs), and the card\'s own box is not inside it', () => {
    const dom = createFakeDom();
    dom.document.body.innerHTML = recordCard('Which way?');
    const card = dom.document.querySelector('[data-testid="question-record-card"]');
    const input = card.querySelector('[data-testid="question-record-card-input"]');
    assert.equal(QR.focusInCard(card, input), true);
    assert.equal(QR.focusInCard(card, card), false, 'the card\'s own box');
    assert.equal(QR.focusInCard(card, null), false, 'null: nothing was focused');
    assert.equal(QR.holdsCard(card, input), true, 'holdsCard takes the same captured element');
    assert.equal(QR.holdsCard(null), false);
  });

  test('the older reply card holds the same way: typed words in its own input, or its answer in flight', () => {
    const dom = createFakeDom();
    dom.document.body.innerHTML = '<div data-testid="session-question-card" data-loop-id="l-1"><textarea data-testid="session-question-card-input"></textarea><button>Answer</button></div>';
    const card = dom.document.querySelector('[data-testid="session-question-card"]');
    assert.equal(QR.holdsCard(card), false);
    card.querySelector('textarea').value = 'words';
    assert.equal(QR.holdsCard(card), true);
    card.querySelector('textarea').value = '';
    card.dataset.answerInFlight = 'true';
    assert.equal(QR.holdsReaderInput(card), true);
  });
});
