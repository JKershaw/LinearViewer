/**
 * LIN-4242 — the live Waiting on you merge, witnessed in a fake DOM (no browser, no timers).
 *
 * public/question-cards.js `mergeWaitingCards` and `keepsReaderPlace` run in a vm sandbox over a small element tree. The
 * fresh markup is the real `renderWaitingSection` output, parsed by a minimal HTML parser below, so the merge sees the
 * same `.waiting-card` wrappers and `session-question-card` markup the server sends. Each test is a mutation witness: the
 * comment on it names the change that makes it fail.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderWaitingSection } from '../../lib/waiting-section.js';
import { createFakeDom } from './helpers/fake-dom.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
const QUESTION_CARDS_JS_SRC = readFileSync(join(REPO, 'public/question-cards.js'), 'utf8');

// ── The page and the sandbox ────────────────────────────────────────────────

const row = (identifier) => ({
  decision: { decision_id: `d-${identifier}`, question: `Which for ${identifier}?` },
  decisionCase: [],
  anchor: { loopId: `r-${identifier}`, issueId: `id-${identifier}`, issueIdentifier: identifier, issueTitle: `Title ${identifier}`, workspaceUrlKey: 'ws', taskDecisionId: null },
  disposition: 'resumable',
  effect: 'resume',
  canReply: true,
});

/** The server's section for `identifiers`, parsed into a document root. Returns the live body and the sandbox. */
function world(identifiers) {
  const dom = createFakeDom();
  const { document } = dom;
  const sectionHtml = renderWaitingSection({ rows: identifiers.map(row) }, { urlKey: 'ws', owner: true });
  dom.parse(sectionHtml, document.body);
  const body = document.querySelector('.waiting-body');
  const sandbox = {
    console,
    document,
    window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout,
    clearTimeout,
  };
  sandbox.window.document = document;
  vm.createContext(sandbox);
  vm.runInContext(QUESTION_CARDS_JS_SRC, sandbox, { filename: 'question-cards.js' });
  const QC = sandbox.window.QuestionCards;
  return { body, document, QC, sandbox };
}

/** The key the merge uses for a wrapper: rulingKeyOf on its inner session card. */
const keyOfWrapper = (QC, wrapper) => QC.rulingKeyOf(wrapper.querySelector('[data-testid="session-question-card"]'));
const wrappersOf = (body) => body.children.filter((c) => c.classList.contains('waiting-card'));
const idsOf = (body) => wrappersOf(body).map((w) => w.querySelector('[data-testid="waiting-task-line"]').textContent.match(/LIN-\d+/)[0]);
const wrapperFor = (body, identifier) => wrappersOf(body).find((w) => w.querySelector('[data-testid="waiting-task-line"]').textContent.includes(identifier));
/** The fresh server markup for `identifiers`, as the route sends it. */
const freshFor = (identifiers) => renderWaitingSection({ rows: identifiers.map(row) }, { urlKey: 'ws', owner: true });
/**
 * The merge's result, copied into this realm: the sandbox's own arrays would fail strict deep equality on prototype.
 */
const merge = (QC, body, html) => {
  const r = QC.mergeWaitingCards(body, html);
  return { count: r.count, removed: [...r.removed] };
};
/** The fresh server markup for an empty owner section (zero rulings). */
const EMPTY = renderWaitingSection({ rows: [] }, { urlKey: 'ws', owner: true });

describe('LIN-4242: the fake DOM reads the server markup the way the merge needs', () => {
  test('the parsed section has one keyed wrapper per ruling, and the keys are distinct', () => {
    const { body, QC } = world(['LIN-1', 'LIN-2']);
    assert.deepEqual(idsOf(body), ['LIN-1', 'LIN-2']);
    const keys = wrappersOf(body).map((w) => keyOfWrapper(QC, w));
    assert.equal(new Set(keys).size, 2, 'two rulings, two keys');
    assert.ok(keys.every((k) => k && k !== 'loop:|'), 'every key is set');
  });
});

