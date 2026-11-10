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
 *  - which rows are members and who founds the lineage, and the order of a lineage's dispatches: lib/lineage-membership.js
 *    (`byDispatchOrder`, reused here, not re-written);
 *  - which ids identify a posting row: `postingKeysOf` in this file, the one list (LIN-4276);
 *  - how a lineage's rows add up (one fold): lib/row-usage.js;
 *  - how a row's usage is read (absent / unreadable / present): lib/session-telemetry.js.
 * One decision IS this file's own (LIN-4201, LIN-4195 D7): whether a lineage reads its request records or its
 * snapshots, made once in `lineageUsageOf`. How records add up is lib/request-usage-fold.js's.
 *
 * Request records (LIN-4201, LIN-4226): `readCost`, `lineageRecords` and `buildRunView` (lib/run-view.js) take a
 * `requestSource` (the request-usage loader, lib/request-usage-loader.js) and load their own records through it,
 * exactly once per call. A missing source throws, and so does the old `requestRows` argument: a caller cannot
 * pass rows in, so none can read snapshots for every lineage without anyone noticing. The pure cores
 * (`readCostOverRecords`, `lineageRecordsOverRecords`) take records and are for the read's own module and tests.
 * `lineageFigureOf` is the synchronous per-lineage figure over records its caller passes (`records`, `[]` when none).
 *
 * Harbour calls (LIN-4179): `readCalls` sums the call docs with the same figure rule; `appCallsOf` and
 * `callsSurfaceOf` are the two shapes its callers publish. Lineage figures (plan's figure rule): `totalUsd` is the lineage sum only when every selected lineage is
 * fully priced, read, and complete; otherwise null. `pricedUsd` sums the complete, priced lineages
 * and never includes a partial. A lineage is INCOMPLETE (narrow rule, plan N1) only when a true
 * member is missing from the fetch and one of these holds: the fold counts an opencode delta, the
 * fold is `no-usage` or `unreadable`, or a missing member was dispatched after the counted running
 * total. Pure: no store, clock or network.
 */

import { groupLineageMembership, anchorOf, byDispatchOrder } from './lineage-membership.js';
import { readRowUsage, readUsageEntry } from './session-telemetry.js';
import { foldLineageUsage, countedRowsOf, sumTokens } from './row-usage.js';
import { foldRequestUsage } from './request-usage-fold.js';
import { mergeLineageFeedback, deriveCompletedAt } from './dispatch-terminal.js';
import { toEpochMs } from './utils/time.js';
import { callTelemetryOf } from './llm-call-log.js';

const EMPTY_APP_CALLS = { calls: 0, costUsd: 0, unpricedCalls: 0, byFeature: [] };

/**
 * Every id a posting row can be known by, as strings: `id` (formatted rows), `_id` (raw docs), then `loopId` (a
 * run-page row). The one posting-row key list (LIN-4276). Its order is load-bearing: `byPostingKey` is first-wins, so
 * a reordering changes which row owns a request. Not `anchorOf` (lineage-membership.js): that is a lineage key, not
 * a posting key, and is deliberately not in this list.
 */
function postingKeysOf(row) {
  return [row?.id, row?._id, row?.loopId]
    .filter(key => key !== undefined && key !== null)
    .map(String);
}

/** A row's key: its first posting key (`id`, else `_id`, else `loopId`). Null for a row with none. */
function keyOf(row) {
  return postingKeysOf(row)[0] ?? null;
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

/**
 * Whether a missing member (one the fetch did not return) could change the lineage's figure.
 *
 * A record-only lineage: never (review note 3). Its records are fetched by anchor, so the rows the caller's read
 * returned do not decide which records it has (`missingRowsCanChangeFigure: false`, lib/request-usage-fold.js).
 * A lineage that also counts snapshots (a harness with no records, see `lineageUsageOf`): the narrow rule over
 * those snapshots only, `snapshot` being their fold and `states` the rows' states with the record harnesses'
 * snapshots already set aside.
 */
function missingCanChangeFigure(fetchedMembers, states, missing, { fold, snapshot }) {
  if (missing.length === 0) return false;
  if (fold.missingRowsCanChangeFigure === false) return false;
  if (snapshot.completeness === 'no-usage' || snapshot.completeness === 'unreadable') return true;

  // The counted rows are the snapshot fold's own (lib/row-usage.js `countedRowsOf`, the one partition): a counted
  // delta can be joined by a missing one; otherwise a missing member dispatched after the running total in force
  // could supersede it.
  const { snapshot: inForce, deltas } = countedRowsOf(states);
  if (deltas.length > 0) return true;
  const snapshotMs = inForce ? toEpochMs(fetchedMembers[inForce.index].dispatchedAt) : null;
  return missing.some(member => {
    const ms = toEpochMs(member.dispatchedAt);
    return ms === null || (snapshotMs !== null && ms > snapshotMs);
  });
}

/**
 * A row's usage state, in either row shape (LIN-4177 "one reader per row", extended for LIN-4178):
 *  - a row with a `feedback` array (a formatted history row, a raw doc) is read from its own feedback,
 *    its LAST `kind: 'usage'` entry (lib/session-telemetry.js `readRowUsage`);
 *  - a row without one, the aggregation shape `loadDispatchHistory` returns (`$project`ed `usageEntry`,
 *    the last usage entry, or null), is read from that entry (`readUsageEntry`).
 * A row carrying neither has no usage posted: absent.
 *
 * @param {Object} row
 * @returns {{state: 'absent'|'unreadable'|'present', usage: Object|null}}
 */
// LEGACY (LIN-4203 / LIN-4195 D8): reads OLD snapshot rows only. The runner stopped posting [usage] snapshots
// in piece 6, so this is kept for old rows, with no translation and no backfill. A lineage with request records
// never reaches it (the cutover, lib/cost-read.js). Delete 30 days after LIN-4203 deploys (not before 2026-12-04).
export function usageStateOf(row) {
  if (Array.isArray(row.feedback)) return readRowUsage(row.feedback);
  if (row.usageEntry !== undefined) return readUsageEntry(row.usageEntry);
  return readUsageEntry(null);
}

/** The harness a record or a snapshot belongs to. Absent reads as `claude-code`, as row-usage's `isRunningTotal` reads it. */
export function harnessOf(usage) {
  return usage?.harness || 'claude-code';
}

/** The harness of a row's usage state. An unreadable snapshot is a running total of unknown value: `claude-code`. */
function harnessOfState(state) {
  return state.state === 'present' ? harnessOf(state.usage) : 'claude-code';
}

const ABSENT = Object.freeze({ state: 'absent', usage: null });

/**
 * The guards every loading entry point makes before it reads anything (LIN-4226). The read takes the source it loads
 * from, never the rows it loads:
 *  - the old `requestRows` key throws, so a half-migrated caller fails loudly;
 *  - a missing `requestSource` throws (no silent "no records": a caller that forgot its source fails, it does not
 *    read snapshots for every lineage, LIN-4201);
 *  - a scoped read needs its `urlKey`, which formatted history rows do not carry; `instanceWide: true` (the /kpis
 *    read) takes no urlKey and skips a row that carries none. The rule depends on how the read is called, not on data.
 *
 * @param {string} entryPoint  the name the TypeError carries
 * @param {Object} params      the entry's own arguments
 */
function requireLoadingArguments(entryPoint, params) {
  if (Object.hasOwn(params, 'requestRows')) {
    throw new TypeError(`${entryPoint}: requestRows is not accepted (LIN-4226). Pass requestSource (the request-usage loader, lib/request-usage-loader.js) and urlKey; the read loads its own records.`);
  }
  const { requestSource, urlKey, instanceWide } = params;
  if (!requestSource || typeof requestSource.forRows !== 'function' || typeof requestSource.forAnchors !== 'function') {
    throw new TypeError(`${entryPoint}: requestSource is required (LIN-4226). Pass the request-usage loader (lib/request-usage-loader.js); the read never reads snapshots instead.`);
  }
  if (instanceWide === true) {
    if (urlKey !== undefined) throw new TypeError(`${entryPoint}: pass urlKey or instanceWide: true, not both (LIN-4226).`);
    return;
  }
  if (!urlKey) throw new TypeError(`${entryPoint}: urlKey or instanceWide: true is required (LIN-4226). A scoped read names its workspace.`);
}

/**
 * The one load a loading entry makes (LIN-4226): the lineages' request records for `fetchedRows`, from the source.
 * It is called synchronously and returns its promise, so a caller can start it before it awaits anything else.
 */
function loadRecords(requestSource, fetchedRows, { urlKey, instanceWide }) {
  return instanceWide === true
    ? requestSource.forRows(fetchedRows, {})
    : requestSource.forRows(fetchedRows, { urlKey });
}

/** Request records grouped by their lineage anchor (the posting row's CURRENT anchor, as the loader relabels them). */
function recordsByAnchor(records) {
  const byAnchor = new Map();
  for (const record of records) {
    if (!record || typeof record !== 'object' || record.rootItemId === undefined || record.rootItemId === null) continue;
    const anchor = String(record.rootItemId);
    const list = byAnchor.get(anchor);
    if (list) list.push(record);
    else byAnchor.set(anchor, [record]);
  }
  return byAnchor;
}

/** Whether `row` is the posting row `itemId` names, in any row shape (formatted `id`, raw `_id`, run-page `loopId`). */
function isPostingRow(row, itemId) {
  return postingKeysOf(row).includes(itemId);
}

/**
 * The record fold and the counted snapshots of the harnesses that have no records, as one fold (the
 * `foldLineageUsage` shape). Only reached by a lineage that holds both, which the runner does not produce (a resume
 * never switches harness); the window before opencode posted records (piece 5) is where it can occur.
 */
function combineFolds(records, snapshot) {
  // The labels follow the part that carries more of the priced cost (the cost-dominant rule D6 applies within the
  // records, applied across the two parts): an opencode delta that outweighs the records keeps naming the lineage, so
  // a lineage does not move between model groups just because its smaller harness started posting records. A
  // withheld snapshot weighs nothing; a tie goes to the records.
  const recordsPricedUsd = records.byModel.reduce((sum, entry) => sum + entry.pricedUsd, 0);
  const snapshotPricedUsd = snapshot.costUsd ?? 0;
  const labels = snapshotPricedUsd > recordsPricedUsd && snapshot.last ? snapshot.last : records.last;
  let completeness;
  if (snapshot.completeness === 'unreadable') completeness = 'unreadable';
  else if (records.completeness === 'unpriced' || snapshot.completeness === 'unpriced') completeness = 'unpriced';
  else completeness = 'complete';
  return {
    source: 'records+snapshots',
    completeness,
    tokens: completeness === 'unreadable' ? null : sumTokens([records.tokens, snapshot.tokens]),
    costUsd: completeness === 'complete' ? records.costUsd + snapshot.costUsd : null,
    unpricedModels: [...new Set([...records.unpricedModels, ...snapshot.unpricedModels])],
    lastIndex: snapshot.lastIndex,
    lastItemId: records.lastItemId,
    last: { harness: labels.harness ?? null, model: labels.model ?? null, effort: labels.effort ?? null },
    byModel: records.byModel,
  };
}

/**
 * THE decision (LIN-4201, LIN-4195 D7 and review note 9): how one lineage's usage is read. Made here, once; no other
 * file branches on whether records exist.
 *
 *  - A lineage with no request record reads its snapshots exactly as before (`foldLineageUsage`).
 *  - A lineage with request records reads them (`foldRequestUsage`), and its snapshots of every harness that has
 *    records are IGNORED. Records are a superset of the same harness's snapshots (the runner walks the whole
 *    transcript the first time it sees a session, so a session resumed across the deploy has records for what its
 *    old snapshots covered), so counting both would count that work twice (replay case (f)).
 *  - Per-harness scoping (review note 9): a snapshot of a harness with NO records in the lineage still counts, so an
 *    opencode delta row beside claude-code records (the window before piece 5) keeps its spend. This cannot double
 *    count: a snapshot only ever covers its own harness's transcript (lib/row-usage.js, "a mixed lineage is
 *    additive").
 *
 * So "a lineage with any record reads from records only" holds exactly for every lineage whose records cover every
 * harness it reported, which is every lineage the runner makes (a resume never switches harness). Where the two
 * statements differ (a lineage mixing harnesses, only one of them with records), per-harness scoping is the rule,
 * because reading records only would drop the other harness's spend, and it adds nothing twice.
 *
 * A null or absent record or snapshot harness reads as `claude-code`.
 *
 * @param {Array<Object>} memberRows  the lineage's fetched rows, in dispatch order, either row shape
 * @param {Array<Object>} records  the lineage's request records
 * @returns {{fold: Object, snapshot: Object, states: Array<Object>, harnessReading: {reported: boolean, deltaSummed: boolean}}}
 *   `fold` is the lineage's fold (the `foldLineageUsage` shape; `source` names what it read when records exist);
 *   `snapshot` the fold over the counted snapshots and `states` the rows' states with the record harnesses' snapshots
 *   set aside, for the narrow rule. `harnessReading` (LIN-4201, review note 1) is what the /kpis harness disclosures
 *   read: whether the lineage's harness is known (a record always names one, a null harness reading as claude-code;
 *   a snapshot only when it reported one), and whether its figure sums an opencode delta. A record lineage is not
 *   delta-summed: only a counted opencode SNAPSHOT is.
 */
export function lineageUsageOf(memberRows, records) {
  const rowStates = memberRows.map(usageStateOf);
  if (records.length === 0) {
    const fold = foldLineageUsage(rowStates);
    const harnessReading = {
      reported: rowStates.some(state => state.state === 'present' && Boolean(state.usage?.harness)),
      deltaSummed: countedRowsOf(rowStates).deltas.length > 0,
    };
    return { fold, snapshot: fold, states: rowStates, harnessReading };
  }

  const recordHarnesses = new Set(records.map(harnessOf));
  const states = rowStates.map(state => (state.state !== 'absent' && recordHarnesses.has(harnessOfState(state)) ? ABSENT : state));
  const snapshot = foldLineageUsage(states);
  const recordFold = foldRequestUsage(records);
  const fold = snapshot.completeness === 'no-usage' ? recordFold : combineFolds(recordFold, snapshot);

  // The row the figure sits on: the latest record's posting row, or the snapshot's counted row if it is later.
  // A posting row the caller did not pass places it on the last row ("the last loop").
  let recordIndex = memberRows.findIndex(row => recordFold.lastItemId !== null && isPostingRow(row, recordFold.lastItemId));
  if (recordIndex === -1) recordIndex = memberRows.length - 1;
  const lastIndex = memberRows.length === 0 ? null : Math.max(recordIndex, snapshot.lastIndex ?? -1);
  const harnessReading = { reported: true, deltaSummed: countedRowsOf(states).deltas.length > 0 };
  return { fold: { ...fold, lastIndex }, snapshot, states, harnessReading };
}

/**
 * The outcome facts a record carries, when the caller passes `outcomes` (lib/dispatch-lineage.js
 * `groupDispatchLineages`): the lineage's `status` (`done`, `failed`, `skipped`, ...), the latest
 * terminal instant and its ticket walk. Keyed by the same anchor as the record.
 */
function outcomeFieldsOf(outcomes, anchor) {
  const outcome = outcomes?.get(anchor);
  return {
    status: outcome?.status ?? null,
    statusMs: outcome?.statusMs ?? null,
    ticketMarkers: outcome?.ticketMarkers ?? [],
  };
}

/**
 * The lineage records: one per lineage the caller's selection holds, in the order the fetched rows
 * first name it. A record carries exactly what a figure needs and nothing that re-dates a lineage:
 *
 *  - `anchor`: the lineage's rootItemId (its key);
 *  - `issueIdentifier`: the TRUE issue, from the founder lookup (null when no member names one);
 *  - `baseKind`: the TRUE base kind, the kind of the earliest true member;
 *  - `lastActivity`: the latest true member's dispatch time (ISO), or null;
 *  - `members`: the FETCHED members, in dispatch order (the snapshot fold's inputs);
 *  - `requests`: the lineage's request records (from the source, by anchor), [] when it has none;
 *  - `fold`: the lineage's fold, records or snapshots as `lineageUsageOf` decides;
 *  - `harnessReading`: `{reported, deltaSummed}`, the harness facts of what the fold read (`lineageUsageOf`);
 *  - `missing`: the true members the fetch did not return;
 *  - `incomplete`: whether a missing member could change the figure (the narrow rule);
 *  - `status`, `statusMs`, `ticketMarkers`: the outcome facts, when `outcomes` is passed (null/[] otherwise).
 *
 * The session's dispatch time and duration are the fetched earliest member's (plan decision (ii)),
 * computed by `readCost`, not here.
 *
 * @param {Object} params  `fetchedRows`, `identityRows` (an array or a promise), `requestSource` and `urlKey` (or
 *   `instanceWide: true`), as `readCost`; `outcomes` (groupDispatchLineages output) is optional. Loads once.
 * @returns {Promise<Array<Object>>}
 */
export async function lineageRecords(params = {}) {
  requireLoadingArguments('lineageRecords', params);
  const { fetchedRows = [], identityRows = [], requestSource, urlKey, instanceWide } = params;
  // The identity lookup and the records load run in parallel: the load is started before either is awaited.
  const [identity, records] = await Promise.all([identityRows, loadRecords(requestSource, fetchedRows, { urlKey, instanceWide })]);
  return lineageRecordsOverRecords({ ...params, identityRows: identity }, records);
}

/**
 * The pure core of `lineageRecords` (LIN-4226): the same fold, over the request records the caller already holds.
 * Production reads go through `lineageRecords`, which loads them from the source; this is the read's own core.
 *
 * @param {Object} params  as `lineageRecords`, with `identityRows` already an array
 * @param {Array<Object>} records  the lineages' request records (the loader's output; `[]` when none)
 * @returns {Array<Object>}
 */
export function lineageRecordsOverRecords(params = {}, requestRecords) {
  return selectLineageRecords(params, requestRecords).records;
}

/**
 * The selection both record entries share (LIN-4404). `records` are the lineages the caller's selection counts, exactly
 * as before. `foundedElsewhere` is filled only when the caller opts in and names an `issueIdentifier`: the fetched
 * lineages whose true issue is another one but which have a FETCHED member tagged with this issue (a parent's
 * autopilot whose wakes this task caused carries the child's `issueIdentifier`, lib/dispatch-wake.js). Each is built
 * by the same record code as a counted one, plus `countedUnder` (the true issue, null when no member names one) and
 * `taggedItemIds` (the fetched members tagged with this issue, in dispatch order). The opt-in reads nothing more: the
 * caller's fetch already returned these lineages, and without it they are dropped at the issue check as always.
 */
function selectLineageRecords({ fetchedRows = [], identityRows = [], issueIdentifier, windowStart, selectAnchors, outcomes, foundedElsewhere: wantForeign = false } = {}, requestRecords) {
  if (!Array.isArray(requestRecords)) throw new TypeError('lineageRecordsOverRecords: records is required (LIN-4226)');
  const recordsOf = recordsByAnchor(requestRecords);
  const fetched = distinctRows(fetchedRows);
  const fetchedLineages = groupLineageMembership(fetched);
  // The identity map covers every fetched member too, so a lineage the lookup missed still has
  // its fetched members as its truth (it can only undercount its identity, never drop the lineage).
  const identity = groupLineageMembership(distinctRows([...identityRows, ...fetched]));
  const fetchedKeys = new Set(fetched.map(keyOf).filter(key => key !== null));
  // The period rule's window guard (plan B1: a lineage counts when it has a member in the window). It applies only
  // when the caller passes `windowStart`. A caller whose fetch is bounded by the same window sees no lineage excluded
  // here (a fetched member is itself a true member; replay M8 survives because no case bites). The task-life reads
  // (lib/task-cost-read.js, LIN-4404) are not time-bounded and pass no `windowStart`, so they skip it: a lineage whose
  // members have no `dispatchedAt` would otherwise be dropped.
  const windowMs = windowStart === undefined || windowStart === null ? null : toEpochMs(windowStart);
  const collectForeign = wantForeign === true && issueIdentifier !== undefined && issueIdentifier !== null;

  const records = [];
  const foreign = [];
  for (const [anchor, lineage] of fetchedLineages) {
    const truth = identity.get(anchor);
    if (selectAnchors && !selectAnchors.has(anchor)) continue;
    if (windowMs !== null && !truth.members.some(member => (toEpochMs(member.dispatchedAt) ?? -Infinity) >= windowMs)) continue;
    let tagged = null;
    if (issueIdentifier !== undefined && truth.issueIdentifier !== issueIdentifier) {
      if (!collectForeign) continue;
      tagged = lineage.members.filter(member => member.issueIdentifier === issueIdentifier);
      if (tagged.length === 0) continue;
    }

    const trueBase = truth.members[0];
    const trueLast = truth.members[truth.members.length - 1];
    const missing = truth.members.filter(member => !fetchedKeys.has(keyOf(member)));
    const requests = recordsOf.get(anchor) || [];
    const usage = lineageUsageOf(lineage.members, requests);
    const fold = usage.fold;
    const record = {
      anchor,
      issueIdentifier: truth.issueIdentifier,
      baseKind: trueBase.kind || 'custom',
      lastActivity: isoOf(trueLast.dispatchedAt),
      members: lineage.members,
      requests,
      fold,
      harnessReading: usage.harnessReading,
      missing,
      incomplete: missingCanChangeFigure(lineage.members, usage.states, missing, usage),
      ...outcomeFieldsOf(outcomes, anchor),
    };
    if (tagged) foreign.push({ record, taggedItemIds: tagged.map(keyOf).filter(key => key !== null) });
    else records.push(record);
  }
  return { records, foundedElsewhere: collectForeign ? foreign : null };
}

/**
 * The one cost read over a set of lineages: the records (`lineageRecords`) summed into figures. Async (LIN-4226): it
 * resolves to the figures below, after its one load.
 *
 * @param {Object} params
 * @param {Array<Object>} params.fetchedRows  usage-bearing dispatch rows, in the order the caller
 *   wants lineages listed in; the fold reads these
 * @param {Array<Object>} [params.identityRows] the founder lookup's scalar rows (`_id`/`id`,
 *   `rootItemId`, `status`, `abort`, `kind`, `issueIdentifier`, `dispatchedAt`)
 * @param {Object} params.requestSource  REQUIRED: the request-usage loader; the read loads the fetched rows' request
 *   records through it, once. Throws when it is missing, and when the old `requestRows` argument is passed.
 * @param {string} [params.urlKey]  REQUIRED unless `instanceWide` is true: the workspace the rows are scoped to.
 * @param {boolean} [params.instanceWide]  `true` for the instance-wide read (/kpis): no urlKey; a row with none is skipped.
 * @param {Object} [params.appSummary]  call-log summary, folded into `totalUsd` only
 * @param {string} [params.issueIdentifier]  report only lineages whose true issue is this one
 * @param {Date|number|string} [params.windowStart]  report only lineages with a true member
 *   dispatched at or after this instant
 * @param {Set<string>} [params.selectAnchors]  report only lineages whose anchor is in this set
 * @param {boolean} [params.perDispatch]  build each records lineage's `dispatches` (LIN-4263). Passed only by the
 *   task read (lib/task-cost-read.js); without it `dispatches` is null and no per-dispatch fold runs.
 * @param {boolean} [params.foundedElsewhere]  also return `foundedElsewhere` (LIN-4404, opt-in, needs
 *   `issueIdentifier`): one session row per fetched lineage founded on another issue with a fetched member tagged with
 *   this one, summarised by the same branches as `workerSessions`, plus `countedUnder` and `taggedItemIds`. Never added
 *   to `pricedUsd`, `totalUsd` or any count; every other key is byte-identical with and without it. Without the flag the
 *   key is absent.
 * @returns {{
 *   pricedUsd: number,
 *   totalUsd: number|null,
 *   unpriced: string[],
 *   noTelemetryCount: number,
 *   unreadableCount: number,
 *   noLineage: boolean,
 *   workerSessions: Array<{rootItemId: string, kind: string, dispatchedAt: string|null, harness: string|null, model: string|null, effort: string|null, costUsd: number|null, durationMs: number|null, tokens: Object|null, byModel: Array<Object>|null, dispatches: Array<Object>|null, telemetry: boolean, incomplete: boolean}>,
 *   appCalls: Object,
 *   foundedElsewhere?: Array<Object>
 * }}
 */
export async function readCost(params = {}) {
  requireLoadingArguments('readCost', params);
  // One load, as `lineageRecords` makes it (the identity lookup and the records load in parallel). Nothing else loads.
  const { fetchedRows = [], identityRows = [], requestSource, urlKey, instanceWide } = params;
  const [identity, records] = await Promise.all([identityRows, loadRecords(requestSource, fetchedRows, { urlKey, instanceWide })]);
  return readCostOverRecords({ ...params, identityRows: identity }, records);
}

/**
 * The pure core of `readCost` (LIN-4226): the same figures over the request records the caller already holds. Only
 * the read's own module and the tests call it; production goes through `readCost`.
 *
 * @param {Object} params  as `readCost`, less the loading arguments
 * @param {Array<Object>} records  the lineages' request records (`[]` when none)
 */
export function readCostOverRecords(params = {}, records) {
  const perDispatch = params.perDispatch === true;
  const selected = selectLineageRecords(params, records);
  const result = summarizeReadCost(selected.records, params.appSummary, { perDispatch });
  if (selected.foundedElsewhere === null) return result;
  // LIN-4404: the same per-lineage branches, summed into nothing. `countedUnder` and `taggedItemIds` go last.
  const foundedElsewhere = selected.foundedElsewhere.map(({ record, taggedItemIds }) => ({
    ...sessionOf(record, perDispatch).session,
    countedUnder: record.issueIdentifier,
    taggedItemIds,
  }));
  return { ...result, foundedElsewhere };
}

/** One model's row on the wire (LIN-4263): the fold's per-model figure, without its internal count fields. */
function modelRowOf({ model, requests, tokens, costUsd }) {
  return { model, requests, tokens, costUsd };
}

/** The latest entry dispatched at or before `at` (entries must already be in dispatch order, `byDispatchOrder`), or undefined when none is. */
function latestDispatchedBy(entries, at) {
  let found;
  entries.forEach((entry, index) => {
    if (entry.at !== null && at !== null && entry.at <= at) found = index;
  });
  return found;
}

/**
 * The per-dispatch split of a records lineage (LIN-4263): one entry per true dispatch of the lineage, in dispatch
 * order, each folded by `foldRequestUsage` over the records it owns. Every record is owned by exactly one entry, so
 * the entries partition the lineage: their requests and tokens sum to the lineage's, and their costs sum to the
 * lineage's `costUsd` whenever every entry is priced.
 *
 * Split rule C: a record belongs to its posting row (`itemId`), unless it was made before that row was dispatched
 * (`at < dispatchedAt`). A row cannot have made a request before it existed, so such a record was posted late, by a
 * later row: a build that ran before the records deploy is posted under its follow-up's itemId, because the runner
 * walks the whole transcript the first time it sees a session. Only a provably late record moves: to the latest
 * member dispatched at or before its `at`, or else it stays on its posting row. A record with no time stays put.
 * Without a posting row in the lineage (never the case for a loaded record), it goes to the latest member dispatched
 * at or before its time, or else to the base dispatch, so no record is ever dropped or counted twice.
 *
 * Working span (LIN-4404): `firstRequestAt` and `lastRequestAt` are the earliest and latest `at` (ISO) of the records
 * this split gives the entry, so a late-posted record's time counts toward the dispatch it moves to. Both are null when
 * the entry owns no record with a time. They are read from the split and reassign nothing. They exist only where
 * `dispatches` does, so a snapshot-only lineage (every lineage from before request records began, about 4 Nov 2026)
 * has no spans: its working times are unknown, not reconstructed.
 *
 * @param {Object} record  one of `lineageRecords`' records, with a records fold (`fold.source === 'records'`)
 * @returns {Array<Object>} `{itemId, kind, dispatchedAt, followUpTo, byModel, requests, tokens, costUsd, firstRequestAt,
 *   lastRequestAt}` per dispatch. A dispatch with no records has `requests: 0`, `byModel: null`, `tokens: null`,
 *   `costUsd: null`: unknown, not zero.
 */
function dispatchesOf(record) {
  const entries = [...record.members, ...record.missing]
    // Dispatch order is the owner's (`byDispatchOrder`, lineage-membership.js): a member with no time sorts last.
    .sort(byDispatchOrder)
    .map(member => ({ member, at: toEpochMs(member.dispatchedAt), owned: [] }));
  if (entries.length === 0) return [];

  const byPostingKey = new Map();
  entries.forEach((entry, index) => {
    for (const key of postingKeysOf(entry.member)) if (!byPostingKey.has(key)) byPostingKey.set(key, index);
  });

  for (const request of record.requests) {
    const at = toEpochMs(request.at);
    const postedKey = request.itemId === undefined || request.itemId === null ? null : String(request.itemId);
    const posted = postedKey === null ? undefined : byPostingKey.get(postedKey);
    let target;
    if (posted !== undefined) {
      const postedAt = entries[posted].at;
      const provablyLate = at !== null && postedAt !== null && at < postedAt;
      target = provablyLate ? (latestDispatchedBy(entries, at) ?? posted) : posted;
    } else {
      target = latestDispatchedBy(entries, at) ?? 0;
    }
    entries[target].owned.push(request);
  }

  return entries.map(({ member, owned }) => {
    const base = {
      itemId: keyOf(member),
      kind: member.kind || 'custom',
      dispatchedAt: isoOf(member.dispatchedAt),
      followUpTo: member.followUpTo ?? null,
    };
    const span = requestSpanOf(owned);
    if (owned.length === 0) return { ...base, byModel: null, requests: 0, tokens: null, costUsd: null, ...span };
    const fold = foldRequestUsage(owned);
    return { ...base, byModel: fold.byModel.map(modelRowOf), requests: owned.length, tokens: fold.tokens, costUsd: fold.costUsd, ...span };
  });
}

/** The earliest and latest `at` of a dispatch's own records, as ISO (LIN-4404); null for both when none has a time. */
function requestSpanOf(owned) {
  let first = null;
  let last = null;
  for (const request of owned) {
    const at = toEpochMs(request.at);
    if (at === null) continue;
    if (first === null || at < first) first = at;
    if (last === null || at > last) last = at;
  }
  return {
    firstRequestAt: first === null ? null : new Date(first).toISOString(),
    lastRequestAt: last === null ? null : new Date(last).toISOString(),
  };
}

/**
 * The usage detail every `workerSessions` row carries (LIN-4263), added after `durationMs` on every branch. Unknown is
 * `null`, never `0` or `[]`:
 *  - `tokens`: the lineage fold's token sum (a snapshot lineage's cumulative total, or the records' sum); null when the
 *    lineage has no readable usage.
 *  - `byModel`: the per-model figures, only for a records lineage (`fold.source === 'records'`). A snapshot total
 *    carries one model, so it is not split; `null` for snapshot-only and records+snapshots lineages.
 *  - `dispatches`: the per-dispatch split (`dispatchesOf`), only for a records lineage read with `perDispatch` (the
 *    `/cost` route). Every other reader passes no flag and pays nothing for it; `null` otherwise.
 */
function usageDetailOf(record, perDispatch) {
  const { fold } = record;
  const fromRecords = fold.source === 'records';
  return {
    tokens: fold.tokens ?? null,
    byModel: fromRecords ? fold.byModel.map(modelRowOf) : null,
    dispatches: fromRecords && perDispatch ? dispatchesOf(record) : null,
  };
}

/**
 * One lineage record's `workerSessions` row (the branches: no usage, unreadable, incomplete, a figure), with what it
 * adds to the read's figures: its `tally`, the models it leaves unpriced and its priced USD (0 unless complete). Pure.
 * `summarizeReadCost` adds them up; the founded-elsewhere rows (LIN-4404) take only the row, so they go through the
 * same branches and add to nothing.
 *
 * @returns {{session: Object, tally: 'noTelemetry'|'unreadable'|'incomplete'|'figure', unpricedModels: string[], pricedUsd: number}}
 */
function sessionOf(record, perDispatch) {
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
  // `incomplete` is the record's own flag (the narrow rule, N1), set on these branches too: a no-usage or
  // unreadable lineage with a missing true member is incomplete, even though its count stays no-telemetry or
  // unreadable. The wire strips the flag (routes/proxy-compute.js); the in-process readers see it.
  if (fold.completeness === 'no-usage') {
    return {
      session: { rootItemId: anchor, kind: baseKind, dispatchedAt: baseAt, harness: null, model: null, effort: null, costUsd: null, durationMs, ...usageDetailOf(record, perDispatch), telemetry: false, incomplete },
      tally: 'noTelemetry', unpricedModels: [], pricedUsd: 0,
    };
  }
  if (fold.completeness === 'unreadable') {
    return {
      session: { rootItemId: anchor, kind: baseKind, dispatchedAt: baseAt, harness: null, model: null, effort: null, costUsd: null, durationMs, ...usageDetailOf(record, perDispatch), telemetry: true, incomplete },
      tally: 'unreadable', unpricedModels: [], pricedUsd: 0,
    };
  }

  // An incomplete lineage shows what it knows (its labels) but no figure: never a partial as a whole.
  const last = fold.last;
  if (incomplete) {
    return {
      session: { rootItemId: anchor, kind: baseKind, dispatchedAt: baseAt, harness: last?.harness || null, model: last?.model || null, effort: last?.effort || null, costUsd: null, durationMs, ...usageDetailOf(record, perDispatch), telemetry: true, incomplete: true },
      tally: 'incomplete', unpricedModels: fold.unpricedModels, pricedUsd: 0,
    };
  }

  // The labels (LIN-2830, LIN-4263). A snapshot lineage's are its last counted row's (the cumulative snapshot's own
  // model). A records lineage's are NOT the last session's: `model` is the cost-dominant priced model
  // (foldRequestUsage), and `effort` and `harness` are the latest record's. The per-dispatch split says which
  // dispatch each request ran in, so a follow-up's model is never read as the whole lineage's.
  return {
    session: {
      rootItemId: anchor,
      kind: baseKind,
      dispatchedAt: baseAt,
      harness: last?.harness || null,
      model: last?.model || null,
      effort: last?.effort || null,
      costUsd: fold.costUsd,
      durationMs,
      ...usageDetailOf(record, perDispatch),
      telemetry: true,
      incomplete: false,
    },
    tally: 'figure',
    unpricedModels: fold.unpricedModels,
    pricedUsd: fold.completeness === 'complete' ? fold.costUsd : 0,
  };
}

/** The figures of `readCost` over its lineage records. Pure. */
function summarizeReadCost(records, appSummary, { perDispatch = false } = {}) {
  let pricedUsd = 0;
  let noTelemetryCount = 0;
  let unreadableCount = 0;
  let incompleteCount = 0;
  const unpricedModels = new Set();
  const workerSessions = [];

  for (const record of records) {
    const { session, tally, unpricedModels: unpriced, pricedUsd: priced } = sessionOf(record, perDispatch);
    if (tally === 'noTelemetry') noTelemetryCount += 1;
    else if (tally === 'unreadable') unreadableCount += 1;
    else if (tally === 'incomplete') incompleteCount += 1;
    if (tally === 'figure' && record.fold.completeness === 'complete') pricedUsd += priced;
    for (const model of unpriced) unpricedModels.add(model);
    workerSessions.push(session);
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

/**
 * The figure of one lineage record (the figure rule, LIN-4176 plan): complete only when every counted row
 * was read and priced AND the record is not incomplete. A complete $0 is a real figure (`costUsd` 0).
 * Anything else withholds the figure: `costUsd` is null, never a partial sum or a silent zero.
 *
 * @param {Object} record  one of `lineageRecords`' records
 * @returns {{costUsd: number|null, fullyPriced: boolean, completeness: string}}
 */
export function lineageFigure(record) {
  const fullyPriced = !record.incomplete && record.fold.completeness === 'complete';
  return {
    costUsd: fullyPriced ? record.fold.costUsd : null,
    fullyPriced,
    completeness: record.incomplete ? 'incomplete' : record.fold.completeness,
  };
}

/**
 * The figure of a lineage whose rows the caller already holds as its members (the run page's loops:
 * the session is the lineage). No membership filter and no identity: the one decision (`lineageUsageOf`), and the
 * figure rule.
 *
 * @param {Array<Object>} rows  the lineage's rows in dispatch order, either shape
 * @param {Object} options
 * @param {Array<Object>} options.records  REQUIRED: THIS lineage's request records (`[]` on purpose when none).
 *   Throws when it is not an array. Synchronous: the caller loads the records (buildRunView loads once for all).
 * @returns {{costUsd: number|null, fullyPriced: boolean, completeness: string, lastIndex: number|null}}
 *   `lastIndex` is the position in `rows` of the row the figure sits on (null when none): the counted snapshot row,
 *   or for records the latest record's posting row (the last row when the caller did not pass that row).
 */
export function lineageFigureOf(rows, options = {}) {
  if (Object.hasOwn(options, 'requestRows')) {
    throw new TypeError('lineageFigureOf: requestRows is not accepted (LIN-4226). Pass records: this lineage\'s request records.');
  }
  const { records } = options;
  if (!Array.isArray(records)) throw new TypeError('lineageFigureOf: records is required (LIN-4226). Pass this lineage\'s request records, or [] on purpose when there are none.');
  const { fold } = lineageUsageOf(rows, records.filter(record => record && typeof record === 'object'));
  const fullyPriced = fold.completeness === 'complete';
  return {
    costUsd: fullyPriced ? fold.costUsd : null,
    fullyPriced,
    completeness: fold.completeness,
    lastIndex: fold.lastIndex,
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

/**
 * The Harbour calls figure (plan "Calls", LIN-4179): the priced sum over a set of call-log docs, with the figure
 * rule's coverage. A null call cost is never added as 0: it is counted in `unpricedCalls`. Pure.
 *
 * @param {Array<{feature?: string, model?: string, cost?: number|null}>} docs  call-log docs, in the order the caller reads them
 * @returns {{calls: number, pricedCalls: number, unpricedCalls: number, pricedUsd: number, totalUsd: number|null,
 *   complete: boolean, models: string[], byFeature: Array<{feature: string, calls: number, pricedCalls: number,
 *   unpricedCalls: number, pricedUsd: number}>}}
 *   `totalUsd` is the sum only when every call is priced (a complete $0 is a real $0); `complete` is false for no
 *   calls too, so `calls === 0` is the "no data" case, distinct from a zero.
 */
export function readCalls(docs = []) {
  const features = new Map();
  const models = new Set();
  let calls = 0;
  let pricedCalls = 0;
  let pricedUsd = 0;
  for (const doc of docs) {
    if (!doc || typeof doc !== 'object') continue;
    calls += 1;
    if (doc.model) models.add(doc.model);
    const feature = doc.feature || 'unknown';
    const acc = features.get(feature) || { feature, calls: 0, pricedCalls: 0, unpricedCalls: 0, pricedUsd: 0 };
    acc.calls += 1;
    if (Number.isFinite(doc.cost)) {
      pricedCalls += 1;
      pricedUsd += doc.cost;
      acc.pricedCalls += 1;
      acc.pricedUsd += doc.cost;
    } else {
      acc.unpricedCalls += 1;
    }
    features.set(feature, acc);
  }
  const unpricedCalls = calls - pricedCalls;
  const complete = calls > 0 && unpricedCalls === 0;
  return {
    calls,
    pricedCalls,
    unpricedCalls,
    pricedUsd,
    totalUsd: complete ? pricedUsd : null,
    complete,
    models: [...models].sort(),
    byFeature: [...features.values()].sort((a, b) => b.calls - a.calls),
  };
}

/**
 * The per-issue app calls the S1 cost route publishes as `appCalls` (its wire shape is pinned by the route test):
 * `{calls, costUsd, unpricedCalls, byFeature: [{feature, calls, costUsd}]}`. `costUsd` is the priced sum.
 *
 * @param {Array<Object>} docs  the issue's calls in the window (`listInHorizon` with `issueIdentifier`)
 */
export function appCallsOf(docs = []) {
  const figure = readCalls(docs);
  return {
    calls: figure.calls,
    costUsd: figure.pricedUsd,
    unpricedCalls: figure.unpricedCalls,
    byFeature: figure.byFeature.map(({ feature, calls, pricedUsd }) => ({ feature, calls, costUsd: pricedUsd })),
  };
}

/**
 * The workspace calls surface Settings › Health and Ship's Biscuit's Weather line read (LIN-418, LIN-4179): the
 * figure (`readCalls`) with the call telemetry that is not cost (`callTelemetryOf`). Both callers say the unpriced
 * count next to the sum; neither reads a null cost as $0.
 *
 * @param {Array<Object>} docs  the workspace's calls in the window
 */
export function callsSurfaceOf(docs = []) {
  const figure = readCalls(docs);
  const telemetry = callTelemetryOf(docs);
  return {
    totalCalls: figure.calls,
    totalTokens: telemetry.totalTokens,
    lastCallAt: telemetry.lastCallAt,
    latencyByFeatureModel: telemetry.latencyByFeatureModel,
    pricedUsd: figure.pricedUsd,
    unpricedCalls: figure.unpricedCalls,
    totalUsd: figure.totalUsd,
    complete: figure.complete,
    byFeature: figure.byFeature,
  };
}
