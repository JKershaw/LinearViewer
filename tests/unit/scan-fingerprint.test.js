/**
 * LIN-2241 tier 1 — the scan-BASIS fingerprint.
 *
 * The load-bearing tests here are the acceptance-criterion-1 pins: a change to
 * priority, labels or assignee ALONE must not move the basis. Those three are
 * the reason this digest exists at all rather than reusing `hashContext`
 * (which carries labels) or a digest of the scan's own rendered input (which
 * carries `updatedAt`, and therefore moves on all three).
 *
 * The second group pins the properties that make the signal SAFE rather than
 * merely correct: order-independence (a provider re-ordering an unchanged
 * comment set must not manufacture a flag) and version-gating (a future change
 * to the projection must not mass-flag every pending ruling at once). Both are
 * false-positive guards, and a false positive is this feature's expensive
 * failure — an operator who is told "the task changed" when it did not stops
 * believing the panel (docs/escalation-philosophy.md §4).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  scanBasisHashFromContext,
  scanBasisFromContext,
  basisChanged,
  dueBasisFromContext,
  dueBasisHashFromContext,
  dueChanged,
  BASIS_VERSION
} from '../../lib/scan-fingerprint.js';
import { hashContext } from '../../lib/recap-cache.js';
import { snapshotFromContext } from '../../lib/task-snapshot-store.js';

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
    assert.strictEqual(
      scanBasisHashFromContext(makeContext({ issue: { priority: 4 } })),
      scanBasisHashFromContext(makeContext())
    );
  });

  test('a label-only change does NOT move the basis — and this is where hashContext differs', () => {
    const before = makeContext();
    const after = makeContext({ issue: { labels: ['Improvement', 'Bug'] } });

    assert.strictEqual(scanBasisHashFromContext(after), scanBasisHashFromContext(before), 'basis must ignore labels');
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
    // Weaker than it looks, and deliberately kept: the projection is a
    // whitelist, so this passes because `assignee` is simply never read. That
    // IS the guarantee criterion 1 asks for, and the test fails the moment
    // someone widens the projection to spread over the whole issue object.
    assert.strictEqual(
      scanBasisHashFromContext(makeContext({ issue: { assignee: { id: 'u2', name: 'Someone Else' } } })),
      scanBasisHashFromContext(makeContext())
    );
  });

  test('an updatedAt-only bump does NOT move the basis', () => {
    // The trap the ticket's own prescription walks into: `formatIssueContext`
    // renders `**Updated:**`, so a digest of the scan's literal input would
    // move here — on every priority/label/assignee edit, transitively.
    assert.strictEqual(
      scanBasisHashFromContext(makeContext({ issue: { updatedAt: '2026-09-05T12:00:00.000Z' } })),
      scanBasisHashFromContext(makeContext())
    );
  });

  test('a cycle-only change does NOT move the basis', () => {
    const before = makeContext();
    const after = makeContext({ issue: { cycle: { id: 'cyc-9', number: 9 } }, rest: { cycle: { id: 'cyc-9', number: 9 } } });
    assert.strictEqual(scanBasisHashFromContext(after), scanBasisHashFromContext(before));
  });

  test('a project-only change does NOT move the basis', () => {
    assert.strictEqual(
      scanBasisHashFromContext(makeContext({ rest: { project: { id: 'pr1', name: 'Platform' } } })),
      scanBasisHashFromContext(makeContext())
    );
  });
});

describe('scan basis fingerprint — the changes that DO count', () => {
  const base = () => scanBasisHashFromContext(makeContext());

  test('a description edit moves the basis', () => {
    assert.notStrictEqual(scanBasisHashFromContext(makeContext({ issue: { description: 'Rewritten, and it now answers the question.' } })), base());
  });

  test('a new comment moves the basis', () => {
    assert.notStrictEqual(scanBasisHashFromContext(makeContext({
      comments: [
        { id: 'c1', body: 'First comment', createdAt: '2026-09-01T09:00:00.000Z' },
        { id: 'c2', body: 'John: use option B.', createdAt: '2026-09-05T09:00:00.000Z' }
      ]
    })), base());
  });

  test('an edit to an existing comment body moves the basis', () => {
    assert.notStrictEqual(scanBasisHashFromContext(makeContext({
      comments: [{ id: 'c1', body: 'Edited in place', createdAt: '2026-09-01T09:00:00.000Z' }]
    })), base());
  });

  test('a comment TIMESTAMP change moves the basis', () => {
    // The docstring justifies keying on (createdAt, body, id); without this,
    // dropping createdAt from the projection passes the whole suite.
    const at = ts => scanBasisHashFromContext(makeContext({
      comments: [{ id: 'c1', body: 'same body', createdAt: ts }]
    }));
    assert.notStrictEqual(at('2026-09-01T09:00:00.000Z'), at('2026-09-02T09:00:00.000Z'));
  });

  test('a Date-valued createdAt hashes the same as its ISO string — no timezone exposure', () => {
    const iso = '2026-09-01T09:00:00.000Z';
    const asString = scanBasisHashFromContext(makeContext({ comments: [{ id: 'c1', body: 'b', createdAt: iso }] }));
    const asDate = scanBasisHashFromContext(makeContext({ comments: [{ id: 'c1', body: 'b', createdAt: new Date(iso) }] }));
    assert.strictEqual(asDate, asString);
  });

  test('a comment body change is caught even with NO comment id — the Linear shape', () => {
    // lib/providers/linear/index.js:910-915 maps comments to {body, createdAt,
    // user} with no `id` at all. An id-keyed digest would be blind to comment
    // changes on the primary provider, so the basis keys on content.
    const withComment = body => scanBasisHashFromContext(makeContext({
      comments: [{ body, createdAt: '2026-09-01T09:00:00.000Z', user: { name: 'John' } }]
    }));
    assert.notStrictEqual(withComment('the original question'), withComment('John answered: option B'));
  });

  test("the task's own state moving counts — the mandate's 'the task has moved on'", () => {
    assert.notStrictEqual(scanBasisHashFromContext(makeContext({ issue: { state: { name: 'Done', type: 'completed' } } })), base());
  });

  test('a subtask changing state moves the basis', () => {
    assert.notStrictEqual(scanBasisHashFromContext(makeContext({
      children: [{ id: 'k1', identifier: 'LIN-2242', title: 'Child', state: { name: 'Done', type: 'completed' }, labels: [] }]
    })), base());
  });

  test('a state RENAME at the same type does not count (cosmetic, provider-side)', () => {
    assert.strictEqual(scanBasisHashFromContext(makeContext({ issue: { state: { name: 'Doing', type: 'started' } } })), base());
  });

  test('a subtask label change does not count, though hashContext carries child labels', () => {
    assert.strictEqual(scanBasisHashFromContext(makeContext({
      children: [{ id: 'k1', identifier: 'LIN-2242', title: 'Child', state: { name: 'Todo', type: 'unstarted' }, labels: ['Bug'] }]
    })), base());
  });

  test('there is no comment cap — a 501st comment still moves the basis', () => {
    // Why this is NOT routed through lib/task-snapshot-store.js's
    // snapshotFromContext: that projection slices to 500 comments, which would
    // make "an agent answered the question in a comment" invisible on exactly
    // the long-running tasks most likely to carry a pending ruling.
    const many = n => Array.from({ length: n }, (_, i) => ({
      id: `c${i}`, body: `comment ${i}`, createdAt: `2026-09-01T09:${String(i % 60).padStart(2, '0')}:00.000Z`
    }));
    assert.notStrictEqual(
      scanBasisHashFromContext(makeContext({ comments: many(501) })),
      scanBasisHashFromContext(makeContext({ comments: many(500) }))
    );
  });
});

describe('scan basis fingerprint — false-positive guards', () => {
  test('re-ordering an unchanged comment set does NOT move the basis', () => {
    // Linear sorts comments by createdAt, but same-timestamp ties fall through
    // to the GraphQL connection order, which lib/providers/linear/index.js
    // notes at :942-945 Linear does not guarantee. Without canonical ordering,
    // two fetches of an unchanged task could hash differently and invent a
    // "the task changed" flag out of nothing.
    const tied = '2026-09-01T09:00:00.000Z';
    const a = [{ id: 'c1', body: 'first', createdAt: tied }, { id: 'c2', body: 'second', createdAt: tied }];
    const b = [{ id: 'c2', body: 'second', createdAt: tied }, { id: 'c1', body: 'first', createdAt: tied }];
    assert.strictEqual(
      scanBasisHashFromContext(makeContext({ comments: a })),
      scanBasisHashFromContext(makeContext({ comments: b }))
    );
  });

  test('reorder-independence holds on the NO-ID Linear shape too', () => {
    // The guard exists BECAUSE Linear emits comments without ids. Testing it
    // only with ids present lets an id-only sort key pass, which on Linear
    // makes every key '' and defeats the canonicalization entirely.
    const tied = '2026-09-01T09:00:00.000Z';
    const a = [{ body: 'first', createdAt: tied }, { body: 'second', createdAt: tied }];
    const b = [{ body: 'second', createdAt: tied }, { body: 'first', createdAt: tied }];
    assert.strictEqual(
      scanBasisHashFromContext(makeContext({ comments: a })),
      scanBasisHashFromContext(makeContext({ comments: b }))
    );
    // ...and still distinguishes a genuinely different set at the same instant.
    assert.notStrictEqual(
      scanBasisHashFromContext(makeContext({ comments: a })),
      scanBasisHashFromContext(makeContext({ comments: [{ body: 'first', createdAt: tied }, { body: 'third', createdAt: tied }] }))
    );
  });

  test('re-ordering an unchanged subtask set does NOT move the basis', () => {
    const k = (identifier, type) => ({ identifier, state: { name: 'x', type } });
    assert.strictEqual(
      scanBasisHashFromContext(makeContext({ children: [k('LIN-1', 'started'), k('LIN-2', 'unstarted')] })),
      scanBasisHashFromContext(makeContext({ children: [k('LIN-2', 'unstarted'), k('LIN-1', 'started')] }))
    );
  });

  test('the digest is independent of key insertion order in the source object', () => {
    const ordered = { issue: { title: 't', description: 'd', state: { type: 'started' } }, comments: [], children: [], parent: null };
    const reordered = { children: [], parent: null, comments: [], issue: { state: { type: 'started' }, description: 'd', title: 't' } };
    assert.strictEqual(scanBasisHashFromContext(reordered), scanBasisHashFromContext(ordered));
  });

  test('the basis slice carries no excluded field, and no excluded VALUE reaches the digest', () => {
    const basis = scanBasisFromContext(makeContext());
    for (const excluded of ['labels', 'priority', 'assignee', 'updatedAt']) {
      assert.ok(!Object.prototype.hasOwnProperty.call(basis, excluded), `${excluded} must not be a basis field`);
    }
    const serialized = JSON.stringify(basis);
    assert.ok(!serialized.includes('Improvement'), 'label values must not reach the digest input');
    assert.ok(!serialized.includes('2026-09-01T10:00:00.000Z'), 'updatedAt must not reach the digest input');
  });

  test('a malformed or empty context still hashes, and hashes stably', () => {
    assert.strictEqual(scanBasisHashFromContext(null), scanBasisHashFromContext(undefined));
    assert.strictEqual(typeof scanBasisHashFromContext({}), 'string');
  });

  test('the version is folded into the digest, so a bump cannot collide with old hashes', () => {
    const basis = scanBasisFromContext(makeContext());
    assert.strictEqual(basis.v, BASIS_VERSION);
  });
});

describe('basisChanged — the tri-state', () => {
  test('differing hashes at the same version → true', () => {
    assert.strictEqual(basisChanged({ raisedBasisHash: 'aaa', raisedBasisVersion: BASIS_VERSION, currentBasisHash: 'bbb' }), true);
  });

  test('agreeing hashes at the same version → false', () => {
    assert.strictEqual(basisChanged({ raisedBasisHash: 'aaa', raisedBasisVersion: BASIS_VERSION, currentBasisHash: 'aaa' }), false);
  });

  test('a row with no recorded basis is UNKNOWN, never "unchanged"', () => {
    // The legacy-row case: every ruling raised before this feature landed.
    // Reporting `false` there would quietly assert something never checked.
    assert.strictEqual(basisChanged({ raisedBasisHash: null, currentBasisHash: 'bbb' }), null);
  });

  test('no current hash is UNKNOWN', () => {
    assert.strictEqual(basisChanged({ raisedBasisHash: 'aaa', currentBasisHash: null }), null);
  });

  test('a hash recorded under a DIFFERENT BASIS_VERSION is UNKNOWN, not changed', () => {
    // The mass-false-positive guard. Without it, editing the projection would
    // flag every pending ruling in the fleet at once — the single worst thing
    // this signal can do, and it would look exactly like a real finding.
    assert.strictEqual(
      basisChanged({ raisedBasisHash: 'aaa', raisedBasisVersion: BASIS_VERSION + 1, currentBasisHash: 'bbb' }),
      null
    );
    assert.strictEqual(
      basisChanged({ raisedBasisHash: 'aaa', raisedBasisVersion: BASIS_VERSION + 1, currentBasisHash: 'aaa' }),
      null
    );
  });

  test('an ABSENT version is UNKNOWN too — there is no legitimate version-less row', () => {
    // The only writer stores hash and version together (recordScan), so a row
    // with a hash but no version cannot have come from this projection. The
    // rows that COULD take a lenient branch are ones written by some earlier,
    // different projection — every one of which compares as a guaranteed
    // mismatch, i.e. exactly the fleet-wide false positive the gate exists to
    // prevent, re-entering through the one door left open.
    assert.strictEqual(basisChanged({ raisedBasisHash: 'aaa', currentBasisHash: 'bbb' }), null);
    assert.strictEqual(basisChanged({ raisedBasisHash: 'aaa', raisedBasisVersion: null, currentBasisHash: 'bbb' }), null);
    assert.strictEqual(basisChanged({ raisedBasisHash: 'aaa', raisedBasisVersion: undefined, currentBasisHash: 'aaa' }), null);
  });

  test('called with nothing at all → unknown, never a throw', () => {
    assert.strictEqual(basisChanged(), null);
  });

  test('a hash raised under the OLD BASIS_VERSION (1), pre-dating the commentId fallback, is UNKNOWN across the 1→2 boundary — never a fleet-wide true', () => {
    // LIN-2648: BASIS_VERSION bumped 1 -> 2 in the same change that widened the
    // comment-id extraction to `id || commentId`. Every row raised before this
    // change carries `raisedBasisVersion: 1`; this pins that they compare as
    // unknown against the new projection rather than a mass false-positive.
    assert.strictEqual(
      basisChanged({ raisedBasisHash: 'aaa', raisedBasisVersion: 1, currentBasisHash: 'bbb' }),
      null
    );
    assert.strictEqual(
      basisChanged({ raisedBasisHash: 'aaa', raisedBasisVersion: 1, currentBasisHash: 'aaa' }),
      null
    );
  });
});

/**
 * LIN-2648 F1 — the `commentId` key is load-bearing: it must reach the scan
 * basis fallback (`scanBasisFromContext`'s `id || commentId`) WITHOUT reaching
 * `hashContext` (`lib/recap-cache.js`'s `extractHashableContext`, feeds
 * `inputHash`) or `snapshotFromContext` (`lib/task-snapshot-store.js`), both of
 * which read `c?.id` specifically and only that key. A leak here would shift
 * `inputHash` fleet-wide for every Linear task with a comment — see the LIN-2648
 * description's "Why the commentId key is load-bearing" section for the three
 * concrete consequences (resurrected rulings, false-stale, cache invalidation).
 */
