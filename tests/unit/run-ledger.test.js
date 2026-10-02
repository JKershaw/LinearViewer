// Unit tests for the pure run-ledger reader (LIN-3247, P2 of LIN-2949).
//
// Run with: node --test tests/unit/run-ledger.test.js
//
// The parser is grounded in REAL review comments (verbatim bodies in
// tests/fixtures/run-ledger-comments.js, extracted from
// scripts/eval/fixtures/recommend/_source/large-dense.json and
// scripts/eval/fixtures/recommend/closeout-review.json). Nothing here invents
// a review comment except the one deliberately malformed ledger used to prove
// the raw fallback.

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseRunLedger, readRunLedger, latestReviewComment } from '../../lib/run-ledger.js';
import { RUN_LEDGER_COMMENTS } from '../fixtures/run-ledger-comments.js';

const fixture = name => RUN_LEDGER_COMMENTS[name].comment;

describe('run-ledger: verdict', () => {
  test('distinguishes a plain Approve from the conditional form', () => {
    assert.strictEqual(parseRunLedger(fixture('plain-approve-ci')).verdict, 'approve');
    assert.strictEqual(parseRunLedger(fixture('empty-ledger')).verdict, 'approve');
    assert.strictEqual(parseRunLedger(fixture('conditional-table')).verdict, 'approve-conditional');
    assert.strictEqual(parseRunLedger(fixture('conditional-bullets')).verdict, 'approve-conditional');
  });

  test('a non-approve verdict is carried, not read as approval', () => {
    const model = parseRunLedger(fixture('request-changes-table'));
    assert.strictEqual(model.verdict, 'request-changes');
    assert.match(model.verdictText, /Request Changes/);
  });

  test('the verdict text is exactly as the review wrote it', () => {
    const model = parseRunLedger(fixture('conditional-table'));
    assert.strictEqual(model.verdictText, 'Approve — conditional on close-out discharging the ledger.');
  });

  test('an absent review is an unknown verdict with an absent ledger, never a crash', () => {
    const model = parseRunLedger(null);
    assert.strictEqual(model.verdict, 'unknown');
    assert.strictEqual(model.ledger.present, false);
    assert.deepStrictEqual(model.ledger.items, []);
    assert.strictEqual(model.ledger.raw, null);
  });
});

describe('run-ledger: the review CI line and sha', () => {
  test('captures the CI line verbatim and the head sha the comment carries', () => {
    const model = parseRunLedger(fixture('plain-approve-ci'));
    assert.ok(model.ciLine.startsWith('CI on `1dffc408` is **green**.'), `ciLine was: ${model.ciLine}`);
    assert.match(model.ciLine, /36306122471/);
    assert.strictEqual(model.sha, '1dffc408');
  });

  test('captures a different real review head sha', () => {
    assert.strictEqual(parseRunLedger(fixture('conditional-table')).sha, 'e10768db');
    assert.strictEqual(parseRunLedger(fixture('request-changes-table')).sha, '8790ce34');
  });

  test('carries the comment time', () => {
    assert.strictEqual(parseRunLedger(fixture('conditional-table')).at, '2026-09-28T21:27:05.078Z');
  });
});