describe('LIN-4242: the keyed merge (fake DOM)', () => {
  test('a key only in the fresh set is inserted at its server-order position and bound; the others are untouched', () => {
    // Witness: drop the `insertBefore` position (append instead) → LIN-2 lands last and the order assertion fails.
    // Witness: drop `initQuestionCards(item.el)` → LIN-2's card is not bound.
    const { body, QC } = world(['LIN-1', 'LIN-3']);
    const kept = wrapperFor(body, 'LIN-1');
    const result = merge(QC, body, freshFor(['LIN-1', 'LIN-2', 'LIN-3']));
    assert.equal(result.count, 3);
    assert.deepEqual(result.removed, []);
    assert.deepEqual(idsOf(body), ['LIN-1', 'LIN-2', 'LIN-3'], 'server order');
    assert.equal(wrapperFor(body, 'LIN-1'), kept, 'the kept wrapper is the same node');
    const added = wrapperFor(body, 'LIN-2').querySelector('[data-testid="session-question-card"]');
    assert.equal(added.dataset.qcardBound, 'true', 'the added card is bound');
  });

  test('a kept card is the same node, with its typed text and focus intact, and is never re-rendered', () => {
    // Witness: a merge that replaces kept wrappers (`wrapper.replaceWith(fresh)`) → the node identity and the focus assertions fail.
    const { body, QC, document } = world(['LIN-1', 'LIN-2']);
    const wrapper = wrapperFor(body, 'LIN-1');
    const card = wrapper.querySelector('[data-testid="session-question-card"]');
    const textarea = card.querySelector('[data-testid="session-question-card-input"]');
    textarea.value = 'half a sentence';
    document.activeElement = textarea;
    merge(QC, body, freshFor(['LIN-1', 'LIN-2']));
    assert.equal(wrapperFor(body, 'LIN-1'), wrapper, 'the same wrapper node');
    assert.equal(wrapper.querySelector('[data-testid="session-question-card-input"]'), textarea, 'the same textarea node');
    assert.equal(textarea.value, 'half a sentence', 'the typed text survives');
    assert.equal(document.activeElement, textarea, 'focus survives');
  });

  test('a key only on the page is removed and reported, unless its answer is still in flight', () => {
    // Witness: drop the `answerInFlight` guard → the in-flight card is removed and the first assertion fails.
    const { body, QC } = world(['LIN-1', 'LIN-2']);
    const inFlight = wrapperFor(body, 'LIN-2').querySelector('[data-testid="session-question-card"]');
    const key2 = QC.rulingKeyOf(inFlight);
    inFlight.dataset.answerInFlight = 'true';
    const first = merge(QC, body, freshFor(['LIN-1']));
    assert.deepEqual(first.removed, [], 'an in-flight card is not reported removed');
    assert.deepEqual(idsOf(body), ['LIN-1', 'LIN-2'], 'and stays on the page');
    delete inFlight.dataset.answerInFlight;
    const second = merge(QC, body, freshFor(['LIN-1']));
    assert.deepEqual(second.removed, [key2], 'reported removed once its answer has settled');
    assert.deepEqual(idsOf(body), ['LIN-1']);
    assert.equal(second.count, 1);
  });

  test('a just-answered key is not re-added by a response requested before it settled', () => {
    // Witness: drop the `settledKeys.has(key)` skip → LIN-2 is re-added and the count and id assertions fail.
    // The key settles through noteSettled, which app.js calls from RULING_GONE_EVENT (this page answered or dismissed it).
    const { body, QC } = world(['LIN-1', 'LIN-2']);
    const answeredKey = QC.rulingKeyOf(wrapperFor(body, 'LIN-2').querySelector('[data-testid="session-question-card"]'));
    QC.noteSettled(answeredKey);
    wrapperFor(body, 'LIN-2').remove(); // the page has already removed the answered card (onRulingGone)
    // The response was requested before the answer, so it still lists LIN-2.
    const result = merge(QC, body, freshFor(['LIN-1', 'LIN-2']));
    assert.equal(result.count, 1, 'the settled LIN-2 is not added');
    assert.deepEqual(idsOf(body), ['LIN-1']);
  });

  test('a card that leaves one response and returns in a later one comes back: a server-side drop is not a settlement', () => {
    // Witness: restore `noteSettled(key)` in the removal path → the card cannot return and the second merge fails.
    // This is the one→zero→one path for the merge: a ruling that the live guard drops for a moment and restores.
    const { body, QC } = world(['LIN-1']);
    assert.equal(merge(QC, body, EMPTY).count, 0, 'zero: the card goes');
    assert.deepEqual(idsOf(body), []);
    const back = merge(QC, body, freshFor(['LIN-1']));
    assert.equal(back.count, 1, 'one again: the card returns');
    assert.deepEqual(idsOf(body), ['LIN-1']);
    assert.deepEqual(back.removed, []);
  });

  test('a fresh set that repeats a key contributes it once', () => {
    const { body, QC } = world([]);
    const result = merge(QC, body, freshFor(['LIN-1', 'LIN-1']));
    assert.equal(result.count, 1);
    assert.deepEqual(idsOf(body), ['LIN-1']);
  });

  test('a null or empty body is a no-op, not an error', () => {
    const { QC } = world([]);
    assert.deepEqual(merge(QC, null, freshFor(['LIN-1'])), { count: 0, removed: [] });
  });
});