describe('F1 — commentId is invisible to hashContext/snapshotFromContext, visible only to the basis', () => {
  // The Linear shape post-projection widening: comments carry `commentId`
  // (never `id`) alongside body/createdAt/user, per lib/providers/linear/index.js.
  function linearShapedContext(comments) {
    return makeContext({
      comments: comments || [
        { commentId: 'lin-c-1', body: 'First comment', createdAt: '2026-09-01T09:00:00.000Z', user: 'John' },
        { commentId: 'lin-c-2', body: 'Second comment', createdAt: '2026-09-02T09:00:00.000Z', user: 'Jane' }
      ]
    });
  }

  test('[F1 golden/leak] commentId does not move hashContext or snapshotFromContext, in either direction', () => {
    const withCommentId = linearShapedContext();
    const withoutCommentId = {
      ...withCommentId,
      comments: withCommentId.comments.map(({ commentId, ...rest }) => rest)
    };

    assert.strictEqual(
      hashContext(withCommentId), hashContext(withoutCommentId),
      'hashContext must ignore commentId (with -> without)'
    );
    assert.strictEqual(
      hashContext(withoutCommentId), hashContext(withCommentId),
      'hashContext must ignore commentId (without -> with)'
    );
    assert.deepStrictEqual(
      snapshotFromContext(withCommentId), snapshotFromContext(withoutCommentId),
      'snapshotFromContext must ignore commentId (with -> without)'
    );
    assert.deepStrictEqual(
      snapshotFromContext(withoutCommentId), snapshotFromContext(withCommentId),
      'snapshotFromContext must ignore commentId (without -> with)'
    );
  });

  test('[F1 companion] scanBasisHashFromContext DOES move when commentId differs — without this the leak test above is vacuous', () => {
    const a = linearShapedContext();
    const b = linearShapedContext([
      { commentId: 'lin-c-1-DIFFERENT', body: 'First comment', createdAt: '2026-09-01T09:00:00.000Z', user: 'John' },
      { commentId: 'lin-c-2', body: 'Second comment', createdAt: '2026-09-02T09:00:00.000Z', user: 'Jane' }
    ]);
    assert.notStrictEqual(scanBasisHashFromContext(a), scanBasisHashFromContext(b));
  });
});