describe('run-ledger: ledger items and their marks', () => {
  test('table ledger: each item keeps its own inside/outside mark, not a blended one', () => {
    const { ledger } = parseRunLedger(fixture('request-changes-table'));
    assert.strictEqual(ledger.present, true);
    assert.strictEqual(ledger.empty, false);
    const byId = Object.fromEntries(ledger.items.map(i => [i.id, i]));
    assert.strictEqual(byId.D1.scope, 'inside');
    assert.strictEqual(byId.N2.scope, 'inside');
    assert.strictEqual(byId['R-L1'].scope, 'inside');
    assert.strictEqual(byId.C6.scope, 'outside', 'the one outside item must stay outside');
    assert.notStrictEqual(byId.C6.scope, byId.D1.scope);
  });

  test('table ledger: the discharge route is captured per item', () => {
    const { ledger } = parseRunLedger(fixture('request-changes-table'));
    const d3 = ledger.items.find(i => i.id === 'D3');
    assert.strictEqual(d3.discharge, '**implementation** (test only), then re-review');
  });

  test('a follow-up link named for an outside item is surfaced', () => {
    const { ledger } = parseRunLedger(fixture('request-changes-table'));
    const c6 = ledger.items.find(i => i.id === 'C6');
    assert.strictEqual(c6.followUp, 'LIN-2149');
  });

  test('a discharged item carries its discharge evidence', () => {
    const { ledger } = parseRunLedger(fixture('conditional-table'));
    const l7 = ledger.items.find(i => i.id === 'L7');
    assert.strictEqual(l7.discharged, true);
    assert.match(l7.dischargedBy, /:236/);
    assert.ok(ledger.items.every(i => i.scope === 'inside'));
  });

  test('numbered-list ledger: marks are read per item across inside and outside', () => {
    const { ledger } = parseRunLedger(fixture('numbered-list'));
    assert.strictEqual(ledger.items.length, 6);
    const scopes = ledger.items.map(i => i.scope);
    assert.ok(scopes.includes('inside'));
    assert.ok(scopes.includes('outside'));
    assert.strictEqual(scopes.at(-1), 'outside', 'the last numbered item is the outside one');
    assert.match(ledger.items[0].discharge, /F1's fix/);
  });

  test('bullet ledger: items are still enumerated', () => {
    const { ledger } = parseRunLedger(fixture('conditional-bullets'));
    assert.strictEqual(ledger.items.length, 2);
    assert.match(ledger.items[0].claim, /backoff actually fires/);
  });
});

describe('run-ledger: the empty ledger is a distinct state', () => {
  test('an explicit "(none ...)" ledger is empty, not unparsed and not absent', () => {
    const { ledger } = parseRunLedger(fixture('empty-ledger'));
    assert.strictEqual(ledger.present, true);
    assert.strictEqual(ledger.empty, true);
    assert.strictEqual(ledger.unparsed, false);
    assert.deepStrictEqual(ledger.items, []);
  });
});

describe('run-ledger: unparseable text falls back to raw', () => {
  const malformed = {
    createdAt: '2026-07-01T12:00:00.000Z',
    body: [
      '## Review',
      '',
      '### What CI Did Not Prove',
      '',
      'This change leans on a remote queue CI cannot reach, and that is the whole story.',
      '',
      '**Verdict: Approve.**',
    ].join('\n'),
  };

  test('the raw section survives intact and is flagged unparsed', () => {
    const model = parseRunLedger(malformed);
    assert.strictEqual(model.ledger.present, true);
    assert.strictEqual(model.ledger.empty, false);
    assert.strictEqual(model.ledger.unparsed, true);
    assert.deepStrictEqual(model.ledger.items, []);
    assert.strictEqual(
      model.ledger.raw,
      'This change leans on a remote queue CI cannot reach, and that is the whole story.',
    );
  });
});

describe('run-ledger: latest review comment selection', () => {
  const review = (id, createdAt, body) => ({ id, createdAt, body });

  test('picks the newest review summary comment and ignores non-review chatter', () => {
    const comments = [
      review('eng-1', '2026-07-01T00:00:00.000Z', 'Implemented it. PR #1 opened; CI green.'),
      review('r1', '2026-07-02T00:00:00.000Z', '## Review\n\n### What CI Did Not Prove\n- one item\n\n**Verdict: Approve.**'),
      review('r2', '2026-07-03T00:00:00.000Z', '## Re-review\n\n### What CI Did Not Prove\n- carried\n\n**Verdict: Approve — conditional on close-out discharging the ledger.**'),
      review('note', '2026-07-04T00:00:00.000Z', 'A later non-review note with no verdict and no ledger.'),
    ];
    assert.strictEqual(latestReviewComment(comments)?.id, 'r2');
    assert.strictEqual(readRunLedger(comments).verdict, 'approve-conditional');
  });

  test('returns null / an unknown model when no review comment exists', () => {
    assert.strictEqual(latestReviewComment([]), null);
    assert.strictEqual(latestReviewComment([{ id: 'x', body: 'nothing review-like' }]), null);
    assert.strictEqual(readRunLedger([]).verdict, 'unknown');
  });
});
