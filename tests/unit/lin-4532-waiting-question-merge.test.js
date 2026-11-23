/**
 * LIN-4532 (finding-dca7ac9d): Home's live Waiting refresh merges open question cards, not only ruling cards.
 *
 * public/question-cards.js `mergeWaitingCards` runs in a vm sandbox over the fake DOM (tests/unit/helpers/fake-dom.js). The fresh
 * markup is the real `renderWaitingSection` output for the questions the route now passes it, so the merge sees the same
 * `.waiting-question` wrappers and `question-record-card` markup the server sends.
 *
 * What each test pins, and what it fails without the change:
 *   - a question asked after the page load is drawn by the refresh (the fragment carries it, and the merge keeps the wrapper):
 *     without the fragment's `questions`, or without the merge reading `.waiting-question`, the card never appears;
 *   - a question the server stops listing is taken out, unless it is settled here or its request is in flight: without the
 *     held-question rule, a settled card would vanish on the next tick;
 *   - a question already on the page is not drawn twice: without the question key, every tick adds a copy.
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
const URL_KEY = 'ws';

const ruling = (identifier) => ({
  decision: { decision_id: `d-${identifier}`, question: `Which for ${identifier}?` },
  decisionCase: [],
  anchor: { loopId: `r-${identifier}`, issueId: `id-${identifier}`, issueIdentifier: identifier, issueTitle: `Title ${identifier}`, workspaceUrlKey: URL_KEY, taskDecisionId: null },
  disposition: 'resumable',
  effect: 'resume',
  canReply: true,
});

const question = (questionId, ticket = 'LIN-9') => ({
  questionId, asks: `Which for ${questionId}?`, options: ['left', 'right'], recommended: 'left', ifUnanswered: 'pick left',
  taskId: 'task-9', ticket, runId: 'run-1', askedAt: '2026-11-23T09:00:00.000Z', state: 'resumable', reason: null, interactive: true,
});

/** The server's section for a page: `rulings` and `questions` as the route draws them. */
const sectionFor = ({ rulings = [], questions = [] }) => renderWaitingSection(
  { rows: rulings.map(ruling), titles: {}, questions },
  { urlKey: URL_KEY, owner: true },
);

/** The live document with `html` as its section, and the merge's sandbox over it. */
function world(html) {
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

/** The merge's result, copied into this realm (the sandbox's arrays would fail strict deep equality). */
const merge = (QC, body, html) => {
  const r = QC.mergeWaitingCards(body, html);
  return { count: r.count, removed: [...r.removed] };
};

const questionWrappers = (body) => body.children.filter((c) => c.classList.contains('waiting-question'));
const questionIdsOn = (body) => questionWrappers(body).map((w) => w.querySelector('[data-testid="question-record-card"]').dataset.questionId);
const rulingWrappers = (body) => body.children.filter((c) => c.classList.contains('waiting-card'));

describe('LIN-4532: the live Waiting refresh draws question cards (finding-dca7ac9d)', () => {
  test('a question asked after the page load is drawn by the refresh, under its task line, and the ruling stays', () => {
    const { body, QC } = world(sectionFor({ rulings: ['LIN-1'] }));
    assert.equal(questionWrappers(body).length, 0, 'the page load drew no question');
    const fresh = sectionFor({ rulings: ['LIN-1'], questions: [question('q-new')] });
    const result = merge(QC, body, fresh);
    assert.deepEqual(questionIdsOn(body), ['q-new'], 'the new question card is on the page');
    assert.equal(rulingWrappers(body).length, 1, 'the ruling card is still there');
    assert.deepEqual(result.removed, [], 'nothing was taken out');
    assert.equal(result.count, 2, 'the merge counts the question with the ruling');
    const wrapper = questionWrappers(body)[0];
    assert.equal(wrapper.classList.contains('waiting-card'), false, 'a question is never a waiting-card wrapper (the lesson in front-end-pages)');
    assert.match(wrapper.querySelector('[data-testid="waiting-task-line"]').textContent, /LIN-9/, 'under its task line');
  });

  test('a question already on the page is not drawn again by a later refresh', () => {
    const { body, QC } = world(sectionFor({ questions: [question('q-a')] }));
    const fresh = sectionFor({ questions: [question('q-a')] });
    merge(QC, body, fresh);
    merge(QC, body, fresh);
    assert.deepEqual(questionIdsOn(body), ['q-a'], 'one card for the question, however many refreshes');
  });

  test('a question the server no longer lists is taken out, and reported as removed', () => {
    const { body, QC } = world(sectionFor({ questions: [question('q-gone')] }));
    const result = merge(QC, body, sectionFor({ rulings: ['LIN-1'] }));
    assert.deepEqual(questionIdsOn(body), [], 'an open question that is no longer open leaves the page');
    assert.deepEqual(result.removed, ['question:q-gone']);
  });

  test('a question answered here stays on the page, settled, though the refresh no longer lists it', () => {
    const { body, document, QC } = world(sectionFor({ questions: [question('q-done')] }));
    const card = document.querySelector('[data-testid="question-record-card"]');
    card.dataset.settled = 'true';
    const result = merge(QC, body, sectionFor({}));
    assert.deepEqual(questionIdsOn(body), ['q-done'], 'the settled card keeps its outcome on the page');
    assert.deepEqual(result.removed, [], 'a settled card is not reported as answered elsewhere');
  });

  test('a question whose answer is in flight (its controls disabled) is kept until the answer lands', () => {
    const { body, document, QC } = world(sectionFor({ questions: [question('q-flight')] }));
    document.querySelectorAll('[data-testid="question-record-card"] button').forEach((b) => { b.disabled = true; });
    merge(QC, body, sectionFor({}));
    assert.deepEqual(questionIdsOn(body), ['q-flight'], 'the in-flight card is not taken out from under its answer');
  });
});