/**
 * LIN-2649 WS2 (LIN-2665 beat 1) — the due-basis fingerprint.
 *
 * `dueBasisFromContext`/`dueBasisHashFromContext` are the identical projection
 * to their tier-1 siblings above, with exactly one addition: a comment whose
 * resolved id is in the WS1 ledger's `recordedCommentIds` set is dropped
 * before the digest is built. `dueChanged` is the tri-state comparison over
 * the resulting hash, byte-parallel to `basisChanged`.
 */
describe('dueBasisFromContext / dueBasisHashFromContext — the ledger-filtered sibling', () => {
  test('a comment whose id is in recordedCommentIds is excluded from the due-basis, and from the digest', () => {
    const withBoth = makeContext({
      comments: [
        { id: 'c1', body: 'First comment', createdAt: '2026-09-01T09:00:00.000Z' },
        { id: 'harbour-1', body: 'Closing this out — no action needed.', createdAt: '2026-09-05T09:00:00.000Z' }
      ]
    });

    const basis = dueBasisFromContext(withBoth, { recordedCommentIds: new Set(['harbour-1']) });
    assert.deepStrictEqual(basis.comments.map(c => c.id), ['c1']);

    // Filtering the ledgered comment out and physically deleting it must be
    // indistinguishable to the digest — that equivalence is what dueBasisHash
    // actually depends on.
    const withoutHarbourComment = makeContext({
      comments: [{ id: 'c1', body: 'First comment', createdAt: '2026-09-01T09:00:00.000Z' }]
    });
    assert.strictEqual(
      dueBasisHashFromContext(withBoth, { recordedCommentIds: new Set(['harbour-1']) }),
      dueBasisHashFromContext(withoutHarbourComment, {})
    );
  });

  test('an empty/absent recordedCommentIds set filters nothing — the fail-open direction', () => {
    const ctx = makeContext();
    assert.strictEqual(dueBasisHashFromContext(ctx), scanBasisHashFromContext(ctx));
    assert.strictEqual(dueBasisHashFromContext(ctx, { recordedCommentIds: new Set() }), scanBasisHashFromContext(ctx));
  });

  test('dueBasisFromContext never reads context.focusedChild.comments[] — the F3 non-goal, pinned', () => {
    // grep -n focusedChild lib/scan-fingerprint.js must return nothing; this
    // pins the observable behaviour rather than the source text. Linear's
    // fetchFocusedChild projects comments with no id, so a reader of
    // focusedChild.comments[].id would silently get undefined for every entry.
    const ctx = makeContext();
    const withFocusedChild = {
      ...ctx,
      focusedChild: { comments: [{ body: 'focused-child noise', createdAt: '2099-01-01T00:00:00.000Z' }] }
    };
    assert.strictEqual(dueBasisHashFromContext(withFocusedChild), dueBasisHashFromContext(ctx));
  });

  test('the version is folded into the due-basis digest too, sharing BASIS_VERSION with the tier-1 slice', () => {
    const basis = dueBasisFromContext(makeContext());
    assert.strictEqual(basis.v, BASIS_VERSION);
  });
});

