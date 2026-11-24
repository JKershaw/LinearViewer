/**
 * LIN-4532 (LIN-4529 P2b): the browser handler for a question record card (public/question-records.js), run natively over the shared
 * fake DOM (importWorld, tests/unit/helpers/import-world.js). The card is the REAL markup from lib/question-record-card.js, parsed into
 * the fake document, so the handler reads the elements a browser would; clicks reach its document listener through clickDelegated.
 *
 * What is pinned, and what it fails without the change:
 *   - an answer with neither an option nor words is refused on the card and sends nothing;
 *   - an answer sends the chosen option and the person's own words together, to that question's answer route;
 *   - a resumed answer settles the card, shows the outcome, and keeps its controls off;
 *   - a refused answer shows the route's error and gives the controls back (nothing was recorded);
 *   - a dismissal posts to the dismiss route, and a stopped run's dismissal says it was not resumed;
 *   - a settled card takes no further press.
 */
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { importWorld } from './helpers/import-world.js';
import { clickDelegated } from './helpers/client-world.js';
import { renderQuestionRecordCard } from '../../lib/question-record-card.js';

const calls = [];
let nextResponse = null;
let world;

before(async () => {
  world = await importWorld({
    globals: {
      fetch: async (url, init) => {
        calls.push({ url, method: init.method, body: JSON.parse(init.body) });
        return nextResponse;
      },
    },
  });
  await world.importPage('question-records.js');
});

after(() => world?.restore());

afterEach(() => {
  calls.length = 0;
  nextResponse = null;
});

const row = (over = {}) => ({
  questionId: 'q-1', asks: 'Ship it?', options: ['left', 'right'], recommended: 'right', ifUnanswered: 'pick right',
  state: 'resumable', interactive: true, ...over,
});

/** Draws the real card for `r` into the fake document and returns its element. */
function drawCard(r, urlKey = 'ws-1') {
  world.document.body.innerHTML = renderQuestionRecordCard(r, { urlKey });
  return world.document.querySelector('[data-testid="question-record-card"]');
}

const part = (card, testid) => card.querySelector(`[data-testid="${testid}"]`);
const option = (card, id) => card.querySelector(`[data-testid="question-record-card-option"][data-option-id="${id}"]`);
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const refused = (status, body) => ({ ok: false, status, json: async () => body });

describe('the question record card, in the browser', () => {
  test('an answer with neither an option nor words is refused on the card and sends nothing', async () => {
    const card = drawCard(row());
    await clickDelegated(part(card, 'question-record-card-answer'));
    assert.equal(calls.length, 0);
    assert.equal(part(card, 'question-record-card-feedback').textContent, 'Choose an option or write your own answer.');
  });

  test('an answer sends the chosen option and the person\'s own words together, to that question\'s answer route', async () => {
    const card = drawCard(row());
    nextResponse = ok({ answered: true, resumed: true });
    await clickDelegated(option(card, 'left'));
    part(card, 'question-record-card-input').value = '  Keep the logs.  ';
    await clickDelegated(part(card, 'question-record-card-answer'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, '/workspace/ws-1/questions/q-1/answer');
    assert.deepEqual(calls[0].body, { option: 'left', words: 'Keep the logs.' });
  });

  test('a resumed answer settles the card, shows the outcome, and keeps its controls off', async () => {
    const card = drawCard(row());
    nextResponse = ok({ answered: true, resumed: true });
    await clickDelegated(option(card, 'right'));
    await clickDelegated(part(card, 'question-record-card-answer'));
    assert.equal(card.dataset.settled, 'true');
    assert.equal(part(card, 'question-record-card-feedback').textContent, 'Answered. The run resumes with your answer.');
    assert.equal(part(card, 'question-record-card-answer').disabled, true);
    assert.equal(part(card, 'question-record-card-input').disabled, true);
  });

  test('a refused answer shows the route\'s error and gives the controls back', async () => {
    const card = drawCard(row());
    nextResponse = refused(409, { error: 'This question already has a different answer' });
    await clickDelegated(option(card, 'left'));
    await clickDelegated(part(card, 'question-record-card-answer'));
    assert.equal(part(card, 'question-record-card-feedback').textContent, 'This question already has a different answer');
    assert.equal(part(card, 'question-record-card-answer').disabled, false);
    assert.equal(card.dataset.settled, undefined);
  });

  // LIN-4549: a refusal as settled elsewhere (`ruling-settled`) marks the card so the one keep-a-card rule lets it go on the next
  // refresh; any other refusal does not, and neither leaves the answer flagged as in flight.
  test('a refusal as settled elsewhere marks the card for the next refresh; another refusal does not', async () => {
    const stale = drawCard(row());
    nextResponse = refused(409, { error: 'This ruling was already answered or dismissed.', code: 'ruling-settled' });
    await clickDelegated(option(stale, 'left'));
    await clickDelegated(part(stale, 'question-record-card-answer'));
    assert.equal(stale.dataset.settledElsewhere, 'true');
    assert.equal(stale.dataset.answerInFlight, undefined);
    assert.equal(stale.dataset.settled, undefined, 'not settled by this page');
    const other = drawCard(row({ questionId: 'q-2' }));
    nextResponse = refused(409, { error: 'This question already has a different answer', code: 'decision-exists' });
    await clickDelegated(option(other, 'left'));
    await clickDelegated(part(other, 'question-record-card-answer'));
    assert.equal(other.dataset.settledElsewhere, undefined);
  });

  test('a dismissal posts to the dismiss route; a stopped run is said to be not resumed', async () => {
    const card = drawCard(row({ questionId: 'q-9' }), 'ws-2');
    nextResponse = ok({ dismissed: true, resumed: false, notResumedBecause: 'stopped' });
    await clickDelegated(part(card, 'question-record-card-dismiss'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/workspace/ws-2/questions/q-9/dismiss');
    assert.deepEqual(calls[0].body, {});
    assert.equal(part(card, 'question-record-card-feedback').textContent, 'Dismissed. The run was stopped, so it was not resumed.');
    assert.equal(card.dataset.settled, 'true');
  });

  test('a settled card takes no further press', async () => {
    const card = drawCard(row());
    nextResponse = ok({ answered: true, resumed: true });
    await clickDelegated(option(card, 'left'));
    await clickDelegated(part(card, 'question-record-card-answer'));
    const sent = calls.length;
    await clickDelegated(part(card, 'question-record-card-dismiss'));
    assert.equal(calls.length, sent);
  });

  test('a press outside any question card does nothing', async () => {
    world.document.body.innerHTML = '<button data-testid="something-else">x</button>';
    await clickDelegated(world.document.querySelector('[data-testid="something-else"]'));
    assert.equal(calls.length, 0);
  });
});
