/**
 * lib/task-timeline.js: one task's sessions on one clock (LIN-4405, part 2 of LIN-4395).
 *
 * Three things live here, and no timeline logic lives in the task page loader:
 *
 *  - `taskTimeline(...)`, PURE: the lineages of the task's own cost read (lib/task-cost-read.js, part 1) plus its merge
 *    marks and the page's open session ids, turned into lanes, segments, ticks, a scale with breaks, and totals. Every
 *    position is a percentage computed here, so the renderer (lib/render-task-timeline.js) only prints numbers and
 *    the browser does no layout maths.
 *  - `withoutSpend(timeline)`: a COPY with every dollar field removed, for guests (John's ruling, LIN-4395 comment
 *    31484e36: "Owner and members see spend; guests see the picture without dollars"). It never mutates its input,
 *    which may be a cached model (plan-review builder note 5).
 *  - `createTaskTimelineReader(deps)`: the reader that composes `readTaskCost` (no Harbour-call summary, with the
 *    `foundedElsewhere` opt-in), the close-out events and `taskTimeline`; and `createTimelineFragmentReader(deps)`, the
 *    single-flight short cache both fragment routes share.
 *
 * Honesty rules (the parent's constraints):
 *  - Working time is only `[firstRequestAt, lastRequestAt]` per dispatch (part 1's split rule C). Held or elapsed time
 *    is a thin line, never a bar. A dispatch with no records gets a tick, never a guessed bar.
 *  - A lineage with `dispatches: null` (request records began about 4 Nov 2026; older lineages are snapshot-only) is
 *    drawn as its known span, outlined, and marked "working times unknown". Its span counts as covered, so a break
 *    never folds time in which work may have happened.
 *  - A lineage founded on another task (`foundedElsewhere`) draws only the dispatches tagged with this task, and only
 *    those set the clock. Its line is clipped to this task's clock with the clipped ends marked, and its cost is the
 *    whole lineage's, counted under its founder and never added to this task's total.
 *  - The total is the own read's `totalUsd`; null reads "not complete", naming any priced part as priced.
 */

import { roleOf, lineageRoleOf } from './session-roles.js';
import { readTaskCost as realReadTaskCost } from './task-cost-read.js';
import { toEpochMs } from './utils/time.js';

/** A gap shorter than this never folds into a break. */
export const BREAK_MIN_MS = 10 * 60 * 1000;
/** A gap folds when it is longer than this share of the span still drawn (and longer than `BREAK_MIN_MS`). */
export const BREAK_SPAN_FRACTION = 0.15;
/** The track width (percent) one folded break takes. */
export const BREAK_PCT = 4;
/** The narrowest a working segment is drawn (percent), so a 15-second wake is still visible. Drawn only: `workedMs` is real. */
export const MIN_SEGMENT_PCT = 0.8;
/** The shortest clock drawn, so one instant still has a width. */
export const MIN_CLOCK_MS = 60 * 1000;
/**
 * The fragment cache window. Shorter than the browser's one-fetch-per-60-s window (public/task-page.js), so one viewer
 * always gets a fresh read, while any number of open tabs (owners, members and guests share one entry) cost at most
 * one read per task per window (LIN-4405 decision, recorded on LIN-4395).
 */
export const TIMELINE_CACHE_MS = 30 * 1000;

const round = (pct) => Math.round(pct * 100) / 100;
const isoOf = (ms) => (ms === null ? null : new Date(ms).toISOString());

/** One dispatch as the lane lists it. Its `model` is the cost fold's answer, carried by the read (LIN-4454), never re-ranked here. */
function dispatchRowOf(dispatch) {
  const first = toEpochMs(dispatch.firstRequestAt);
  const last = toEpochMs(dispatch.lastRequestAt);
  return {
    itemId: dispatch.itemId ?? null,
    kind: dispatch.kind || 'custom',
    role: roleOf(dispatch),
    dispatchedAt: dispatch.dispatchedAt ?? null,
    firstRequestAt: first === null ? null : isoOf(first),
    lastRequestAt: last === null ? null : isoOf(Math.max(last, first ?? last)),
    workedMs: first !== null && last !== null ? Math.max(0, last - first) : null,
    requests: Number.isFinite(dispatch.requests) ? dispatch.requests : 0,
    model: dispatch.model ?? null,
    costUsd: dispatch.costUsd ?? null,
  };
}

