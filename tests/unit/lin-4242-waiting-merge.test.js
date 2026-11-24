/**
 * LIN-4242 — the live Waiting on you merge, witnessed in a fake DOM (no browser, no timers).
 *
 * public/waiting-merge.js `mergeWaitingCards` (LIN-4549: a module, moved out of the classic public/question-cards.js; it asks the
 * one keep-a-card rule, public/question-records.js holdsCard, itself) runs over the shared fake DOM, a fresh module instance per
 * world. The
 * fresh markup is the real `renderWaitingSection` output, parsed by a minimal HTML parser below, so the merge sees the
 * same `.waiting-question` wrappers and `question-record-card` markup the server sends. Each test is a mutation witness: the
 * comment on it names the change that makes it fail.
 *
 * LIN-4532 (finding-dca7ac9d): the same merge also draws and keys the open question cards (`.waiting-question`), at the end of the file.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderWaitingSection } from '../../lib/waiting-section.js';
import { createFakeDom } from './helpers/fake-dom.js';
import { holdsCard } from '../../public/question-records.js';


// ── The page and the sandbox ────────────────────────────────────────────────

// LIN-4538: the owner's section draws its open questions (lib/open-questions.js rows); a ruling card is no longer drawn.
const row = (identifier) => ({
  questionId: `q-${identifier}`, asks: `Which for ${identifier}?`, options: ['left', 'right'], recommended: 'left', ifUnanswered: 'pick left',
  taskId: `task-${identifier}`, ticket: identifier, runId: `r-${identifier}`, askedAt: '2026-11-23T09:00:00.000Z', state: 'resumable',
  reason: null, interactive: true,
});

// A fresh instance of the merge module per world, so the questions one test settles (`noteSettled`) never reach another.
let instance = 0;
async function mergeModule() {
  const m = await import(`../../public/waiting-merge.js?world=${instance += 1}`);
  return { mergeWaitingCards: m.mergeWaitingCards, questionKeyOf: m.questionKeyOf, noteSettled: m.noteSettled };
}

/** The server's section for `identifiers`, parsed into a document root. Returns the live body and the merge module (`QC`). */
async function world(identifiers) {
  const dom = createFakeDom();
  const { document } = dom;
  const sectionHtml = renderWaitingSection({ rows: [], questions: identifiers.map(row) }, { urlKey: 'ws', owner: true });
  dom.parse(sectionHtml, document.body);
  const body = document.querySelector('.waiting-body');
  return { body, document, QC: await mergeModule() };
}

/** The key the merge uses for a wrapper: its card's question id (public/waiting-merge.js questionKeyOf). */
const keyOfWrapper = (QC, wrapper) => QC.questionKeyOf(wrapper.querySelector('[data-testid="question-record-card"]'));
const wrappersOf = (body) => body.children.filter((c) => c.classList.contains('waiting-question'));
const idsOf = (body) => wrappersOf(body).map((w) => w.querySelector('[data-testid="question-record-card-task"]').textContent.match(/LIN-\d+/)[0]);
const wrapperFor = (body, identifier) => wrappersOf(body).find((w) => w.querySelector('[data-testid="question-record-card-task"]').textContent.includes(identifier));
/** The fresh server markup for `identifiers`, as the route sends it. */
const freshFor = (identifiers) => renderWaitingSection({ rows: [], questions: identifiers.map(row) }, { urlKey: 'ws', owner: true });
/** The merge's result, as a plain copy. */
const merge = (QC, body, html) => {
  const r = QC.mergeWaitingCards(body, html);
  return { count: r.count, removed: [...r.removed] };
};
/** The fresh server markup for an empty owner section (zero rulings). */
const EMPTY = renderWaitingSection({ rows: [], questions: [] }, { urlKey: 'ws', owner: true });

describe('LIN-4242: the fake DOM reads the server markup the way the merge needs', () => {
  test('the parsed section has one keyed wrapper per ruling, and the keys are distinct', async () => {
    const { body, QC } = await world(['LIN-1', 'LIN-2']);
    assert.deepEqual(idsOf(body), ['LIN-1', 'LIN-2']);
    const keys = wrappersOf(body).map((w) => keyOfWrapper(QC, w));
    assert.equal(new Set(keys).size, 2, 'two rulings, two keys');
    assert.deepEqual(keys, ['q-LIN-1', 'q-LIN-2'], 'every key is its question id');
  });
});

