// Unit tests for the pure run-ledger helpers (LIN-3247, P2 of LIN-2949; LIN-4520 retired the comment parsers).
//
// Run with: node --test tests/unit/run-ledger.test.js
//
// What stays here: the full PR URL reader (prUrlsIn, prOf), and the trail sort (byTime). The blind read's PR-set
// check retired with its comment guard (LIN-4543). The verdict, ledger and review-comment parsers are retired: a verdict is a records
// fact now (lib/records/*), so no test reads a review comment for one.

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { prUrlsIn, prOf, byTime } from '../../lib/run-ledger.js';

const A = 'https://github.com/acme/app/pull/101';
const B = 'https://github.com/acme/app/pull/202';
const C = 'https://github.com/acme/tools/pull/7';

describe('run-ledger: full PR URLs', () => {
  test('prUrlsIn returns each distinct full URL once, in first-appearance order', () => {
    assert.deepStrictEqual(prUrlsIn(`Landed ${B} then ${A}. Re-cites ${B}.`), [B, A]);
  });

  test('a bare #N or a non-PR GitHub URL is not a PR URL', () => {
    assert.deepStrictEqual(prUrlsIn('see #101 and https://github.com/acme/app/issues/5'), []);
  });

  test('an absent body names no PR', () => {
    assert.deepStrictEqual(prUrlsIn(null), []);
    assert.deepStrictEqual(prUrlsIn(undefined), []);
  });

  test('prOf reads the owner/name slug and the number of a PR URL', () => {
    assert.deepStrictEqual(prOf(C), { repo: 'acme/tools', number: 7 });
  });
});

describe('run-ledger: the trail sort', () => {
  test('byTime orders by createdAt, oldest first, whatever order the provider gave', () => {
    const comments = [
      { id: 'late', body: 'b', createdAt: '2026-07-03T00:00:00.000Z' },
      { id: 'early', body: 'a', createdAt: '2026-07-01T00:00:00.000Z' },
      { id: 'mid', body: 'c', createdAt: '2026-07-02T00:00:00.000Z' },
    ];
    assert.deepStrictEqual(byTime(comments).map((c) => c.id), ['early', 'mid', 'late']);
    assert.strictEqual(comments[0].id, 'late', 'the input is not reordered in place');
  });

  test('byTime keeps only comments with a string body', () => {
    const comments = [null, { id: 'no-body', createdAt: '2026-07-01T00:00:00.000Z' }, { id: 'ok', body: '', createdAt: '2026-07-01T00:00:00.000Z' }];
    assert.deepStrictEqual(byTime(comments).map((c) => c.id), ['ok']);
    assert.deepStrictEqual(byTime(null), []);
  });
});