/** The latest instant a lane's dispatches show (a dispatch time or a request), or null. */
function lastActivityOf(rows) {
  let last = null;
  for (const row of rows) {
    for (const at of [row.dispatchedAt, row.firstRequestAt, row.lastRequestAt]) {
      const ms = toEpochMs(at);
      if (ms !== null && (last === null || ms > last)) last = ms;
    }
  }
  return last;
}

/** The earliest dispatch time of a lane's dispatches, or null. */
function firstDispatchOf(rows) {
  let first = null;
  for (const row of rows) {
    const ms = toEpochMs(row.dispatchedAt);
    if (ms !== null && (first === null || ms < first)) first = ms;
  }
  return first;
}

/**
 * A lane's times before the clock is known. Own lanes run from the lineage's start to `start + durationMs`; the start
 * is the earliest of the session's own `dispatchedAt` and its dispatches' (the dispatches include members a truncated
 * read did not fetch, so the start does not move later when old rows are dropped). Foreign lanes run over their tagged
 * dispatches only; their lineage span is kept to clip against.
 */
function laneTimesOf(session, rows, { foreign, running, nowMs }) {
  const sessionStart = toEpochMs(session.dispatchedAt);
  const lineageStart = [sessionStart, firstDispatchOf(rows)].filter(ms => ms !== null).reduce((a, b) => Math.min(a, b), Infinity);
  const lineageStartMs = Number.isFinite(lineageStart) ? lineageStart : null;
  const recordedEnd = sessionStart !== null && Number.isFinite(session.durationMs) ? sessionStart + session.durationMs : null;
  const activity = lastActivityOf(rows);

  if (foreign && rows.length > 0) {
    const start = firstDispatchOf(rows) ?? toEpochMs(rows[0].firstRequestAt);
    const end = running ? Math.max(nowMs, activity ?? start) : Math.max(activity ?? start, start);
    return { start, end, lineageStart: lineageStartMs, lineageEnd: running ? end : recordedEnd, endRecorded: true };
  }
  const start = lineageStartMs;
  if (start === null) return null;
  // A runner's clock can run a little ahead of the server's: a running lane never ends before its own last request.
  if (running) return { start, end: Math.max(nowMs, activity ?? start, start), lineageStart: start, lineageEnd: Math.max(nowMs, activity ?? start), endRecorded: true };
  if (recordedEnd !== null) return { start, end: Math.max(recordedEnd, activity ?? recordedEnd, start), lineageStart: start, lineageEnd: recordedEnd, endRecorded: true };
  // No end and not running: stop at the last thing known, and say the end was not recorded.
  return { start, end: Math.max(activity ?? start, start), lineageStart: start, lineageEnd: null, endRecorded: false };
}

