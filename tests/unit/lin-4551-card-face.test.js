/**
 * LIN-4551 (LIN-4546 piece 3/7): the card's face, in the shared leaf (lib/question-record-card.js), so every host gets it at once.
 *
 * What is pinned (each fails on the card before LIN-4551, which leads with the whole ask as one paragraph):
 *   - the card leads with the one-line question (`short`, from the reader: lib/open-questions.js gives every row one, written or
 *     derived), and the full ask sits in a closed <details> fold;
 *   - the fold keeps paragraphs, line breaks and lists, and emits nothing else (only p, br, ul, ol, li);
 *   - hostile input in the ask (<script>, <img onerror>, a markdown link to javascript:) is text in the fold: no tag, no link;
 *   - options are one style: the recommended one comes first and carries a "recommended" label, and no option is the main button;
 *   - Answer is the primary button, dismiss a quiet one;
 *   - the read-only state ("Harbour is still working") keeps its words and offers no control, under the same lead and fold;
 *   - the outcome words read the question's end when the route refuses an ended question (`ended` on its 409): a person's dismissal
 *     says "Dismissed", an agent's withdrawal keeps its own word, an answer says "Answered".
 * The browser half (aria-pressed and the computed pressed style moving with the choice) is witnessed end to end in
 * tests/e2e/lin-4551-card-face.spec.js; the route's `ended` in tests/unit/lin-4551-settled-end-words.test.js.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderQuestionRecordCard, questionOutcomeText } from '../../lib/question-record-card.js';
import { questionShortOf } from '../../lib/records/question-short.js';
import { longQuestion } from '../../lib/sample-data/question-workload.js';

const row = (over = {}) => ({
  questionId: 'q-1', short: 'Which sheet should the card\'s rules live in?', asks: 'Which sheet should the card\'s rules live in?',
  options: ['style.css', 'a card sheet', 'session.css'], recommended: 'a card sheet', ifUnanswered: 'take style.css',
  state: 'resumable', interactive: true, ticket: 'LIN-1', title: 'Card face', ...over,
});

const render = (over) => renderQuestionRecordCard(row(over), { urlKey: 'ws-1' });

/** The card's fold: the <details> element, whole. Fails the test when there is none. */
function foldOf(html) {
  const m = html.match(/<details\b[^>]*data-testid="question-record-card-ask"[^>]*>[\s\S]*?<\/details>/);
  assert.ok(m, 'the card has a fold (<details data-testid="question-record-card-ask">)');
  return m[0];
}

/** The fold's body: what sits inside data-testid="question-record-card-ask-body". */
function foldBodyOf(html) {
  const fold = foldOf(html);
  const m = fold.match(/data-testid="question-record-card-ask-body"[^>]*>([\s\S]*)<\/div>\s*<\/details>$/);
  assert.ok(m, 'the fold has a body (data-testid="question-record-card-ask-body")');
  return m[1];
}

/** The lead: the text of data-testid="question-record-card-question". */
function leadOf(html) {
  const m = html.match(/data-testid="question-record-card-question"[^>]*>([\s\S]*?)<\/p>/);
  assert.ok(m, 'the card has a lead');
  return m[1];
}

const optionTags = (html) => html.match(/<button[^>]*data-testid="question-record-card-option"[^>]*>[\s\S]*?<\/button>/g) || [];

