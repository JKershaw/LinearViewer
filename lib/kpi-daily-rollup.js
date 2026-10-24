/**
 * lib/kpi-daily-rollup.js
 *
 * KPI daily rollup, part A (LIN-3724, design LIN-3712, docs/plans/kpi-daily-rollup.md).
 *
 * Running totals of finished tasks need daily counts that outlive the 30-day
 * read horizon (lib/read-horizon.js) without an unbounded read. This module
 * owns the record: the `kpi-daily-rollup` collection of
 * `{ urlKey, day, done, failed, aborted, dispatches }` (`day` is a UTC
 * `YYYY-MM-DD`), the daily job that rewrites the in-horizon days, and the
 * backfill for days that have left the horizon. Nothing reads the collection
 * yet (part B), so `/kpis` and the workspace page are unchanged.
 *
 * Today's row is a SNAPSHOT: it is written at the first tick of the UTC day and
 * not touched again until tomorrow's run rewrites it. That is acceptable only
 * because part B's total stops before today; do not treat today's row as live.
 * For the same reason yesterday's row is stale from 00:00 UTC until the first
 * tick of the new day (LIN-3733): part B stops at the marker's `through`, the
 * last day this job has completed, not at "yesterday".
 *
 * Counting rules, shared by the job and the backfill (`rollupCountsByDay`):
 *   - done / failed / aborted count LINEAGES (groupDispatchLineages) on the UTC
 *     day of the lineage's latest terminal marker (`statusMs`). `skipped` and a
 *     null `statusMs` are not counted.
 *   - dispatches counts HISTORY rows on the UTC day of `dispatchedAt` (abort
 *     rows included, decision 1 of the plan); queue rows are never read.
 */
import { groupDispatchLineages } from './dispatch-lineage.js';
import { DAY_KEY_LENGTH, loadDispatchHistory, utcKey } from './kpi-stats.js';
import { readHorizonStart, READ_HORIZON_MS } from './read-horizon.js';
import { toEpochMs } from './utils/time.js';
import { INDEX_SPECS, tierOf, sameKeySpec, deferredIndexState } from './db-indexes.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How many days BEFORE a day's start the job and the backfill read. A lineage
 * is counted on the day of its latest terminal row, but the row that holds that
 * terminal is dispatched earlier (a follow-up dispatched on D+5 finishes a
 * lineage first dispatched on D). A read bounded at the day's own start would
 * miss every such terminal; L days of lookback catches follow-ups dispatched up
 * to L days before the day they finish. A lineage whose latest terminal row was
 * dispatched more than L days earlier is still missed (the dry run reports a
 * lower bound of that loss). Open question (LIN-3724): fixed at 7, revisit once
 * the dry run has produced a loss figure.
 */
export const ROLLUP_LOOKBACK_DAYS = 7;

/**
 * The dry run's wider lookback, used only to MEASURE what ROLLUP_LOOKBACK_DAYS
 * loses. `--write` never reads this window.
 */
export const AUDIT_LOOKBACK_DAYS = 30;

/**
 * The index the backfill needs: the declared deferred `dispatch-history`
 * `{ urlKey: 1, dispatchedAt: 1 }` spec in `INDEX_SPECS` (LIN-3811). It is
 * deferred, so boot does not build it (boot awaits only the boot tier, and a
 * build over the whole of `dispatch-history` would hold the deploy, LIN-2954)
 * and the server builds it in the background after `listen` (LIN-3865); the
 * manual tool is `scripts/apply-deferred-indexes.mjs --apply`
 * (docs/runbooks/deferred-index-build.md).
 * The daily job's own scan has no urlKey and is served by the sibling deferred
 * `{ dispatchedAt: 1, urlKey: 1 }` spec.
 */
export const ROLLUP_HISTORY_INDEX = Object.freeze({
  ...INDEX_SPECS.find(
    spec => spec.collection === 'dispatch-history' && tierOf(spec) === 'deferred' && sameKeySpec(spec.keySpec, { urlKey: 1, dispatchedAt: 1 })
  ).keySpec
});

