// Unit tests for the run-evidence builder (LIN-3247, P2 of LIN-2949).
//
// Run with: node --test tests/unit/run-evidence.test.js
//
// Covers the S1 PR-URL source (tracker comments, newest first, evidence URLs
// corroborating only — the repo allowlist filter was retired in LIN-3333), and
// buildRunEvidence's
// zero / one / many / unreadable derivation into `{ state, evidence, ledger,
// closeOut }`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractPrUrls, summarizeChecks, sameHead, buildRunEvidence } from '../../lib/run-evidence.js';

const REPLY = '## Review\n\n### What CI Did Not Prove\n- one claim\n\n**Verdict: Approve — conditional on close-out discharging the ledger.**';

function comment(body, createdAt) {
  return { body, createdAt, user: 'reviewer' };
}

const PR_A = 'https://github.com/acme/widget/pull/12';
const PR_B = 'https://github.com/acme/gadget/pull/7';

describe('run-evidence: extractPrUrls', () => {
  test('collects PR URLs newest-comment first, deduped', () => {
    const comments = [
      comment(`see ${PR_A}`, '2026-07-01T00:00:00.000Z'),
      comment(`again ${PR_A} and ${PR_B}`, '2026-07-03T00:00:00.000Z'),
    ];
    const urls = extractPrUrls(comments);
    assert.deepEqual(urls.map(u => u.url), [PR_A, PR_B]);
    assert.equal(urls[0].repo, 'acme/widget');
    assert.equal(urls[0].number, 12);
  });

  test('any repo is accepted — the workspace allowlist filter is gone (LIN-3333)', () => {
    const comments = [comment(`${PR_A}`, '2026-07-01T00:00:00.000Z')];
    assert.deepEqual(extractPrUrls(comments).map(u => u.url), [PR_A]);
  });

  test('an evidence URL is corroboration only — never the sole PR-URL source', () => {
    const urls = extractPrUrls([], [PR_A]);
    assert.deepEqual(urls, [], 'zero comment URLs stays zero even with an evidence URL');
  });

  test('marks a comment URL corroborated when the same URL appears in evidence', () => {
    const comments = [comment(PR_A, '2026-07-01T00:00:00.000Z')];
    const urls = extractPrUrls(comments, [PR_A]);
    assert.equal(urls.length, 1);
    assert.equal(urls[0].corroborated, true);
  });
});

describe('run-evidence: check summarisation', () => {
  test('passing / failing / pending / unknown', () => {
    assert.equal(summarizeChecks([{ conclusion: 'success' }, { conclusion: 'skipped' }]), 'passing');
    assert.equal(summarizeChecks([{ conclusion: 'success' }, { conclusion: 'failure' }]), 'failing');
    assert.equal(summarizeChecks([{ conclusion: 'success' }, { conclusion: null }]), 'pending');
    assert.equal(summarizeChecks([{ conclusion: 'in_progress' }]), 'pending');
    assert.equal(summarizeChecks([]), 'unknown');
  });

  test('an abbreviated sha equals its full form; a different sha does not', () => {
    assert.equal(sameHead('abc1234', 'abc1234def'), true);
    assert.equal(sameHead('abc1234', 'def5678'), false);
    assert.equal(sameHead(null, 'abc1234'), true);
  });
});

