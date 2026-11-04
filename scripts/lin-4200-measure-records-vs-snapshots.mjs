#!/usr/bin/env node
/**
 * LIN-4200 (piece 3 of LIN-4195): the measurement gate for piece 4 (records vs snapshots).
 * One-off, read-only. Not part of the app.
 *
 * WHAT IT MEASURES, over every lineage with a request record or a member dispatched in the window:
 *  - the to-the-cent subset: priced snapshot, no subagents, one model, last record <= last snapshot.
 *    Agreement = the five integer token sums are equal AND the cost difference is under half a cent.
 *    A disagreement is listed with its per-field diff; it needs an explanation or it blocks piece 4.
 *    A disagreement whose gap is exactly the lineage's last record, whose first line leads the last snapshot
 *    by at most 2 s, is the SAME-STOP RACE (the snapshot walked the transcript before the final request reached disk). It is
 *    reported as its own class, not as agreement and not as unexplained.
 *  - the records-after-last-snapshot set (L4/L5 tail): records >= snapshot per token field expected;
 *    the excess is reported (tokens, and dollars when both sides price).
 *  - the D7 residue: lineages where the record token sum is below the snapshot on any token field.
 *  - the share of runner work priceable from snapshots vs from records (token-weighted and by lineage).
 *  - record-backed vs snapshot-only lineage counts; orphan records (no member row for their anchor).
 *  - the runner oplog's request-usage.flush counters (posted, rejected, failed, skipped.noRequestId).
 *  - the case classes the sample does NOT contain, reported as UNMEASURED.
 *
 * It uses the production read path: lineageRecords / foldLineageUsage / lineageFigure (lib/cost-read.js,
 * lib/row-usage.js), priceRequest and resolveWorkerModelId (lib/model-pricing.js). No pricing is re-implemented.
 *
 * READ-ONLY. Only find() calls against Mongo. No inserts, updates, deletes, or index builds.
 *
 * RUN (the URI is read from the environment at run time and never written to a file):
 *   MONGODB_URI='<read-only production URI>' node scripts/lin-4200-measure-records-vs-snapshots.mjs \
 *     [--url-key KEY] [--out FILE]
 * Env:
 *   LIN4200_DB            database name (default: linear-viewer)
 *   LIN4200_WINDOW_START  window start, ISO (default: 2026-11-04T04:59:21Z, the LIN-4199 merge)
 *   LIN4200_OPLOG         runner oplog path (default: /Users/autopilot/development/simple-dispatcher/state/oplog.jsonl)
 *
 * TESTS (pure classification and oplog logic, on fixtures built with the production fold):
 *   node --test tests/unit/lin-4200-measure.test.js
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { lineageRecords, lineageFigure } from '../lib/cost-read.js';
import { lastUsageEntry } from '../lib/row-usage.js';
import { priceRequest, resolveWorkerModelId, promptTokensOf } from '../lib/model-pricing.js';

export const TOKEN_FIELDS = Object.freeze([
  'inputTokens',
  'outputTokens',
  'cacheCreationInputTokens',
  'cacheCreation1hInputTokens',
  'cacheReadInputTokens'
]);

const SYNTHETIC_MODEL = '<synthetic>';
const CENT_EPSILON = 0.005;
// The final line's first-seen time may lead the snapshot by at most this much. Chosen AFTER the first live run
// (every race observed led by 0.19-0.45 s); disclosed in the LIN-4200 report, not fitted to the outcome.
const RACE_WINDOW_MS = 2000;
const DEPLOY_MS = Date.parse('2026-11-04T04:59:21Z');
const LONG_CONTEXT_THRESHOLD = 100000;

const msOf = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const tokenValue = (item, field) => (typeof item[field] === 'number' && Number.isFinite(item[field]) ? item[field] : 0);

/** The five token sums over a list of items (records or a snapshot's tokens). */
export function tokenSums(items) {
  const out = {};
  for (const field of TOKEN_FIELDS) out[field] = items.reduce((sum, item) => sum + tokenValue(item, field), 0);
  return out;
}

/** The record's own request, shaped for priceRequest (claude-code records carry no native cost). */
function requestOf(record) {
  const request = { model: record.model, harness: 'claude-code', costUsd: null };
  for (const field of TOKEN_FIELDS) request[field] = tokenValue(record, field);
  return request;
}

