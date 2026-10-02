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
        present: true, empty: false, unparsed: false,
        items: [{ id: 'L1', claim: 'a claim', scope: 'inside', discharge: 'do the check', dischargedBy: null, discharged: false, followUp: 'LIN-999', raw: '| L1 | a claim | inside | do the check |' }],
        raw: '| L1 | a claim | inside | do the check |',
      },
    },
    closeOut: { owner: true, status: 'ready', pr: { url: 'https://github.com/acme/widget/pull/12', number: 12 }, message: null },
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
});

describe('render-run-evidence: the collapsed ledger', () => {
  test('items render under a <details> with their inside/outside mark', () => {
    const html = renderEvidence(model());
    assert.match(html, /<details class="rev-ledger" data-testid="run-evidence-ledger">/);
    assert.match(html, /data-testid="run-evidence-ledger-summary"/);
    assert.match(html, /data-testid="run-evidence-ledger-item" data-scope="inside"/);
    assert.match(html, /data-testid="run-evidence-ledger-followup">LIN-999</);
  });

  test('an outside item keeps its outside mark', () => {
    const m = model();
    m.ledger.ledger.items[0].scope = 'outside';
    assert.match(renderEvidence(m), /data-testid="run-evidence-ledger-item" data-scope="outside"/);
  });

  test('the raw fallback survives intact as preformatted text', () => {
    const raw = 'This claim is prose CI cannot structure, and it must survive verbatim <not a tag>.';
    const m = model();
    m.ledger.ledger.items = [];
    m.ledger.ledger.unparsed = true;
    m.ledger.ledger.raw = raw;
    const html = renderEvidence(m);
    assert.match(html, /<pre class="rev-ledger-raw" data-testid="run-evidence-ledger-raw">/);
    assert.ok(html.includes('This claim is prose CI cannot structure, and it must survive verbatim &lt;not a tag&gt;.'));
  });

  test('an empty ledger is a distinct labelled state', () => {
    const m = model();
    m.ledger.ledger.empty = true;
    m.ledger.ledger.items = [];
    assert.match(renderEvidence(m), /data-testid="run-evidence-ledger-empty">ledger empty/);
  });
});

describe('render-run-evidence: escaping', () => {
  test('interpolated text is escaped, never raw HTML', () => {
    const m = model();
    m.evidence.asked = '<script>alert(1)</script>';
    m.evidence.checked.review.ciLine = '<img src=x onerror=alert(2)>';
    m.ledger.ledger.items[0].claim = '"><b>bold</b>';
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