/** `_id` of the single marker document the job gates on. */
export const ROLLUP_MARKER_ID = 'last-complete-day';

const ROLLUP_BATCH_SIZE = 500;
const DUPLICATE_KEY_CODE = 11000;
const COUNT_FIELDS = ['done', 'failed', 'aborted', 'dispatches'];
const OUTCOME_FIELDS = ['done', 'failed', 'aborted'];
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Day helpers
// ---------------------------------------------------------------------------

const nowMsOf = now => (now instanceof Date ? now.getTime() : now);

/** Epoch ms of 00:00:00 UTC on a `YYYY-MM-DD` key. */
export const dayStartMs = key => Date.parse(`${key}T00:00:00.000Z`);

/** The UTC day key `n` days after `key` (negative `n` goes back). */
export const addDays = (key, n) => utcKey(dayStartMs(key) + n * DAY_MS, DAY_KEY_LENGTH);

/** True for a real calendar day written as `YYYY-MM-DD`. */
export const isDayKey = value =>
  typeof value === 'string' && DAY_KEY_PATTERN.test(value) && utcKey(dayStartMs(value), DAY_KEY_LENGTH) === value;

/** First UTC day whose start is at or after the read horizon: the oldest day the page still shows whole. */
export function firstRollupDay(now = Date.now()) {
  const horizonMs = readHorizonStart(now).getTime();
  return utcKey(Math.ceil(horizonMs / DAY_MS) * DAY_MS, DAY_KEY_LENGTH);
}

export const todayKey = (now = Date.now()) => utcKey(nowMsOf(now), DAY_KEY_LENGTH);
export const yesterdayKey = (now = Date.now()) => addDays(todayKey(now), -1);