/** Sum of priceRequest over the records; null when any record is unpriceable (the figure is withheld). */
export function recordCostUsd(records) {
  let total = 0;
  let unpriced = 0;
  for (const record of records) {
    const cost = priceRequest(requestOf(record));
    if (cost === null) unpriced += 1;
    else total += cost;
  }
  return { costUsd: unpriced > 0 ? null : total, unpriced };
}

/** Priced token total of the records whose own price is known (for the record-side share). */
function pricedTokensOf(records) {
  let tokens = 0;
  for (const record of records) {
    if (priceRequest(requestOf(record)) !== null) tokens += TOKEN_FIELDS.reduce((s, f) => s + tokenValue(record, f), 0);
  }
  return tokens;
}

/** The distinct resolved models of the records, excluding `<synthetic>` (walkRequestRecords skips it). */
export function modelsOf(records) {
  const models = new Set();
  for (const record of records) {
    if (typeof record.model !== 'string' || !record.model || record.model === SYNTHETIC_MODEL) continue;
    models.add(resolveWorkerModelId(record.model) ?? record.model);
  }
  return models;
}

/**
 * The timestamp of the last counted snapshot: the last usage entry of the counted row (the fold's
 * lastIndex names it). The snapshot carries no covered-through field, so its post time is the cover point.
 */
export function snapshotAtMsOf(lineage) {
  const index = lineage.fold.lastIndex;
  if (index === null || index === undefined) return null;
  const entry = lastUsageEntry(lineage.members[index]?.feedback);
  return msOf(entry?.timestamp);
}

/**
 * Classify one lineage. `lineage` is one lineageRecords() record (its fold is the legacy snapshot read);
 * `records` are the request-usage docs for its anchor. Returns plain facts, no judgement.
 */
