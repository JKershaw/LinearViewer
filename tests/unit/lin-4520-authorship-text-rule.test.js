// LIN-4520: the authorship text rule that stays until Slice 4 (lib/run-trail.js isPersonComment, reportsLandedWork,
// isRuling, isHarbourSummary). The comment-kind table was retired with the verdict readers; these predicates were rewritten
// without it, and this file pins what they answered BEFORE the rewrite, body by body, over a corpus that covers every kind
// the old classifier told apart. A change here is a change to who the selector reads as a person, so it must be a reviewed
// change, never a side effect.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as trail from '../../lib/run-trail.js';

const CORPUS = [
  ['plain-person', 'Can we also cover the empty state? Thanks.'],
  ['plain-person-long', 'I looked at this again and I think the simpler route is better because the cache is not needed.'],
  ['plain-pr-cited', 'Opened https://github.com/o/r/pull/12 for this.'],
  ['ruling', 'Use the simpler route.\n\n— Ruling recorded via Harbour'],
  ['ruling-quoted', 'The mark is "— Ruling recorded via Harbour" in the text.'],
  ['agent-note-posted', 'Plan posted for review, see the description.'],
  ['agent-note-revised', 'Plan revised with the findings applied.'],
  ['agent-note-revision-line', 'Revision 2 — addresses plan-review abc123'],
  ['autopilot', 'Autopilot: started the implementation run.'],
  ['heading-review', '## Review — X1\n\nVerdict: approve\n\nCI: green'],
  ['heading-review-title-close', '## Review of the close-out\n\nApprove.'],
  ['heading-close-out', '## Close-out — X1\n\nMerged https://github.com/o/r/pull/3.'],
  ['heading-autopilot-close-out', '## Autopilot close-out\n\nDone.'],
  ['plan-review-contract', '### Plan Review Verdict\n\n**Verdict:** Approve\n\nBlocking findings: 0'],
  ['plan-review-legacy', '## Plan-review (round 2) — Request Changes\n\nNeeds work.'],
  ['plan-review-with-pr', '### Plan Review Verdict\n\nRequest changes against https://github.com/o/r/pull/9'],
  ['blind-read', '## Blind read\n\nVerdict: better, the change removes a branch and adds a test.\n\nhttps://github.com/o/r/pull/4'],
  ['blind-read-pilot', '## Blind read pilot\n\nTally of reads.'],
  ['survey-task', '## Survey task — X1 @ abc123\n\nFindings.'],
  ['survey-place', '## Survey place: X1 @ abc123\n\nFindings.'],
  ['area-read', '## Area read\n\nNotes https://github.com/o/r/pull/5'],
  ['audit', 'Retrospective audit of X1.\n\nNotes PR https://github.com/o/r/pull/6'],
  ['audit-no-pr', 'Retrospective audit of X1 with no PR.'],
  ['harbour-summary', '## Plan summary\n\n*Harbour summary, not the plan.*'],
  ['review-title-no-heading-first', 'Intro line.\n\n## Review\n\nApprove conditional.'],
  ['close-out-plain-line', 'Close-out: merged.\n\nhttps://github.com/o/r/pull/7'],
  ['close-out-plain-no-pr', 'Close-out: nothing left to do.'],
  ['empty', ''],
  ['whitespace-only', '   \n  \n'],
  ['agent-note-with-pr', 'Plan posted: https://github.com/o/r/pull/8'],
  ['heading-plain-person', '## My thoughts\n\nI prefer option B.'],
  ['quote-review-heading-later', 'I think the approach is fine.\n\n### Review\n\nApprove'],
];

// Captured from the classifier before LIN-4520 (COMMENT_KINDS + isPersonComment/reportsLandedWork), on main fc6849b1a.
// LIN-4520 (finding-ca44ecba): a review's verdict words no longer make work landed; only a cited PR does. The four review
// rows below read landed: false for that reason. Their `person` answers (the authorship rule) are unchanged.
const EXPECTED = {
  "plain-person": {
    "person": true,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "plain-person-long": {
    "person": true,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "plain-pr-cited": {
    "person": false,
    "landed": true,
    "ruling": false,
    "summary": false
  },
  "ruling": {
    "person": true,
    "landed": false,
    "ruling": true,
    "summary": false
  },
  "ruling-quoted": {
    "person": true,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "agent-note-posted": {
    "person": false,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "agent-note-revised": {
    "person": false,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "agent-note-revision-line": {
    "person": false,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "autopilot": {
    "person": false,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "heading-review": {
    "person": false,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "heading-review-title-close": {
    "person": false,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "heading-close-out": {
    "person": false,
    "landed": true,
    "ruling": false,
    "summary": false
  },
  "heading-autopilot-close-out": {
    "person": false,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "plan-review-contract": {
    "person": false,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "plan-review-legacy": {
    "person": false,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "plan-review-with-pr": {
    "person": false,
    "landed": true,
    "ruling": false,
    "summary": false
  },
  "blind-read": {
    "person": false,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "blind-read-pilot": {
    "person": false,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "survey-task": {
    "person": false,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "survey-place": {
    "person": false,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "area-read": {
    "person": false,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "audit": {
    "person": false,
    "landed": true,
    "ruling": false,
    "summary": false
  },
  "audit-no-pr": {
    "person": true,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "harbour-summary": {
    "person": false,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "review-title-no-heading-first": {
    "person": false,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "close-out-plain-line": {
    "person": false,
    "landed": true,
    "ruling": false,
    "summary": false
  },
  "close-out-plain-no-pr": {
    "person": false,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "empty": {
    "person": true,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "whitespace-only": {
    "person": true,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "agent-note-with-pr": {
    "person": false,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "heading-plain-person": {
    "person": false,
    "landed": false,
    "ruling": false,
    "summary": false
  },
  "quote-review-heading-later": {
    "person": false,
    "landed": false,
    "ruling": false,
    "summary": false
  }
};

describe('LIN-4520: authorship text rule (run-trail)', () => {
  test('the corpus covers every name in the expected table', () => {
    assert.deepEqual(CORPUS.map(([name]) => name).sort(), Object.keys(EXPECTED).sort());
  });

  for (const [name, body] of CORPUS) {
    test(`${name}: person, landed, ruling and summary as before`, () => {
      const c = { body, createdAt: '2026-11-20T10:00:00.000Z' };
      const got = {
        person: trail.isPersonComment(c),
        landed: trail.reportsLandedWork(c),
        ruling: trail.isRuling(c),
        summary: trail.isHarbourSummary(c),
      };
      assert.deepEqual(got, EXPECTED[name]);
    });
  }

  test('the removed classifier and verdict readers are gone from the module', () => {
    for (const gone of ['COMMENT_KINDS', 'commentKindOf', 'extractVerdict', 'readTrail', 'latestReviewComment', 'landingPrUrls', 'parseBlindRead', 'SURVEY_KINDS']) {
      assert.equal(gone in trail, false, gone);
    }
  });
});
