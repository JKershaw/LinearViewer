/**
 * LIN-4293: the two witnesses the tidy-after of public/prompt-section.js needs, on the shared fake DOM.
 *
 * 1. The `render()` path keeps a focused question card. `render()` is the one repaint that is not the poll: Home's mount reads
 *    the run quota, and that read repaints with `render()` once it lands. The read is held open here, the card is focused
 *    while it is held, then released. The same card node must be kept and focus must be back in its textarea. Witness: set
 *    render()'s focus capture to null (its `readerFocusIn(oldQuestion)` call), and this goes red.
 * 2. The `paintState` no-slot fallback keeps the card once. With no state slot, paintState hands the write to `render()`,
 *    which already keeps the card. The keep must not run a second time: a second `initQuestionCards` is the visible
 *    symptom. Witness: at the base (keep after the `render()` fallback too) this counts 2 calls, not 1.
 *
 * The helpers mirror tests/unit/lin-4246-opened-task-repaint-keep.test.js (same fixtures, same vm over the fake DOM).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../../lib/utils/html.js';
import { serverSessions, serverRow } from '../fixtures/task-decision.js';
import { loadWorld } from './helpers/client-world.js';

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

const flush = () => new Promise((r) => setTimeout(r, 0));
const flushN = async (n) => { for (let i = 0; i < n; i++) await flush(); };

function stateWithCard(questionHtml) {
  return {
    status: 'running', live: true, homeStatusHtml: '', headerHtml: '', questionHtml,
    sessions: serverSessions({ count: 1, running: RUNNING, next: null, last: null, offered: null, busy: true, excluded: [] }),
  };
}

function cardHtml(decisionId, question) {
  return `<div data-testid="session-question-card" data-decision-id="${escapeHtml(decisionId)}" data-issue-identifier="LOCAL-S">`
    + `<p>${escapeHtml(question)}</p>`
    + '<textarea data-testid="session-question-card-input"></textarea>'
    + '<button data-testid="session-question-card-answer">Answer</button>'
    + '<div class="sess-qcard-feedback"></div></div>';
}

/**
 * Home mounted on a running task with a question card. `quota` is an optional deferred read: when given, it is the held-open
 * run-quota read, and `releaseQuota()` lets it land (its landing is a `render()` call on the mount path).
 */
