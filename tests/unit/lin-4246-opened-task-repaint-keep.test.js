/**
 * LIN-4246: the opened task's repaint, at the call site (`keepTypedQuestion`, public/prompt-section.js), on the shared fake DOM.
 *
 * Home's state poll repaints the question slot. A card keeps its place only while `QuestionCards.keepsReaderPlace` says so:
 * the same ruling, and the card holds the reader's typed text, focus, or an answer in flight. Each case mounts Home with a
 * running task and a card, then fires the captured 10s poll once with a second `/state` body, and asserts on node identity.
 * `question-cards.js` is loaded into the same vm (without it `keepsPlace` is always false and these cannot go red for the
 * right reason; `mountWithCard` fails loudly if it is missing).
 *
 * The typed-input survival claim is witnessed once, by the E2E in tests/e2e/lin-4242-waiting-live.spec.js. The cases here are
 * the remaining ones: a card with nothing typed is replaced, and the typed case is the contrast that makes it mean something.
 * A focused card with nothing typed is kept, and focus is back in its textarea after the repaint (LIN-4246 review: the write
 * detaches the card before the gate reads focus, so focus is captured before it and restored after the card is moved back).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../../lib/utils/html.js';
import { serverSessions, serverRow } from '../fixtures/task-decision.js';
import { loadWorld } from './helpers/client-world.js';

const RUNNING = { loopId: 'loop-1', kind: 'implementation', label: 'Build', state: 'running', since: '2026-11-05T10:00:00.000Z', target: 'cli' };
const HOME = {
  // LIN-4104 D2: this file's workspace fills Run to PR (its tests are about that run).
  filledRung: 'pr',
  urlKey: 'acme', surface: 'home', dispatchEnabled: true, runSetup: false, hasAI: true, aiState: 'ok', isLocalhost: false,
  promptMeta: { plan: 'Plan', implementation: 'implement', research: 'Research', scoping: 'Scoping', review: 'Review', 'plan-review': 'plan-review' },
  stageWords: { plan: 'Plan', implementation: 'Build', research: 'Research', scoping: 'Scoping', review: 'Review', 'plan-review': 'Plan review' },
  defaultPromptKeys: ['look-into', 'research', 'plan', 'implementation'],
  morePromptKeys: ['review', 'scoping', 'plan-review'],
  issue: { id: 'uuid-42', identifier: 'LIN-42', title: 'T', url: '', source: 'linear', stateType: 'started' },
  row: serverRow({ stateType: 'started' }),
};

const flush = () => new Promise((r) => setTimeout(r, 0));
const flushN = async (n) => { for (let i = 0; i < n; i++) await flush(); };

/** A running task's `/state` body, with the question card `questionHtml` (the server's own card markup, as the poll sends it). */
function stateWithCard(questionHtml) {
  return {
    status: 'running', live: true, homeStatusHtml: '', headerHtml: '', questionHtml,
    sessions: serverSessions({ count: 1, running: RUNNING, next: null, last: null, offered: null, busy: true, excluded: [] }),
  };
}

/** A minimal card in the server's shape: the ruling key (`data-decision-id`), the answer and the input the client binds. */
function cardHtml(decisionId, question) {
  return `<div data-testid="session-question-card" data-decision-id="${escapeHtml(decisionId)}" data-issue-identifier="LOCAL-S">`
    + `<p>${escapeHtml(question)}</p>`
    + '<textarea data-testid="session-question-card-input"></textarea>'
    + '<button data-testid="session-question-card-answer">Answer</button>'
    + '<div class="sess-qcard-feedback"></div></div>';
}

/** Home mounted on a running task with `first` as its state, and the poll captured. `next(body)` sets the poll's body. */
async function mountWithCard(first) {
  const timers = [];
  let current = first;
  const world = loadWorld({
    window: {
      escapeHtml: (x) => (x == null ? '' : escapeHtml(String(x))),
      stripCodeBlockWrapper: (x) => x,
      renderMarkdown: (x) => String(x == null ? '' : x),
      api: async (url) => {
        if (url.includes('/api/task/')) return current;
        if (url.includes('/api/dispatch/quota')) return {};
        if (url.includes('/api/task-mode/')) return { lastCopy: null };
        if (url.includes('/api/dispatch/preview')) return { kind: 'implementation', harness: 'claude-code', words: {}, sources: {}, group: null, description: '' };
        if (url.includes('/api/dispatch/decision-panel')) return { html: '', words: null, withoutEffort: [], targets: ['cli', 'web'], optionWords: { harness: {}, model: {} } };
        if (url.includes('/api/dispatch/presets')) return { presets: [] };
        return {};
      },
      ProxyToggle: { isActive: () => true, setActive() {}, maybeAppend: async (raw) => raw },
      renderDispatchDisclosure: () => '',
      readDispatchExecControls: () => ({ model: null, harness: null }),
      isPinnedToBottom: () => false,
      taskPageHref: () => '/workspace/acme/task/LIN-42',
      toast: () => {},
    },
    scripts: ['question-cards.js', 'prompt-section.js'],
    timers,
    globals: {
      CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
      localStorage: { getItem: () => null, setItem() {} },
    },
  });
  assert.equal(typeof world.window.QuestionCards?.keepsReaderPlace, 'function', 'question-cards.js is in the same vm: the gate exists');
  const container = world.makeContainer();
  world.PromptSection.init(container, HOME);
  await flushN(3);
  const document = world.document;
  return {
    document,
    card: () => document.querySelector('[data-question-slot] [data-testid="session-question-card"]'),
    /** Fires the one captured 10s poll, with `next` as the `/state` body it reads. */
    poll: async (next) => {
      current = next;
      const poll = timers.find((t) => t.ms === 10000 && !t.cancelled && !t.fired);
      assert.ok(poll, 'a run poll is armed while the task runs');
      poll.fired = true;
      poll.fn();
      await flushN(3);
    },
  };
}

