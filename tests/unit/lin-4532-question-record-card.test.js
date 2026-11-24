/**
 * LIN-4532 (LIN-4529 P2b): the question record card (lib/question-record-card.js), the markup both pages and the browser handler read.
 *
 * What is pinned, and what it fails without the change:
 *   - the card carries the question id and workspace, and offers an option button per option, the recommended one first and marked
 *     (LIN-4551: marked by its "recommended" label, not the main button style, which no option keeps);
 *   - a run still working is read-only: no option, no words box, no Answer or dismiss control (the route would refuse them);
 *   - the question's own words are escaped, never written as markup;
 *   - "if you don't answer" is the question's words, else worded by whether the run is still waiting;
 *   - the outcome wording says what happened: resumed; not resumed because stopped; no session left; or the route's own error.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderQuestionRecordCard, questionOutcomeText, questionIfUnanswered, questionActionPath } from '../../lib/question-record-card.js';

const row = (over = {}) => ({
  questionId: 'q-1', asks: 'Ship it?', options: ['left', 'right'], recommended: 'right', ifUnanswered: 'pick right',
  state: 'resumable', interactive: true, ...over,
});

describe('renderQuestionRecordCard', () => {
  test('carries the question id and workspace, and offers each option, the recommended one first and marked', () => {
    const html = renderQuestionRecordCard(row(), { urlKey: 'ws-1' });
    assert.match(html, /data-question-id="q-1"/);
    assert.match(html, /data-url-key="ws-1"/);
    const optionTags = html.match(/<button[^>]*question-record-card-option[^>]*>[^<]*</g) || [];
    assert.equal(optionTags.length, 2);
    assert.match(optionTags[0], />right</, 'the recommended option comes first');
    // LIN-4551: the recommended option is marked by its label; it no longer keeps the main button style (the highlight then never
    // moved to another choice), so neither option carries btn--primary.
    assert.match(html, /data-option-id="right"[^>]*>right<span[^>]*data-testid="question-record-card-recommended"[^>]*>recommended</);
    assert.doesNotMatch(optionTags[0], /btn--primary/);
    assert.match(optionTags[0], /data-recommended="true"/);
    assert.match(optionTags[1], />left</);
    assert.doesNotMatch(optionTags[1], /btn--primary/);
    assert.match(html, /data-testid="question-record-card-input"/);
    assert.match(html, /data-testid="question-record-card-answer"/);
    assert.match(html, /data-testid="question-record-card-dismiss"/);
  });

  test('a recommendation that names no offered option is no recommendation', () => {
    const html = renderQuestionRecordCard(row({ recommended: 'nope' }), { urlKey: 'ws-1' });
    // LIN-4551: Answer is now the card's primary button, so "no option is primary" is read on the options, not the whole card.
    const optionTags = html.match(/<button[^>]*question-record-card-option[^>]*>/g) || [];
    assert.equal(optionTags.length, 2);
    for (const tag of optionTags) assert.doesNotMatch(tag, /btn--primary/);
    assert.doesNotMatch(html, /data-recommended/);
    assert.doesNotMatch(html, /question-record-card-recommended/);
  });

  test('a run still working is read-only: no option, words box, Answer or dismiss', () => {
    const html = renderQuestionRecordCard(row({ interactive: false, state: 'mid-turn' }), { urlKey: 'ws-1' });
    assert.match(html, /data-testid="question-record-card-readonly"/);
    assert.doesNotMatch(html, /data-testid="question-record-card-option"/);
    assert.doesNotMatch(html, /data-testid="question-record-card-input"/);
    assert.doesNotMatch(html, /data-testid="question-record-card-answer"/);
    assert.doesNotMatch(html, /data-testid="question-record-card-dismiss"/);
  });

  test('the question\'s own words are escaped', () => {
    const html = renderQuestionRecordCard(row({ asks: '<img src=x onerror=alert(1)>', options: ['<b>x</b>'], recommended: null }), { urlKey: 'ws-1' });
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x/);
    assert.doesNotMatch(html, /<b>x<\/b>/);
    assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  });
});

describe('questionIfUnanswered', () => {
  test('the question\'s own words, when it has them', () => {
    assert.equal(questionIfUnanswered(row({ ifUnanswered: ' pick right ' })), 'pick right');
  });
  test('a waiting run keeps waiting; a run that has ended says nothing further runs', () => {
    assert.equal(questionIfUnanswered(row({ ifUnanswered: null, state: 'resumable' })), 'Harbour keeps waiting for your answer.');
    assert.equal(questionIfUnanswered(row({ ifUnanswered: null, state: 'stopped' })), 'Nothing further runs; the run has ended.');
  });
});

describe('questionOutcomeText', () => {
  test('a resumed answer says the run resumes with it', () => {
    assert.equal(questionOutcomeText('answer', { resumed: true }), 'Answered. The run resumes with your answer.');
  });
  test('a resumed dismissal says the run takes its fallback', () => {
    assert.equal(questionOutcomeText('dismiss', { resumed: true }), 'Dismissed. The run is told and takes its fallback.');
  });
  test('a stopped run is said to be not resumed, for an answer and for a dismissal', () => {
    assert.equal(questionOutcomeText('answer', { resumed: false, notResumedBecause: 'stopped' }), 'Answered. The run was stopped, so it was not resumed.');
    assert.equal(questionOutcomeText('dismiss', { resumed: false, notResumedBecause: 'stopped' }), 'Dismissed. The run was stopped, so it was not resumed.');
  });
  test('no session left is said, with the next step', () => {
    assert.equal(questionOutcomeText('answer', { resumed: false, notResumedBecause: 'no-session' }), 'Answered. No session is left to resume; dispatch the next stage to carry it on.');
  });
  test('a refusal reads as the route\'s own error', () => {
    assert.equal(questionOutcomeText('answer', { error: 'The run is still working' }), 'The run is still working');
  });
});

describe('questionActionPath', () => {
  test('is the one route for the action, with the ids encoded', () => {
    assert.equal(questionActionPath('ws a', 'q/1', 'answer'), '/workspace/ws%20a/questions/q%2F1/answer');
    assert.equal(questionActionPath('ws-1', 'q-1', 'dismiss'), '/workspace/ws-1/questions/q-1/dismiss');
  });
});