/** Covered intervals (`[from, to]`, points as `[at, at]`) merged into disjoint regions, in order. */
function coveredRegions(intervals) {
  const sorted = intervals.filter(([a, b]) => a !== null && b !== null).map(([a, b]) => [Math.min(a, b), Math.max(a, b)]).sort((x, y) => x[0] - y[0]);
  const regions = [];
  for (const [a, b] of sorted) {
    const last = regions[regions.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else regions.push([a, b]);
  }
  return regions;
}

/**
 * The gaps to fold: the empty stretches between covered regions, largest first, folded while each is longer than
 * `BREAK_MIN_MS` and than `BREAK_SPAN_FRACTION` of the span still drawn. Folding the largest first shrinks what is drawn,
 * so a gap that was small beside a two-day wait can fold next. Returned in time order.
 */
function foldedGaps(regions, spanMs) {
  const gaps = [];
  for (let i = 1; i < regions.length; i += 1) gaps.push({ from: regions[i - 1][1], to: regions[i][0] });
  gaps.sort((a, b) => (b.to - b.from) - (a.to - a.from));
  const folded = [];
  let drawn = spanMs;
  for (const gap of gaps) {
    const length = gap.to - gap.from;
    if (length <= Math.max(BREAK_MIN_MS, BREAK_SPAN_FRACTION * drawn)) break;
    folded.push(gap);
    drawn -= length;
  }
  return folded.sort((a, b) => a.from - b.from);
}

/** Plain words for a break's length: `2d 4h`, `5h 12m`, `47m`. */
export function gapWords(ms) {
  const minutes = Math.round(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

/** The scale: time pieces drawn linearly and folded breaks at a fixed width, over the whole track (0–100 %). */
function scaleOf(clockStart, clockEnd, folded) {
  const spanMs = clockEnd - clockStart;
  const foldedMs = folded.reduce((sum, gap) => sum + (gap.to - gap.from), 0);
  const linearPct = 100 - folded.length * BREAK_PCT;
  const perMs = linearPct / Math.max(1, spanMs - foldedMs);
  const pieces = [];
  let cursor = clockStart;
  let left = 0;
  for (const gap of folded) {
    const width = (gap.from - cursor) * perMs;
    pieces.push({ type: 'time', from: cursor, to: gap.from, leftPct: left, widthPct: width });
    left += width;
    pieces.push({ type: 'break', from: gap.from, to: gap.to, leftPct: left, widthPct: BREAK_PCT });
    left += BREAK_PCT;
    cursor = gap.to;
  }
  pieces.push({ type: 'time', from: cursor, to: clockEnd, leftPct: left, widthPct: 100 - left });
  return pieces;
}

/** A clock instant's position on the track (percent), clamped to it. */
function pctOf(pieces, ms) {
  if (ms <= pieces[0].from) return 0;
  for (const piece of pieces) {
    if (ms <= piece.to) {
      const span = piece.to - piece.from;
      const inner = span > 0 ? ((ms - piece.from) / span) * piece.widthPct : 0;
      return Math.min(100, Math.max(0, piece.leftPct + inner));
    }
  }
  return 100;
}

/** A `[from, to]` stretch on the track, at least `minPct` wide and never past its end. */
function placeOf(pieces, from, to, minPct = 0) {
  const left = pctOf(pieces, from);
  const width = Math.max(pctOf(pieces, to) - left, minPct);
  const clampedLeft = Math.min(left, Math.max(0, 100 - width));
  return { leftPct: round(clampedLeft), widthPct: round(Math.min(width, 100)) };
}

/**
 * The merge marks (the plan's one merge rule). Merged close-out events are de-duplicated by `prUrl`, and each PR with a
 * recorded `prMergedAt` gets a mark. If none is timed, the PR status's `mergedAt` (lib/run-evidence.js, page load only)
 * marks it. Otherwise a known merge reads "merged, time not recorded", with no mark. Pure.
 *
 * @param {{events?: Array<Object>|null, pr?: {merged?: boolean, mergedAt?: string|null, url?: string|null}|null}} input
 * @returns {{marks: Array<{prUrl: string|null, at: string}>, untimed: boolean}}
 */
export function mergeMarksOf({ events = [], pr = null } = {}) {
  const byUrl = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || event.merged !== true || typeof event.prUrl !== 'string') continue;
    const at = toEpochMs(event.prMergedAt);
    const known = byUrl.get(event.prUrl);
    if (known === undefined || (known === null && at !== null)) byUrl.set(event.prUrl, at);
  }
  const timed = [...byUrl.entries()].filter(([, at]) => at !== null).map(([prUrl, at]) => ({ prUrl, at: isoOf(at) }));
  if (timed.length > 0) return { marks: timed.sort((a, b) => a.at.localeCompare(b.at)), untimed: false };
  const prMergedAt = pr && pr.merged ? toEpochMs(pr.mergedAt) : null;
  if (prMergedAt !== null) return { marks: [{ prUrl: pr.url || null, at: isoOf(prMergedAt) }], untimed: false };
  return { marks: [], untimed: byUrl.size > 0 || !!(pr && pr.merged) };
}

/**
 * One task's sessions on one clock. Pure.
 *
 * @param {Object} input
 * @param {Array<Object>} input.sessions  the own read's `workerSessions` (lib/cost-read.js), one per lineage
 * @param {Array<Object>|null} [input.foundedElsewhere]  the read's founded-elsewhere rows (`countedUnder`, `taggedItemIds`)
 * @param {{marks: Array<Object>, untimed: boolean}} [input.merges]  `mergeMarksOf`'s result
 * @param {Iterable<string>} [input.openItemIds]  the page model's open session ids (`loopId`, `isOpenState`)
 * @param {Date|number|string} input.now
 * @param {number|null} [input.totalUsd]  the own read's total (null: not complete)
 * @param {number} [input.pricedUsd]  the own read's fully priced part
 * @param {boolean} [input.lineagesTruncated]  part 1's coarse cap flag
 * @returns {{spend: boolean, lanes: Array<Object>, scale: Object|null, marks: Object, totals: Object}}
 */
export function taskTimeline({ sessions = [], foundedElsewhere = null, merges = { marks: [], untimed: false }, openItemIds = [], now, totalUsd = null, pricedUsd = 0, lineagesTruncated = false } = {}) {
  const nowMs = toEpochMs(now instanceof Date ? now : now ?? Date.now()) ?? Date.now();
  const open = new Set([...(openItemIds || [])].filter(id => id !== null && id !== undefined).map(String));
  const ownSessions = Array.isArray(sessions) ? sessions : [];
  const foreignSessions = Array.isArray(foundedElsewhere) ? foundedElsewhere : [];

  // 1. Each lane's rows and times, before the clock.
  const drafts = [];
  for (const [session, foreign] of [...ownSessions.map(s => [s, false]), ...foreignSessions.map(s => [s, true])]) {
    const known = Array.isArray(session.dispatches);
    const tagged = foreign ? new Set((session.taggedItemIds || []).map(String)) : null;
    const rows = known ? session.dispatches.map(dispatchRowOf).filter(row => !foreign || tagged.has(String(row.itemId))) : [];
    const ids = foreign ? [...tagged] : [session.rootItemId, ...rows.map(row => row.itemId)];
    const running = ids.some(id => id !== null && id !== undefined && open.has(String(id)));
    const times = laneTimesOf(session, rows, { foreign, running, nowMs });
    if (!times) continue;
    drafts.push({ session, foreign, known, rows, running, times });
  }

  // 2. The clock: own lanes' spans, foreign lanes' tagged activity only (never the founder's history), merge marks.
  const markMs = (merges.marks || []).map(mark => toEpochMs(mark.at)).filter(ms => ms !== null);
  const clockPoints = [...markMs];
  for (const draft of drafts) {
    if (draft.foreign && !(draft.known && draft.rows.length)) continue;
    clockPoints.push(draft.times.start, draft.times.end);
  }
  // Only snapshot foreign lanes and no own lane: their spans are all there is to draw.
  if (clockPoints.length === 0) for (const draft of drafts) clockPoints.push(draft.times.start, draft.times.end);
  const totals = {
    totalUsd: totalUsd ?? null,
    pricedUsd: Number.isFinite(pricedUsd) ? pricedUsd : 0,
    complete: totalUsd !== null && totalUsd !== undefined,
    lineagesTruncated: !!lineagesTruncated,
    lanes: drafts.filter(d => !d.foreign).length,
    foreignLanes: drafts.filter(d => d.foreign).length,
  };
  if (clockPoints.length === 0) {
    return { spend: true, lanes: [], scale: null, marks: { merges: [], untimedMerge: !!merges.untimed }, totals };
  }
  const clockStart = Math.min(...clockPoints);
  const clockEnd = Math.max(...clockPoints, clockStart + MIN_CLOCK_MS);

  // Foreign lanes are clipped to this task's clock.
  for (const draft of drafts) {
    if (!draft.foreign) continue;
    const { lineageStart, lineageEnd } = draft.times;
    const from = draft.known && draft.rows.length ? Math.min(draft.times.start, lineageStart ?? draft.times.start) : (lineageStart ?? draft.times.start);
    const to = draft.known && draft.rows.length ? Math.max(draft.times.end, lineageEnd ?? draft.times.end) : (lineageEnd ?? draft.times.end);
    draft.line = { from: Math.max(from, clockStart), to: Math.min(to, clockEnd) };
    if (draft.line.to < draft.line.from) draft.line = { from: Math.min(Math.max(from, clockStart), clockEnd), to: Math.min(Math.max(from, clockStart), clockEnd) };
    draft.clipped = { start: from < clockStart, end: to > clockEnd };
  }

  // 3. Breaks: stretches with no work, no tick, no lane edge and no merge. Held lines do not count as work, so a
  // two-day wait folds even while a held line crosses it; an unknown-times span counts as covered.
  const intervals = markMs.map(ms => [ms, ms]);
  for (const draft of drafts) {
    if (!draft.foreign) {
      intervals.push([draft.times.start, draft.times.start], [draft.times.end, draft.times.end]);
      if (!draft.known) intervals.push([draft.times.start, draft.times.end]);
    } else if (!(draft.known && draft.rows.length)) {
      intervals.push([draft.line.from, draft.line.to]);
    }
    for (const row of draft.rows) {
      const at = toEpochMs(row.dispatchedAt);
      if (at !== null) intervals.push([at, at]);
      const first = toEpochMs(row.firstRequestAt);
      const last = toEpochMs(row.lastRequestAt);
      if (first !== null && last !== null) intervals.push([first, last]);
    }
    if (draft.running) intervals.push([nowMs, nowMs]);
  }
  const clamp = (ms) => Math.min(Math.max(ms, clockStart), clockEnd);
  const regions = coveredRegions([[clockStart, clockStart], [clockEnd, clockEnd], ...intervals.map(([a, b]) => [clamp(a), clamp(b)])]);
  const folded = foldedGaps(regions, clockEnd - clockStart);
  const pieces = scaleOf(clockStart, clockEnd, folded);

  // 4. Lanes, ordered by start (foreign lanes by their first tagged dispatch).
  drafts.sort((a, b) => (a.foreign ? a.line.from : a.times.start) - (b.foreign ? b.line.from : b.times.start) || (a.foreign - b.foreign));
  const lanes = drafts.map(({ session, foreign, known, rows, running, times, line, clipped }) => {
    const span = foreign ? line : { from: times.start, to: times.end };
    const segments = [];
    const ticks = [];
    for (const row of rows) {
      const first = toEpochMs(row.firstRequestAt);
      const last = toEpochMs(row.lastRequestAt);
      const at = toEpochMs(row.dispatchedAt);
      if (first !== null && last !== null) {
        segments.push({ itemId: row.itemId, kind: row.kind, role: row.role, fromAt: row.firstRequestAt, toAt: row.lastRequestAt, ...placeOf(pieces, first, last, MIN_SEGMENT_PCT) });
      }
      const noRecords = first === null;
      if ((row.role === 'wake' || row.role === 'resumed' || noRecords) && at !== null) {
        ticks.push({ itemId: row.itemId, kind: row.kind, role: row.role, noRecords, at: row.dispatchedAt, leftPct: round(pctOf(pieces, at)) });
      }
    }
    const workedMs = known ? rows.reduce((sum, row) => sum + (row.workedMs ?? 0), 0) : null;
    const state = running ? 'running' : times.endRecorded ? 'ended' : 'end-not-recorded';
    return {
      id: session.rootItemId ?? null,
      kind: session.kind || 'custom',
      role: lineageRoleOf({ baseKind: session.kind, dispatches: known ? session.dispatches : null }),
      model: session.model ?? null,
      costUsd: session.costUsd ?? null,
      incomplete: session.incomplete === true,
      telemetry: session.telemetry !== false,
      countedUnder: foreign ? (session.countedUnder ?? null) : null,
      state,
      times: known ? 'known' : 'unknown',
      startAt: isoOf(times.start),
      endAt: isoOf(times.end),
      // A foreign lane's elapsed is the founder lineage's (its line continues outside this task); worked is this task's dispatches.
      elapsedMs: foreign
        ? (times.lineageStart !== null && times.lineageEnd !== null ? Math.max(0, times.lineageEnd - times.lineageStart) : null)
        : Math.max(0, times.end - times.start),
      workedMs,
      span: placeOf(pieces, span.from, span.to),
      clipped: foreign ? clipped : { start: false, end: false },
      segments,
      ticks,
      dispatches: known ? rows : null,
    };
  });

  const scale = {
    startAt: isoOf(clockStart),
    endAt: isoOf(clockEnd),
    breaks: pieces.filter(piece => piece.type === 'break').map(piece => ({
      fromAt: isoOf(piece.from), toAt: isoOf(piece.to), leftPct: round(piece.leftPct), widthPct: round(piece.widthPct), words: gapWords(piece.to - piece.from),
    })),
    nowPct: drafts.some(d => d.running) ? round(pctOf(pieces, nowMs)) : null,
  };
  const marks = {
    merges: (merges.marks || []).map(mark => ({ prUrl: mark.prUrl ?? null, at: mark.at, leftPct: round(pctOf(pieces, toEpochMs(mark.at))) })),
    untimedMerge: !!merges.untimed,
  };
  return { spend: true, lanes, scale, marks, totals };
}

/**
 * The timeline without a dollar anywhere: a deep COPY with every cost field removed and `spend: false`, so the renderer
 * writes no cost words at all. Never mutates its input (a cached page model's timeline). Null stays null.
 *
 * @param {Object|null} timeline
 * @returns {Object|null}
 */
export function withoutSpend(timeline) {
  if (!timeline || typeof timeline !== 'object') return timeline ?? null;
  const copy = structuredClone(timeline);
  copy.spend = false;
  for (const lane of Array.isArray(copy.lanes) ? copy.lanes : []) {
    delete lane.costUsd;
    for (const row of Array.isArray(lane.dispatches) ? lane.dispatches : []) delete row.costUsd;
  }
  if (copy.totals) {
    delete copy.totals.totalUsd;
    delete copy.totals.pricedUsd;
  }
  return copy;
}

/**
 * The timeline reader: the task's own whole-life cost read with the founded-elsewhere opt-in (no Harbour-call
 * summary: they are not sessions), the merge marks, and `taskTimeline`.
 *
 * @param {Object} deps
 * @param {Object} deps.dispatchQueueStore
 * @param {Object} deps.requestUsageLoader
 * @param {Object|null} [deps.closeOutEventsStore]  read with `listForIssue` only, and only when the caller hands no events in
 * @param {Function} [deps.readTaskCost]  test seam (lib/task-cost-read.js)
 * @param {Function} [deps.now]
 * @returns {(args: {urlKey: string, identifier: string, openItemIds?: Iterable<string>, closeOutEvents?: Array<Object>|null, pr?: Object|null}) => Promise<Object>}
 */
export function createTaskTimelineReader({ dispatchQueueStore, requestUsageLoader, closeOutEventsStore = null, readTaskCost = realReadTaskCost, now = () => new Date() } = {}) {
  return async function readTaskTimeline({ urlKey, identifier, openItemIds = [], closeOutEvents = null, pr = null } = {}) {
    const [read, events] = await Promise.all([
      readTaskCost({ dispatchQueueStore, requestUsageLoader }, { urlKey, identifier, foundedElsewhere: true, caller: 'readTaskTimeline' }),
      // The page load hands in the events its merged-by read already holds; otherwise read them once here.
      Array.isArray(closeOutEvents) ? closeOutEvents
        : closeOutEventsStore ? closeOutEventsStore.listForIssue({ urlKey, issueIdentifier: identifier }).catch(() => []) : [],
    ]);
    return taskTimeline({
      sessions: read.workerSessions,
      foundedElsewhere: read.foundedElsewhere || [],
      merges: mergeMarksOf({ events, pr }),
      openItemIds,
      now: now(),
      totalUsd: read.totalUsd,
      pricedUsd: read.pricedUsd,
      lineagesTruncated: read.lineagesTruncated,
    });
  };
}

/** The open session ids of a page model (`loopId` of each `isOpenState` session). */
export function openItemIdsOf(model) {
  return (model && Array.isArray(model.sessions) ? model.sessions : []).filter(s => s && s.open).map(s => s.loopId).filter(Boolean);
}

/**
 * The fragment reader both fragment routes share (`GET …/api/task/:identifier/timeline` and `GET /t/:token/timeline`):
 * the open ids from the stored-facts state read (`loadTaskState`, no tracker and no GitHub call), then the timeline.
 * Single-flight and cached for `ttlMs` per task, so concurrent tabs share one read; failures are never cached. The
 * cached value carries spend: a guest route strips it with `withoutSpend`, which copies.
 *
 * @param {Object} deps
 * @param {Function} deps.loadTaskState  the loader's stored-facts read
 * @param {Function} deps.readTaskTimeline  `createTaskTimelineReader(...)`
 * @param {number} [deps.ttlMs=TIMELINE_CACHE_MS]
 * @param {Function} [deps.now]
 * @returns {{read: (args: {urlKey: string, identifier: string, issueId?: string|null}) => Promise<Object>, clear: Function, countFor: Function}}
 */
export function createTimelineFragmentReader({ loadTaskState, readTaskTimeline, ttlMs = TIMELINE_CACHE_MS, now = () => new Date() } = {}) {
  if (typeof loadTaskState !== 'function' || typeof readTaskTimeline !== 'function') {
    throw new TypeError('createTimelineFragmentReader: loadTaskState and readTaskTimeline are required');
  }
  const cache = new Map();
  const inflight = new Map();
  // A per-key epoch: `clear` bumps it, so a read already in flight for that key does not refill the cleared cache.
  const epochs = new Map();
  const keyOf = (urlKey, identifier) => `${urlKey}\u0000${identifier}`;
  const ownedBy = (key, urlKey) => key.startsWith(`${urlKey}\u0000`);
  const sweep = (at) => {
    for (const [key, hit] of cache) if (at - hit.at >= ttlMs) cache.delete(key);
  };
  function read({ urlKey, identifier, issueId = null }) {
    const key = keyOf(urlKey, identifier);
    const at = now().getTime();
    const hit = cache.get(key);
    if (hit && at - hit.at < ttlMs) return Promise.resolve(hit.timeline);
    const pending = inflight.get(key);
    if (pending) return pending;
    const epoch = epochs.get(urlKey) || 0;
    const promise = Promise.resolve()
      .then(() => loadTaskState({ urlKey, identifier, issueId }))
      .then(state => readTaskTimeline({ urlKey, identifier, openItemIds: openItemIdsOf(state && state.model) }))
      .then((timeline) => {
        sweep(now().getTime());
        if ((epochs.get(urlKey) || 0) === epoch) cache.set(key, { at: now().getTime(), timeline });
        return timeline;
      })
      .finally(() => { if (inflight.get(key) === promise) inflight.delete(key); });
    inflight.set(key, promise);
    return promise;
  }
  /** Forget every cached timeline of a workspace key (the per-key reset, lib/key-state-holders.js). */
  function clear({ urlKey }) {
    epochs.set(urlKey, (epochs.get(urlKey) || 0) + 1);
    for (const key of [...cache.keys()]) if (ownedBy(key, urlKey)) cache.delete(key);
    for (const key of [...inflight.keys()]) if (ownedBy(key, urlKey)) inflight.delete(key);
  }
  /** How many timelines are cached for a workspace key (the reset's probe). */
  function countFor({ urlKey }) {
    let count = 0;
    for (const key of cache.keys()) if (ownedBy(key, urlKey)) count += 1;
    return count;
  }
  return { read, clear, countFor };
}
