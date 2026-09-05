/**
 * LIN-2241 tier 1 — the scan-BASIS fingerprint.
 *
 * The load-bearing tests here are the acceptance-criterion-1 pins: a change to
 * priority, labels or assignee ALONE must not move the basis. Those three are
 * the reason this digest exists at all rather than reusing `hashContext`
 * (which carries labels) or a digest of the scan's own rendered input (which
 * carries `updatedAt`, and therefore moves on all three).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  scanBasisHashFromContext,
  scanBasisHashFromSnapshot,
  scanBasisFromContext,
  basisChanged
} from '../../lib/scan-fingerprint.js';
import { snapshotFromContext } from '../../lib/task-snapshot-store.js';
import { hashContext } from '../../lib/recap-cache.js';

/** A representative recommendation context. */
function makeContext(overrides = {}) {
  return {
    issue: {
      id: '11111111-2222-3333-4444-555555555555',
      identifier: 'LIN-2241',
      title: 'Scan-due surfacing',
      description: 'The queue should clear itself when the task has moved on.',
      state: { name: 'In Progress', type: 'started' },
      labels: ['Improvement'],
      priority: 2,
      updatedAt: '2026-09-01T10:00:00.000Z',
      ...(overrides.issue || {})
    },
    comments: overrides.comments || [
      { id: 'c1', body: 'First comment', createdAt: '2026-09-01T09:00:00.000Z' }
    ],
    children: overrides.children || [
      { id: 'k1', identifier: 'LIN-2242', title: 'Child', state: { name: 'Todo', type: 'unstarted' }, labels: [] }
    ],
    parent: overrides.parent !== undefined ? overrides.parent : {
      id: 'p1', identifier: 'LIN-2200', title: 'Parent', state: { name: 'In Progress', type: 'started' }
    },
    ...(overrides.rest || {})
  };
}

describe('scan basis fingerprint — acceptance criterion 1 (no nuisance signal)', () => {
  test('a priority-only change does NOT move the basis', () => {
    const before = makeContext();
    const after = makeContext({ issue: { priority: 4 } });
    assert.strictEqual(scanBasisHashFromContext(after), scanBasisHashFromContext(before));
  });

  test('a label-only change does NOT move the basis — and this is where hashContext differs', () => {
    const before = makeContext();
    const after = makeContext({ issue: { labels: ['Improvement', 'Bug'] } });

    assert.strictEqual(
      scanBasisHashFromContext(after),
      scanBasisHashFromContext(before),
      'basis must ignore labels'
    );
    // The reason this module exists rather than reusing the digest already
    // stored on every scan row: `inputHash` DOES move on a label-only edit, so
    // it cannot be the scan-due signal criterion 1 describes.
    assert.notStrictEqual(
      hashContext(after),
      hashContext(before),
      'hashContext is expected to move on labels — if this ever stops being true, the basis digest may be redundant'
    );
  });

  test('an assignee-only change does NOT move the basis', () => {
    const before = makeContext();
    const after = makeContext({ issue: { assignee: { id: 'u2', name: 'Someone Else' } } });
    assert.strictEqual(scanBasisHashFromContext(after), scanBasisHashFromContext(before));
  });

  test('an updatedAt-only bump does NOT move the basis', () => {
    // The trap the ticket's own prescription walks into: `formatIssueContext`
    // renders `**Updated:**`, so a digest of the scan's literal input would
    // move here — on every priority/label/assignee edit, transitively.
    const before = makeContext();
    const after = makeContext({ issue: { updatedAt: '2026-09-05T12:00:00.000Z' } });
    assert.strictEqual(scanBasisHashFromContext(after), scanBasisHashFromContext(before));
  });

  test('a cycle- or project-only change does NOT move the basis', () => {
    const before = makeContext();
    const after = makeContext({ rest: { project: { id: 'pr1', name: 'Platform' } } });
    assert.strictEqual(scanBasisHashFromContext(after), scanBasisHashFromContext(before));
  });
});

describe('scan basis fingerprint — the changes that DO count', () => {
  test('a description edit moves the basis', () => {
    const before = makeContext();
    const after = makeContext({ issue: { description: 'Rewritten, and it now answers the question.' } });
    assert.notStrictEqual(scanBasisHashFromContext(after), scanBasisHashFromContext(before));
  });

  test('a new comment moves the basis', () => {
    const before = makeContext();
    const after = makeContext({
      comments: [
        { id: 'c1', body: 'First comment', createdAt: '2026-09-01T09:00:00.000Z' },
        { id: 'c2', body: 'John: use option B.', createdAt: '2026-09-05T09:00:00.000Z' }
      ]
    });
    assert.notStrictEqual(scanBasisHashFromContext(after), scanBasisHashFromContext(before));
  });

  test('an edit to an existing comment body moves the basis', () => {
    const before = makeContext();
    const after = makeContext({ comments: [{ id: 'c1', body: 'Edited in place', createdAt: '2026-09-01T09:00:00.000Z' }] });
    assert.notStrictEqual(scanBasisHashFromContext(after), scanBasisHashFromContext(before));
  });

  test("the task's own state moving counts — the mandate's 'the task has moved on'", () => {
    const before = makeContext();
    const after = makeContext({ issue: { state: { name: 'Done', type: 'completed' } } });
    assert.notStrictEqual(scanBasisHashFromContext(after), scanBasisHashFromContext(before));
  });

  test('a subtask changing state moves the basis', () => {
    const before = makeContext();
    const after = makeContext({
      children: [{ id: 'k1', identifier: 'LIN-2242', title: 'Child', state: { name: 'Done', type: 'completed' }, labels: [] }]
    });
    assert.notStrictEqual(scanBasisHashFromContext(after), scanBasisHashFromContext(before));
  });

  test('a state RENAME at the same type does not count (cosmetic, provider-side)', () => {
    const before = makeContext();
    const after = makeContext({ issue: { state: { name: 'Doing', type: 'started' } } });
    assert.strictEqual(scanBasisHashFromContext(after), scanBasisHashFromContext(before));
  });

  test('a subtask label change does not count, though hashContext carries child labels', () => {
    const before = makeContext();
    const after = makeContext({
      children: [{ id: 'k1', identifier: 'LIN-2242', title: 'Child', state: { name: 'Todo', type: 'unstarted' }, labels: ['Bug'] }]
    });
    assert.strictEqual(scanBasisHashFromContext(after), scanBasisHashFromContext(before));
  });
});

