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
import { lineageRecords as lineageRecords__unplumbed } from '../../lib/cost-read.js';
import {
  classifyLineage, modelsOf, oplogCounters, requestRecordAudit, readWorkspace, sharesOf, tokenSums, recordCostUsd,
  oplogCrossCheck, parseFlushes
} from '../../scripts/lin-4200-measure-records-vs-snapshots.mjs';
import { NO_REQUEST_RECORDS, withRequestRows } from '../fixtures/request-usage-loader.js';
// LIN-4201: these tests read snapshot-only lineages, so they pass "no request records" explicitly (plumbing only).
const lineageRecords = withRequestRows(lineageRecords__unplumbed, 0, { requestRows: [] });


const HAIKU = 'claude-haiku-5-5';
const NOW_ISO = '2026-11-04T05:00:00.000Z';
const SNAP_AT = '2026-11-04T06:00:00.000Z';

/** A dispatch row carrying one `[usage]` snapshot (a running total, claude-code). */
function row({ id, rootItemId, usage, usageAt = SNAP_AT, dispatchedAt = '2026-11-04T05:30:00.000Z', kind = 'implementation' }) {
  const feedback = usage
    ? [{ kind: 'usage', message: `[usage] ${JSON.stringify({ harness: 'claude-code', model: usage.model ?? HAIKU, ...usage })}`, timestamp: usageAt }]
    : [];
  return { _id: id, id, rootItemId, status: 'taken', abort: false, kind, issueIdentifier: 'LIN-1', dispatchedAt, feedback };
}

