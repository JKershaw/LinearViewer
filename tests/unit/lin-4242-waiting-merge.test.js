/**
 * LIN-4242 — the live Waiting on you merge, witnessed in a fake DOM (no browser, no timers).
 *
 * public/question-cards.js `mergeWaitingCards` and `keepsReaderPlace` run in a vm sandbox over a small element tree. The
 * fresh markup is the real `renderWaitingSection` output, parsed by a minimal HTML parser below, so the merge sees the
 * same `.waiting-card` wrappers and `question-record-card` markup the server sends. Each test is a mutation witness: the
 * comment on it names the change that makes it fail.
 *
 * LIN-4532 (finding-dca7ac9d): the same merge also draws and keys the open question cards (`.waiting-question`), at the end of the file.
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

// LIN-4538: the owner's section draws its open questions (lib/open-questions.js rows); a ruling card is no longer drawn.
const row = (identifier) => ({
  questionId: `q-${identifier}`, asks: `Which for ${identifier}?`, options: ['left', 'right'], recommended: 'left', ifUnanswered: 'pick left',
  taskId: `task-${identifier}`, ticket: identifier, runId: `r-${identifier}`, askedAt: '2026-11-23T09:00:00.000Z', state: 'resumable',
  reason: null, interactive: true,
});

/** The server's section for `identifiers`, parsed into a document root. Returns the live body and the sandbox. */
function world(identifiers) {
  const dom = createFakeDom();
  const { document } = dom;
  const sectionHtml = renderWaitingSection({ rows: [], questions: identifiers.map(row) }, { urlKey: 'ws', owner: true });
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
const keyOfWrapper = (QC, wrapper) => QC.rulingKeyOf(wrapper.querySelector('[data-testid="question-record-card"]'));
const wrappersOf = (body) => body.children.filter((c) => c.classList.contains('waiting-question'));
const idsOf = (body) => wrappersOf(body).map((w) => w.querySelector('[data-testid="waiting-task-line"]').textContent.match(/LIN-\d+/)[0]);
const wrapperFor = (body, identifier) => wrappersOf(body).find((w) => w.querySelector('[data-testid="waiting-task-line"]').textContent.includes(identifier));
/** The fresh server markup for `identifiers`, as the route sends it. */
const freshFor = (identifiers) => renderWaitingSection({ rows: [], questions: identifiers.map(row) }, { urlKey: 'ws', owner: true });
/**
 * The merge's result, copied into this realm: the sandbox's own arrays would fail strict deep equality on prototype.
 */
const merge = (QC, body, html) => {
  const r = QC.mergeWaitingCards(body, html);
  return { count: r.count, removed: [...r.removed] };
};
/** The fresh server markup for an empty owner section (zero rulings). */
const EMPTY = renderWaitingSection({ rows: [], questions: [] }, { urlKey: 'ws', owner: true });

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
    const added = wrapperFor(body, 'LIN-2').querySelector('[data-testid="question-record-card"]');
    assert.equal(added.dataset.questionId, 'q-LIN-2', 'the added card is the question it names');
  });

  test('a kept card is the same node, with its typed text and focus intact, and is never re-rendered', () => {
    // Witness: a merge that replaces kept wrappers (`wrapper.replaceWith(fresh)`) → the node identity and the focus assertions fail.
    const { body, QC, document } = world(['LIN-1', 'LIN-2']);
    const wrapper = wrapperFor(body, 'LIN-1');
    const card = wrapper.querySelector('[data-testid="question-record-card"]');
    const textarea = card.querySelector('[data-testid="question-record-card-input"]');
    textarea.value = 'half a sentence';
    document.activeElement = textarea;
    merge(QC, body, freshFor(['LIN-1', 'LIN-2']));
    assert.equal(wrapperFor(body, 'LIN-1'), wrapper, 'the same wrapper node');
    assert.equal(wrapper.querySelector('[data-testid="question-record-card-input"]'), textarea, 'the same textarea node');
    assert.equal(textarea.value, 'half a sentence', 'the typed text survives');
    assert.equal(document.activeElement, textarea, 'focus survives');
  });

  test('a key only on the page is removed and reported, unless its answer is still in flight', () => {
    // Witness: drop the `answerInFlight` guard → the in-flight card is removed and the first assertion fails.
    const { body, QC } = world(['LIN-1', 'LIN-2']);
    // A question record's card is in flight while its controls are disabled (the answer is being written): questionCardHeld.
    const inFlight = wrapperFor(body, 'LIN-2').querySelector('[data-testid="question-record-card"]');
    const key2 = QC.rulingKeyOf(inFlight);
    const answer = inFlight.querySelector('[data-testid="question-record-card-answer"]');
    answer.disabled = true;
    const first = merge(QC, body, freshFor(['LIN-1']));
    assert.deepEqual(first.removed, [], 'an in-flight card is not reported removed');
    assert.deepEqual(idsOf(body), ['LIN-1', 'LIN-2'], 'and stays on the page');
    answer.disabled = false;
    const second = merge(QC, body, freshFor(['LIN-1']));
    assert.deepEqual(second.removed, [key2], 'reported removed once its answer has settled');
    assert.deepEqual(idsOf(body), ['LIN-1']);
    assert.equal(second.count, 1);
  });

  test('a just-answered key is not re-added by a response requested before it settled', () => {
    // Witness: drop the `settledKeys.has(key)` skip → LIN-2 is re-added and the count and id assertions fail.
    // The key settles through noteSettled, which app.js calls from RULING_GONE_EVENT (this page answered or dismissed it).
    const { body, QC } = world(['LIN-1', 'LIN-2']);
    const answeredKey = QC.rulingKeyOf(wrapperFor(body, 'LIN-2').querySelector('[data-testid="question-record-card"]'));
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
  const cardFor = (QC, body, identifier) => wrapperFor(body, identifier).querySelector('[data-testid="question-record-card"]');

  test('the same ruling with typed text is kept', () => {
    // Witness: drop the rulingKeyOf equality → the cross-ruling case below is kept and the other assertion still passes; the
    // cross-ruling test is the one that fails.
    const { body, QC } = world(['LIN-1']);
    const old = cardFor(QC, body, 'LIN-1');
    old.querySelector('[data-testid="question-record-card-input"]').value = 'my words';
    const fresh = cardFor(QC, world(['LIN-1']).body, 'LIN-1');
    assert.equal(QC.keepsReaderPlace(old, fresh), true);
  });

  test('a different ruling with typed text is never kept', () => {
    // Witness: the rulingKeyOf equality removed → this assertion fails.
    const { body, QC } = world(['LIN-1']);
    const old = cardFor(QC, body, 'LIN-1');
    old.querySelector('[data-testid="question-record-card-input"]').value = 'my words for LIN-1';
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

// ── LIN-4532 (finding-dca7ac9d): the live refresh draws question cards ───────
// The same merge, over a question wrapper. Each test is a mutation witness: the comment on it names what makes it fail.

const ruling = (identifier) => ({
  decision: { decision_id: `d-${identifier}`, question: `Which for ${identifier}?` },
  decisionCase: [],
  anchor: { loopId: `r-${identifier}`, issueId: `id-${identifier}`, issueIdentifier: identifier, issueTitle: `Title ${identifier}`, workspaceUrlKey: 'ws', taskDecisionId: null },
  disposition: 'resumable',
  effect: 'resume',
  canReply: true,
});

const question = (questionId, ticket = 'LIN-9') => ({
  questionId, asks: `Which for ${questionId}?`, options: ['left', 'right'], recommended: 'left', ifUnanswered: 'pick left',
  taskId: 'task-9', ticket, runId: 'run-1', askedAt: '2026-11-23T09:00:00.000Z', state: 'resumable', reason: null, interactive: true,
});

/** The server's section for a page: `rulings` and `questions` as the route draws them. */
const sectionFor = ({ questions = [] }) => renderWaitingSection(
  { rows: [], titles: {}, questions },
  { urlKey: 'ws', owner: true },
);

/** The live document with `html` as its section, and the merge's sandbox over it. */
function questionWorld(html) {
  const dom = createFakeDom();
  const { document } = dom;
  dom.parse(html, document.body);
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
  return { body, document, QC: sandbox.window.QuestionCards };
}

const questionWrappers = (body) => body.children.filter((c) => c.classList.contains('waiting-question'));
const questionIdsOn = (body) => questionWrappers(body).map((w) => w.querySelector('[data-testid="question-record-card"]').dataset.questionId);
const rulingWrappers = (body) => body.children.filter((c) => c.classList.contains('waiting-question'));

describe('LIN-4532: the live Waiting refresh draws question cards (finding-dca7ac9d)', () => {
  test('a question asked after the page load is drawn by the refresh, under its task line, and the earlier question stays', () => {
    const { body, QC } = questionWorld(sectionFor({ questions: [question('q-old', 'LIN-8')] }));
    assert.equal(questionWrappers(body).length, 1, 'the page load drew the earlier question');
    const fresh = sectionFor({ questions: [question('q-old', 'LIN-8'), question('q-new')] });
    const result = merge(QC, body, fresh);
    assert.deepEqual(questionIdsOn(body), ['q-old', 'q-new'], 'the new question card is on the page, after the earlier one');
    assert.deepEqual(result.removed, [], 'nothing was taken out');
    assert.equal(result.count, 2, 'the merge counts both questions');
    const wrapper = questionWrappers(body)[1];
    assert.equal(wrapper.classList.contains('waiting-card'), false, 'a question is never a waiting-card wrapper (the lesson in front-end-pages)');
    assert.match(wrapper.querySelector('[data-testid="waiting-task-line"]').textContent, /LIN-9/, 'under its task line');
  });

  test('a question already on the page is not drawn again by a later refresh', () => {
    const { body, QC } = questionWorld(sectionFor({ questions: [question('q-a')] }));
    const fresh = sectionFor({ questions: [question('q-a')] });
    merge(QC, body, fresh);
    merge(QC, body, fresh);
    assert.deepEqual(questionIdsOn(body), ['q-a'], 'one card for the question, however many refreshes');
  });

  test('a question the server no longer lists is taken out, and reported as removed', () => {
    const { body, QC } = questionWorld(sectionFor({ questions: [question('q-gone')] }));
    const result = merge(QC, body, sectionFor({ rulings: ['LIN-1'] }));
    assert.deepEqual(questionIdsOn(body), [], 'an open question that is no longer open leaves the page');
    assert.deepEqual(result.removed, ['question:q-gone']);
  });

  test('a question answered here stays on the page, settled, though the refresh no longer lists it', () => {
    const { body, document, QC } = questionWorld(sectionFor({ questions: [question('q-done')] }));
    const card = document.querySelector('[data-testid="question-record-card"]');
    card.dataset.settled = 'true';
    const result = merge(QC, body, sectionFor({}));
    assert.deepEqual(questionIdsOn(body), ['q-done'], 'the settled card keeps its outcome on the page');
    assert.deepEqual(result.removed, [], 'a settled card is not reported as answered elsewhere');
  });

  test('a question whose answer is in flight (its controls disabled) is kept until the answer lands', () => {
    const { body, document, QC } = questionWorld(sectionFor({ questions: [question('q-flight')] }));
    document.querySelectorAll('[data-testid="question-record-card"] button').forEach((b) => { b.disabled = true; });
    merge(QC, body, sectionFor({}));
    assert.deepEqual(questionIdsOn(body), ['q-flight'], 'the in-flight card is not taken out from under its answer');
  });
});
