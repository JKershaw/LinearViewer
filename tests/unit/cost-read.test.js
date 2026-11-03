/**
 * LIN-4177 witnesses: the cost read core, the surfaces it now feeds, and the change list.
 *
 * Each witness runs the current code over the fixture corpus (tests/fixtures/cost-replay). W1, W2
 * and W3's incomplete case are red before the change and green after; the guards (W3 claude-code,
 * W3 no-usage) pass on both sides, as the plan marks them. The replay diff (W9) is pinned by
 * tests/fixtures/cost-replay/expected-changes.json, the change list.
 *
 * Run with: node --test tests/unit/cost-read.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runReplay } from '../fixtures/cost-replay/harness.js';
import { diffReplay } from '../fixtures/cost-replay/diff.js';
import { formatUsd } from '../../lib/cost-format.js';
import { DispatchQueueStore, LINEAGE_IDENTITY_PROJECTION, UnboundedHistoryReadError } from '../../lib/dispatch-store.js';

const GOLDENS = fileURLToPath(new URL('../fixtures/cost-replay/goldens.json', import.meta.url));
const CHANGES = fileURLToPath(new URL('../fixtures/cost-replay/expected-changes.json', import.meta.url));

let current;
let golden;
before(async () => {
  current = await runReplay();
  golden = JSON.parse(await readFile(GOLDENS, 'utf8'));
});

const sessions = (issue) => current.S1[issue].body.workerSessions;
const rootsOf = (issue) => sessions(issue).map(s => s.rootItemId);

describe('W1: the founder cap (LIN-4148): a lineage is credited once, to its true issue', () => {
  test('lineage P is counted under LIN-42 (its founder) exactly once', () => {
    const under42 = sessions('LIN-42').filter(s => s.rootItemId === 'P');
    assert.equal(under42.length, 1);
  });

  test('lineage P is not counted under LIN-99 (a follow-up on another issue)', () => {
    assert.deepEqual(rootsOf('LIN-99').filter(root => root === 'P'), []);
  });
});

describe('W2: a horizon straddler counts under its true issue only (LIN-4148)', () => {
  test('straddler st (founder on LIN-42, 40 days old) counts under LIN-42', () => {
    const under42 = sessions('LIN-42').filter(s => s.rootItemId === 'st');
    assert.equal(under42.length, 1);
    assert.equal(under42[0].costUsd, 4);
  });

  test('straddler st does not count under LIN-99', () => {
    assert.deepEqual(rootsOf('LIN-99').filter(root => root === 'st'), []);
  });

  test('straddler st carries its true base kind (implementation, not the follow-up\'s review)', () => {
    const under42 = sessions('LIN-42').find(s => s.rootItemId === 'st');
    assert.equal(under42?.kind, 'implementation');
  });

  test('the review job loses the straddler it wrongly took (change c)', () => {
    const review = current.S5.jobs.find(j => j.id === 'review');
    assert.equal(review.runs, 0);
  });
});

describe('W3: incomplete figures (narrow rule, plan N1)', () => {
  test('guard: a claude-code lineage with members older than the window prices as before', () => {
    assert.equal(current.S1['LIN-18'].body.totalUsd, 1.2);
    assert.equal(current.S1['LIN-18'].body.pricedUsd, 1.2);
  });

  test('an opencode lineage with a dropped true member is incomplete, not a silent partial', () => {
    // LIN-8: the founder (an opencode delta, 38 days old) is dropped; the in-window delta alone
    // would read as the whole. It must not be priced as complete.
    assert.equal(current.S1['LIN-8'].body.totalUsd, null);
  });

  test('a no-usage lineage with a dropped member is incomplete, not "no telemetry" alone', () => {
    assert.equal(current.S1['LIN-17'].body.totalUsd, null);
  });

  test('mixed harness: the fixture prices additively and is counted by the tally', () => {
    assert.equal(current.S1['LIN-6'].body.pricedUsd, 1.85);
    assert.equal(current.S1['LIN-6'].body.totalUsd, 1.85);
    assert.ok(current.mixedHarness.lineages.includes('mx'));
  });
});

describe('W4: S1 and S5 agree where they can (plan N2)', () => {
  test('the over-cap corpus makes S5 show its truncation', () => {
    assert.equal(current.S5.truncated, true);
    assert.ok(current.S5.total > current.S5.rows);
  });

  test('S1 still sees the lineages S5 truncated away: the issue is not empty', () => {
    assert.ok(sessions('LIN-42').length > 0);
    assert.ok(sessions('LIN-99').length > 0);
  });
});

describe('W5: no silent zero (plan figure rule)', () => {
  test('a complete $0 reads as a real $0.00', () => {
    assert.equal(current.S1['LIN-11'].body.totalUsd, 0);
    assert.equal(formatUsd(0), '$0.00');
  });

  test('an unpriced lineage withholds its total', () => {
    assert.equal(current.S1['LIN-12'].body.totalUsd, null);
  });

  test('formatUsd never turns null or undefined into a dollar figure', () => {
    assert.equal(formatUsd(null), null);
    assert.equal(formatUsd(undefined), null);
  });
});

describe('formatUsd (plan: one formatter)', () => {
  test('cents by default', () => {
    assert.equal(formatUsd(12.4), '$12.40');
    assert.equal(formatUsd(1), '$1.00');
    assert.equal(formatUsd(1234.5), '$1234.50');
  });

  test('a nonzero amount under half a cent reads <$0.01', () => {
    assert.equal(formatUsd(0.004), '<$0.01');
    assert.equal(formatUsd(0.0001), '<$0.01');
  });

  test('half a cent rounds up to a cent, not to the floor marker', () => {
    assert.equal(formatUsd(0.005), '$0.01');
  });

  test('fine gives four decimals under $1', () => {
    assert.equal(formatUsd(0.0421, { fine: true }), '$0.0421');
    assert.equal(formatUsd(0.5, { fine: true }), '$0.5000');
  });

  test('fine keeps dollars at cents', () => {
    assert.equal(formatUsd(12.4, { fine: true }), '$12.40');
  });

  test('zero with fine is a real $0', () => {
    assert.equal(formatUsd(0, { fine: true }), '$0.0000');
  });
});

describe('W9: every replay difference is on the change list', () => {
  test('the diff against the goldens is exactly the named changes', async () => {
    const changes = JSON.parse(await readFile(CHANGES, 'utf8')).changes;
    const diffs = diffReplay(golden, current);
    const unlisted = diffs.filter(path => !changes.some(c => path === c.path || path.startsWith(`${c.path}.`)));
    assert.deepEqual(unlisted, []);
  });
});

describe('the founder lookup (LIN-4177 plan: scalar-only, uncapped, identity-bounded)', () => {
  // A collection that records each find's query and projection, and serves one fixed row.
  function recordingCollection(row) {
    const calls = [];
    return {
      calls,
      find(query, opts) {
        calls.push({ query, opts });
        return { toArray: async () => [row] };
      },
    };
  }
  const founder = { _id: 'f1', rootItemId: 'f1', status: 'taken', kind: 'implementation', issueIdentifier: 'LIN-42', dispatchedAt: new Date('2026-10-01T00:00:00Z') };

  test('reads by anchor over BOTH collections, with the founder projection and no since or limit', async () => {
    const queue = recordingCollection(founder);
    const history = recordingCollection(founder);
    const store = new DispatchQueueStore({ collection: queue, historyCollection: history });
    const rows = await store.lineageIdentityRows('acme', { anchors: ['f1'] });
    assert.equal(rows.length, 1, 'one founder, deduplicated across the two collections');
    for (const { calls } of [queue, history]) {
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].query, { urlKey: 'acme', rootItemId: { $in: ['f1'] } });
      assert.deepEqual(calls[0].opts.projection, LINEAGE_IDENTITY_PROJECTION);
    }
    assert.deepEqual(Object.keys(LINEAGE_IDENTITY_PROJECTION).sort(), ['_id', 'abort', 'dispatchedAt', 'issueIdentifier', 'kind', 'rootItemId', 'status']);
  });

  test('reads by issue with the same projection, and an empty anchor set reads nothing', async () => {
    const queue = recordingCollection(founder);
    const history = recordingCollection(founder);
    const store = new DispatchQueueStore({ collection: queue, historyCollection: history });
    await store.lineageIdentityRows('acme', { issueIdentifier: 'LIN-42' });
    assert.deepEqual(queue.calls[0].query, { urlKey: 'acme', issueIdentifier: 'LIN-42' });
    assert.deepEqual(await store.lineageIdentityRows('acme', { anchors: [] }), []);
    assert.equal(queue.calls.length, 1, 'the empty set made no read');
  });

  test('an unbounded read is refused, never run', async () => {
    const queue = recordingCollection(founder);
    const store = new DispatchQueueStore({ collection: queue, historyCollection: recordingCollection(founder) });
    await assert.rejects(() => store.lineageIdentityRows('acme', {}), UnboundedHistoryReadError);
    assert.equal(queue.calls.length, 0);
  });
});
