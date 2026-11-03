/**
 * lib/cost-read.js: the one cost read (LIN-4177, plan LIN-4176).
 *
 * Every worker-cost figure is read here. A lineage's figure is its fold over the rows the caller
 * fetched; its identity (issue, base kind, true member set) comes from the founder lookup, the
 * scalar read the caller made over every row of the lineage. The two are kept apart on purpose:
 *
 *  - `fetchedRows` (usage-bearing, bounded by the caller's own read) supply the usage fold, and
 *    nothing else. A capped or windowed fetch can lose rows; the fold reads what it has.
 *  - `identityRows` (the founder lookup, uncapped, scalar) decide the lineage's issue, its base
 *    kind and dispatch time, and which members the lineage truly has. A lineage whose founder is
 *    outside the caller's window keeps its true issue and kind (LIN-4148).
 *
 * The three decisions are the composed modules' own, restated nowhere here:
 *  - which rows are members and who founds the lineage: lib/lineage-membership.js;
 *  - how a lineage's rows add up (one fold): lib/row-usage.js;
 *  - how a row's usage is read (absent / unreadable / present): lib/session-telemetry.js.
 *
 * Figures (plan's figure rule): `totalUsd` is the lineage sum only when every selected lineage is
 * fully priced, read, and complete; otherwise null. `pricedUsd` sums the complete, priced lineages
 * and never includes a partial. A lineage is INCOMPLETE (narrow rule, plan N1) only when a true
 * member is missing from the fetch and one of these holds: the fold counts an opencode delta, the
 * fold is `no-usage` or `unreadable`, or a missing member was dispatched after the counted running
 * total. Pure: no store, clock or network.
 */

import { groupLineageMembership, anchorOf } from './lineage-membership.js';
import { readRowUsage } from './session-telemetry.js';
import { foldLineageUsage, isRunningTotal } from './row-usage.js';
import { mergeLineageFeedback, deriveCompletedAt } from './dispatch-terminal.js';
import { toEpochMs } from './utils/time.js';

const EMPTY_APP_CALLS = { calls: 0, costUsd: 0, unpricedCalls: 0, byFeature: [] };

/** A row's key: its `id` (formatted rows) or `_id` (raw docs). Null for a row with neither. */
function keyOf(row) {
  const key = row.id ?? row._id;
  return key === undefined || key === null ? null : String(key);
}

/** Rows keyed once. A later row with the same key replaces an earlier one, in the earlier one's place. */
function distinctRows(rows) {
  const byKey = new Map();
  const keyless = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const key = keyOf(row);
    if (key === null) keyless.push(row);
    else byKey.set(key, row);
  }
  return [...byKey.values(), ...keyless];
}

/** An ISO string for a stored or formatted instant (a Date, a string or null). */
function isoOf(value) {
  const ms = toEpochMs(value);
  return ms === null ? null : new Date(ms).toISOString();
}

/** Whether a missing member (one the fetch did not return) could change the lineage's figure. */
function missingCanChangeFigure(fetchedMembers, missing, fold) {
  if (missing.length === 0) return false;
  if (fold.completeness === 'no-usage' || fold.completeness === 'unreadable') return true;

  // The running total in force is the last fetched row that is not an opencode delta (an
  // unreadable row is a running total of unknown value, so it counts too). Deltas are every
  // readable opencode row, all of which the fold counts.
  let snapshotMs = null;
  let countsDelta = false;
  for (const member of fetchedMembers) {
    const state = readRowUsage(member.feedback);
    if (state.state === 'absent') continue;
    if (state.state === 'present' && !isRunningTotal(state.usage)) {
      countsDelta = true;
      continue;
    }
    snapshotMs = toEpochMs(member.dispatchedAt);
  }
  if (countsDelta) return true;
  return missing.some(member => {
    const ms = toEpochMs(member.dispatchedAt);
    return ms === null || (snapshotMs !== null && ms > snapshotMs);
  });
}

