// Unit tests for the host-agnostic run-evidence fragments (LIN-3247, S13).
//
// Run with: node --test tests/unit/render-run-evidence.test.js
//
// Proves the two-line "checked" row (never blended), head-moved, not-checked,
// the collapsed ledger and its raw fallback, the empty ledger, guest omission
// of the close-out box, and HTML escaping.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderEvidence, renderCloseOutBox, renderRunEvidence } from '../../lib/render-run-evidence.js';

function model(overrides = {}) {
  return {
    state: {
      status: 'ready',
      pr: { url: 'https://github.com/acme/widget/pull/12', repo: 'acme/widget', number: 12, headSha: 'deadbeef', checksUrl: 'https://github.com/acme/widget/pull/12/checks' },
      message: null,
    },
    evidence: {
      asked: 'Do the thing',
      done: 'PR #12',
      checked: {
        review: { verdict: 'approve-conditional', verdictText: 'Approve — conditional on close-out discharging the ledger.', ciLine: 'CI is green on the PR.', at: '2026-07-02T00:00:00.000Z', sha: 'abc1234' },
        now: { state: 'passing', checks: [{ name: 'unit', conclusion: 'success' }], headSha: 'deadbeef', prUrl: 'https://github.com/acme/widget/pull/12', checksUrl: 'https://github.com/acme/widget/pull/12/checks', headMoved: false },
      },
    },
    ledger: {
      verdict: 'approve-conditional',
      verdictText: 'Approve — conditional on close-out discharging the ledger.',
      ciLine: 'CI is green on the PR.',
      at: '2026-07-02T00:00:00.000Z',
      sha: 'abc1234',
      ledger: {
        present: false, empty: false, raw: null,
      },
    },
    closeOut: { owner: true, status: 'ready', pr: { url: 'https://github.com/acme/widget/pull/12', number: 12 }, message: null, openFindings: { state: 'read', count: 1, ids: ['finding-aaaaaaaa'] } },
    ...overrides,
  };
}

describe('render-run-evidence: the checked row is two labelled lines', () => {
  test('review claim and Now render separately, never blended into one line', () => {
    const html = renderEvidence(model());
    assert.match(html, /data-testid="run-evidence-checked"/);
    assert.match(html, /data-testid="run-evidence-checked-review"/);
    assert.match(html, /data-testid="run-evidence-checked-now"/);
    assert.match(html, /Review&#039;s claim/);
    assert.match(html, />Now</);
    // Review's line carries the verbatim verdict; the Now line carries the head.
    assert.match(html, /Approve — conditional on close-out discharging the ledger\./);
    assert.match(html, /data-testid="run-evidence-checked-now-state">passing/);
    assert.match(html, /data-testid="run-evidence-checked-now-sha">head deadbeef/);
    assert.match(html, /data-testid="run-evidence-checks-link"[^>]*href="https:\/\/github\.com\/acme\/widget\/pull\/12\/checks"/);
  });

  test('"head moved since review" is shown when the review sha differs from the head', () => {
    const m = model();
    m.evidence.checked.now.headMoved = true;
    assert.match(renderEvidence(m), /data-testid="run-evidence-head-moved">head moved since review</);
  });

  test('an unreadable/unknown head says "not checked" and shows no checks link', () => {
    const m = model();
    m.evidence.checked.now = { state: 'unknown', checks: [], headSha: null, prUrl: null, checksUrl: null, headMoved: false };
    const html = renderEvidence(m);
    assert.match(html, /data-testid="run-evidence-not-checked">not checked</);
    assert.ok(!html.includes('data-testid="run-evidence-checks-link"'));
  });

  test('a readable PR with no checks (read: true) says "no checks set up", not "not checked" (LIN-3443)', () => {
    const m = model();
    m.evidence.checked.now = { state: 'unknown', read: true, checks: [], headSha: 'deadbeef', prUrl: null, checksUrl: 'https://github.com/acme/widget/pull/12/checks', headMoved: false };
    const html = renderEvidence(m);
    assert.match(html, /data-testid="run-evidence-checked-now-state">no checks set up</);
    assert.match(html, /data-testid="run-evidence-checked-now-sha">head deadbeef/);
    assert.match(html, /data-testid="run-evidence-checks-link"/);
    assert.ok(!html.includes('data-testid="run-evidence-not-checked"'));
  });

  test('read: false keeps "not checked" (LIN-3443)', () => {
    const m = model();
    m.evidence.checked.now = { state: 'unknown', read: false, checks: [], headSha: null, prUrl: null, checksUrl: null, headMoved: false };
    assert.match(renderEvidence(m), /data-testid="run-evidence-not-checked">not checked</);
  });
});

describe('render-run-evidence: the collapsed ledger (LIN-4495: the findings to close-out, as read)', () => {
  test('the findings reading renders under a <details>, with its count', () => {
    const html = renderEvidence(model());
    assert.match(html, /<details class="rev-ledger" data-testid="run-evidence-ledger">/);
    assert.match(html, /data-testid="run-evidence-findings">1 open finding to close-out</);
    assert.match(html, /data-testid="run-evidence-ledger-summary">Review ledger — 1 open to close-out</);
  });

  test('a finding not read is shown as not read, never as zero', () => {
    const m = model();
    m.closeOut.openFindings = { state: 'not-read', count: null, ids: [], why: 'x' };
    const html = renderEvidence(m);
    assert.match(html, /open findings not read — not checked/);
    assert.match(html, /Review ledger — not measured/);
    assert.doesNotMatch(html, /\b0 open to close-out/);
  });

  // LIN-4527: the pre-cutover section's text is no longer shown: the gate does not read it, so the box shows only the live
  // open-findings reading. The box keeps its label and its findings line.
  test('a pre-cutover ledger section is not shown; the box keeps the live open-findings reading', () => {
    const raw = 'This claim is prose CI cannot structure, and it must survive verbatim <not a tag>.';
    const m = model();
    m.ledger.ledger = { present: true, empty: false, raw };
    const html = renderEvidence(m);
    assert.doesNotMatch(html, /run-evidence-ledger-raw|run-evidence-ledger-legacy|not measured here/);
    assert.ok(!html.includes('This claim is prose CI cannot structure'));
    assert.match(html, /data-testid="run-evidence-findings"/);
    assert.match(html, /data-testid="run-evidence-ledger"/);
  });

  test('a finished task keeps no count (LIN-3373)', () => {
    const m = model();
    m.closeOut.status = 'merged';
    const html = renderEvidence(m, { finished: true });
    assert.match(html, /Review ledger — as the review wrote it/);
  });
});

describe('render-run-evidence: escaping', () => {
  test('interpolated text is escaped, never raw HTML', () => {
    const m = model();
    m.evidence.asked = '<script>alert(1)</script>';
    m.evidence.checked.review.ciLine = '<img src=x onerror=alert(2)>';
    m.ledger.ledger = { present: true, empty: false, raw: '"><b>bold</b>' };
    const html = renderEvidence(m);
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(!html.includes('<b>bold</b>'));
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&lt;img src=x/);
  });
});