/** Every day key from `from` to `to` inclusive, oldest first (empty when `to < from`). */
function dayRange(from, to) {
  const days = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

const zeroCounts = day => ({ day, done: 0, failed: 0, aborted: 0, dispatches: 0 });
const isAllZero = counts => COUNT_FIELDS.every(field => counts[field] === 0);

/**
 * Daily counts for one workspace's rows over `from..to` (inclusive day keys).
 * Every day in the range is present, zeros included, oldest first.
 *
 * @param {Array<Object>} rows - history rows, `loadDispatchHistory`'s shape
 * @param {{from: string, to: string}} range
 * @returns {Array<{day: string, done: number, failed: number, aborted: number, dispatches: number}>}
 */
export function rollupCountsByDay(rows, { from, to }) {
  const byDay = new Map(dayRange(from, to).map(day => [day, zeroCounts(day)]));
  for (const { status, statusMs } of groupDispatchLineages(rows).values()) {
    if (statusMs === null || !OUTCOME_FIELDS.includes(status)) continue;
    const counts = byDay.get(utcKey(statusMs, DAY_KEY_LENGTH));
    if (counts) counts[status]++;
  }
  for (const row of rows) {
    const counts = byDay.get(utcKey(row.dispatchedAt, DAY_KEY_LENGTH));
    if (counts) counts.dispatches++;
  }
  return [...byDay.values()];
}

const partitionByUrlKey = rows => {
  const byKey = new Map();
  for (const row of rows) {
    if (typeof row.urlKey !== 'string' || row.urlKey === '') continue;
    if (!byKey.has(row.urlKey)) byKey.set(row.urlKey, []);
    byKey.get(row.urlKey).push(row);
  }
  return byKey;
};

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Error code of one `writeErrors` entry: the driver puts it at `.code`, MangoDB at `.error.code`. */
const writeErrorCode = entry => entry?.code ?? entry?.error?.code;

const isDuplicateKeyOnly = err =>
  Array.isArray(err?.writeErrors) && err.writeErrors.length > 0 &&
  err.writeErrors.every(entry => writeErrorCode(entry) === DUPLICATE_KEY_CODE);

/**
 * `bulkWrite` one batch unordered. If EVERY write error is E11000 (two
 * instances upserting the same `{urlKey, day}` at once lose one insert to the
 * unique index) the batch is retried once, when the row exists and the upsert
 * becomes an update. Anything else, or a second failure, propagates.
 */
async function bulkWriteWithRetry(rollup, ops) {
  try {
    return await rollup.bulkWrite(ops, { ordered: false });
  } catch (err) {
    if (!isDuplicateKeyOnly(err)) throw err;
    return rollup.bulkWrite(ops, { ordered: false });
  }
}

/**
 * Upsert daily rows. An all-zero day is written ONLY to overwrite an existing
 * row (`upsert: false`: no row, no-op), so a quiet workspace never grows zero
 * rows and a row that has dropped to zero is still corrected. Readers treat a
 * missing row as zero in the rolled-up range.
 *
 * @param {Object} rollup - the `kpi-daily-rollup` collection
 * @param {Array<{urlKey: string, days: Array<Object>}>} perWorkspace
 * @returns {Promise<{ops: number}>} number of operations sent
 */
export async function writeRollupDays(rollup, perWorkspace) {
  const ops = [];
  for (const { urlKey, days } of perWorkspace) {
    for (const counts of days) {
      ops.push({
        updateOne: {
          filter: { urlKey, day: counts.day },
          update: { $set: { done: counts.done, failed: counts.failed, aborted: counts.aborted, dispatches: counts.dispatches } },
          upsert: !isAllZero(counts)
        }
      });
    }
  }
  for (let i = 0; i < ops.length; i += ROLLUP_BATCH_SIZE) {
    await bulkWriteWithRetry(rollup, ops.slice(i, i + ROLLUP_BATCH_SIZE));
  }
  return { ops: ops.length };
}

// ---------------------------------------------------------------------------
// The daily job
// ---------------------------------------------------------------------------

/**
 * The `kpi-daily-rollup` scheduler job body (registered in server.js). The
 * scheduler is interval-only (lib/scheduler.js), so the job ticks hourly and
 * gates on one marker doc `{ _id: 'last-complete-day', through }`: when
 * `through` is yesterday's UTC day the tick returns without reading history,
 * so there is one full scan a day, within an hour after midnight UTC. The
 * marker has no `urlKey`/`day`, so `distinct` and readers skip it; it is only
 * ever `_id`-upserted (a second marker would collide on the unique index's
 * null/null key).
 *
 * A run reads `[start(first) - L, now)` once, instance-wide, partitions by
 * `urlKey`, and rewrites days `first..today` for every workspace in the read
 * plus every workspace with an in-horizon rollup row (a quiet workspace's days
 * go to zero). The marker is set only after the writes, so a failed run is
 * retried by the next tick (hourly, with no back-off: the same scan /kpis pays).
 * `through` is taken from the tick's start so a run that crosses midnight is
 * not marked complete for a day it did not see.
 *
 * @param {Object} deps
 * @param {Object} deps.dispatchHistory
 * @param {Object} deps.rollup - the `kpi-daily-rollup` collection
 * @param {() => number} [deps.now]
 * @param {number} [deps.lookbackDays] - ROLLUP_LOOKBACK_DAYS; injectable only so a test can show what L = 0 loses
 * @returns {() => Promise<{scanned: boolean, workspaces?: number, ops?: number}>}
 */
export function createKpiDailyRollupRun({ dispatchHistory, rollup, now = Date.now, lookbackDays = ROLLUP_LOOKBACK_DAYS }) {
  return async function kpiDailyRollupRun() {
    const tickStart = now();
    const yesterday = yesterdayKey(tickStart);
    const marker = await rollup.findOne({ _id: ROLLUP_MARKER_ID });
    if (marker?.through === yesterday) return { scanned: false };

    const first = firstRollupDay(tickStart);
    const today = todayKey(tickStart);
    const since = new Date(dayStartMs(first) - lookbackDays * DAY_MS);
    const byKey = partitionByUrlKey(await loadDispatchHistory(dispatchHistory, { since }));
    const quiet = await rollup.distinct('urlKey', { day: { $gte: first } });
    const urlKeys = new Set([...byKey.keys(), ...quiet.filter(key => typeof key === 'string' && key !== '')]);

    const perWorkspace = [...urlKeys].map(urlKey => ({
      urlKey,
      days: rollupCountsByDay(byKey.get(urlKey) ?? [], { from: first, to: today })
    }));
    const { ops } = await writeRollupDays(rollup, perWorkspace);
    await rollup.updateOne({ _id: ROLLUP_MARKER_ID }, { $set: { through: yesterday } }, { upsert: true });
    return { scanned: true, workspaces: urlKeys.size, ops };
  };
}

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------

/** Error carrying the process exit code the script maps it to. */
export class BackfillError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'BackfillError';
    this.code = code;
  }
}
export const EXIT_NO_DATABASE = 2;
export const EXIT_INDEX_MISSING = 3;
export const EXIT_BAD_RANGE = 4;