describe('LIN-4246 — the opened task\'s repaint keeps a card only while it holds the reader\'s place', () => {
  test('same ruling, markup changed, nothing typed, nothing focused: the old card is replaced by a fresh, bound one', async () => {
    const h = await mountWithCard(stateWithCard(cardHtml('d-LOCAL-S', 'Which way?')));
    const old = h.card();
    assert.ok(old, 'the card is on the page');
    assert.equal(old.dataset.qcardBound, 'true', 'the mount binds the card');
    assert.equal(old.contains(h.document.activeElement), false, 'nothing in the card has focus, so focus cannot keep it');

    await h.poll(stateWithCard(cardHtml('d-LOCAL-S', 'Which way, now?')));

    const fresh = h.card();
    assert.ok(fresh && fresh !== old, 'a different node is in the slot');
    assert.equal(old.isConnected, false, 'the old node is gone from the document');
    assert.match(fresh.textContent, /Which way, now\?/, 'the slot holds the new markup');
    assert.equal(fresh.dataset.qcardBound, 'true', 'the fresh card is bound');
  });

  test('same ruling, markup changed, typed text: the same node and its text are kept (the contrast for the case above)', async () => {
    const h = await mountWithCard(stateWithCard(cardHtml('d-LOCAL-S', 'Which way?')));
    const old = h.card();
    const input = old.querySelector('[data-testid="session-question-card-input"]');
    input.value = 'half a sentence';
    assert.equal(old.contains(h.document.activeElement), false, 'typed text is what keeps the card here, not focus');

    await h.poll(stateWithCard(cardHtml('d-LOCAL-S', 'Which way, now?')));

    assert.equal(h.card(), old, 'the same node is in the slot');
    assert.equal(old.isConnected, true, 'the old node is still in the document');
    assert.equal(old.querySelector('[data-testid="session-question-card-input"]').value, 'half a sentence', 'the typed text is intact');
  });

  test('same ruling, markup changed, focused but nothing typed: the same node is kept and focus returns to its textarea', async () => {
    // Review finding on 926fdba9: the repaint detaches the old slot before keepTypedQuestion reads document.activeElement, so
    // focus never keeps a card here and the reader loses the caret every poll. The focus must be captured before the write
    // and restored after the old node is put back. Witness: drop the focus capture → the old node is replaced and this fails.
    const h = await mountWithCard(stateWithCard(cardHtml('d-LOCAL-S', 'Which way?')));
    const old = h.card();
    const input = old.querySelector('[data-testid="session-question-card-input"]');
    input.focus();
    assert.equal(h.document.activeElement, input, 'the reader is typing in the empty textarea');
    assert.equal(input.value, '', 'nothing is typed, so focus is the only thing that can keep the card');

    await h.poll(stateWithCard(cardHtml('d-LOCAL-S', 'Which way, now?')));

    assert.equal(h.card(), old, 'the same node is in the slot');
    assert.equal(old.isConnected, true, 'the old node is still in the document');
    assert.equal(h.document.activeElement, input, 'focus is back in the textarea after the repaint');
  });

  test('current behaviour, not a promise: an idle card is replaced on every poll, even with byte-identical markup', async () => {
    // `initQuestionCards` stamps data-qcard-bound on the mounted card, and fresh server markup never carries the stamp, so the
    // `innerHTML ===` clause in keepTypedQuestion cannot hold for a bound card. Pinned here so removing that clause is visibly
    // neutral; if a later change keeps idle cards, that is a decision and this test should change with it.
    const same = cardHtml('d-LOCAL-S', 'Which way?');
    const h = await mountWithCard(stateWithCard(same));
    const old = h.card();
    await h.poll(stateWithCard(same));
    assert.notEqual(h.card(), old, 'the idle card is a fresh node');
    assert.equal(old.isConnected, false, 'the old node is gone');
  });
});