describe('dueChanged — the tri-state (LIN-2649 WS2 required tests)', () => {
  // A representative "already scanned" context carrying one genuine comment
  // (c1) and one Harbour-authored close-out comment (harbour-1) already in
  // the WS1 ledger at raise time.
  const raisedContext = () => makeContext({
    comments: [
      { id: 'c1', body: 'First comment', createdAt: '2026-09-01T09:00:00.000Z' },
      { id: 'harbour-1', body: 'Closing this out — no action needed.', createdAt: '2026-09-05T09:00:00.000Z' }
    ]
  });
  const recorded = () => new Set(['harbour-1']);
  const raisedDueBasisHash = () => dueBasisHashFromContext(raisedContext(), { recordedCommentIds: recorded() });

  test('Harbour-comment-only change (since raise) → not-due (false)', () => {
    // Nothing about the live context has moved relative to what was raised —
    // same genuine comment, same ledgered Harbour comment, present again.
    const currentDueBasisHash = dueBasisHashFromContext(raisedContext(), { recordedCommentIds: recorded() });
    assert.strictEqual(
      dueChanged({ raisedDueBasisHash: raisedDueBasisHash(), raisedDueBasisVersion: BASIS_VERSION, currentDueBasisHash }),
      false
    );
  });

  test('a genuine new (non-ledger) comment → due (true)', () => {
    const live = makeContext({
      comments: [
        { id: 'c1', body: 'First comment', createdAt: '2026-09-01T09:00:00.000Z' },
        { id: 'harbour-1', body: 'Closing this out — no action needed.', createdAt: '2026-09-05T09:00:00.000Z' },
        { id: 'c2', body: 'John: actually, reopen this.', createdAt: '2026-09-06T09:00:00.000Z' }
      ]
    });
    const currentDueBasisHash = dueBasisHashFromContext(live, { recordedCommentIds: recorded() });
    assert.strictEqual(
      dueChanged({ raisedDueBasisHash: raisedDueBasisHash(), raisedDueBasisVersion: BASIS_VERSION, currentDueBasisHash }),
      true
    );
  });

  test('a description edit → due (true)', () => {
    const live = makeContext({
      issue: { description: 'Rewritten since the scan.' },
      comments: [
        { id: 'c1', body: 'First comment', createdAt: '2026-09-01T09:00:00.000Z' },
        { id: 'harbour-1', body: 'Closing this out — no action needed.', createdAt: '2026-09-05T09:00:00.000Z' }
      ]
    });
    const currentDueBasisHash = dueBasisHashFromContext(live, { recordedCommentIds: recorded() });
    assert.strictEqual(
      dueChanged({ raisedDueBasisHash: raisedDueBasisHash(), raisedDueBasisVersion: BASIS_VERSION, currentDueBasisHash }),
      true
    );
  });

  test('a subtask edit → due (true)', () => {
    const live = makeContext({
      comments: [
        { id: 'c1', body: 'First comment', createdAt: '2026-09-01T09:00:00.000Z' },
        { id: 'harbour-1', body: 'Closing this out — no action needed.', createdAt: '2026-09-05T09:00:00.000Z' }
      ],
      children: [{ id: 'k1', identifier: 'LIN-2242', title: 'Child', state: { name: 'Done', type: 'completed' }, labels: [] }]
    });
    const currentDueBasisHash = dueBasisHashFromContext(live, { recordedCommentIds: recorded() });
    assert.strictEqual(
      dueChanged({ raisedDueBasisHash: raisedDueBasisHash(), raisedDueBasisVersion: BASIS_VERSION, currentDueBasisHash }),
      true
    );
  });

  test('a pre-WS2 row with no recorded dueBasisHash is UNKNOWN (null), never false', () => {
    const result = dueChanged({ raisedDueBasisHash: null, raisedDueBasisVersion: BASIS_VERSION, currentDueBasisHash: 'bbb' });
    assert.strictEqual(result, null);
    assert.notStrictEqual(result, false);
  });

  test('a hash raised under a stale BASIS_VERSION is UNKNOWN (null), never false — the literal day-one state of every pre-WS2 row', () => {
    const result = dueChanged({ raisedDueBasisHash: 'aaa', raisedDueBasisVersion: BASIS_VERSION - 1, currentDueBasisHash: 'aaa' });
    assert.strictEqual(result, null);
    assert.notStrictEqual(result, false);
  });

  test('called with nothing at all → unknown, never a throw', () => {
    assert.strictEqual(dueChanged(), null);
  });
});
