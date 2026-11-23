/**
 * LIN-4532 (LIN-4529 P2b): the browser handler for a question record card (public/question-records.js), run under Node with a stubbed
 * document and fetch. The module is an ES module (it imports the shared leaf), so loadWorld's classic-script vm cannot load it; the
 * handler is the one delegated click listener it registers, driven here with the elements the card markup names.
 *
 * What is pinned, and what it fails without the change:
 *   - an answer with neither an option nor words is refused on the card and sends nothing;
 *   - an answer sends the chosen option and the person's own words together, to the answer route of that question and workspace;
 *   - a resumed answer settles the card and shows the route's outcome, and the card's controls stay off;
 *   - a refused answer shows the route's error and gives the controls back (nothing was recorded);
 *   - a dismissal posts to the dismiss route, and a stopped run's dismissal says it was not resumed;
 *   - a settled card takes no further press.
 */
import { describe, test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let onClick;
const calls = [];
let nextResponse = null;

function element(tag, testid, { dataset = {}, value = '' } = {}) {
  const node = {
    tag, dataset, value, disabled: false, textContent: '', parent: null, children: [], attrs: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    matches(sel) { return testid !== null && sel === `[data-testid="${testid}"]`; },
    closest(sel) {
      for (let n = this; n; n = n.parent) if (n.matches(sel)) return n;
      return null;
    },
  };
  return node;
}

function card({ urlKey = 'ws-1', questionId = 'q-1' } = {}) {
  const c = element('div', 'question-record-card', { dataset: { urlKey, questionId } });
  c.feedback = element('span', 'question-record-card-feedback');
  c.input = element('textarea', 'question-record-card-input', { value: '' });
  c.left = element('button', 'question-record-card-option', { dataset: { optionId: 'left' } });
  c.right = element('button', 'question-record-card-option', { dataset: { optionId: 'right' } });
  c.answerBtn = element('button', 'question-record-card-answer');
  c.dismissBtn = element('button', 'question-record-card-dismiss');
  c.children = [c.left, c.right, c.input, c.answerBtn, c.dismissBtn, c.feedback];
  for (const ch of c.children) ch.parent = c;
  const find = (sel) => c.children.find((ch) => ch.matches(sel)) || null;
  c.querySelector = (sel) => (sel === '[data-testid="question-record-card-feedback"]' ? c.feedback : find(sel));
  c.querySelectorAll = (sel) => c.children.filter((ch) => (sel === 'button, textarea' ? ch.tag === 'button' || ch.tag === 'textarea' : ch.matches(sel)));
  return c;
}

before(async () => {
  globalThis.document = { addEventListener: (type, fn) => { if (type === 'click') onClick = fn; } };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body) });
    return nextResponse;
  };
  await import('../../public/question-records.js');
  assert.equal(typeof onClick, 'function', 'the module registers its click listener on the document');
});

afterEach(() => {
  calls.length = 0;
  nextResponse = null;
});

/** A click on `target` inside `c`, as the document's listener receives it. */
function clickOn(target) {
  return onClick({ target });
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const refused = (status, body) => ({ ok: false, status, json: async () => body });

describe('the question record card, in the browser', () => {
  test('an answer with neither an option nor words is refused on the card and sends nothing', async () => {
    const c = card();
    await clickOn(c.answerBtn);
    assert.equal(calls.length, 0);
    assert.equal(c.feedback.textContent, 'Choose an option or write your own answer.');
  });

  test('an answer sends the chosen option and the person\'s own words together, to that question\'s answer route', async () => {
    const c = card();
    nextResponse = ok({ answered: true, resumed: true });
    clickOn(c.left);
    c.input.value = '  Keep the logs.  ';
    await clickOn(c.answerBtn);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, '/workspace/ws-1/questions/q-1/answer');
    assert.deepEqual(calls[0].body, { option: 'left', words: 'Keep the logs.' });
  });

  test('a resumed answer settles the card, shows the outcome, and keeps its controls off', async () => {
    const c = card();
    nextResponse = ok({ answered: true, resumed: true });
    clickOn(c.right);
    await clickOn(c.answerBtn);
    assert.equal(c.dataset.settled, 'true');
    assert.equal(c.feedback.textContent, 'Answered. The run resumes with your answer.');
    assert.equal(c.answerBtn.disabled, true);
    assert.equal(c.input.disabled, true);
  });

  test('a refused answer shows the route\'s error and gives the controls back', async () => {
    const c = card();
    nextResponse = refused(409, { error: 'This question already has a different answer' });
    clickOn(c.left);
    await clickOn(c.answerBtn);
    assert.equal(c.feedback.textContent, 'This question already has a different answer');
    assert.equal(c.answerBtn.disabled, false);
    assert.equal(c.dataset.settled, undefined);
  });

  test('a dismissal posts to the dismiss route; a stopped run is said to be not resumed', async () => {
    const c = card({ questionId: 'q-9', urlKey: 'ws-2' });
    nextResponse = ok({ dismissed: true, resumed: false, notResumedBecause: 'stopped' });
    await clickOn(c.dismissBtn);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/workspace/ws-2/questions/q-9/dismiss');
    assert.deepEqual(calls[0].body, {});
    assert.equal(c.feedback.textContent, 'Dismissed. The run was stopped, so it was not resumed.');
    assert.equal(c.dataset.settled, 'true');
  });

  test('a settled card takes no further press', async () => {
    const c = card();
    nextResponse = ok({ answered: true, resumed: true });
    clickOn(c.left);
    await clickOn(c.answerBtn);
    const before = calls.length;
    await clickOn(c.dismissBtn);
    assert.equal(calls.length, before);
  });

  test('a press outside any question card does nothing', async () => {
    const outside = element('button', 'something-else');
    await clickOn(outside);
    assert.equal(calls.length, 0);
  });
});