async function assertHistoryIndex(db, logger) {
  const state = (await deferredIndexState(db, { logger })).find(
    entry => entry.collection === 'dispatch-history' && sameKeySpec(entry.keySpec, ROLLUP_HISTORY_INDEX)
  );
  // Only a confirmed build passes: pending and unreadable both refuse (LIN-3811).
  if (state?.built === true) return;
  const why = state?.built === 'unknown' ? ' (the index state could not be read: see the log above)' : '';
  throw new BackfillError(`index missing: see runbook (docs/runbooks/deferred-index-build.md)${why}`, EXIT_INDEX_MISSING);
}

/** Oldest `dispatchedAt` day of one workspace, or null when no row carries a usable time. */
async function oldestDayOf(historyCollection, urlKey) {
  const [row] = await historyCollection
    .find({ urlKey, dispatchedAt: { $ne: null } }, { projection: { dispatchedAt: 1 } })
    .sort({ dispatchedAt: 1 })
    .limit(1)
    .toArray();
  const ms = row ? toEpochMs(row.dispatchedAt) : null;
  return ms === null ? null : utcKey(ms, DAY_KEY_LENGTH);
}

/**
 * Plan and (with `write`) run the backfill for days that have left the read
 * horizon. Nothing here calls `process.exit`; refusals throw `BackfillError`.
 *
 * Per workspace the units are the days `oldest + 1 .. first - 1`: the oldest
 * day is skipped (its lineages may have started before the data does) and named
 * possibly partial; days within L of it are flagged "short lookback". One query
 * per workspace and day. `--write` reads `[start(D) - L, start(D) + 30d)`; the
 * dry run reads the wider `[start(D) - AUDIT_LOOKBACK_DAYS, start(D) + 30d)`
 * once and groups it twice (the narrow grouping is what `--write` would
 * write), so the loss figure compares two groupings of the same rows.
 *
 * @param {Object} opts
 * @param {Object} opts.db
 * @param {Date|number} [opts.now]
 * @param {boolean} [opts.write=false]
 * @param {boolean} [opts.planOnly=false]
 * @param {string} [opts.from] - first day to run, UTC `YYYY-MM-DD`
 * @param {string} [opts.to] - last day to run, inclusive
 * @param {{log: Function}} [opts.logger]
 * @returns {Promise<Object>} the report
 */
