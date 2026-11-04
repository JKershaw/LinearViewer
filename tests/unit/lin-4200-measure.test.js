/**
 * LIN-4200: fixture tests for the records-vs-snapshots measurement script
 * (scripts/lin-4200-measure-records-vs-snapshots.mjs). Each fixture is built with the production
 * read path (lineageRecords -> foldLineageUsage), so the classification is tested against the same
 * fold the cost read uses, never against hand-written figures.
 *
 * Run with: node --test tests/unit/lin-4200-measure.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lineageRecords } from '../../lib/cost-read.js';
import {
  classifyLineage, modelsOf, oplogCounters, orphanAnchors, sharesOf, tokenSums, recordCostUsd
} from '../../scripts/lin-4200-measure-records-vs-snapshots.mjs';

const HAIKU = 'claude-haiku-5-5';
const SNAP_AT = '2026-11-04T06:00:00.000Z';

/** A dispatch row carrying one `[usage]` snapshot (a running total, claude-code). */
function row({ id, rootItemId, usage, usageAt = SNAP_AT, dispatchedAt = '2026-11-04T05:30:00.000Z', kind = 'implementation' }) {
  const feedback = usage
    ? [{ kind: 'usage', message: `[usage] ${JSON.stringify({ harness: 'claude-code', model: usage.model ?? HAIKU, ...usage })}`, timestamp: usageAt }]
    : [];
  return { _id: id, id, rootItemId, status: 'taken', abort: false, kind, issueIdentifier: 'LIN-1', dispatchedAt, feedback };
}

/** A request record as the intake stores it (identity, metadata, and the five token fields). */
function rec({ requestId, at, agent = 'main', model = HAIKU, input = 0, output = 0, cacheRead = 0, cacheWrite = 0 }) {
  return {
    requestId, rootItemId: 'L1', agent, model, harness: 'claude-code', at,
    inputTokens: input, outputTokens: output, cacheCreationInputTokens: cacheWrite,
    cacheCreation1hInputTokens: 0, cacheReadInputTokens: cacheRead
  };
}

/** Build the lineage the production read sees, then classify it. */
function classify(rowsForLineage, records) {
  const [lineage] = lineageRecords({ fetchedRows: rowsForLineage, identityRows: rowsForLineage });
  return classifyLineage({ lineage, records });
}

// Haiku 5.5 base rates: prompt 0.10, completion 0.50 USD per 1M tokens (lib/model-pricing.js).
const SNAP = { inputTokens: 1000, outputTokens: 500 };

describe('to-the-cent subset', () => {
  test('a priced, single-model, main-only lineage whose records equal the snapshot agrees exactly', () => {
    const r = classify(
      [row({ id: 'a', rootItemId: 'L1', usage: SNAP })],
      [rec({ requestId: 'm1', at: '2026-11-04T05:40:00.000Z', input: 1000, output: 500 })]
    );
    assert.equal(r.toCent, true);
    assert.equal(r.agrees, true);
    assert.equal(r.costDiff, 0);
    assert.deepEqual(r.tokenDiff, { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 0 });
  });

  test('a lineage with a subagent record is excluded from the to-the-cent subset', () => {
    const r = classify(
      [row({ id: 'a', rootItemId: 'L1', usage: SNAP })],
      [
        rec({ requestId: 'm1', at: '2026-11-04T05:40:00.000Z', input: 1000, output: 500 }),
        rec({ requestId: 's1', at: '2026-11-04T05:41:00.000Z', agent: 'agent-abc', input: 10, output: 1 })
      ]
    );
    assert.equal(r.subagents, true);
    assert.equal(r.toCent, false);
    assert.equal(r.agrees, null);
  });

  test('a lineage with two models is excluded from the to-the-cent subset', () => {
    const r = classify(
      [row({ id: 'a', rootItemId: 'L1', usage: SNAP })],
      [
        rec({ requestId: 'm1', at: '2026-11-04T05:40:00.000Z', input: 1000, output: 500 }),
        rec({ requestId: 'm2', at: '2026-11-04T05:41:00.000Z', model: 'claude-sonnet-5', input: 10, output: 1 })
      ]
    );
    assert.equal(r.oneModel, false);
    assert.equal(r.toCent, false);
  });

  test('a snapshot priced to null (Haiku over the 100k threshold) is excluded from the subset', () => {
    const r = classify(
      [row({ id: 'a', rootItemId: 'L1', usage: { inputTokens: 150000, outputTokens: 500 } })],
      [rec({ requestId: 'm1', at: '2026-11-04T05:40:00.000Z', input: 150000, output: 500 })]
    );
    assert.equal(r.snapshotPriced, false);
    assert.equal(r.toCent, false);
  });

  test('a token disagreement inside the subset is reported as a disagreement, not hidden', () => {
    const r = classify(
      [row({ id: 'a', rootItemId: 'L1', usage: SNAP })],
      [rec({ requestId: 'm1', at: '2026-11-04T05:40:00.000Z', input: 1000, output: 501 })]
    );
    assert.equal(r.toCent, true);
    assert.equal(r.agrees, false);
    assert.equal(r.tokenDiff.outputTokens, 1);
  });

  test('a record stamped after the last snapshot leaves the subset and joins the tail', () => {
    const r = classify(
      [row({ id: 'a', rootItemId: 'L1', usage: SNAP })],
      [
        rec({ requestId: 'm1', at: '2026-11-04T05:40:00.000Z', input: 1000, output: 500 }),
        rec({ requestId: 'm2', at: '2026-11-04T06:30:00.000Z', input: 200, output: 20 })
      ]
    );
    assert.equal(r.toCent, false);
    assert.equal(r.recordsAfterSnapshot, true);
    assert.equal(r.tailExcessTokens.inputTokens, 200);
    assert.equal(r.tailExcessTokens.outputTokens, 20);
  });
});