/** A request record as the intake stores it (identity, metadata, and the five token fields). */
function rec({ requestId, at, agent = 'main', model = HAIKU, input = 0, output = 0, cacheRead = 0, cacheWrite = 0, updatedAt = at }) {
  return {
    requestId, rootItemId: 'L1', agent, model, harness: 'claude-code', at, updatedAt,
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

describe('same-Stop race (the final request missed by the snapshot walk)', () => {
  test('a gap that is exactly the last record, led by the snapshot by 0.2 s, is the race', () => {
    // The snapshot (06:00:00.000) covers m1 only. m2 first lines at 05:59:59.800, posted at 06:00:00.100:
    // the snapshot walked before m2's line reached disk.
    const r = classify(
      [row({ id: 'a', rootItemId: 'L1', usage: SNAP })],
      [
        rec({ requestId: 'm1', at: '2026-11-04T05:40:00.000Z', input: 1000, output: 500 }),
        rec({ requestId: 'm2', at: '2026-11-04T05:59:59.800Z', updatedAt: '2026-11-04T05:59:59.900Z', input: 200, output: 130 })
      ]
    );
    assert.equal(r.toCent, true);
    assert.equal(r.agrees, false);
    assert.equal(r.sameStopRace, true);
    // RULING lin4200-to-cent-rule: the race class is excluded from the to-the-cent subset.
    assert.equal(r.toCentSubset, false);
  });

  test('a gap whose final line led the snapshot by a minute is NOT the race (unexplained)', () => {
    const r = classify(
      [row({ id: 'a', rootItemId: 'L1', usage: SNAP })],
      [
        rec({ requestId: 'm1', at: '2026-11-04T05:40:00.000Z', input: 1000, output: 500 }),
        rec({ requestId: 'm2', at: '2026-11-04T05:59:00.000Z', updatedAt: '2026-11-04T05:59:30.000Z', input: 200, output: 130 })
      ]
    );
    assert.equal(r.agrees, false);
    assert.equal(r.sameStopRace, false);
    // Outside the class, so it stays in the subset: it is unexplained, not silently dropped.
    assert.equal(r.toCentSubset, true);
  });

  test('a gap that is NOT exactly the last record is not the race, even when posted close in time', () => {
    const r = classify(
      [row({ id: 'a', rootItemId: 'L1', usage: SNAP })],
      [
        rec({ requestId: 'm1', at: '2026-11-04T05:40:00.000Z', input: 1000, output: 500 }),
        rec({ requestId: 'm2', at: '2026-11-04T05:59:59.800Z', updatedAt: '2026-11-04T05:59:59.900Z', input: 200, output: 130 }),
        rec({ requestId: 'm3', at: '2026-11-04T05:59:00.000Z', updatedAt: '2026-11-04T05:59:59.900Z', input: 0, output: 7 })
      ]
    );
    assert.equal(r.agrees, false);
    assert.equal(r.sameStopRace, false);
    assert.equal(r.toCentSubset, true);
  });
});

describe('pre-deploy requests', () => {
  test('a record whose first line predates the deploy is counted as pre-deploy', () => {
    const r = classify(
      [row({ id: 'a', rootItemId: 'L1', usage: SNAP })],
      [rec({ requestId: 'old', at: '2026-11-04T04:20:00.000Z', input: 1000, output: 500 })]
    );
    assert.equal(r.preDeployRecords, 1);
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

  test('orphan records are those whose itemId has no posting row in dispatch-history (not the stamp)', () => {
    const a = requestRecordAudit({
      usageDocs: [
        { itemId: 'row-a', rootItemId: 'row-a', requestId: 'm1' },
        { itemId: 'ghost', rootItemId: 'L9', requestId: 'm2' },
        { itemId: 'ghost', rootItemId: 'L9', requestId: 'm3' }
      ],
      postingRows: [{ _id: 'row-a', rootItemId: 'L1', kind: 'implementation' }],
      folded: [], lineages: []
    });
    assert.equal(a.orphanRecords, 2);
    assert.equal(a.orphanPostingRows, 1);
    assert.deepEqual(a.orphans, [{ itemId: 'ghost', stamp: 'L9', records: 2 }]);
  });

  test('a stranded wake record is not an orphan; a wake-stamped record is counted as informational; a re-post split is reported raw and not after the read', () => {
    // W is a wake latched to L1. m1 was posted before the latch (stamp W) and re-posted after it (stamp L1): a split.
    // m2 was posted before the latch and never re-posted: stranded under W, reachable through its posting row.
    const a = requestRecordAudit({
      usageDocs: [
        { itemId: 'W', rootItemId: 'W', requestId: 'm1' },
        { itemId: 'W', rootItemId: 'L1', requestId: 'm1' },
        { itemId: 'W', rootItemId: 'W', requestId: 'm2' }
      ],
      postingRows: [{ _id: 'W', rootItemId: 'L1', kind: 'wake' }],
      folded: [{ rootItemId: 'L1', requestId: 'm1' }, { rootItemId: 'L1', requestId: 'm2' }],
      lineages: [{ members: [{ kind: 'implementation' }] }]
    });
    assert.equal(a.orphanRecords, 0, 'a record whose posting row exists is never an orphan');
    assert.equal(a.stampedAtWakeId, 2, 'the two pre-latch records carry the wake id as their stamp');
    assert.equal(a.splitRequests, 1);
    assert.equal(a.splitRawDocs, 1, 'the raw split is reported before the read');
    assert.equal(a.duplicateAfterRead, 0, 'the loader folds the split: no duplicate after the read');
    assert.equal(a.phantomLineages, 0);
  });

  test('a lineage whose only member is a wake is a phantom lineage; a repeated (root, requestId) after the read is counted', () => {
    const a = requestRecordAudit({
      usageDocs: [],
      postingRows: [],
      folded: [{ rootItemId: 'L1', requestId: 'm1' }, { rootItemId: 'L1', requestId: 'm1' }],
      lineages: [{ members: [{ kind: 'wake' }] }, { members: [{ kind: 'implementation' }, { kind: 'wake' }] }]
    });
    assert.equal(a.phantomLineages, 1, 'a wake-only lineage is phantom; a lineage with a real member is not');
    assert.equal(a.duplicateAfterRead, 1);
  });

  test('readWorkspace only reads: every collection call is a find, and no write method is ever invoked', async () => {
    const writes = [];
    const canned = {
      'request-usage': [{ urlKey: 'ws', itemId: 'row-a', rootItemId: 'row-a', requestId: 'm1', at: NOW_ISO, updatedAt: NOW_ISO, inputTokens: 1 }],
      'dispatch-history': [{ _id: 'row-a', urlKey: 'ws', rootItemId: 'row-a', kind: 'implementation', status: 'taken', abort: false, dispatchedAt: NOW_ISO }],
      'dispatch-queue': []
    };
    const WRITE_METHODS = ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'bulkWrite', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'createIndex', 'drop'];
    const collection = (name) => {
      const handle = {
        find: () => ({ toArray: async () => canned[name] ?? [] })
      };
      for (const method of WRITE_METHODS) handle[method] = async () => { writes.push(`${name}.${method}`); throw new Error(`write refused: ${name}.${method}`); };
      return handle;
    };
    const db = { collection };
    const { records, postingRows } = await readWorkspace(db, 'ws', new Date('2026-11-04T00:00:00Z'));
    assert.deepEqual(writes, []);
    assert.equal(postingRows.length, 1);
    assert.equal(records.length, 1, 'the record side is the loader, and it returns the record under its posting row');
    assert.equal(records[0].rootItemId, 'row-a');
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

describe('coverage by post time (review finding 1)', () => {
  test('a record first written before the snapshot but posted after it lands in the tail, not the subset', () => {
    // at 05:59:59.800 <= snapshot 06:00:00.000 < updatedAt 06:00:00.100: the snapshot cannot include a record
    // posted after it, so the excess is the late record, and it is counted as a late post.
    const r = classify(
      [row({ id: 'a', rootItemId: 'L1', usage: SNAP })],
      [
        rec({ requestId: 'm1', at: '2026-11-04T05:40:00.000Z', input: 1000, output: 500 }),
        rec({ requestId: 'm2', at: '2026-11-04T05:59:59.800Z', updatedAt: '2026-11-04T06:00:00.100Z', input: 200, output: 130 })
      ]
    );
    assert.equal(r.recordsAfterSnapshot, true);
    assert.equal(r.toCent, false);
    assert.equal(r.toCentSubset, false);
    assert.equal(r.sameStopRace, false);
    assert.equal(r.lateRacePost, true);
    assert.equal(r.tailGeqSnapshot, true);
    assert.equal(r.tailEqualsLatePosts, true);
    assert.equal(r.tailExcessTokens.inputTokens, 200);
    assert.equal(r.tailExcessTokens.outputTokens, 130);
  });

  test('equal tokens with a different snapshot cost do not agree (the to-the-cent half of the rule)', () => {
    const rows = [row({ id: 'a', rootItemId: 'L1', usage: SNAP })];
    const [lineage] = lineageRecords({ fetchedRows: rows, identityRows: rows });
    lineage.fold = { ...lineage.fold, costUsd: 999 }; // the snapshot's dollars differ; its tokens are equal
    const r = classifyLineage({
      lineage,
      records: [rec({ requestId: 'm1', at: '2026-11-04T05:40:00.000Z', input: 1000, output: 500 })]
    });
    assert.equal(r.toCent, true);
    assert.equal(r.tokenDiff.inputTokens, 0);
    assert.equal(r.tokenDiff.outputTokens, 0);
    assert.equal(r.agrees, false);
    assert.equal(r.toCentSubset, true); // it is not the race class, so it is reported as unexplained
  });
});

describe('oplog cross-check (review finding 4)', () => {
  const flush = (ts, posted, reason) => JSON.stringify({ ts, event: 'request-usage.flush', sessionId: 'S1', reason, posted });
  const oplog = [
    flush('2026-11-04T05:02:00.600Z', 32, 'stop'),
    flush('2026-11-04T05:02:04.400Z', 1, 'stop'),
    flush('2026-11-04T05:02:07.600Z', 1, 'reap')
  ];

  test('late posts match the trailing stop and reap flushes by time; an unmatched post is reported', () => {
    const out = oplogCrossCheck({
      lineages: [{ anchor: 'L1', latePostMs: [Date.parse('2026-11-04T05:02:04.900Z'), Date.parse('2026-11-04T05:02:08.000Z'), Date.parse('2026-11-04T06:00:00.000Z')] }],
      oplogLines: oplog,
      anchorOfSession: { S1: 'L1' } // the runner state maps the runner session to its lineage anchor
    });
    const lin = out.perLineage[0];
    assert.equal(lin.trailingStopPosts, 1);
    assert.equal(lin.reapPosts, 1);
    assert.equal(lin.matchedLate, 2);
    assert.equal(lin.matchedStop, 1);
    assert.equal(lin.matchedReap, 1);
    assert.equal(lin.unmatchedLate, 1);
    assert.equal(out.totals.unmatchedLate, 1);
  });

  test('parseFlushes keeps only request-usage.flush events and their reason', () => {
    const events = parseFlushes([...oplog, JSON.stringify({ ts: '2026-11-04T05:03:00.000Z', event: 'unrelated' })]);
    assert.equal(events.length, 3);
    assert.deepEqual(events.map(e => e.reason), ['stop', 'stop', 'reap']);
  });
});