export function classifyLineage({ lineage, records }) {
  const fold = lineage.fold;
  const snapshotTokens = fold.tokens; // null when unreadable or no usage
  const snapshotAtMs = snapshotAtMsOf(lineage);
  const snapshotModel = fold.last?.model ?? null;
  const snapshotPriced = lineageFigure(lineage).fullyPriced;
  const subagents = records.some(record => typeof record.agent === 'string' && record.agent !== 'main');
  const models = modelsOf(records);
  const oneModel = models.size === 1 && snapshotModel !== null
    && models.has(resolveWorkerModelId(snapshotModel) ?? snapshotModel);
  const recordMs = records.map(record => msOf(record.at)).filter(Number.isFinite);
  const lastRecordMs = recordMs.length > 0 ? Math.max(...recordMs) : null;
  const recordTokens = tokenSums(records);
  const recordBacked = records.length > 0;
  const snapshotOnly = !recordBacked && fold.completeness !== 'no-usage';
  const recordCost = recordCostUsd(records);
  const snapshotCostUsd = fold.costUsd;

  const lastRecordBeforeSnapshot = lastRecordMs !== null && snapshotAtMs !== null && lastRecordMs <= snapshotAtMs;
  const toCent = recordBacked && snapshotPriced && !subagents && oneModel && lastRecordBeforeSnapshot;

  let tokenDiff = null;
  let costDiff = null;
  let agrees = null;
  if (snapshotTokens) {
    tokenDiff = Object.fromEntries(TOKEN_FIELDS.map(f => [f, recordTokens[f] - (snapshotTokens[f] ?? 0)]));
  }
  if (toCent) {
    const tokensEqual = TOKEN_FIELDS.every(f => tokenDiff[f] === 0);
    costDiff = recordCost.costUsd === null || snapshotCostUsd === null ? null : recordCost.costUsd - snapshotCostUsd;
    agrees = tokensEqual && costDiff !== null && Math.abs(costDiff) < CENT_EPSILON;
  }

  // The same-Stop race: the snapshot walked the transcript before the lineage's final request reached
  // disk. The gap is exactly that one request, and its first line led the snapshot by at most RACE_WINDOW_MS.
  // Reported as its own class, never as agreement and never as an unexplained gap.
  const lastRecord = records.length > 0
    ? [...records].sort((a, b) => (msOf(a.at) ?? 0) - (msOf(b.at) ?? 0))[records.length - 1]
    : null;
  // The race is about the final line's timing vs the snapshot walk: the line was written moments before the
  // snapshot was taken. Its post time is not used: a later flush may post it seconds after the snapshot.
  const lastRecordAtMs = lastRecord ? msOf(lastRecord.at) : null;
  const gapIsLastRecord = tokenDiff !== null && lastRecord !== null
    && TOKEN_FIELDS.every(f => tokenDiff[f] === tokenValue(lastRecord, f));
  const lagMs = lastRecordAtMs !== null && snapshotAtMs !== null ? snapshotAtMs - lastRecordAtMs : null;
  const sameStopRace = toCent && agrees === false && gapIsLastRecord && lagMs !== null
    && lagMs >= 0 && lagMs <= RACE_WINDOW_MS;
  // Requests whose first transcript line predates the deploy: a lineage resumed across it, or a pre-deploy
  // transcript the first post walked.
  const preDeployRecords = records.filter(record => {
    const ms = msOf(record.at);
    return ms !== null && ms < DEPLOY_MS;
  }).length;

  const recordsAfterSnapshot = recordBacked && snapshotAtMs !== null && lastRecordMs > snapshotAtMs;
  const d7Residue = recordBacked && tokenDiff !== null && TOKEN_FIELDS.some(f => tokenDiff[f] < 0);
  const tailExcessTokens = recordsAfterSnapshot && tokenDiff ? tokenDiff : null;
  const tailExcessCostUsd = recordsAfterSnapshot && recordCost.costUsd !== null && snapshotCostUsd !== null
    ? recordCost.costUsd - snapshotCostUsd : null;

  return {
    anchor: lineage.anchor,
    issueIdentifier: lineage.issueIdentifier ?? null,
    klass: recordBacked ? 'record-backed' : snapshotOnly ? 'snapshot-only' : 'no-usage',
    snapshotPriced,
    snapshotCompleteness: fold.completeness,
    subagents,
    models: [...models],
    oneModel,
    snapshotModel,
    lastRecordAt: lastRecordMs === null ? null : new Date(lastRecordMs).toISOString(),
    snapshotAt: snapshotAtMs === null ? null : new Date(snapshotAtMs).toISOString(),
    toCent,
    agrees,
    sameStopRace,
    lagMs,
    preDeployRecords,
    tokenDiff,
    costDiff,
    recordsAfterSnapshot,
    tailExcessTokens,
    tailExcessCostUsd,
    d7Residue,
    recordTokens: recordBacked ? recordTokens : null,
    snapshotTokens,
    recordCostUsd: recordCost.costUsd,
    snapshotCostUsd,
    unpricedRecords: recordCost.unpriced,
    recordPricedTokens: pricedTokensOf(records),
    recordTokenTotal: TOKEN_FIELDS.reduce((s, f) => s + recordTokens[f], 0),
    snapshotTokenTotal: snapshotTokens ? TOKEN_FIELDS.reduce((s, f) => s + (snapshotTokens[f] ?? 0), 0) : null,
    incomplete: lineage.incomplete,
    fullRecordCount: records.length
  };
}

/** Request records whose anchor has no member row (they belong to no lineage the read can see). */
export function orphanAnchors(usageDocs, anchorsWithMemberRows) {
  const orphans = new Map();
  for (const doc of usageDocs) {
    if (anchorsWithMemberRows.has(doc.rootItemId)) continue;
    orphans.set(doc.rootItemId, (orphans.get(doc.rootItemId) || 0) + 1);
  }
  return orphans;
}