async function mountWithCard({ freeTier = false, holdQuota = false, body = stateWithCard(cardHtml('d-LOCAL-S', 'Which way?')) } = {}) {
  const timers = [];
  const quotaGate = {};
  const state = body;
  const world = loadWorld({
    window: {
      escapeHtml: (x) => (x == null ? '' : escapeHtml(String(x))),
      stripCodeBlockWrapper: (x) => x,
      renderMarkdown: (x) => String(x == null ? '' : x),
      api: async (url) => {
        if (url.includes('/api/task/')) return state;
        if (url.includes('/api/dispatch/quota')) {
          if (!holdQuota) return {};
          return new Promise((resolve) => { quotaGate.release = () => resolve({}); });
        }
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
  const container = world.makeContainer();
  world.PromptSection.init(container, freeTier ? { ...HOME, freeTier: true } : HOME);
  await flushN(3);
  return {
    world,
    document: world.document,
    container,
    timers,
    card: () => world.document.querySelector('[data-question-slot] [data-testid="session-question-card"]'),
    release: async () => { quotaGate.release(); await flushN(3); },
  };
}

describe('LIN-4293: the render() path keeps a focused question card (the mount quota read repaints through render())', () => {
  test('a focused card with nothing typed survives the render() repaint: same node, focus back in its textarea', async () => {
    const h = await mountWithCard({ freeTier: true, holdQuota: true });
    const old = h.card();
    assert.ok(old, 'the mount put the question card on the page');
    const input = old.querySelector('[data-testid="session-question-card-input"]');
    input.focus();
    assert.equal(input.value, '', 'nothing is typed, so focus is the only thing that can keep the card');
    assert.equal(h.document.activeElement, input, 'the textarea has focus before the repaint');

    await h.release(); // the held quota read lands: the mount's render() runs with focus inside the card

    assert.equal(h.card(), old, 'the same card node is kept by render(), not replaced by fresh markup');
    assert.equal(old.isConnected, true, 'the kept node is in the document');
    assert.equal(h.document.activeElement, input, 'focus is back in the kept textarea after render()');
  });
});

describe('LIN-4293: the paintState no-slot fallback keeps the card once, not twice', () => {
  test('with no state slot, a poll runs the card keep once (one initQuestionCards), and the card is bound', async () => {
    const h = await mountWithCard();
    const QC = h.world.window.QuestionCards;
    assert.equal(typeof QC.initQuestionCards, 'function', 'question-cards.js is in the same vm: the keep can be counted');
    const slot = h.container.querySelector('[data-state-slot]');
    assert.ok(slot, 'the mount painted a state slot');
    // A caller that skins the component removes the slot; paintState then has no slot to write and falls back to render().
    slot.remove();
    assert.equal(h.container.querySelector('[data-state-slot]'), null, 'no state slot is left');

    const poll = h.timers.find((t) => t.ms === 10000 && !t.cancelled && !t.fired);
    assert.ok(poll, 'a run poll is armed while the task runs');
    let calls = 0;
    const real = QC.initQuestionCards;
    QC.initQuestionCards = function (...args) { calls += 1; return real.apply(this, args); };
    try {
      poll.fired = true;
      poll.fn();
      await flushN(3);
    } finally {
      QC.initQuestionCards = real;
    }

    assert.equal(calls, 1, 'the card is bound once on the fallback path (render() keeps it; paintState does not keep it again)');
    const card = h.card();
    assert.ok(card, 'the question card is on the page after the fallback repaint');
    assert.equal(card.dataset.qcardBound, 'true', 'the card is bound');
  });
});

/** A complete `/state` body for a task with nothing live, optionally with a busy session (a queued or subtree-busy run). */
function idleBody({ busy }) {
  return {
    status: 'idle', live: false, homeStatusHtml: '', headerHtml: '', stripHtml: '', questionHtml: null,
    sessions: serverSessions({ count: busy ? 1 : 0, running: null, next: null, last: null, offered: null, busy, excluded: [] }),
  };
}

describe('LIN-4293: the "in progress" views keep today\'s inputs', () => {
  // Pins InProgress.liveNow (the mount and press read): a run is live or waiting, and a busy task that is not live does not
  // start the running line or its poll. Witness: liveNow also counting sessions.busy arms the poll here, and this goes red.
  test('the mount read of a busy task that is not live does not arm a run poll; a live one does', async () => {
    const live = await mountWithCard();
    assert.ok(live.timers.find((t) => t.ms === 10000 && !t.cancelled), 'control: a live run arms the run poll');

    const busyNotLive = await mountWithCard({ body: idleBody({ busy: true }) });
    assert.equal(busyNotLive.timers.find((t) => t.ms === 10000 && !t.cancelled), undefined,
      'a busy-but-not-live task arms no run poll: nothing is live now, so the mount read does not start a run');
  });

  // Pins InProgress.busy (the step-line gate): the last complete reply says busy, so the step line is hidden; an idle one shows it.
  test('a complete reply that says busy hides the step line; an idle reply shows it', async () => {
    const busy = await mountWithCard({ body: idleBody({ busy: true }) });
    assert.equal(busy.document.querySelector('[data-testid="opened-task-step"]'), null,
      'busy: the step line is hidden while a session is busy');

    const idle = await mountWithCard({ body: idleBody({ busy: false }) });
    assert.ok(idle.document.querySelector('[data-testid="opened-task-step"]'),
      'idle: the step line is drawn (control for the busy case above)');
  });
});