/**
 * The lineage records: one per lineage the caller's selection holds, in the order the fetched rows
 * first name it. A record carries exactly what a figure needs and nothing that re-dates a lineage:
 *
 *  - `anchor`: the lineage's rootItemId (its key);
 *  - `issueIdentifier`: the TRUE issue, from the founder lookup (null when no member names one);
 *  - `baseKind`: the TRUE base kind, the kind of the earliest true member;
 *  - `lastActivity`: the latest true member's dispatch time (ISO), or null;
 *  - `members`: the FETCHED members, in dispatch order (the fold's inputs);
 *  - `fold`: the one fold over the fetched members (lib/row-usage.js);
 *  - `missing`: the true members the fetch did not return;
 *  - `incomplete`: whether a missing member could change the figure (the narrow rule).
 *
 * The session's dispatch time and duration are the fetched earliest member's (plan decision (ii)),
 * computed by `readCost`, not here.
 *
 * @param {Object} params  as `readCost`, less `appSummary`
 * @returns {Array<Object>}
 */
export function lineageRecords({ fetchedRows = [], identityRows = [], issueIdentifier, windowStart, selectAnchors } = {}) {
  const fetched = distinctRows(fetchedRows);
  const fetchedLineages = groupLineageMembership(fetched);
  // The identity map covers every fetched member too, so a lineage the lookup missed still has
  // its fetched members as its truth (it can only undercount its identity, never drop the lineage).
  const identity = groupLineageMembership(distinctRows([...identityRows, ...fetched]));
  const fetchedKeys = new Set(fetched.map(keyOf).filter(key => key !== null));
  const windowMs = windowStart === undefined || windowStart === null ? null : toEpochMs(windowStart);

  const records = [];
  for (const [anchor, lineage] of fetchedLineages) {
    const truth = identity.get(anchor);
    if (selectAnchors && !selectAnchors.has(anchor)) continue;
    if (issueIdentifier !== undefined && truth.issueIdentifier !== issueIdentifier) continue;
    if (windowMs !== null && !truth.members.some(member => (toEpochMs(member.dispatchedAt) ?? -Infinity) >= windowMs)) continue;

    const trueBase = truth.members[0];
    const trueLast = truth.members[truth.members.length - 1];
    const missing = truth.members.filter(member => !fetchedKeys.has(keyOf(member)));
    const fold = foldLineageUsage(lineage.members.map(member => readRowUsage(member.feedback)));
    records.push({
      anchor,
      issueIdentifier: truth.issueIdentifier,
      baseKind: trueBase.kind || 'custom',
      lastActivity: isoOf(trueLast.dispatchedAt),
      members: lineage.members,
      fold,
      missing,
      incomplete: missingCanChangeFigure(lineage.members, missing, fold),
    });
  }
  return records;
}

/**
 * The one cost read over a set of lineages: the records (`lineageRecords`) summed into figures.
 *
 * @param {Object} params
 * @param {Array<Object>} params.fetchedRows  usage-bearing dispatch rows, in the order the caller
 *   wants lineages listed in; the fold reads these
 * @param {Array<Object>} [params.identityRows] the founder lookup's scalar rows (`_id`/`id`,
 *   `rootItemId`, `status`, `abort`, `kind`, `issueIdentifier`, `dispatchedAt`)
 * @param {Object} [params.appSummary]  call-log summary, folded into `totalUsd` only
 * @param {string} [params.issueIdentifier]  report only lineages whose true issue is this one
 * @param {Date|number|string} [params.windowStart]  report only lineages with a true member
 *   dispatched at or after this instant
 * @param {Set<string>} [params.selectAnchors]  report only lineages whose anchor is in this set
 * @returns {{
 *   pricedUsd: number,
 *   totalUsd: number|null,
 *   unpriced: string[],
 *   noTelemetryCount: number,
 *   unreadableCount: number,
 *   noLineage: boolean,
 *   workerSessions: Array<{rootItemId: string, kind: string, dispatchedAt: string|null, harness: string|null, model: string|null, effort: string|null, costUsd: number|null, durationMs: number|null, telemetry: boolean, incomplete: boolean}>,
 *   appCalls: Object
 * }}
 */