describe('LIN-4242: the keyed merge (fake DOM)', () => {
  test('a key only in the fresh set is inserted at its server-order position and bound; the others are untouched', async () => {
    // Witness: drop the `insertBefore` position (append instead) → LIN-2 lands last and the order assertion fails.
    // Witness: drop `initQuestionCards(item.el)` → LIN-2's card is not bound.
    const { body, QC } = await world(['LIN-1', 'LIN-3']);
    const kept = wrapperFor(body, 'LIN-1');
    const result = merge(QC, body, freshFor(['LIN-1', 'LIN-2', 'LIN-3']));
    assert.equal(result.count, 3);
    assert.deepEqual(result.removed, []);
    assert.deepEqual(idsOf(body), ['LIN-1', 'LIN-2', 'LIN-3'], 'server order');
    assert.equal(wrapperFor(body, 'LIN-1'), kept, 'the kept wrapper is the same node');
    const added = wrapperFor(body, 'LIN-2').querySelector('[data-testid="question-record-card"]');
    assert.equal(added.dataset.questionId, 'q-LIN-2', 'the added card is the question it names');
  });

  test('a kept card is the same node, with its typed text and focus intact, and is never re-rendered', async () => {
    // Witness: a merge that replaces kept wrappers (`wrapper.replaceWith(fresh)`) → the node identity and the focus assertions fail.
    const { body, QC, document } = await world(['LIN-1', 'LIN-2']);
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

  test('a key only on the page is removed and reported, unless its answer is still in flight', async () => {
    // Witness: drop the `answerInFlight` guard → the in-flight card is removed and the first assertion fails.
    const { body, QC } = await world(['LIN-1', 'LIN-2']);
    // A question record's card is in flight while its controls are disabled (the answer is being written): holdsCard.
    const inFlight = wrapperFor(body, 'LIN-2').querySelector('[data-testid="question-record-card"]');
    const key2 = QC.questionKeyOf(inFlight);
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

  test('a just-answered key is not re-added by a response requested before it settled', async () => {
    // Witness: drop the `settledKeys.has(key)` skip → LIN-2 is re-added and the count and id assertions fail.
    // The key settles through noteSettled, which app.js calls from RULING_GONE_EVENT (this page answered or dismissed it).
    const { body, QC } = await world(['LIN-1', 'LIN-2']);
    const answeredKey = QC.questionKeyOf(wrapperFor(body, 'LIN-2').querySelector('[data-testid="question-record-card"]'));
    QC.noteSettled(answeredKey);
    wrapperFor(body, 'LIN-2').remove(); // the page has already removed the answered card (onRulingGone)
    // The response was requested before the answer, so it still lists LIN-2.
    const result = merge(QC, body, freshFor(['LIN-1', 'LIN-2']));
    assert.equal(result.count, 1, 'the settled LIN-2 is not added');
    assert.deepEqual(idsOf(body), ['LIN-1']);
  });

  test('a card that leaves one response and returns in a later one comes back: a server-side drop is not a settlement', async () => {
    // Witness: restore `noteSettled(key)` in the removal path → the card cannot return and the second merge fails.
    // This is the one→zero→one path for the merge: a ruling that the live guard drops for a moment and restores.
    const { body, QC } = await world(['LIN-1']);
    assert.equal(merge(QC, body, EMPTY).count, 0, 'zero: the card goes');
    assert.deepEqual(idsOf(body), []);
    const back = merge(QC, body, freshFor(['LIN-1']));
    assert.equal(back.count, 1, 'one again: the card returns');
    assert.deepEqual(idsOf(body), ['LIN-1']);
    assert.deepEqual(back.removed, []);
  });

  test('a fresh set that repeats a key contributes it once', async () => {
    const { body, QC } = await world([]);
    const result = merge(QC, body, freshFor(['LIN-1', 'LIN-1']));
    assert.equal(result.count, 1);
    assert.deepEqual(idsOf(body), ['LIN-1']);
  });

  test('a null or empty body is a no-op, not an error', async () => {
    const { QC } = await world([]);
    assert.deepEqual(merge(QC, null, freshFor(['LIN-1'])), { count: 0, removed: [] });
  });
});

// LIN-4549: keepsReaderPlace (question-cards.js) is gone. Its two halves are pinned where they now live: the key gate (another
// question's card is never kept) at the opened task's call site (tests/unit/lin-4549-hold-rule.test.js, "another question's card"),
// and the hold half here, on the one rule (public/question-records.js holdsCard) over the same server markup.
describe('LIN-4242: the hold half of the opened task\'s repaint gate, now the one rule (holdsCard)', () => {
  const cardFor = (QC, body, identifier) => wrapperFor(body, identifier).querySelector('[data-testid="question-record-card"]');

  test('a card with typed text is held', async () => {
    const { body, QC } = await world(['LIN-1']);
    const old = cardFor(QC, body, 'LIN-1');
    old.querySelector('[data-testid="question-record-card-input"]').value = 'my words';
    assert.equal(holdsCard(old), true);
  });

  test('a card with no input, no focus and no answer in flight is not held', async () => {
    // Witness: holdsCard replaced by `true` → this assertion fails.
    const { body, QC } = await world(['LIN-1']);
    assert.equal(holdsCard(cardFor(QC, body, 'LIN-1')), false);
  });

  test('a card with an answer in flight is held, even with no typed text', async () => {
    const { body, QC } = await world(['LIN-1']);
    const old = cardFor(QC, body, 'LIN-1');
    old.dataset.answerInFlight = 'true';
    assert.equal(holdsCard(old), true);
  });

  test('a missing card is never held', async () => {
    assert.equal(holdsCard(null), false);
  });

  test('the merge asks the rule itself: a card with typed words the server no longer lists stays (no hand-off from app.js)', async () => {
    // Witness: drop the holdsCard call from the merge's removal → the typed card is taken out.
    const { body, QC } = await world(['LIN-1']);
    cardFor(QC, body, 'LIN-1').querySelector('[data-testid="question-record-card-input"]').value = 'my words';
    const result = merge(QC, body, EMPTY);
    assert.deepEqual(result.removed, []);
    assert.deepEqual(idsOf(body), ['LIN-1']);
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

/** The live document with `html` as its section, and a fresh merge module over it. */
async function questionWorld(html) {
  const dom = createFakeDom();
  const { document } = dom;
  dom.parse(html, document.body);
  const body = document.querySelector('.waiting-body');
  return { body, document, QC: await mergeModule() };
}

const questionWrappers = (body) => body.children.filter((c) => c.classList.contains('waiting-question'));
const questionIdsOn = (body) => questionWrappers(body).map((w) => w.querySelector('[data-testid="question-record-card"]').dataset.questionId);
const rulingWrappers = (body) => body.children.filter((c) => c.classList.contains('waiting-question'));

describe('LIN-4532: the live Waiting refresh draws question cards (finding-dca7ac9d)', () => {
  test('a question asked after the page load is drawn by the refresh, under its task line, and the earlier question stays', async () => {
    const { body, QC } = await questionWorld(sectionFor({ questions: [question('q-old', 'LIN-8')] }));
    assert.equal(questionWrappers(body).length, 1, 'the page load drew the earlier question');
    const fresh = sectionFor({ questions: [question('q-old', 'LIN-8'), question('q-new')] });
    const result = merge(QC, body, fresh);
    assert.deepEqual(questionIdsOn(body), ['q-old', 'q-new'], 'the new question card is on the page, after the earlier one');
    assert.deepEqual(result.removed, [], 'nothing was taken out');
    assert.equal(result.count, 2, 'the merge counts both questions');
    const wrapper = questionWrappers(body)[1];
    assert.ok(wrapper.classList.contains('waiting-question'), 'a question is a .waiting-question wrapper, the merge unit');
    assert.match(wrapper.querySelector('[data-testid="question-record-card-task"]').textContent, /LIN-9/, 'with its task line (the card draws it, LIN-4549)');
  });

  test('a question already on the page is not drawn again by a later refresh', async () => {
    const { body, QC } = await questionWorld(sectionFor({ questions: [question('q-a')] }));
    const fresh = sectionFor({ questions: [question('q-a')] });
    merge(QC, body, fresh);
    merge(QC, body, fresh);
    assert.deepEqual(questionIdsOn(body), ['q-a'], 'one card for the question, however many refreshes');
  });

  test('a question the server no longer lists is taken out, and reported as removed', async () => {
    const { body, QC } = await questionWorld(sectionFor({ questions: [question('q-gone')] }));
    const result = merge(QC, body, sectionFor({ rulings: ['LIN-1'] }));
    assert.deepEqual(questionIdsOn(body), [], 'an open question that is no longer open leaves the page');
    assert.deepEqual(result.removed, ['q-gone']);
  });

  test('a question answered here stays on the page, settled, though the refresh no longer lists it', async () => {
    const { body, document, QC } = await questionWorld(sectionFor({ questions: [question('q-done')] }));
    const card = document.querySelector('[data-testid="question-record-card"]');
    card.dataset.settled = 'true';
    const result = merge(QC, body, sectionFor({}));
    assert.deepEqual(questionIdsOn(body), ['q-done'], 'the settled card keeps its outcome on the page');
    assert.deepEqual(result.removed, [], 'a settled card is not reported as answered elsewhere');
  });

  test('a question whose answer is in flight (its controls disabled) is kept until the answer lands', async () => {
    const { body, document, QC } = await questionWorld(sectionFor({ questions: [question('q-flight')] }));
    document.querySelectorAll('[data-testid="question-record-card"] button').forEach((b) => { b.disabled = true; });
    merge(QC, body, sectionFor({}));
    assert.deepEqual(questionIdsOn(body), ['q-flight'], 'the in-flight card is not taken out from under its answer');
  });
});