describe('render-run-evidence: the close-out box', () => {
  test('a guest / non-owner renders no box at all', () => {
    assert.equal(renderCloseOutBox({ owner: false, status: 'ready', pr: { url: 'https://github.com/acme/widget/pull/12' } }), '');
    assert.equal(renderCloseOutBox(null), '');
    const guest = model({ closeOut: { owner: false, status: 'ready', pr: { url: 'https://github.com/acme/widget/pull/12' } } });
    const html = renderRunEvidence(guest);
    assert.ok(!html.includes('data-testid="run-evidence-closeout"'));
  });

  test('the ready box shows the ready label and the "or merge it yourself" link', () => {
    const html = renderCloseOutBox(model().closeOut);
    assert.match(html, /data-testid="run-evidence-closeout" data-state="ready"/);
    assert.match(html, /✓ PR ready for close-out/);
    assert.match(html, /data-testid="run-evidence-closeout-merge-yourself"[^>]*>or merge it yourself on GitHub ›</);
  });

  test('a withheld state shows what is known', () => {
    const html = renderCloseOutBox({ owner: true, status: 'multiple-prs', pr: null, message: 'more than one PR: close each out on GitHub or with run this step' });
    assert.match(html, /data-state="multiple-prs"/);
    assert.match(html, /more than one PR/);
  });

  test('a non-http PR URL is not rendered as a live link', () => {
    const html = renderCloseOutBox({ owner: true, status: 'ready', pr: { url: 'javascript:alert(1)' } });
    assert.ok(!/href="javascript:/i.test(html));
  });
});

describe('render-run-evidence: P3 close-out box states (LIN-3248)', () => {
  const readyState = (over = {}) => ({
    owner: true, status: 'ready', variant: 'standard', stopAt: 'pr',
    urlKey: 'ws', issueIdentifier: 'LIN-1',
    pr: { url: 'https://github.com/acme/widget/pull/12', number: 12, headSha: 'deadbeef' },
    message: null, ...over,
  });

  test('ready shows the press button, the merge-yourself link and (standard) the promise', () => {
    const html = renderCloseOutBox(readyState());
    assert.match(html, /data-state="ready"/);
    assert.match(html, /data-testid="run-evidence-closeout-ready">✓ PR ready for close-out/);
    assert.match(html, /data-testid="run-evidence-closeout-press"[^>]*>\[ close out &amp; merge \]/);
    assert.match(html, /data-testid="run-evidence-closeout-merge-yourself"[^>]*>or merge it yourself on GitHub ›/);
    assert.match(html, /data-testid="run-evidence-closeout-promise">Harbour stops this run at the PR and leaves the merge to a person\./);
    assert.match(html, /data-variant="standard"/);
    assert.match(html, /data-stop-at="pr"/);
  });

  test('the promise copy is viewer-true: no second person, advises branch protection, claims no enforcement', () => {
    const html = renderCloseOutBox(readyState());
    const m = /data-testid="run-evidence-closeout-promise">([^<]*)</.exec(html);
    assert.ok(m, 'promise paragraph present');
    assert.ok(!/\b(you|your|yours)\b/i.test(m[1]), 'shown to non-owner viewers: no you/your');
    assert.match(m[1], /protect the default branch on GitHub/);
    assert.ok(!/never merges/i.test(m[1]));
  });

  test('N2: a stepped run omits the promise and preserves the stepper variant', () => {
    const html = renderCloseOutBox(readyState({ variant: 'stepper' }));
    assert.match(html, /data-variant="stepper"/);
    assert.ok(!html.includes('Harbour stops this run at the PR'));
    assert.ok(!html.includes('data-testid="run-evidence-closeout-promise"'));
    // The press itself is still offered.
    assert.match(html, /data-testid="run-evidence-closeout-press"/);
  });

  test('M9: an unknown variant (missing/legacy row) withholds the promise — never coerced to standard', () => {
    const html = renderCloseOutBox(readyState({ variant: 'unknown' }));
    assert.match(html, /data-variant="unknown"/);
    assert.ok(!html.includes('Harbour stops this run at the PR'));
    assert.ok(!html.includes('data-testid="run-evidence-closeout-promise"'));
    assert.match(html, /data-testid="run-evidence-closeout-press"/);
  });

  test('not-ready shows ○ set up › and is never hidden', () => {
    const html = renderCloseOutBox({ owner: true, status: 'not-ready', variant: 'standard', message: 'no runner is set up for this workspace yet' });
    assert.match(html, /data-state="not-ready"/);
    assert.match(html, /data-testid="run-evidence-closeout-setup">○ set up ›/);
    assert.ok(!html.includes('data-testid="run-evidence-closeout-press"'));
  });

  test('a merged box reads the same neutral line for every viewer, never "merged by you" (LIN-3426)', () => {
    const html = renderCloseOutBox({ owner: true, status: 'merged', variant: 'standard', message: 'PR #12 merged' });
    assert.match(html, /data-state="merged"/);
    assert.match(html, /data-testid="run-evidence-closeout-neutral">PR #12 merged/);
    assert.ok(!/merged by you|you merged|data-merged-by-you/i.test(html));
    assert.match(renderCloseOutBox({ owner: true, status: 'merged', variant: 'standard' }), /data-testid="run-evidence-closeout-neutral">the pull request is already merged/);
  });

  test('multi-PR partial renders the merged·open copy and stays In Progress', () => {
    const html = renderCloseOutBox({ owner: true, status: 'partial', variant: 'standard', message: 'PR #12 merged · 1 more PR open' });
    assert.match(html, /data-state="partial"/);
    assert.match(html, /PR #12 merged · 1 more PR open/);
    assert.ok(!html.includes('data-testid="run-evidence-closeout-press"'));
  });

  test('an unreadable PR state still renders a withheld box (fail open)', () => {
    const html = renderCloseOutBox({ owner: true, status: 'unknown', variant: 'standard', message: 'the pull request could not be read — not checked' });
    assert.match(html, /data-state="unknown"/);
    assert.match(html, /data-testid="run-evidence-closeout-withheld">the pull request could not be read/);
  });
});

describe('render-run-evidence: the mount', () => {
  test('no model renders nothing (the existing page is unchanged)', () => {
    assert.equal(renderRunEvidence(null), '');
    assert.equal(renderRunEvidence(undefined), '');
  });

  test('a model renders the mount wrapping evidence and the box', () => {
    const html = renderRunEvidence(model());
    assert.match(html, /data-testid="run-evidence-mount"[\s\S]*data-testid="run-evidence"[\s\S]*data-testid="run-evidence-closeout"/);
  });
});