/** Token-weighted and count shares. Snapshot side: snapshot tokens. Record side: record tokens. */
export function sharesOf(results) {
  const withSnapshot = results.filter(r => r.snapshotTokens);
  const snapshotTotal = withSnapshot.reduce((s, r) => s + r.snapshotTokenTotal, 0);
  const snapshotPricedTotal = withSnapshot.filter(r => r.snapshotPriced).reduce((s, r) => s + r.snapshotTokenTotal, 0);
  const recordBacked = results.filter(r => r.klass === 'record-backed');
  const recordTotal = recordBacked.reduce((s, r) => s + r.recordTokenTotal, 0);
  const recordPricedTotal = recordBacked.reduce((s, r) => s + r.recordPricedTokens, 0);
  const usage = results.filter(r => r.klass !== 'no-usage');
  return {
    snapshotTokenShare: snapshotTotal > 0 ? snapshotPricedTotal / snapshotTotal : null,
    snapshotLineageShare: usage.length > 0 ? usage.filter(r => r.snapshotPriced).length / usage.length : null,
    recordTokenShare: recordTotal > 0 ? recordPricedTotal / recordTotal : null,
    recordLineageShare: recordBacked.length > 0
      ? recordBacked.filter(r => r.unpricedRecords === 0).length / recordBacked.length : null,
    counts: {
      lineagesWithUsage: usage.length,
      recordBacked: recordBacked.length,
      snapshotOnly: results.filter(r => r.klass === 'snapshot-only').length,
      noUsage: results.filter(r => r.klass === 'no-usage').length
    },
    denominators: {
      snapshotTokens: snapshotTotal,
      snapshotPricedTokens: snapshotPricedTotal,
      recordTokens: recordTotal,
      recordPricedTokens: recordPricedTotal
    }
  };
}

/**
 * The runner oplog's request-usage counters over flush events at or after `sinceMs`.
 * posted = records in acknowledged batches; rejected = records refused for good; failed = unacknowledged
 * batches; skipped.noRequestId = transcript lines with no message id (never given a synthetic id).
 */