export function readCost({
  fetchedRows = [],
  identityRows = [],
  appSummary = EMPTY_APP_CALLS,
  issueIdentifier,
  windowStart,
  selectAnchors,
} = {}) {
  const records = lineageRecords({ fetchedRows, identityRows, issueIdentifier, windowStart, selectAnchors });

  let pricedUsd = 0;
  let noTelemetryCount = 0;
  let unreadableCount = 0;
  let incompleteCount = 0;
  const unpricedModels = new Set();
  const workerSessions = [];

  for (const record of records) {
    const { anchor, fold, incomplete, baseKind } = record;
    // Plan decision (LIN-4177 "workerSessions[].dispatchedAt", option ii): the session's dispatch time
    // and its duration stay the fetched earliest member's, exactly as before. The KIND is the true base
    // kind (change c). A founder's dispatch time would date a straddler's duration from weeks before the
    // window and move the effort columns' means by a day (replay S10).
    const [fetchedBase, ...fetchedOthers] = record.members;
    const baseAt = isoOf(fetchedBase.dispatchedAt);
    const merged = mergeLineageFeedback(fetchedBase.feedback, fetchedOthers, anchor, baseAt);
    const completedAt = deriveCompletedAt(merged);
    const durationMs = (baseAt && completedAt)
      ? (() => {
          const ms = new Date(completedAt).getTime() - new Date(baseAt).getTime();
          return Number.isFinite(ms) && ms >= 0 ? ms : null;
        })()
      : null;

    // A lineage with no usage posted at all (no-telemetry), then an unreadable one: never a figure.
    if (fold.completeness === 'no-usage') {
      noTelemetryCount += 1;
      workerSessions.push({ rootItemId: anchor, kind: baseKind, dispatchedAt: baseAt, harness: null, model: null, effort: null, costUsd: null, durationMs, telemetry: false, incomplete: false });
      continue;
    }
    if (fold.completeness === 'unreadable') {
      unreadableCount += 1;
      workerSessions.push({ rootItemId: anchor, kind: baseKind, dispatchedAt: baseAt, harness: null, model: null, effort: null, costUsd: null, durationMs, telemetry: true, incomplete: false });
      continue;
    }

    // An incomplete lineage shows what it knows (its labels) but no figure: never a partial as a whole.
    const last = fold.last;
    if (incomplete) {
      incompleteCount += 1;
      for (const model of fold.unpricedModels) unpricedModels.add(model);
      workerSessions.push({ rootItemId: anchor, kind: baseKind, dispatchedAt: baseAt, harness: last?.harness || null, model: last?.model || null, effort: last?.effort || null, costUsd: null, durationMs, telemetry: true, incomplete: true });
      continue;
    }

    if (fold.completeness === 'complete') pricedUsd += fold.costUsd;
    for (const model of fold.unpricedModels) unpricedModels.add(model);

    // LIN-2830: the labels come from the lineage's last counted row, the row the figure is shown on.
    workerSessions.push({
      rootItemId: anchor,
      kind: baseKind,
      dispatchedAt: baseAt,
      harness: last?.harness || null,
      model: last?.model || null,
      effort: last?.effort || null,
      costUsd: fold.costUsd,
      durationMs,
      telemetry: true,
      incomplete: false,
    });
  }

  const appCalls = appSummary || EMPTY_APP_CALLS;
  const unpriced = [...unpricedModels];
  // No lineage reported: an empty set must not read as a confirmed $0 (LIN-2253).
  const noLineage = records.length === 0;
  const fullyPriced = !noLineage
    && unpriced.length === 0
    && noTelemetryCount === 0
    && unreadableCount === 0
    && incompleteCount === 0
    && (appCalls.unpricedCalls || 0) === 0;

  return {
    pricedUsd,
    totalUsd: fullyPriced ? pricedUsd + (appCalls.costUsd || 0) : null,
    unpriced,
    noTelemetryCount,
    unreadableCount,
    noLineage,
    workerSessions,
    appCalls,
  };
}

/** The anchor of every row, as a Set, for `selectAnchors`. */
export function anchorsOfRows(rows) {
  const anchors = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const anchor = anchorOf(row);
    if (anchor !== null) anchors.add(anchor);
  }
  return anchors;
}