describe('LIN-4242: keepsReaderPlace, the gate the opened task’s repaint uses (keepTypedQuestion)', () => {
  const cardFor = (QC, body, identifier) => wrapperFor(body, identifier).querySelector('[data-testid="session-question-card"]');

  test('the same ruling with typed text is kept', () => {
    // Witness: drop the rulingKeyOf equality → the cross-ruling case below is kept and the other assertion still passes; the
    // cross-ruling test is the one that fails.
    const { body, QC } = world(['LIN-1']);
    const old = cardFor(QC, body, 'LIN-1');
    old.querySelector('[data-testid="session-question-card-input"]').value = 'my words';
    const fresh = cardFor(QC, world(['LIN-1']).body, 'LIN-1');
    assert.equal(QC.keepsReaderPlace(old, fresh), true);
  });

  test('a different ruling with typed text is never kept', () => {
    // Witness: the rulingKeyOf equality removed → this assertion fails.
    const { body, QC } = world(['LIN-1']);
    const old = cardFor(QC, body, 'LIN-1');
    old.querySelector('[data-testid="session-question-card-input"]').value = 'my words for LIN-1';
    const other = cardFor(QC, world(['LIN-9']).body, 'LIN-9');
    assert.equal(QC.keepsReaderPlace(old, other), false);
  });

  test('the same ruling with no input, no focus and no answer in flight is not kept', () => {
    // Witness: `cardHoldsInput` replaced by `true` → this assertion fails.
    const { body, QC } = world(['LIN-1']);
    const old = cardFor(QC, body, 'LIN-1');
    const fresh = cardFor(QC, world(['LIN-1']).body, 'LIN-1');
    assert.equal(QC.keepsReaderPlace(old, fresh), false);
  });

  test('the same ruling with an answer in flight is kept, even with no typed text', () => {
    const { body, QC } = world(['LIN-1']);
    const old = cardFor(QC, body, 'LIN-1');
    old.dataset.answerInFlight = 'true';
    const fresh = cardFor(QC, world(['LIN-1']).body, 'LIN-1');
    assert.equal(QC.keepsReaderPlace(old, fresh), true);
  });

  test('a missing card on either side is never kept', () => {
    const { QC, document } = world([]);
    assert.equal(QC.keepsReaderPlace(null, null), false);
    assert.equal(QC.keepsReaderPlace(document.createElement('div'), null), false);
  });
});
