/**
 * LIN-4518 (beat 2): the run-evidence box reads its review, its blind read and its landing from the gate's trail
 * (lib/task-standing.js gateTrailOf): the records once the task's newest verdict is a record, else the comment trail.
 * Witnesses: a records verdict shows with its judged commit and no comment; a newer review comment governs; with no
 * records the box reads exactly what it read before.
 */
process.env.NODE_ENV = 'test';

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunEvidence } from '../../lib/run-evidence.js';
import { standingOfComments } from '../helpers/records-trail.js';
import { FINDINGS_NONE } from '../../lib/close-out-findings.js';

const REPO = 'acme/widget';
const PR = (n) => `https://github.com/${REPO}/pull/${n}`;
const T = (hhmm) => `2026-11-21T${hhmm}:00.000Z`;
const HEAD = '459181ba298bc5196054782b3f7a79a45ae28340';
const summary = (id, at, n) => ({ id, createdAt: T(at), body: `Implementation done: ${PR(n)}, CI green.` });
const review = (id, at, n, sha = HEAD.slice(0, 9)) => ({
  id, createdAt: T(at),
  body: `## Code Review\n\nReviewed head \`${sha}\` of ${PR(n)}.\n\n### What CI Did Not Prove\n| # | Claim | In/Out | Discharge |\n| --- | --- | --- | --- |\n| 1 | one claim | In | a repro |\n\n**Verdict: Approve**\nCI: green on \`${sha}\`.`,
});
const open = { readable: true, state: 'open', merged: false, head: { sha: HEAD }, checks: [] };
const statuses = { [PR(2483)]: open };

describe('the run-evidence box on records (LIN-4518, beat 2)', () => {
  test('a records verdict shows its judged commit and time with no review comment on the trail', () => {
    const trailComments = [summary('c1', '09:00', 2483), review('c2', '09:10', 2483)];
    const standing = standingOfComments(trailComments, { statuses });
    const model = buildRunEvidence({ openFindings: FINDINGS_NONE, issueIdentifier: 'LIN-1', comments: [], standing, prStatus: open });
    assert.equal(model.evidence.checked.review.verdict, 'approve');
    assert.equal(model.evidence.checked.review.sha, HEAD, 'the commit the judge read is the record\'s, not a parsed sha');
    assert.deepEqual(model.closeOut.landingPrs ?? model.closeOut.prs.map((p) => p.url), [PR(2483)]);
  });

  test('a review comment posted after the record does not govern: the box reads the record (LIN-4518 beat 4: records only)', () => {
    const earlier = [summary('c1', '09:00', 2483), review('c2', '09:10', 2483)];
    const standing = standingOfComments(earlier, { statuses });
    const later = [...earlier, review('c3', '11:00', 2483, 'aaaaaaa111')];
    const model = buildRunEvidence({ openFindings: FINDINGS_NONE, issueIdentifier: 'LIN-1', comments: later, standing, prStatus: open });
    assert.equal(model.evidence.checked.review.sha, HEAD, 'the verdict the box shows is the record\'s');
  });

  test('with no records standing the box reads no review and no landing (not read, never the comments)', () => {
    const comments = [summary('c1', '09:00', 2483), review('c2', '09:10', 2483)];
    const model = buildRunEvidence({ openFindings: FINDINGS_NONE, issueIdentifier: 'LIN-1', comments, standing: null, prStatus: open });
    assert.equal(model.evidence.checked.review, null, 'the review is not read from the comments');
    assert.equal(model.evidence.checked.blindRead, null);
  });
});