export function oplogCounters(lines, sinceMs = -Infinity) {
  const out = { flushEvents: 0, posted: 0, rejected: 0, failed: 0, deferred: 0, skippedNoRequestId: 0,
    errorEvents: 0, skipReasons: {} };
  for (const line of lines) {
    if (!line || !line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const ms = msOf(event.ts);
    if (ms === null || ms < sinceMs) continue;
    if (event.event === 'request-usage.error') out.errorEvents += 1;
    if (event.event !== 'request-usage.flush') continue;
    out.flushEvents += 1;
    out.posted += event.posted || 0;
    out.rejected += event.rejected || 0;
    out.failed += event.failed || 0;
    out.deferred += event.deferred || 0;
    out.skippedNoRequestId += event.skipped?.noRequestId || 0;
    if (event.skip) out.skipReasons[event.skip] = (out.skipReasons[event.skip] || 0) + 1;
  }
  return out;
}

/** Case classes the sample does not contain are UNMEASURED, never passing. */
export function caseClassesOf(results, records, lineages) {
  const haikuOver100k = records.some(r => typeof r.model === 'string' && /haiku/.test(r.model)
    && promptTokensOf(requestOf(r)) > LONG_CONTEXT_THRESHOLD);
  const resumedAcrossDeploy = results.some(r => r.preDeployRecords > 0);
  const subagentRecords = records.some(r => typeof r.agent === 'string' && r.agent !== 'main');
  const mixedModel = results.some(r => r.models.length > 1);
  const oneTurnRecords = results.some(r => r.fullRecordCount === 1);
  const classes = {
    subagents: subagentRecords ? 'present' : 'UNMEASURED',
    mixedModel: mixedModel ? 'present' : 'UNMEASURED',
    haikuOver100k: haikuOver100k ? 'present' : 'UNMEASURED',
    resumedAcrossDeploy: resumedAcrossDeploy ? 'present' : 'UNMEASURED',
    oneTurnLineage: oneTurnRecords ? 'present' : 'UNMEASURED',
    syntheticTail: 'UNMEASURED (<synthetic> messages are skipped at write time; not visible in Harbour)',
    killedOrReapedNoStop: 'UNMEASURED (no marker in Harbour rows; needs runner transcript check)',
    unsnapshotedRecordOnly: 'UNMEASURED (records with no snapshot at all are counted under snapshot-only tail, not separately)'
  };
  return { classes, lineageCount: lineages.length };
}

// ---------- Mongo read (the only I/O) ----------

async function readWorkspace(db, urlKey, windowStart) {
  const usageDocs = await db.collection('request-usage')
    .find({ urlKey }, { projection: { _id: 0 } }).toArray();
  const recordAnchors = new Set(usageDocs.map(d => d.rootItemId));
  const windowFilter = { urlKey, dispatchedAt: { $gte: windowStart }, status: 'taken' };
  const windowRows = [
    ...await db.collection('dispatch-queue').find(windowFilter, { projection: { _id: 1, rootItemId: 1 } }).toArray(),
    ...await db.collection('dispatch-history').find(windowFilter, { projection: { _id: 1, rootItemId: 1 } }).toArray()
  ];
  const anchors = new Set([...recordAnchors, ...windowRows.map(r => String(r.rootItemId || r._id))]);
  const anchorList = [...anchors];
  const anchorQuery = { urlKey, $or: [{ rootItemId: { $in: anchorList } }, { _id: { $in: anchorList } }] };
  const rows = [
    ...await db.collection('dispatch-queue').find(anchorQuery).toArray(),
    ...await db.collection('dispatch-history').find(anchorQuery).toArray()
  ];
  return { usageDocs, rows, windowRowCount: windowRows.length };
}

async function main(argv) {
  const args = Object.fromEntries(argv.reduce((acc, arg, i, all) => {
    if (arg.startsWith('--')) acc.push([arg.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []));
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set (read-only production URI; never written to a file)');
  const { MongoClient } = await import('mongodb');
  const windowStartIso = process.env.LIN4200_WINDOW_START || '2026-11-04T04:59:21Z';
  const windowStart = new Date(windowStartIso);
  const oplogPath = process.env.LIN4200_OPLOG || '/Users/autopilot/development/simple-dispatcher/state/oplog.jsonl';
  const client = new MongoClient(uri, { readPreference: 'primary' });
  await client.connect();
  try {
    const db = client.db(process.env.LIN4200_DB || 'linear-viewer');
    const urlKeys = args['url-key'] && args['url-key'] !== true
      ? [args['url-key']]
      : await db.collection('request-usage').distinct('urlKey');
    const perWorkspace = {};
    for (const urlKey of urlKeys) {
      const { usageDocs, rows, windowRowCount } = await readWorkspace(db, urlKey, windowStart);
      const lineages = lineageRecords({ fetchedRows: rows, identityRows: rows });
      const byAnchor = new Map();
      for (const doc of usageDocs) {
        const list = byAnchor.get(doc.rootItemId) || [];
        list.push(doc);
        byAnchor.set(doc.rootItemId, list);
      }
      const results = lineages.map(lineage => classifyLineage({ lineage, records: byAnchor.get(lineage.anchor) || [] }));
      const memberAnchors = new Set(lineages.map(l => l.anchor));
      const orphans = orphanAnchors(usageDocs, memberAnchors);
      const recordTimes = usageDocs.map(d => msOf(d.at)).filter(Number.isFinite);
      perWorkspace[urlKey] = {
        window: {
          start: windowStart.toISOString(),
          firstRecordAt: recordTimes.length ? new Date(Math.min(...recordTimes)).toISOString() : null,
          lastRecordAt: recordTimes.length ? new Date(Math.max(...recordTimes)).toISOString() : null,
          recordCount: usageDocs.length,
          windowRowCount
        },
        orphanRecordAnchors: orphans.size,
        orphanRecordCount: [...orphans.values()].reduce((s, n) => s + n, 0),
        toCent: {
          eligible: results.filter(r => r.toCent).length,
          agree: results.filter(r => r.toCent && r.agrees).length,
          sameStopRace: results.filter(r => r.sameStopRace).length,
          unexplained: results.filter(r => r.toCent && r.agrees === false && !r.sameStopRace),
          disagreements: results.filter(r => r.toCent && !r.agrees)
        },
        tail: results.filter(r => r.recordsAfterSnapshot).map(r => ({
          anchor: r.anchor, tailExcessTokens: r.tailExcessTokens, tailExcessCostUsd: r.tailExcessCostUsd,
          toCentEligible: r.toCent
        })),
        d7Residue: results.filter(r => r.d7Residue).map(r => r.anchor),
        shares: sharesOf(results),
        cases: caseClassesOf(results, usageDocs, lineages),
        lineages: results
      };
    }
    const oplogLines = readFileSync(oplogPath, 'utf8').split('\n');
    const report = {
      generatedAt: new Date().toISOString(),
      oplog: oplogCounters(oplogLines, windowStart.getTime()),
      workspaces: perWorkspace
    };
    const json = JSON.stringify(report, null, 2);
    if (args.out && args.out !== true) writeFileSync(args.out, json);
    process.stdout.write(json + '\n');
  } finally {
    await client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(err => {
    process.stderr.write(`lin-4200 measurement failed: ${err.message}\n`);
    process.exit(1);
  });
}