export async function runBackfill({ db, now = Date.now(), write = false, planOnly = false, from, to, logger = console }) {
  const history = db.collection('dispatch-history');
  const rollup = db.collection('kpi-daily-rollup');
  await assertHistoryIndex(db, logger);

  const first = firstRollupDay(now);
  const lastUnit = addDays(first, -1);
  const urlKeys = (await history.distinct('urlKey')).filter(key => typeof key === 'string' && key !== '').sort();
  const oldest = new Map();
  for (const urlKey of urlKeys) oldest.set(urlKey, await oldestDayOf(history, urlKey));

  const oldestDays = [...oldest.values()].filter(Boolean).sort();
  const lowest = oldestDays.length ? addDays(oldestDays[0], 1) : null;
  for (const [name, value] of [['--from', from], ['--to', to]]) {
    if (value === undefined) continue;
    if (!isDayKey(value)) throw new BackfillError(`${name} must be a UTC day as YYYY-MM-DD, got "${value}"`, EXIT_BAD_RANGE);
    if (lowest === null || value < lowest || value > lastUnit) {
      throw new BackfillError(
        `${name} ${value} is outside the days this backfill may write: ${lowest ?? '(no history)'} .. ${lastUnit}`,
        EXIT_BAD_RANGE
      );
    }
  }
  if (from !== undefined && to !== undefined && from > to) {
    throw new BackfillError(`--from ${from} is after --to ${to}`, EXIT_BAD_RANGE);
  }

  const workspaces = [];
  for (const urlKey of urlKeys) {
    const oldestDay = oldest.get(urlKey);
    if (oldestDay === null) {
      workspaces.push({ urlKey, oldestDay: null, days: [], shortLookbackDays: [], rows: 0 });
      continue;
    }
    const days = dayRange(addDays(oldestDay, 1), lastUnit).filter(day => (from === undefined || day >= from) && (to === undefined || day <= to));
    const shortLookbackDays = days.filter(day => day < addDays(oldestDay, ROLLUP_LOOKBACK_DAYS));
    workspaces.push({ urlKey, oldestDay, days, shortLookbackDays, rows: 0 });
  }
  const plannedQueries = workspaces.reduce((sum, ws) => sum + ws.days.length, 0);

  const mode = write ? 'write' : 'dry-run';
  logger.log(`[backfill] mode=${mode} first-in-horizon-day=${first} workspaces=${workspaces.length} queries=${plannedQueries}`);
  for (const ws of workspaces) {
    logger.log(
      `[backfill] workspace=${ws.urlKey} oldest-day=${ws.oldestDay ?? 'none'}${ws.oldestDay ? ' (skipped: possibly partial)' : ''} ` +
      `days=${ws.days.length} short-lookback-days=${ws.shortLookbackDays.length}`
    );
  }

  const report = { mode, first, plannedQueries, queries: 0, workspaces, written: 0, differingDays: [], loss: { done: 0, failed: 0, aborted: 0 } };
  if (planOnly) return report;

  const lookbackDays = write ? ROLLUP_LOOKBACK_DAYS : AUDIT_LOOKBACK_DAYS;
  for (const ws of workspaces) {
    const writes = [];
    for (const day of ws.days) {
      const startMs = dayStartMs(day);
      const rows = await loadDispatchHistory(db.collection('dispatch-history'), {
        since: new Date(startMs - lookbackDays * DAY_MS),
        until: new Date(startMs + READ_HORIZON_MS),
        urlKey: ws.urlKey
      });
      report.queries++;
      ws.rows += rows.length;
      const narrowRows = write ? rows : rows.filter(row => (toEpochMs(row.dispatchedAt) ?? -Infinity) >= startMs - ROLLUP_LOOKBACK_DAYS * DAY_MS);
      const [counts] = rollupCountsByDay(narrowRows, { from: day, to: day });
      writes.push(counts);
      if (!write) {
        const [wide] = rollupCountsByDay(rows, { from: day, to: day });
        const lost = Object.fromEntries(OUTCOME_FIELDS.map(field => [field, wide[field] - counts[field]]));
        if (OUTCOME_FIELDS.some(field => lost[field] !== 0)) {
          report.differingDays.push({ urlKey: ws.urlKey, day, ...lost });
          for (const field of OUTCOME_FIELDS) report.loss[field] += lost[field];
        }
      }
    }
    if (write && writes.length) {
      const { ops } = await writeRollupDays(rollup, [{ urlKey: ws.urlKey, days: writes }]);
      report.written += ops;
    }
    logger.log(`[backfill] workspace=${ws.urlKey} rows-read=${ws.rows} days=${ws.days.length} oldest-day=${ws.oldestDay ?? 'none'} short-lookback-days=${ws.shortLookbackDays.join(',') || 'none'}`);
  }
  if (!write) {
    logger.log(
      `[backfill] loss at lookback ${ROLLUP_LOOKBACK_DAYS}d vs ${AUDIT_LOOKBACK_DAYS}d: ` +
      `differing-days=${report.differingDays.length} done=${report.loss.done} failed=${report.loss.failed} aborted=${report.loss.aborted} ` +
      '(a lower bound: losses older than the audit lookback are not seen)'
    );
  }
  return report;
}