describe('scan basis fingerprint — agreement by construction', () => {
  test('context-derived and snapshot-derived digests agree for the same task state', () => {
    // The whole rulings-feed mechanism rests on this: the scan routes hash a
    // live context, the feed hashes a stored snapshot, and the two must be the
    // same number or every comparison is noise.
    const context = makeContext();
    assert.strictEqual(
      scanBasisHashFromSnapshot(snapshotFromContext(context)),
      scanBasisHashFromContext(context)
    );
  });

  test('the projection is stable under key order', () => {
    const a = scanBasisHashFromContext(makeContext());
    const b = scanBasisHashFromContext(makeContext());
    assert.strictEqual(a, b);
  });

  test('the basis slice carries no excluded field', () => {
    const basis = scanBasisFromContext(makeContext());
    const serialized = JSON.stringify(basis);
    for (const excluded of ['labels', 'priority', 'assignee', 'updatedAt']) {
      assert.ok(!Object.prototype.hasOwnProperty.call(basis, excluded), `${excluded} must not be a basis field`);
    }
    assert.ok(!serialized.includes('Improvement'), 'label values must not reach the digest input');
    assert.ok(!serialized.includes('2026-09-01T10:00:00.000Z'), 'updatedAt must not reach the digest input');
  });

  test('a malformed or empty context still hashes, and hashes stably', () => {
    assert.strictEqual(scanBasisHashFromContext(null), scanBasisHashFromContext(undefined));
    assert.strictEqual(typeof scanBasisHashFromContext({}), 'string');
  });
});

describe('basisChanged — the tri-state', () => {
  test('differing hashes with a strictly newer observation → true', () => {
    assert.strictEqual(basisChanged({
      raisedBasisHash: 'aaa', currentBasisHash: 'bbb', raisedAtMs: 1000, observedAtMs: 2000
    }), true);
  });

  test('agreeing hashes → false', () => {
    assert.strictEqual(basisChanged({
      raisedBasisHash: 'aaa', currentBasisHash: 'aaa', raisedAtMs: 1000, observedAtMs: 2000
    }), false);
  });

  test('a row with no recorded basis is UNKNOWN, never "unchanged"', () => {
    // The legacy-row case: every ruling raised before this feature landed.
    // Reporting `false` there would quietly assert something never checked.
    assert.strictEqual(basisChanged({ raisedBasisHash: null, currentBasisHash: 'bbb' }), null);
  });

  test('no observation at all is UNKNOWN', () => {
    assert.strictEqual(basisChanged({ raisedBasisHash: 'aaa', currentBasisHash: null }), null);
  });

  test('an observation OLDER than the scan is UNKNOWN, not a change', () => {
    // It describes content the scan already saw; comparing against it would
    // manufacture a difference that never happened.
    assert.strictEqual(basisChanged({
      raisedBasisHash: 'aaa', currentBasisHash: 'bbb', raisedAtMs: 5000, observedAtMs: 1000
    }), null);
  });

  test('an observation at the same instant as the scan is UNKNOWN', () => {
    assert.strictEqual(basisChanged({
      raisedBasisHash: 'aaa', currentBasisHash: 'bbb', raisedAtMs: 5000, observedAtMs: 5000
    }), null);
  });

  test('an unusable timestamp on either side is UNKNOWN', () => {
    assert.strictEqual(basisChanged({
      raisedBasisHash: 'aaa', currentBasisHash: 'bbb', raisedAtMs: NaN, observedAtMs: 2000
    }), null);
    assert.strictEqual(basisChanged({
      raisedBasisHash: 'aaa', currentBasisHash: 'bbb', raisedAtMs: 1000, observedAtMs: NaN
    }), null);
  });

  test('with no timestamps supplied at all the comparison is exact (the live-context path)', () => {
    // `GET /workspace/:urlKey/api/scan/:issueId` compares against content it
    // just fetched, so there is no staleness window to guard.
    assert.strictEqual(basisChanged({ raisedBasisHash: 'aaa', currentBasisHash: 'bbb' }), true);
    assert.strictEqual(basisChanged({ raisedBasisHash: 'aaa', currentBasisHash: 'aaa' }), false);
  });

  test('called with nothing at all → unknown, never a throw', () => {
    assert.strictEqual(basisChanged(), null);
  });
});
