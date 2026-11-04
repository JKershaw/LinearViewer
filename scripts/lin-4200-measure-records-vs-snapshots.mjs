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
 *  - record-backed vs snapshot-only lineage counts; the request-record audit (orphan records: no posting row for their
 *    itemId; duplicates before and after the loader; records stamped at a wake; phantom wake-only lineages).
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
import { RequestUsageStore } from '../lib/request-usage-store.js';
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
 * COVERAGE IS DEFINED BY POST TIME (review finding 1, LIN-4200).
 *
 * A record is covered by the snapshot only when it was posted to Harbour no later than the snapshot itself:
 * `updatedAt <= snapshotAt`. The snapshot is written after its own walk of the transcript, so a record posted
 * after the snapshot cannot be claimed to be inside it. The first transcript line's time (`at`) says when a
 * request was written, not when anything could have read it, so it does not decide coverage. This matches the
 * plan's intent: a lineage is compared with its snapshot only when the snapshot is provably at least as late as
 * every record it is compared with. `updatedAt` is the store's latest post that touched a record (`$max`), so a
 * record that grew after the snapshot also counts as posted after it.
 *
 * The same-walk race (RULING lin4200-to-cent-rule) is still identified from the first-line timing: the final
 * request's first line leads the snapshot by at most RACE_WINDOW_MS, and the gap is exactly that request. It is
 * excluded from to-the-cent only when it was posted by the snapshot. A late post with the same shape is a tail
 * record, counted in the tail, and is not excluded.
 *
 * `lineage` is one lineageRecords() record (its fold is the legacy snapshot read); `records` are the
 * request-usage docs for its anchor. Returns plain facts, no judgement.
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
  const recordBacked = records.length > 0;
  const snapshotOnly = !recordBacked && fold.completeness !== 'no-usage';
  const recordTokens = tokenSums(records);
  const recordCost = recordCostUsd(records);
  const snapshotCostUsd = fold.costUsd;

  // Coverage by post time. A record posted after the snapshot is a tail record.
  const latePosts = snapshotAtMs === null ? [] : records.filter(record => {
    const posted = msOf(record.updatedAt);
    return posted !== null && posted > snapshotAtMs;
  });
  const lastPostedMs = records.map(record => msOf(record.updatedAt)).filter(Number.isFinite);
  const latestPostMs = lastPostedMs.length > 0 ? Math.max(...lastPostedMs) : null;
  const noLatePosts = recordBacked && snapshotAtMs !== null && latePosts.length === 0;
  const toCent = recordBacked && snapshotPriced && !subagents && oneModel && noLatePosts;

  let tokenDiff = null;
  let costDiff = null;
  let agrees = null;
  if (snapshotTokens) {
    tokenDiff = Object.fromEntries(TOKEN_FIELDS.map(f => [f, recordTokens[f] - (snapshotTokens[f] ?? 0)]));
  }
  if (tokenDiff !== null && recordCost.costUsd !== null && snapshotCostUsd !== null) {
    costDiff = recordCost.costUsd - snapshotCostUsd;
  }
  if (toCent) {
    // Both halves of the rule: equal tokens AND equal dollars to the cent. Equal tokens alone is not agreement.
    const tokensEqual = TOKEN_FIELDS.every(f => tokenDiff[f] === 0);
    agrees = tokensEqual && costDiff !== null && Math.abs(costDiff) < CENT_EPSILON;
  }

  // The same-walk race, by first-line timing (the ruling's named class).
  const lastRecord = records.length > 0
    ? [...records].sort((a, b) => (msOf(a.at) ?? 0) - (msOf(b.at) ?? 0))[records.length - 1]
    : null;
  const lastRecordAtMs = lastRecord ? msOf(lastRecord.at) : null;
  const gapIsLastRecord = tokenDiff !== null && lastRecord !== null
    && TOKEN_FIELDS.every(f => tokenDiff[f] === tokenValue(lastRecord, f));
  const lagMs = lastRecordAtMs !== null && snapshotAtMs !== null ? snapshotAtMs - lastRecordAtMs : null;
  const withinRaceWindow = lagMs !== null && lagMs >= 0 && lagMs <= RACE_WINDOW_MS;
  const sameStopRace = toCent && agrees === false && gapIsLastRecord && withinRaceWindow;
  // RULING lin4200-to-cent-rule: exclude the TRUE same-walk race from to-the-cent, and count it. Nothing else.
  const toCentSubset = toCent && !sameStopRace;

  // The former race class (before the post-time fix), split for the review: a late post has the same timing and
  // gap shape but was posted after the snapshot. A true race is the same shape posted by the snapshot.
  const lastRecordBeforeSnapshotByAt = lastRecordAtMs !== null && snapshotAtMs !== null && lastRecordAtMs <= snapshotAtMs;
  const formerEligible = recordBacked && snapshotPriced && !subagents && oneModel && lastRecordBeforeSnapshotByAt;
  const formerRaceShape = formerEligible && gapIsLastRecord && withinRaceWindow;
  const recordsAfterSnapshot = latePosts.length > 0;
  const lateRacePost = recordsAfterSnapshot && gapIsLastRecord && withinRaceWindow;

  // Tail: records posted after the snapshot. Checked, not assumed: records >= snapshot per field, and the excess
  // should equal exactly the late-posted records (in tokens and in dollars).
  const lateTokens = tokenSums(latePosts);
  const lateCostUsd = recordCostUsd(latePosts).costUsd;
  const tailExcessTokens = recordsAfterSnapshot && tokenDiff ? tokenDiff : null;
  const tailGeqSnapshot = recordsAfterSnapshot && tokenDiff !== null && TOKEN_FIELDS.every(f => tokenDiff[f] >= 0);
  const tailEqualsLatePosts = recordsAfterSnapshot && tokenDiff !== null && TOKEN_FIELDS.every(f => tokenDiff[f] === lateTokens[f]);
  const tailExcessCostUsd = recordsAfterSnapshot && costDiff !== null ? costDiff : null;
  // Dollars are compared for single-model lineages only. A mixed-model snapshot prices its whole cumulative total at
  // its last model (the change-(b) effect on the replay list: records price each request at its own model), so its
  // dollar gap is that intended difference, not a tail check.
  const tailCostEqualsLatePosts = oneModel && tailExcessCostUsd !== null && lateCostUsd !== null
    ? Math.abs(tailExcessCostUsd - lateCostUsd) < CENT_EPSILON : null;
  const d7Residue = recordBacked && tokenDiff !== null && TOKEN_FIELDS.some(f => tokenDiff[f] < 0);

  const preDeployRecords = records.filter(record => {
    const ms = msOf(record.at);
    return ms !== null && ms < DEPLOY_MS;
  }).length;

  return {
    anchor: lineage.anchor,
    issueIdentifier: lineage.issueIdentifier ?? null,
    sessionIds: [...new Set((lineage.members || []).map(m => m.sessionId).filter(v => typeof v === 'string' && v))],
    klass: recordBacked ? 'record-backed' : snapshotOnly ? 'snapshot-only' : 'no-usage',
    snapshotPriced,
    snapshotCompleteness: fold.completeness,
    subagents,
    models: [...models],
    oneModel,
    snapshotModel,
    lastRecordAt: lastRecordAtMs === null ? null : new Date(lastRecordAtMs).toISOString(),
    lastPostedAt: latestPostMs === null ? null : new Date(latestPostMs).toISOString(),
    snapshotAt: snapshotAtMs === null ? null : new Date(snapshotAtMs).toISOString(),
    toCent,
    toCentSubset,
    agrees,
    sameStopRace,
    lateRacePost,
    formerRaceShape,
    lagMs,
    preDeployRecords,
    tokenDiff,
    costDiff,
    recordsAfterSnapshot,
    latePostMs: latePosts.map(record => msOf(record.updatedAt)),
    latePostCount: latePosts.length,
    tailExcessTokens,
    tailExcessCostUsd,
    lateCostUsd,
    tailGeqSnapshot,
    tailEqualsLatePosts,
    tailCostEqualsLatePosts,
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

/** Parse the runner oplog's request-usage.flush events (one per flush), keeping only what the cross-check uses. */
export function parseFlushes(oplogLines) {
  const out = [];
  for (const line of oplogLines) {
    if (!line || !line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.event !== 'request-usage.flush') continue;
    const ts = msOf(event.ts);
    if (ts === null) continue;
    out.push({ ts, sessionId: event.sessionId ?? null, reason: event.reason ?? null, posted: event.posted || 0 });
  }
  return out;
}

/**
 * Cross-check Harbour's late posts against the runner oplog, per lineage (its sessions). A late post should match a
 * flush that posted at least one record within `toleranceMs` of the post time. Reports the trailing flushes after
 * each session's first stop flush, by reason, and the late posts that no flush accounts for.
 */
export function oplogCrossCheck({ lineages, oplogLines, anchorOfSession, toleranceMs = 5000 }) {
  // The oplog names the RUNNER session only. Its anchor comes from the runner's session state (rootItemId),
  // passed as `anchorOfSession` (session id -> rootItemId). The Harbour row sessionId is a different identifier
  // and is not used: the join through it found no sessions at all.
  const flushes = parseFlushes(oplogLines);
  const byAnchor = new Map();
  for (const f of flushes) {
    const anchor = f.sessionId ? anchorOfSession?.[f.sessionId] : null;
    if (!anchor) continue;
    const list = byAnchor.get(anchor) || [];
    list.push(f);
    byAnchor.set(anchor, list);
  }
  const perLineage = [];
  const totals = { lineagesChecked: 0, latePosts: 0, matchedLate: 0, matchedReap: 0, matchedStop: 0, unmatchedLate: 0,
    reapFlushesAfterFirstStop: 0, stopFlushesAfterFirstStop: 0 };
  for (const lin of lineages) {
    const events = (byAnchor.get(lin.anchor) || []).slice().sort((a, b) => a.ts - b.ts);
    const firstStop = events.find(e => e.reason === 'stop') || null;
    const after = firstStop ? events.filter(e => e.ts > firstStop.ts && e.posted > 0) : [];
    const reapAfter = after.filter(e => e.reason === 'reap').length;
    const stopAfter = after.filter(e => e.reason === 'stop').length;
    // A late post is a trailing flush: the session's first stop flush carries the snapshot's own records, so only
    // flushes after it are candidates (a session with no stop flush considers all its flushes). The nearest one in
    // time, within the tolerance, is the match.
    const candidates = events.filter(e => e.posted > 0 && (firstStop === null || e.ts > firstStop.ts));
    let matched = 0;
    let matchedReap = 0;
    let matchedStop = 0;
    const unmatched = [];
    for (const p of lin.latePostMs || []) {
      let hit = null;
      let best = Infinity;
      for (const e of candidates) {
        const d = Math.abs(e.ts - p);
        if (d <= toleranceMs && d < best) {
          best = d;
          hit = e;
        }
      }
      if (hit) {
        matched += 1;
        if (hit.reason === 'reap') matchedReap += 1;
        else if (hit.reason === 'stop') matchedStop += 1;
      } else {
        unmatched.push(p);
      }
    }
    if ((lin.latePostMs || []).length > 0 || events.length > 0) totals.lineagesChecked += 1;
    totals.latePosts += (lin.latePostMs || []).length;
    totals.matchedLate += matched;
    totals.matchedReap += matchedReap;
    totals.matchedStop += matchedStop;
    totals.unmatchedLate += unmatched.length;
    totals.reapFlushesAfterFirstStop += reapAfter;
    totals.stopFlushesAfterFirstStop += stopAfter;
    perLineage.push({ anchor: lin.anchor, flushes: events.length,
      trailingStopPosts: stopAfter, reapPosts: reapAfter, latePosts: (lin.latePostMs || []).length,
      matchedLate: matched, matchedReap, matchedStop, unmatchedLate: unmatched.length });
  }
  return { totals, perLineage };
}

/**
 * The request-record audit (LIN-4212, plan-review notes 2 and 3). Pure over what the read fetched.
 *
 *   orphan records        a raw record whose `itemId` has no posting row in dispatch-history. The
 *                         loader's own rule: the member source is dispatch-history alone.
 *   stamped at a wake     a raw record whose stored stamp is its posting row's own id, and that row is a
 *                         wake. Informational: nothing reads by the stamp, and the loader relabels it.
 *   split requests        raw documents of one request that resolve to the same current lineage (a re-post
 *                         split, one document per stamp). Reported raw, before the read.
 *   duplicate after read  loader records that repeat a (rootItemId, requestId). Must be 0.
 *   phantom lineages      lineages whose only members are wake rows (a wake that never latched).
 *
 * `folded` is the loader's output (`listForAnchors`), `lineages` the lineageRecords output.
 */
export function requestRecordAudit({ usageDocs, postingRows, folded, lineages }) {
  const postingOf = new Map(postingRows.map(row => [String(row._id), row]));
  const orphanByItem = new Map();
  let orphanRecords = 0;
  let stampedAtWakeId = 0;
  const perRequest = new Map();
  for (const doc of usageDocs) {
    const itemId = doc.itemId === null || doc.itemId === undefined ? null : String(doc.itemId);
    const posting = itemId === null ? undefined : postingOf.get(itemId);
    if (!posting) {
      orphanRecords += 1;
      const entry = orphanByItem.get(itemId) || { itemId, stamp: doc.rootItemId ?? null, records: 0 };
      entry.records += 1;
      orphanByItem.set(itemId, entry);
      continue;
    }
    if (posting.kind === 'wake' && String(doc.rootItemId) === String(posting._id)) stampedAtWakeId += 1;
    const key = `${posting.rootItemId}\u0000${doc.requestId}`;
    perRequest.set(key, (perRequest.get(key) || 0) + 1);
  }
  let splitRequests = 0;
  let splitRawDocs = 0;
  for (const count of perRequest.values()) {
    if (count > 1) { splitRequests += 1; splitRawDocs += count - 1; }
  }
  const seen = new Set();
  let duplicateAfterRead = 0;
  for (const record of folded) {
    const key = `${record.rootItemId}\u0000${record.requestId}`;
    if (seen.has(key)) duplicateAfterRead += 1;
    seen.add(key);
  }
  const phantomLineages = lineages.filter(l => l.members.length > 0 && l.members.every(m => m.kind === 'wake')).length;
  return {
    rawRecords: usageDocs.length,
    orphanRecords,
    orphanPostingRows: orphanByItem.size,
    orphans: [...orphanByItem.values()],
    stampedAtWakeId,
    splitRequests,
    splitRawDocs,
    duplicateAfterRead,
    foldedRecords: folded.length,
    phantomLineages
  };
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
    errorEvents: 0, skipReasons: {}, byReason: {} };
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
    if (event.reason) out.byReason[event.reason] = (out.byReason[event.reason] || 0) + 1;
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

// READ ONLY: every call below is a find(). The record side is the loader (RequestUsageStore.listForAnchors),
// the same code LIN-4201's cost read calls, so the measurement tests the real read, not a copy of it.
export async function readWorkspace(db, urlKey, windowStart) {
  const usageDocs = await db.collection('request-usage')
    .find({ urlKey }, { projection: { _id: 0 } }).toArray();
  // The posting rows of the stored records, from dispatch-history alone (the loader's member source).
  const itemIds = [...new Set(usageDocs.filter(d => d.itemId !== null && d.itemId !== undefined).map(d => String(d.itemId)))];
  const postingRows = itemIds.length === 0 ? [] : await db.collection('dispatch-history')
    .find({ urlKey, _id: { $in: itemIds } }, { projection: { _id: 1, rootItemId: 1, kind: 1 } }).toArray();
  const windowFilter = { urlKey, dispatchedAt: { $gte: windowStart }, status: 'taken' };
  const windowRows = [
    ...await db.collection('dispatch-queue').find(windowFilter, { projection: { _id: 1, rootItemId: 1 } }).toArray(),
    ...await db.collection('dispatch-history').find(windowFilter, { projection: { _id: 1, rootItemId: 1 } }).toArray()
  ];
  // Lineage anchors are the CURRENT anchors of the window's rows and of the posting rows (never the stored stamp).
  const anchors = new Set([
    ...windowRows.map(r => String(r.rootItemId || r._id)),
    ...postingRows.map(r => String(r.rootItemId || r._id))
  ]);
  const anchorList = [...anchors];
  const anchorQuery = { urlKey, $or: [{ rootItemId: { $in: anchorList } }, { _id: { $in: anchorList } }] };
  const rows = [
    ...await db.collection('dispatch-queue').find(anchorQuery).toArray(),
    ...await db.collection('dispatch-history').find(anchorQuery).toArray()
  ];
  const store = new RequestUsageStore({
    collection: db.collection('request-usage'),
    historyCollection: db.collection('dispatch-history')
  });
  const records = await store.listForAnchors(urlKey, anchorList);
  return { usageDocs, rows, windowRowCount: windowRows.length, postingRows, records };
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
  const runnerStatePath = process.env.LIN4200_RUNNER_STATE || '/Users/autopilot/development/simple-dispatcher/state/sessions.json';
  const client = new MongoClient(uri, { readPreference: 'primary' });
  await client.connect();
  try {
    const db = client.db(process.env.LIN4200_DB || 'linear-viewer');
    const urlKeys = args['url-key'] && args['url-key'] !== true
      ? [args['url-key']]
      : await db.collection('request-usage').distinct('urlKey');
    const perWorkspace = {};
    for (const urlKey of urlKeys) {
      const { usageDocs, rows, windowRowCount, postingRows, records } = await readWorkspace(db, urlKey, windowStart);
      // LIN-4201: the snapshot side of the comparison, so it is read with NO records on purpose (`requestRows: []`):
      // with records the read would fold them, and the measurement would compare records with records.
      const lineages = lineageRecords({ fetchedRows: rows, identityRows: rows, requestRows: [] });
      const byAnchor = new Map();
      for (const record of records) {
        const list = byAnchor.get(record.rootItemId) || [];
        list.push(record);
        byAnchor.set(record.rootItemId, list);
      }
      const results = lineages.map(lineage => classifyLineage({ lineage, records: byAnchor.get(lineage.anchor) || [] }));
      const requestRecords = requestRecordAudit({ usageDocs, postingRows, folded: records, lineages });
      const recordTimes = usageDocs.map(d => msOf(d.at)).filter(Number.isFinite);
      perWorkspace[urlKey] = {
        window: {
          start: windowStart.toISOString(),
          firstRecordAt: recordTimes.length ? new Date(Math.min(...recordTimes)).toISOString() : null,
          lastRecordAt: recordTimes.length ? new Date(Math.max(...recordTimes)).toISOString() : null,
          recordCount: usageDocs.length,
          windowRowCount
        },
        // Records whose itemId has no posting row in dispatch-history: the loader drops them, and they are reported here.
        requestRecords,
        // Coverage by post time (updatedAt). toCent counts lineages with no record posted after the snapshot.
        toCent: {
          eligible: results.filter(r => r.toCent).length,
          // The former race class (first-line timing, pre-fix), split: true same-walk races (posted by the snapshot,
          // excluded by the ruling) and late posts (posted after it, counted in the tail).
          formerRaceShape: results.filter(r => r.formerRaceShape).length,
          formerRaceShapeTrueRace: results.filter(r => r.formerRaceShape && !r.recordsAfterSnapshot).length,
          formerRaceShapeLatePost: results.filter(r => r.formerRaceShape && r.recordsAfterSnapshot).length,
          sameStopRaceClass: results.filter(r => r.sameStopRace).map(r => ({ anchor: r.anchor, lagMs: r.lagMs, tokenGap: r.tokenDiff })),
          subset: results.filter(r => r.toCentSubset).length,
          agree: results.filter(r => r.toCentSubset && r.agrees).length,
          unexplained: results.filter(r => r.toCentSubset && r.agrees === false),
          disagreements: results.filter(r => r.toCentSubset && !r.agrees)
        },
        tail: {
          lineages: results.filter(r => r.recordsAfterSnapshot).length,
          latePosts: results.reduce((s, r) => s + r.latePostCount, 0),
          lateRacePostShape: results.filter(r => r.lateRacePost).length,
          geqViolations: results.filter(r => r.recordsAfterSnapshot && !r.tailGeqSnapshot).map(r => r.anchor),
          tokenExcessEqualsLatePosts: results.filter(r => r.recordsAfterSnapshot).every(r => r.tailEqualsLatePosts),
          dollarExcessEqualsLatePosts: results.filter(r => r.recordsAfterSnapshot && r.oneModel).every(r => r.tailCostEqualsLatePosts === true),
          totalTailTokens: TOKEN_FIELDS.reduce((acc, f) => { acc[f] = results.reduce((s, r) => s + (r.tailExcessTokens?.[f] ?? 0), 0); return acc; }, {}),
          totalTailCostUsd: results.filter(r => r.recordsAfterSnapshot && r.oneModel).reduce((s, r) => s + (r.tailExcessCostUsd ?? 0), 0),
          mixedModelTailCostDiffUsd: results.filter(r => r.recordsAfterSnapshot && !r.oneModel).reduce((s, r) => s + (r.tailExcessCostUsd ?? 0), 0),
          mixedModelTailLineages: results.filter(r => r.recordsAfterSnapshot && !r.oneModel).length,
          perLineage: results.filter(r => r.recordsAfterSnapshot).map(r => ({
            anchor: r.anchor, sessionIds: r.sessionIds, latePostCount: r.latePostCount, lastPostedAt: r.lastPostedAt,
            snapshotAt: r.snapshotAt, tailExcessTokens: r.tailExcessTokens, tailExcessCostUsd: r.tailExcessCostUsd,
            lateCostUsd: r.lateCostUsd, tailGeqSnapshot: r.tailGeqSnapshot, tailEqualsLatePosts: r.tailEqualsLatePosts,
            tailCostEqualsLatePosts: r.tailCostEqualsLatePosts
          }))
        },
        d7Residue: results.filter(r => r.d7Residue).map(r => r.anchor),
        shares: sharesOf(results),
        cases: caseClassesOf(results, usageDocs, lineages),
        lineages: results
      };
    }
    const oplogLines = readFileSync(oplogPath, 'utf8').split('\n');
    const runnerState = JSON.parse(readFileSync(runnerStatePath, 'utf8')).sessions || {};
    const anchorOfSession = Object.fromEntries(Object.entries(runnerState).filter(([, v]) => v && v.rootItemId)
      .map(([id, v]) => [id, String(v.rootItemId)]));
    for (const w of Object.values(perWorkspace)) {
      const cross = oplogCrossCheck({ lineages: w.lineages, oplogLines, anchorOfSession });
      w.oplogCrossCheck = cross;
      w.cases.classes.reapTail = cross.totals.matchedReap > 0
        ? `present (${cross.totals.matchedReap} late posts matched to reap flushes)`
        : 'UNMEASURED (no late post matched a reap flush)';
    }
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