describe('D7 residue and the tail', () => {
  test('records below the snapshot on any token field are flagged as residue', () => {
    const r = classify(
      [row({ id: 'a', rootItemId: 'L1', usage: SNAP })],
      [rec({ requestId: 'm1', at: '2026-11-04T05:40:00.000Z', input: 600, output: 500 })]
    );
    assert.equal(r.d7Residue, true);
    assert.equal(r.tokenDiff.inputTokens, -400);
  });

  test('records equal to or above the snapshot are not residue', () => {
    const r = classify(
      [row({ id: 'a', rootItemId: 'L1', usage: SNAP })],
      [rec({ requestId: 'm1', at: '2026-11-04T05:40:00.000Z', input: 1000, output: 500 })]
    );
    assert.equal(r.d7Residue, false);
  });
});

describe('classes and shares', () => {
  test('a record-only lineage (no snapshot) is record-backed and not priced by snapshot', () => {
    const r = classify(
      [row({ id: 'a', rootItemId: 'L1' })],
      [rec({ requestId: 'm1', at: '2026-11-04T05:40:00.000Z', input: 1000, output: 500 })]
    );
    assert.equal(r.klass, 'record-backed');
    assert.equal(r.snapshotPriced, false);
    assert.equal(r.toCent, false);
  });

  test('a snapshot-only lineage with no records is snapshot-only', () => {
    const r = classify([row({ id: 'a', rootItemId: 'L1', usage: SNAP })], []);
    assert.equal(r.klass, 'snapshot-only');
  });

  test('a synthetic model is not counted as a model', () => {
    assert.equal(modelsOf([rec({ requestId: 's', at: '2026-11-04T05:40:00.000Z', model: '<synthetic>' })]).size, 0);
  });

  test('orphan records are those whose anchor has no member row', () => {
    const docs = [{ rootItemId: 'L1' }, { rootItemId: 'L9' }, { rootItemId: 'L9' }];
    const orphans = orphanAnchors(docs, new Set(['L1']));
    assert.equal(orphans.get('L9'), 2);
    assert.equal(orphans.has('L1'), false);
  });

  test('shares are token-weighted over the priced lineages', () => {
    const priced = classify([row({ id: 'a', rootItemId: 'L1', usage: SNAP })],
      [rec({ requestId: 'm1', at: '2026-11-04T05:40:00.000Z', input: 1000, output: 500 })]);
    const unpriced = classify([row({ id: 'b', rootItemId: 'L2', usage: { inputTokens: 150000, outputTokens: 0 } })], []);
    const unpricedWithId = { ...unpriced, anchor: 'L2' };
    const s = sharesOf([priced, unpricedWithId]);
    assert.equal(s.counts.lineagesWithUsage, 2);
    assert.equal(s.snapshotLineageShare, 0.5);
    assert.equal(s.snapshotTokenShare, 1500 / (1500 + 150000));
  });

  test('recordCostUsd withholds the figure when any record is unpriceable', () => {
    const out = recordCostUsd([rec({ requestId: 'x', at: 't', model: 'no-such-model', input: 1 })]);
    assert.equal(out.costUsd, null);
    assert.equal(out.unpriced, 1);
  });

  test('tokenSums adds the five fields', () => {
    assert.equal(tokenSums([{ inputTokens: 2, outputTokens: 3 }, { inputTokens: 5 }]).inputTokens, 7);
  });
});

describe('oplog counters', () => {
  const lines = [
    JSON.stringify({ ts: '2026-11-04T04:00:00.000Z', event: 'request-usage.flush', posted: 9, rejected: 9, failed: 0, skipped: { noRequestId: 9 } }),
    JSON.stringify({ ts: '2026-11-04T05:00:09.180Z', event: 'request-usage.flush', posted: 136, rejected: 2, failed: 1, deferred: 0, skipped: { noRequestId: 3 } }),
    JSON.stringify({ ts: '2026-11-04T05:06:04.967Z', event: 'request-usage.flush', posted: 1, rejected: 0, failed: 0, skip: 'no-token' }),
    JSON.stringify({ ts: '2026-11-04T05:07:00.000Z', event: 'request-usage.error', error: 'boom' }),
    JSON.stringify({ ts: '2026-11-04T05:08:00.000Z', event: 'unrelated' }),
    '{ not json'
  ];

  test('counts only flush events at or after the window start', () => {
    const c = oplogCounters(lines, Date.parse('2026-11-04T04:59:21Z'));
    assert.equal(c.flushEvents, 2);
    assert.equal(c.posted, 137);
    assert.equal(c.rejected, 2);
    assert.equal(c.failed, 1);
    assert.equal(c.skippedNoRequestId, 3);
    assert.equal(c.errorEvents, 1);
    assert.equal(c.skipReasons['no-token'], 1);
  });
});

describe('to-the-cent subset: model mismatch with equal tokens', () => {
  test('equal tokens but a record model that differs from the snapshot model leaves the subset', () => {
    // The same five token counts, but the record's model differs from the snapshot's: the one-model
    // check excludes it, so no agreement is asserted for it.
    const r = classify(
      [row({ id: 'a', rootItemId: 'L1', usage: { ...SNAP, model: 'claude-sonnet-5' } })],
      [rec({ requestId: 'm1', at: '2026-11-04T05:40:00.000Z', model: HAIKU, input: 1000, output: 500 })]
    );
    assert.equal(r.oneModel, false);
    assert.equal(r.toCent, false);
  });
});
