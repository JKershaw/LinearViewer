/**
 * Unit tests for lib/run-closeout-state.js (LIN-3248, P3 of LIN-2949; S14 + R1).
 *
 * Run with: node --test tests/unit/run-closeout-state.test.js
 *
 * Covers the `deriveCloseOutState` truth table the plan names (one PR ready,
 * many PRs, unreadable/fail-open, head moved, multi-PR partial merge, merged,
 * not-ready → "○ set up ›", no PR) and every bound of the R1 Done predicate —
 * one case per bound that withholds Done.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  deriveCloseOutState,
  closeOutSetsDone,
  isApprovedReview,
  CLOSE_OUT_STATUS,
} from '../../lib/run-closeout-state.js';

const REPO = 'JKershaw/LinearViewer';

const pr = (number, over = {}) => ({ url: `https://github.com/${REPO}/pull/${number}`, repo: REPO, number, corroborated: false, ...over });

const openStatus = (sha = 'aaaaaaa', over = {}) => ({
  repo: REPO, readable: true, number: 1, state: 'open', merged: false, head: { ref: 'x', sha }, ref: sha, checks: [], ...over
});
const mergedStatus = (sha = 'aaaaaaa', over = {}) => ({
  repo: REPO, readable: true, number: 1, state: 'closed', merged: true, head: { ref: 'x', sha }, ref: sha, checks: [], ...over
});
const closedStatus = (sha = 'aaaaaaa') => ({
  repo: REPO, readable: true, number: 1, state: 'closed', merged: false, head: { ref: 'x', sha }, ref: sha, checks: []
});
const unknownStatus = (reason = 'not checked') => ({ repo: REPO, readable: false, state: 'unknown', reason });

const approve = (verdict = 'approve') => ({ verdict, verdictText: verdict === 'approve' ? 'Approve' : 'Approve — conditional', sha: 'aaaaaaa' });

describe('isApprovedReview', () => {
  test('accepts Approve and Approve — conditional, nothing else', () => {
    assert.strictEqual(isApprovedReview(approve('approve')), true);
    assert.strictEqual(isApprovedReview(approve('approve-conditional')), true);
    assert.strictEqual(isApprovedReview(approve('request-changes')), false);
    assert.strictEqual(isApprovedReview(approve('needs-discussion')), false);
    assert.strictEqual(isApprovedReview(approve('unknown')), false);
    assert.strictEqual(isApprovedReview(null), false);
  });
});

describe('deriveCloseOutState — truth table', () => {
  test('one open PR, Approve on record and a runner set up is ready and pressable', () => {
    const state = deriveCloseOutState({
      prs: [pr(41)],
      prStatuses: [openStatus()],
      review: approve(),
      runnerReady: true,
      owner: true,
    });
    assert.strictEqual(state.status, CLOSE_OUT_STATUS.READY);
    assert.strictEqual(state.ready, true);
    assert.strictEqual(state.pressable, true);
    assert.strictEqual(state.headMoved, false);
    assert.strictEqual(state.pr.number, 41);
    assert.match(state.readyCopy, /PR ready for close-out/);
  });

  test('a moved head keeps the run ready but flags it', () => {
    const state = deriveCloseOutState({
      prs: [pr(41)],
      prStatuses: [openStatus('bbbbbbb')],
      review: approve(),
      runnerReady: true,
      owner: true,
    });
    assert.strictEqual(state.status, CLOSE_OUT_STATUS.READY);
    assert.strictEqual(state.headMoved, true);
  });

  test('many open PRs are never ready (per-PR state, task stays open)', () => {
    const state = deriveCloseOutState({
      prs: [pr(41), pr(42)],
      prStatuses: [openStatus(), openStatus()],
      review: approve(),
      runnerReady: true,
      owner: true,
    });
    assert.strictEqual(state.status, CLOSE_OUT_STATUS.MULTIPLE_PRS);
    assert.strictEqual(state.pressable, false);
    assert.strictEqual(state.openCount, 2);
  });

  test('an unreadable PR state fails open: unknown, never ready, never Done', () => {
    const state = deriveCloseOutState({
      prs: [pr(41)],
      prStatuses: [unknownStatus()],
      review: approve(),
      runnerReady: true,
      owner: true,
    });
    assert.strictEqual(state.status, CLOSE_OUT_STATUS.UNKNOWN);
    assert.strictEqual(state.pressable, false);
    assert.strictEqual(state.setDone, false);
    assert.match(state.message, /not checked/);
  });

  test('multi-PR partial merge names the merged PR and the open remainder', () => {
    const state = deriveCloseOutState({
      prs: [pr(41), pr(42)],
      prStatuses: [mergedStatus(), openStatus()],
      review: approve(),
      runnerReady: true,
      owner: true,
    });
    assert.strictEqual(state.status, CLOSE_OUT_STATUS.PARTIAL);
    assert.strictEqual(state.mergedCount, 1);
    assert.strictEqual(state.openCount, 1);
    assert.strictEqual(state.mergedByYou, true);
    assert.strictEqual(state.setDone, false);
    assert.strictEqual(state.pr.number, 41);
    assert.match(state.message, /PR #41 merged · 1 more PR open/);
  });

  test('a partial merge with two remaining PRs pluralises the remainder', () => {
    const state = deriveCloseOutState({
      prs: [pr(41), pr(42), pr(43)],
      prStatuses: [mergedStatus(), openStatus(), openStatus()],
      review: approve(),
      runnerReady: true,
      owner: true,
    });
    assert.strictEqual(state.status, CLOSE_OUT_STATUS.PARTIAL);
    assert.match(state.message, /PR #41 merged · 2 more PRs open/);
  });

  test('a merged PR (own check) is merged and Done is set', () => {
    const state = deriveCloseOutState({
      prs: [pr(41)],
      prStatuses: [mergedStatus()],
      review: approve(),
      runnerReady: true,
      owner: true,
      byPersonCheck: true,
    });
    assert.strictEqual(state.status, CLOSE_OUT_STATUS.MERGED);
    assert.strictEqual(state.mergedByYou, true);
    assert.strictEqual(state.setDone, true);
  });

  test('not ready (no Approve) still renders the set-up state, never hidden', () => {
    const state = deriveCloseOutState({
      prs: [pr(41)],
      prStatuses: [openStatus()],
      review: approve('request-changes'),
      runnerReady: true,
      owner: true,
    });
    assert.strictEqual(state.status, CLOSE_OUT_STATUS.NOT_READY);
    assert.strictEqual(state.pressable, false);
    assert.strictEqual(state.readyCopy, null);
    assert.match(state.setupCopy, /set up/);
    assert.strictEqual(state.reason, 'review-not-approve');
  });

  test('not ready (runner not set up) renders the set-up state', () => {
    const state = deriveCloseOutState({
      prs: [pr(41)],
      prStatuses: [openStatus()],
      review: approve(),
      runnerReady: false,
      owner: true,
    });
    assert.strictEqual(state.status, CLOSE_OUT_STATUS.NOT_READY);
    assert.match(state.setupCopy, /set up/);
    assert.strictEqual(state.reason, 'runner-not-set-up');
  });

  test('no PR found is its own state', () => {
    const state = deriveCloseOutState({ prs: [], prStatuses: [], review: approve(), runnerReady: true, owner: true });
    assert.strictEqual(state.status, CLOSE_OUT_STATUS.NO_PR);
    assert.strictEqual(state.pressable, false);
  });

  test('a closed-but-unmerged PR is not ready and not Done', () => {
    const state = deriveCloseOutState({
      prs: [pr(41)],
      prStatuses: [closedStatus()],
      review: approve(),
      runnerReady: true,
      owner: true,
      byPersonCheck: true,
    });
    assert.strictEqual(state.status, CLOSE_OUT_STATUS.CLOSED);
    assert.strictEqual(state.pressable, false);
    assert.strictEqual(state.setDone, false);
  });

  test('a non-owner sees no box state', () => {
    const state = deriveCloseOutState({
      prs: [pr(41)],
      prStatuses: [openStatus()],
      review: approve(),
      runnerReady: true,
      owner: false,
    });
    assert.strictEqual(state.owner, false);
    assert.strictEqual(state.pressable, false);
  });
});

describe('closeOutSetsDone — one test per bound that withholds Done', () => {
  const base = { prStatuses: [mergedStatus()], review: approve(), byPersonCheck: true };

  test('all four bounds hold → true', () => {
    assert.strictEqual(closeOutSetsDone(base), true);
  });

  test('withholds when the target PR is not merged per the reader', () => {
    assert.strictEqual(closeOutSetsDone({ ...base, prStatuses: [openStatus()] }), false);
    assert.strictEqual(closeOutSetsDone({ ...base, prStatuses: [unknownStatus()] }), false);
    assert.strictEqual(closeOutSetsDone({ ...base, prStatuses: [] }), false);
  });

  test('withholds when the latest review verdict is not Approve / Approve — conditional', () => {
    assert.strictEqual(closeOutSetsDone({ ...base, review: approve('request-changes') }), false);
    assert.strictEqual(closeOutSetsDone({ ...base, review: approve('needs-discussion') }), false);
    assert.strictEqual(closeOutSetsDone({ ...base, review: null }), false);
  });

  test('withholds when another PR in the run evidence is still unmerged', () => {
    assert.strictEqual(closeOutSetsDone({ ...base, prStatuses: [mergedStatus(), openStatus()] }), false);
    assert.strictEqual(closeOutSetsDone({ ...base, prStatuses: [mergedStatus(), unknownStatus()] }), false);
  });

  test('withholds unless the read is the person\'s own check, never a worker token', () => {
    assert.strictEqual(closeOutSetsDone({ ...base, byPersonCheck: false }), false);
    assert.strictEqual(closeOutSetsDone({ ...base, byPersonCheck: undefined }), false);
  });

  test('the target PR may be selected by index among many', () => {
    assert.strictEqual(closeOutSetsDone({ prStatuses: [mergedStatus(), mergedStatus()], prIndex: 1, review: approve(), byPersonCheck: true }), true);
    assert.strictEqual(closeOutSetsDone({ prStatuses: [openStatus(), mergedStatus()], prIndex: 1, review: approve(), byPersonCheck: true }), false);
  });
});