describe('run-evidence: state derivation', () => {
  const oneOpen = {
    readable: true, repo: 'acme/widget', number: 12, state: 'open', merged: false,
    head: { ref: 'feature', sha: 'abc1234def' }, ref: 'abc1234def',
    checks: [{ name: 'unit', conclusion: 'success' }],
  };

  test('zero PR URLs → no-pr', () => {
    const m = buildRunEvidence({ issueIdentifier: 'LIN-1', comments: [], });
    assert.equal(m.state.status, 'no-pr');
    assert.match(m.state.message, /no pull request/);
  });

  test('exactly one open PR → ready, with the PR and checks link', () => {
    const m = buildRunEvidence({
      issueIdentifier: 'LIN-1', comments: [comment(PR_A, '2026-07-01T00:00:00.000Z')], prStatus: oneOpen,
    });
    assert.equal(m.state.status, 'ready');
    assert.equal(m.state.pr.number, 12);
    assert.equal(m.state.pr.checksUrl, `${PR_A}/checks`);
    assert.equal(m.evidence.checked.now.state, 'passing');
  });

  test('more than one PR URL → multiple-prs, with the plan wording', () => {
    const m = buildRunEvidence({
      issueIdentifier: 'LIN-1',
      comments: [comment(`${PR_A} ${PR_B}`, '2026-07-01T00:00:00.000Z')],
    });
    assert.equal(m.state.status, 'multiple-prs');
    assert.match(m.state.message, /more than one PR/);
  });

  test('an unreadable PR read → unknown (fail-open), never throws', () => {
    const m = buildRunEvidence({
      issueIdentifier: 'LIN-1', comments: [comment(PR_A, '2026-07-01T00:00:00.000Z')], prStatus: { readable: false, state: 'unknown', reason: 'private' },
    });
    assert.equal(m.state.status, 'unknown');
    assert.equal(m.evidence.checked.now.state, 'unknown');
    assert.match(m.state.message, /not checked/);
  });

  test('a closed (unmerged) PR → pr-not-open; a merged one → merged', () => {
    const closed = buildRunEvidence({
      issueIdentifier: 'LIN-1', comments: [comment(PR_A, '2026-07-01T00:00:00.000Z')], prStatus: { ...oneOpen, state: 'closed' },
    });
    assert.equal(closed.state.status, 'pr-not-open');
    const merged = buildRunEvidence({
      issueIdentifier: 'LIN-1', comments: [comment(PR_A, '2026-07-01T00:00:00.000Z')], prStatus: { ...oneOpen, state: 'closed', merged: true },
    });
    assert.equal(merged.state.status, 'merged');
  });
});

describe('run-evidence: evidence rows and close-out', () => {
  const oneOpen = {
    readable: true, repo: 'acme/widget', number: 12, state: 'open', merged: false,
    head: { ref: 'feature', sha: 'deadbeefdead' }, ref: 'deadbeefdead',
    checks: [{ name: 'unit', conclusion: 'success' }],
  };

  test('review claim and live head are separate; head-moved is shown, not gated', () => {
    const comments = [
      comment(PR_A, '2026-07-01T00:00:00.000Z'),
      comment(`${REPLY}\n\nhead \`abc1234\``, '2026-07-02T00:00:00.000Z'),
    ];
    const m = buildRunEvidence({ issueIdentifier: 'LIN-1', comments, prStatus: oneOpen });
    assert.equal(m.evidence.checked.review.verdict, 'approve-conditional');
    assert.equal(m.evidence.checked.review.sha, 'abc1234');
    assert.equal(m.evidence.checked.now.headSha, 'deadbeefdead');
    assert.equal(m.evidence.checked.now.headMoved, true);
    assert.equal(m.state.status, 'ready', 'head-moved does not withhold the ready state');
  });

  test('asked comes from the issue title; done from the resolved PR', () => {
    const m = buildRunEvidence({
      issueIdentifier: 'LIN-1', issue: { title: 'Do the thing' },
      comments: [comment(PR_A, '2026-07-01T00:00:00.000Z')], prStatus: oneOpen,
    });
    assert.equal(m.evidence.asked, 'Do the thing');
    assert.equal(m.evidence.done, 'PR #12');
  });

  test('closeOut carries the owner flag and the state', () => {
    const guest = buildRunEvidence({ issueIdentifier: 'LIN-1', comments: [], owner: false });
    assert.equal(guest.closeOut.owner, false);
    const owner = buildRunEvidence({ issueIdentifier: 'LIN-1', comments: [], owner: true });
    assert.equal(owner.closeOut.owner, true);
  });

  test('the ledger model is threaded through for the collapsed fragment', () => {
    const m = buildRunEvidence({
      issueIdentifier: 'LIN-1', comments: [comment(REPLY, '2026-07-02T00:00:00.000Z')],
      prStatus: null,
    });
    assert.equal(m.ledger.verdict, 'approve-conditional');
    assert.equal(m.ledger.ledger.items.length, 1);
  });
});