describe('the lead and the fold', () => {
  test('the card leads with `short`, not the whole ask, and the whole ask sits in a closed fold', () => {
    const sample = longQuestion(0);
    const html = render({ asks: sample.asks, short: questionShortOf({ asks: sample.asks }) });
    assert.equal(leadOf(html), questionShortOf({ asks: sample.asks }).replace(/'/g, '&#39;').replace(/"/g, '&quot;'));
    assert.ok(leadOf(html).length <= 220, 'the lead is one line, not the ask');
    const fold = foldOf(html);
    assert.doesNotMatch(fold.match(/<details\b[^>]*>/)[0], /\bopen\b/, 'the fold starts closed');
    assert.match(fold, /<summary\b/, 'the fold has a summary to open it by');
  });

  test('a question with no written `short` leads with the derived one (the reader\'s questionShortOf)', () => {
    const sample = longQuestion(1);
    const derived = questionShortOf({ asks: sample.asks });
    assert.ok(derived && derived !== sample.asks, 'the fixture derives a lead shorter than the ask');
    const html = render({ asks: sample.asks, short: derived });
    assert.equal(leadOf(html), derived.replace(/'/g, '&#39;').replace(/"/g, '&quot;'));
  });

  test('paragraphs, line breaks and lists survive the fold, and nothing else is emitted', () => {
    const asks = [
      'First paragraph, line one.',
      'Line two of the same paragraph.',
      '',
      'What I found:',
      '- one with <b>markup</b>',
      '- two',
      '* three',
      '',
      'The routes:',
      '1. first route',
      '2. second route',
      '',
      'Last paragraph.',
    ].join('\n');
    const body = foldBodyOf(render({ asks, short: 'Which route?' }));
    const tags = [...body.matchAll(/<\/?([a-z0-9]+)\b[^>]*>/gi)].map((m) => m[1].toLowerCase());
    assert.deepEqual([...new Set(tags)].sort().filter((t) => !['p', 'br', 'ul', 'ol', 'li'].includes(t)), [], `only p, br, ul, ol, li: ${tags}`);
    assert.ok((body.match(/<p>/g) || []).length >= 3, 'each paragraph is its own <p>');
    assert.match(body, /First paragraph, line one\.<br>\s*Line two of the same paragraph\./, 'a single break is kept as <br>');
    const ul = body.match(/<ul>([\s\S]*?)<\/ul>/);
    assert.ok(ul, 'a "- " list is a <ul>');
    assert.equal((ul[1].match(/<li>/g) || []).length, 3, 'each "- " or "* " line is an item');
    assert.match(ul[1], /<li>one with &lt;b&gt;markup&lt;\/b&gt;<\/li>/, 'markup in an item is text');
    const ol = body.match(/<ol>([\s\S]*?)<\/ol>/);
    assert.ok(ol, 'a "1. " list is an <ol>');
    assert.deepEqual([...ol[1].matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1]), ['first route', 'second route']);
    assert.match(body, /<p>Last paragraph\.<\/p>/);
  });

  test('hostile input in the ask is text in the fold: no script, no image, no link', () => {
    const asks = [
      'Intro paragraph.',
      '',
      '<script>alert(1)</script>',
      '',
      '<img src=x onerror=alert(2)>',
      '',
      '- [click me](javascript:alert(3))',
      '- <a href="javascript:alert(4)">four</a>',
    ].join('\n');
    const html = render({ asks, short: '<script>alert(5)</script> which?' });
    const body = foldBodyOf(html);
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /<img/i);
    assert.doesNotMatch(html, /<a\s[^>]*href="javascript:/i);
    assert.doesNotMatch(body, /<a\b/i, 'the fold makes no link, from markdown or markup');
    assert.match(body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(body, /&lt;img src=x onerror=alert\(2\)&gt;/);
    assert.match(body, /\[click me\]\(javascript:alert\(3\)\)/, 'a markdown link stays its own text');
    assert.match(body, /&lt;a href=&quot;javascript:alert\(4\)&quot;&gt;four&lt;\/a&gt;/);
    assert.match(leadOf(html), /^&lt;script&gt;alert\(5\)&lt;\/script&gt; which\?$/, 'the lead is escaped too');
  });
});

describe('the options and controls', () => {
  test('the recommended option comes first, labelled "recommended"; every option shares one style and none is the main button', () => {
    const tags = optionTags(render());
    assert.equal(tags.length, 3);
    assert.match(tags[0], /data-option-id="a card sheet"/, 'the recommended option is first');
    assert.match(tags[0], /data-recommended="true"/);
    assert.match(tags[0], /data-testid="question-record-card-recommended"[^>]*>recommended</, 'it carries a "recommended" label');
    for (const t of tags.slice(1)) assert.doesNotMatch(t, /question-record-card-recommended/, 'only the recommended option is labelled');
    for (const t of tags) assert.doesNotMatch(t, /btn--primary/, 'no option keeps the main button style');
    const classOf = (t) => t.match(/^<button[^>]*\bclass="([^"]*)"/)[1];
    assert.equal(new Set(tags.map(classOf)).size, 1, `all options share one class list: ${tags.map(classOf)}`);
  });

  test('Answer is the primary button; dismiss is a quiet one', () => {
    const html = render();
    const answer = html.match(/<button[^>]*data-testid="question-record-card-answer"[^>]*>/)[0];
    const dismiss = html.match(/<button[^>]*data-testid="question-record-card-dismiss"[^>]*>/)[0];
    assert.match(answer, /class="[^"]*\bbtn\b[^"]*\bbtn--primary\b/, 'Answer is .btn.btn--primary');
    assert.match(dismiss, /class="[^"]*\bbtn--(quiet|ghost)\b/, 'dismiss is a quiet button');
    assert.doesNotMatch(dismiss, /btn--primary/);
  });

  test('the read-only state keeps its words and offers no control, under the same lead and fold', () => {
    const sample = longQuestion(2);
    const html = render({ interactive: false, state: 'mid-turn', asks: sample.asks, short: questionShortOf({ asks: sample.asks }) });
    assert.match(html, /data-testid="question-record-card-readonly"[^>]*>Harbour is still working; you can answer when it pauses\.</);
    for (const id of ['option', 'input', 'answer', 'dismiss']) assert.doesNotMatch(html, new RegExp(`data-testid="question-record-card-${id}"`));
    assert.equal(leadOf(html), questionShortOf({ asks: sample.asks }).replace(/'/g, '&#39;').replace(/"/g, '&quot;'));
    foldBodyOf(html);
  });
});

describe('the outcome words read the question\'s end', () => {
  const refused = (ended) => ({ error: 'This ruling was already answered or dismissed.', code: 'ruling-settled', ended });

  test('a person\'s dismissal says "Dismissed"', () => {
    assert.match(questionOutcomeText('answer', refused('dismissed')), /^Dismissed\b/);
    assert.match(questionOutcomeText('dismiss', refused('dismissed')), /^Dismissed\b/);
  });
  test('an agent\'s withdrawal keeps its own word, and never says "Dismissed"', () => {
    const text = questionOutcomeText('answer', refused('withdrawn'));
    assert.match(text, /withdrawn/i);
    assert.doesNotMatch(text, /dismiss/i);
  });
  test('an answer given elsewhere says "Answered"', () => {
    assert.match(questionOutcomeText('dismiss', refused('answered')), /^Answered\b/);
  });
  test('a dismissal made here still says "Dismissed"', () => {
    assert.equal(questionOutcomeText('dismiss', { dismissed: true, resumed: true }), 'Dismissed. The run is told and takes its fallback.');
  });
});
