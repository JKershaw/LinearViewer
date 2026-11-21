/**
 * LIN-4518 (P5, beat 4; ruling lin4518-authorship: "Stamp Harbour comments with a marker; unmarked history reads as a
 * person's"). Authorship is read from the mark (lib/harbour-comment-mark.js), never from a comment's shape.
 *
 * Witnesses: a Harbour write carries the mark (the tracker seam and the proxy seam stamp it); a person's comment without
 * the mark reads as a person's, whatever its shape; history stays as the ruling says (an unmarked comment from before the
 * mark reads as a person's, a Harbour summary reads as Harbour's by its opening line); the look-first hold reads the mark.
 *
 * Run with: node --test tests/unit/lin-4518-authorship-marker.test.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { HARBOUR_COMMENT_MARK, markHarbourComment, isHarbourMarked, isPersonAuthored, withoutHarbourMark } from '../../lib/harbour-comment-mark.js';
import { trackerPortOf } from '../../lib/records-tracker.js';
import { lookFirstOff } from '../../lib/recommendation-look-first.js';

describe('LIN-4518: a Harbour write carries the mark', () => {
  test('the stamp puts the mark on its own last line, once', () => {
    const marked = markHarbourComment('Implementation done: CI green.');
    assert.ok(marked.endsWith(`\n\n${HARBOUR_COMMENT_MARK}`));
    assert.equal(markHarbourComment(marked), marked, 'a marked body is not stamped twice');
    assert.equal(isHarbourMarked(marked), true);
    assert.equal(isPersonAuthored({ body: marked }), false);
  });

  test('Harbour\'s own tracker comment is posted with the mark', async () => {
    const posted = [];
    const provider = {
      async issueDetail() { return { id: 'iss-1' }; },
      async createComment(_scope, _id, body) { posted.push(body); return { success: true, comment: { id: 'cm-1' } }; },
    };
    await trackerPortOf({ provider, scope: 'tok' }).comment('LIN-1', 'Please keep the old flag.');
    assert.equal(posted.length, 1);
    assert.equal(isHarbourMarked(posted[0]), true, 'the tracker seam stamps the mark');
  });
});

describe('LIN-4518: a person\'s comment without the mark reads as a person\'s', () => {
  test('plain words, a heading, a link: each is a person\'s when it carries no mark', () => {
    for (const body of ['Please keep the old flag.', '## Research notes\n\nA plan.', 'PR to merge: https://github.com/acme/app/pull/1']) {
      assert.equal(isPersonAuthored({ body }), true, body.split('\n')[0]);
    }
  });
});

describe('LIN-4518: history stays as the ruling says', () => {
  test('an unmarked comment from before the mark reads as a person\'s, even one Harbour wrote then', () => {
    assert.equal(isPersonAuthored({ body: '### Survey: the task\n\nJust drill.' }), true);
    assert.equal(isPersonAuthored({ body: 'Autopilot: parked.' }), true);
  });

  test('a Harbour summary reads as Harbour\'s by its opening line (the summary\'s own mark)', () => {
    assert.equal(isPersonAuthored({ body: '**Harbour summary** · plan-1 v1\n\nThe plan.' }), false);
  });
});

describe('LIN-4518: the look-first hold reads the mark', () => {
  const WORDS = 'Make the export button download a CSV.';
  const runs = [{ stage: 'survey-task', outcome: 'done', at: '2026-10-06T09:00:00.000Z', dispatchedAt: '2026-10-06T09:00:00.000Z' }];
  const issue = { description: '', state: { type: 'started' }, blockedBy: [] };
  const base = { asked: WORDS, children: [], allRuns: runs, planFacts: { measured: true, hasPlan: false } };
  const after = (body) => ({ id: 'c', body, createdAt: '2026-10-06T10:00:00.000Z' });

  test('a marked Harbour write after the start does not hold the route; the same words unmarked do', () => {
    assert.equal(lookFirstOff(issue, { ...base, comments: [after(markHarbourComment('Please keep the old flag.'))] }), null);
    assert.equal(lookFirstOff(issue, { ...base, comments: [after('Please keep the old flag.')] }), "a person's comment holds it");
  });
});

describe('LIN-4518: the mark is not part of what a comment says', () => {
  test('a reader that shows the words (the selector\'s view) drops the mark line and nothing else', () => {
    const words = '## Review — ABC-20\n\n### Verdict\nApprove.';
    assert.equal(withoutHarbourMark(markHarbourComment(words)), words);
    assert.equal(withoutHarbourMark(words), words, 'an unmarked body is unchanged');
  });
});

