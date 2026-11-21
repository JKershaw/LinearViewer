/**
 * LIN-4518 review findings c83d5e5c (the multi-PR stale refusal) and eeebc738 (the close-out stale-flag terms): the pure
 * closeOutDecision, each refusal term witnessed on its own. Each test names the term it needs, so the mutation that
 * removes only that term turns exactly its witness red:
 *   - multiMoved (several PRs, one moved after the approval): mutation `multiMoved = false` fails the first witness.
 *   - staleKeys (the records' stale flag names the PR; the live head is still the judged one): mutation dropping the
 *     `staleKeys.has(...)` term fails the second.
 *   - movedOnLive (the live head is not the judged one; no records stale flag): mutation dropping `movedOnLive` fails
 *     the third. Dropping both terms also fails the second and third (the old, single witness).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeOutDecision, CLOSE_OUT_STATUS, CLOSE_OUT_ACTOR } from '../../lib/run-closeout-state.js';
import { FINDINGS_NONE } from '../../lib/close-out-findings.js';

const REPO = 'acme/widget';
const prUrl = (n) => `https://github.com/${REPO}/pull/${n}`;
const A = prUrl(1);
const B = prUrl(2);
const JUDGED = 'JUDGED';
const MOVED = 'MOVED';

const open = (url, sha) => ({ readable: true, repo: REPO, number: Number(url.split('/').pop()), state: 'open', merged: false, head: { ref: 'f', sha }, ref: sha, checks: [] });

/** A landing of `landing` PRs, approved on JUDGED, blind-read on both, with the records' stale flag `staleUrls`. */
function trailOf(landing, staleUrls = []) {
  return {
    landing,
    review: {
      verdict: 'approve', at: '2026-11-21T11:00:00.000Z', sha: JUDGED, commentId: 'verdict-1',
      blindRead: { prs: landing, verdict: 'same', at: '2026-11-21T11:30:00.000Z', commentId: 'verdict-2' },
      staleUrls,
    },
    closeOutOnTrail: false,
    workAfterReview: false,
    closeOutAfterReview: false,
    landingHasNotesPr: false,
  };
}

const decide = (trail, statuses) => closeOutDecision({
  trail,
  prStatuses: new Map(Object.entries(statuses)),
  stopAt: 'pr',
  runnerReady: true,
  actor: CLOSE_OUT_ACTOR.HARBOUR,
  openFindings: FINDINGS_NONE,
});

describe('witness c83d5e5c: a several-PR landing refuses on a moved open PR after an approval', () => {
  test('PR B moved after the approval (named stale): the close-out refuses head-moved on B, not multiple-prs', () => {
    const d = decide(trailOf([A, B], [B]), { [A]: open(A, JUDGED), [B]: open(B, MOVED) });
    assert.equal(d.refuses, 'head-moved');
    assert.equal(d.status, CLOSE_OUT_STATUS.NOT_READY);
    assert.equal(d.pr?.url, B, 'the refusal names the moved PR');
  });

  test('no PR moved: the several-PR landing is not refused for its head (it is multiple-prs, as it always was)', () => {
    const d = decide(trailOf([A, B], []), { [A]: open(A, JUDGED), [B]: open(B, JUDGED) });
    assert.equal(d.refuses, null);
    assert.equal(d.status, CLOSE_OUT_STATUS.MULTIPLE_PRS);
  });
});

describe('witness eeebc738: the stale flag refuses a single PR on its own term', () => {
  test('the records stale flag names the PR while the live head still reads as judged: refused head-moved', () => {
    const d = decide(trailOf([A], [A]), { [A]: open(A, JUDGED) });
    assert.equal(d.refuses, 'head-moved', 'staleKeys alone must refuse');
  });

  test('the live head moved with no stale flag on record (a push no change record saw): refused head-moved', () => {
    const d = decide(trailOf([A], []), { [A]: open(A, MOVED) });
    assert.equal(d.refuses, 'head-moved', 'movedOnLive alone must refuse');
  });

  test('neither the flag nor a moved head: admitted (control)', () => {
    const d = decide(trailOf([A], []), { [A]: open(A, JUDGED) });
    assert.equal(d.refuses, null);
    assert.equal(d.status, CLOSE_OUT_STATUS.READY);
  });
});
