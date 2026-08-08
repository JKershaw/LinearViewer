/**
 * lib/live-console.js
 *
 * Pure data layer for the Live Console (LIN-1436) — an ambient, generation-free
 * view you leave running to watch the whole swarm work.
 *
 * Two read-only inputs, both already flowing through the system:
 *   - agent-status entries → the discrete step STREAM (research / implementation
 *     / review / close-out, each with a one-line summary).
 *   - lean dispatch loops   → the currently-working LANES, each carrying its
 *     latest HEARTBEAT (`telemetry.metrics[]` — parsed `[working] N tools/Xs`
 *     beats), plus `[evidence]` artifacts (`telemetry.producedArtifacts[]`) which
 *     become linked stream events. Heartbeat timestamps also feed the tempo
 *     sparkline, so the "rhythm" reflects real activity between discrete steps.
 *
 * Output shapes the client renders:
 *   - events  : normalized, newest-first, paginated stream (status + evidence)
 *   - lanes   : working agents (loop-based w/ heartbeat; status-only fallback)
 *   - tempo   : activity-rate buckets for the sparkline (incl. heartbeats)
 *   - summary : fleet totals (active / done / failed / blocked / total)
 *   - hasMore / oldestTs : cursor for "view more" pagination into history
 *
 * Everything is tolerant (never throws on malformed input) and deterministic
 * (`now` injected, never read from the clock) — same discipline as
 * lib/session-telemetry.js.
 */

import { resolveCredentialState } from './credential-state.js';
import { TIMELINE_BAR_MIN_WIDTH_PCT } from './timeline-zoom.js';

/** Max length of a rendered event/lane summary. */
export const SUMMARY_MAX = 240;

/** Default events-per-page (the live view's initial page + each "view more"). */
export const DEFAULT_PAGE_SIZE = 60;

/** Default sparkline window: 20 buckets of 1 minute each (last 20 minutes). */
export const DEFAULT_TEMPO_BUCKET_MS = 60 * 1000;
export const DEFAULT_TEMPO_BUCKETS = 20;

/**
 * Flowing-strip "pulse": heartbeat-only density in fine buckets over a short
 * window, used by the client's scrolling activity strip as the ambient "hum"
 * beneath the discrete event blips. Separate from `tempo` (which mixes events +
 * heartbeats) so the strip can render the two signals as distinct layers.
 */
export const DEFAULT_PULSE_WINDOW_MS = 3 * 60 * 1000; // 3 min across the strip
export const DEFAULT_PULSE_BUCKET_MS = 5 * 1000;      // 5s resolution

/**
 * A working lane with no activity within this window is treated as stale and
 * dropped — closing the "session stuck 'running' forever" gap so the live feed
 * only shows what's genuinely moving. Activity = the most recent of the loop's
 * dispatch time, agent-status decoration, or latest heartbeat (or, for a
 * status-only lane, its latest working event).
 */
export const DEFAULT_LANE_STALE_MS = 60 * 60 * 1000; // 1h

/**
 * The timeline panel windows to the last 24h — a narrowing this transform adds
 * on top of the loop read's 30-day lookback (`LOOKBACK_MS`,
 * lib/pipeline-loops.js). Omitting this clamp would ship 30 days of bars.
 */
export const TIMELINE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

/** LIN-1494 disclose-don't-drop: cap the timeline payload at the most-recent N runs. */
export const TIMELINE_RUN_CAP = 500;

/**
 * Minimum time separation between two group-rows sharing a display row
 * (LIN-1908 Phase A) — the worst-case (fully-zoomed-out, 24h-window) on-screen
 * footprint of a `TIMELINE_BAR_MIN_WIDTH_PCT`-floored sliver (~8.6 min).
 * Expressed in TIME, not pixels, so two runs sharing a row can never visually
 * merge at ANY zoom and row assignment stays server-side, pure, and
 * independent of the client's current view window (over-buffering when
 * zoomed in is an accepted trade-off — see the design comment on LIN-1908).
 */
export const TIMELINE_ROW_BUFFER_MS = (TIMELINE_BAR_MIN_WIDTH_PCT / 100) * TIMELINE_WINDOW_MS;

/**
 * Map a raw agent-status `status` string onto the console's coarse event kind.
 * Tolerant of casing, punctuation, and common synonyms; anything unrecognised
 * is a neutral `info` event rather than a dropped one.
 *
 * @param {string} status
 * @returns {'done'|'working'|'blocked'|'failed'|'info'}
 */
export function statusToKind(status) {
  const s = String(status || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (s === 'completed' || s === 'complete' || s === 'done' || s === 'success' || s === 'succeeded') return 'done';
  if (s === 'in-progress' || s === 'working' || s === 'started' || s === 'running') return 'working';
  if (s === 'blocked' || s === 'pending' || s === 'waiting') return 'blocked';
  if (s === 'failed' || s === 'failure' || s === 'error' || s === 'aborted' || s === 'cancelled' || s === 'canceled') return 'failed';
  return 'info';
}

function _epoch(value) {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Normalize one workspace-tagged agent-status entry into a console event.
 * Returns null when the entry is unusable (no parseable timestamp).
 *
 * @param {Object} item - a listStatus item with { workspaceUrlKey, workspaceName } folded in
 * @returns {Object|null}
 */
export function normalizeStatusEvent(item) {
  if (!item || typeof item !== 'object') return null;
  const ts = _epoch(item.timestamp);
  if (ts == null) return null;
  return {
    id: item.id != null ? String(item.id) : `${item.workspaceUrlKey || '?'}:${item.taskIdentifier || '?'}:${ts}`,
    kind: statusToKind(item.status),
    ts,
    iso: new Date(ts).toISOString(),
    workspaceUrlKey: item.workspaceUrlKey || null,
    workspaceName: item.workspaceName || item.workspaceUrlKey || null,
    task: item.taskIdentifier || null,
    action: item.action || null,
    status: item.status || null,
    summary: String(item.summary || '').slice(0, SUMMARY_MAX),
    url: null,
  };
}

/**
 * Turn each loop's `[evidence]` produced artifacts into linked evidence events —
 * the "something real landed" moments (PRs, commits, screenshots). Deduped per
 * loop by url/label. Skips artifacts with no resolvable timestamp.
 *
 * @param {Array<Object>} loops - lean loops with { telemetry.producedArtifacts[], workspaceUrlKey, ... }
 * @returns {Array<Object>}
 */
export function normalizeEvidenceEvents(loops) {
  if (!Array.isArray(loops)) return [];
  const out = [];
  const seen = new Set();
  for (const lp of loops) {
    const arts = lp && lp.telemetry && Array.isArray(lp.telemetry.producedArtifacts) ? lp.telemetry.producedArtifacts : null;
    if (!arts) continue;
    for (const a of arts) {
      const ts = _epoch(a && a.timestamp) ?? _epoch(lp.agentTimestamp) ?? _epoch(lp.dispatchedAt);
      if (ts == null) continue;
      const url = a && a.url ? String(a.url) : '';
      const key = `${lp.loopId || '?'}:${url || (a && a.label) || ts}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: `ev:${key}`,
        kind: 'evidence',
        ts,
        iso: new Date(ts).toISOString(),
        workspaceUrlKey: lp.workspaceUrlKey || null,
        workspaceName: lp.workspaceName || lp.workspaceUrlKey || null,
        task: lp.issueIdentifier || null,
        action: 'evidence',
        status: null,
        summary: String((a && a.label) || url || 'produced an artifact').slice(0, SUMMARY_MAX),
        url: url || null,
      });
    }
  }
  return out;
}

/**
 * Whether a loop is a currently-working agent (a "lane"). Running only — a
 * terminal marker or a done/error/queued/waiting state disqualifies it.
 *
 * @param {Object} loop
 * @returns {boolean}
 */
export function isLoopActive(loop) {
  if (!loop || typeof loop !== 'object') return false;
  if (loop.terminalStatus) return false; // build-time terminal fact wins over a stale agentState
  return loop.agentState === 'running';
}

/**
 * The most recent activity timestamp for a loop: the latest of its dispatch
 * time, agent-status decoration, latest heartbeat, or lineage heartbeat
 * (LIN-1477). Epoch ms, or 0 when the loop carries none of those signals.
 *
 * @param {Object} loop
 * @returns {number}
 */
export function loopLastActivityMs(loop) {
  const dispatchedMs = _epoch(loop && loop.dispatchedAt);
  const agentMs = _epoch(loop && loop.agentTimestamp);
  const beats = loop && loop.telemetry && Array.isArray(loop.telemetry.metrics) ? loop.telemetry.metrics : [];
  const lastBeatMs = beats.length ? _epoch(beats[beats.length - 1] && beats[beats.length - 1].timestamp) : null;
  const lineageMs = Number.isFinite(loop && loop.lineageLastActivityMs) ? loop.lineageLastActivityMs : null;
  return Math.max(dispatchedMs || 0, agentMs || 0, lastBeatMs || 0, lineageMs || 0);
}

/**
 * Whether a loop is active AND has moved within `staleMs` — `isLoopActive`
 * alone has no time component, so a session stuck 'running' forever would
 * otherwise read as fresh indefinitely.
 *
 * @param {Object} loop
 * @param {number} now - epoch ms
 * @param {number} staleMs
 * @returns {boolean}
 */
export const isFreshlyActive = (loop, now, staleMs) =>
  isLoopActive(loop) && (now - loopLastActivityMs(loop)) <= staleMs;

/**
 * The latest heartbeat metric for a loop (the live tick), or null.
 *
 * @param {Object} loop
 * @returns {{toolCount: number|null, elapsedSeconds: number|null, breakdown: Object|null, total: number|null, state: ('running'|'idle'|null)}|null}
 */
export function latestHeartbeat(loop) {
  const ms = loop && loop.telemetry && Array.isArray(loop.telemetry.metrics) ? loop.telemetry.metrics : null;
  if (!ms || !ms.length) return null;
  const m = ms[ms.length - 1];
  if (!m) return null;
  return {
    toolCount: m.toolCount != null ? m.toolCount : null,
    elapsedSeconds: m.elapsedSeconds != null ? m.elapsedSeconds : null,
    breakdown: m.breakdown || null,
    total: m.total != null ? m.total : null,
    state: m.state || null,
  };
}

/**
 * Working lanes derived from running loops, each carrying its latest heartbeat.
 * Sorted most-recently-active first.
 *
 * LIN-1588: each lane also carries its session's `credential` state, resolved
 * from an INJECTED `tokenId → verdict` index. The verdict itself is Beat 1's
 * (`lib/proxy-events.js`), computed by the route — this module stays pure,
 * network-free and `now`-injected, so no store read happens here.
 *
 * @param {Array<Object>} loops
 * @param {Object} [opts]
 * @param {Object<string, string>} [opts.credentialByToken={}] - tokenId → verdict
 * @returns {Array<Object>}
 */
export function deriveLoopLanes(loops, { credentialByToken = {} } = {}) {
  if (!Array.isArray(loops)) return [];
  const lanes = [];
  for (const lp of loops) {
    if (!isLoopActive(lp) || !lp.issueIdentifier) continue;
    const dispatchedMs = _epoch(lp.dispatchedAt);
    const agentMs = _epoch(lp.agentTimestamp);
    // LIN-1477: loopLastActivityMs folds in the lineage heartbeat
    // (lib/pipeline-loops.js) so a lane survives the 1h staleness filter below
    // while its lineage is beating on a follow-up run, even if THIS loop's own
    // last beat predates that. Additive max, never a replacement for the
    // loop's own activity signals.
    const lastActivityMs = loopLastActivityMs(lp);
    lanes.push({
      workspaceUrlKey: lp.workspaceUrlKey || null,
      workspaceName: lp.workspaceName || lp.workspaceUrlKey || null,
      task: lp.issueIdentifier,
      action: lp.agentAction || lp.stage || 'working',
      summary: String(lp.agentSummary || '').slice(0, SUMMARY_MAX),
      sinceMs: dispatchedMs ?? agentMs ?? 0,
      lastActivityMs,
      heartbeat: latestHeartbeat(lp),
      // LIN-1588: `label` is DISPLAY ONLY. Labels are shared across concurrent
      // sessions (every dispatch mints `dispatch-bootstrap`) and historical rows
      // keep `'exchanged'`, so it must never key, group or match anything — the
      // lane key stays `${workspaceUrlKey}::${task}`, untouched.
      credential: {
        state: resolveCredentialState(lp.agentTokenId, credentialByToken),
        label: lp.agentTokenLabel || null,
      },
    });
  }
  lanes.sort((a, b) => b.sinceMs - a.sinceMs);
  return lanes;
}

/**
 * Working lanes from the agent-status stream: one per workspace+task whose MOST
 * RECENT event is a `working` one. The fallback for a working task with no live
 * loop (e.g. older data). Sorted most-recently-active first.
 *
 * @param {Array<Object>} events - normalized status events (any order)
 * @returns {Array<Object>}
 */
export function deriveLanes(events) {
  const latestByKey = new Map();
  for (const ev of events) {
    if (!ev || !ev.task) continue;
    const key = `${ev.workspaceUrlKey}::${ev.task}`;
    const prev = latestByKey.get(key);
    if (!prev || ev.ts > prev.ts) latestByKey.set(key, ev);
  }
  const lanes = [];
  for (const ev of latestByKey.values()) {
    if (ev.kind !== 'working') continue;
    lanes.push({
      workspaceUrlKey: ev.workspaceUrlKey,
      workspaceName: ev.workspaceName,
      task: ev.task,
      action: ev.action,
      summary: ev.summary,
      sinceMs: ev.ts,
    });
  }
  lanes.sort((a, b) => b.sinceMs - a.sinceMs);
  return lanes;
}

/**
 * Merge loop-based lanes (rich, with heartbeats) with status-based lanes,
 * loop wins on a shared workspace+task key. Sorted most-recently-active first.
 */
function mergeLanes(loopLanes, statusLanes) {
  const byKey = new Map();
  for (const l of loopLanes) byKey.set(`${l.workspaceUrlKey}::${l.task}`, l);
  for (const l of statusLanes) {
    const key = `${l.workspaceUrlKey}::${l.task}`;
    if (!byKey.has(key)) byKey.set(key, l);
  }
  return Array.from(byKey.values()).sort((a, b) => b.sinceMs - a.sinceMs);
}

/**
 * Derive the swimlane-timeline's flat run list from the same loops the feed
 * already loads — the last 24h of dispatch runs, as bars a client can lay out
 * on a time axis. Read-only, no new store/query (LIN-1436's ambient-view
 * discipline extends here).
 *
 * Each run's own [`start`, `end`] window decides inclusion — NOT merely
 * `dispatchedAt` within the window — so a still-running (or stale-running) row
 * whose dispatch predates the window by hours still surfaces as long as its
 * activity does. `staleMs` is the SAME knob the caller uses to drop stale
 * lanes (`buildConsoleFeed`'s `laneStaleMs`), so lane-dropping and timeline
 * freshness cannot drift apart into two answers for "is this still going".
 *
 * @param {Array<Object>} loops - lean loops (any state — not just active/running)
 * @param {{now: number, staleMs?: number}} opts
 * @returns {{runs: Array<Object>, truncated: boolean, totalInWindow: number}}
 */
export function buildTimeline(loops, { now, staleMs = DEFAULT_LANE_STALE_MS } = {}) {
  if (!Array.isArray(loops) || !now) return { runs: [], truncated: false, totalInWindow: 0 };
  const windowStart = now - TIMELINE_WINDOW_MS;
  const runs = [];

  for (const lp of loops) {
    if (!lp || !lp.issueIdentifier) continue;

    const terminalCompletedMs = _epoch(lp.terminalCompletedAt);
    const freshlyActive = isFreshlyActive(lp, now, staleMs);
    // Window-overlap filter (F1 + M5): a stale-running row is windowed on its
    // own last activity, NOT on `now` — otherwise `now >= now - 24h` is always
    // true and every stale row would leak into the panel regardless of age.
    const windowEndMs = terminalCompletedMs ?? (freshlyActive ? now : loopLastActivityMs(lp));
    if (windowEndMs < windowStart) continue;

    const dispatchedMs = _epoch(lp.dispatchedAt);
    // M5 — clip, never drop: dropping a run that started before the window
    // would hide exactly the "ran long" case the original feedback names.
    const clippedStart = dispatchedMs != null && dispatchedMs < windowStart;
    const start = clippedStart ? windowStart : dispatchedMs;

    // Bar end (F1): terminal completion when present; otherwise freshness
    // decides open-ended vs. stale. Never `resolvedAt`/`takenAt` — those are
    // the claim time (lib/pipeline-loops.js), so a bar ending there would end
    // where the work STARTED, not where it left off.
    let end, stillRunning;
    if (terminalCompletedMs != null) {
      end = terminalCompletedMs;
      stillRunning = false;
    } else if (freshlyActive) {
      end = null;
      stillRunning = true;
    } else {
      end = loopLastActivityMs(lp);
      stillRunning = 'unknown';
    }

    runs.push({
      id: lp.loopId,
      issueIdentifier: lp.issueIdentifier,
      kind: lp.kind || null,
      promptName: lp.promptName || null,
      outcomeKind: lp.terminalStatus ? statusToKind(lp.terminalStatus) : 'working',
      start,
      end,
      stillRunning,
      clippedStart,
      // Precedence for packTimelineRows' grouping: durable session-group id →
      // legacy session id → lineage id → the run's own loopId (singleton).
      groupKey: lp.sessionGroupId || lp.sessionId || lp.lineageId || lp.loopId,
      followUpTo: lp.followUpTo || null,
      workspaceUrlKey: lp.workspaceUrlKey || null,
    });
  }

  runs.sort((a, b) => (b.start || 0) - (a.start || 0));
  const totalInWindow = runs.length;
  const truncated = totalInWindow > TIMELINE_RUN_CAP;
  return { runs: truncated ? runs.slice(0, TIMELINE_RUN_CAP) : runs, truncated, totalInWindow };
}

/**
 * Pack a flat timeline run list into non-overlapping display rows via a
 * two-level pack (LIN-1908 Phase A — dense-row packing) — the interval-
 * scheduling problem `lib/swim-lanes.js` does NOT solve (that module lanes
 * ISSUES by dependency graph, not runs by time overlap).
 *
 * **Level 1 — intra-group pack, unchanged.** Runs are grouped by
 * `groupKeyOf(run)` (default: `run.groupKey`, itself `sessionGroupId →
 * sessionId → lineageId → singleton`, set by `buildTimeline`), then each
 * group's own runs are greedily packed into the fewest rows such that no two
 * runs in the same row overlap — an open-ended run (`end: null`, still
 * running) occupies its row through the end of the window, so nothing else
 * in that group can share the row after it. This keeps a session lineage's
 * successive runs on one row, reading as a horizontal train.
 *
 * **Level 2 — cross-group pack.** Each row produced by level 1 becomes a
 * placeable "group-row" unit (`{runs, start, end}`; `end` is `Infinity` if
 * its last-placed run is open-ended), and ALL units — from every group — are
 * first-fit into the final display rows, sorted by `start` **ascending**
 * before the pass (deliberately NOT most-recently-active-first: first-fit
 * interval packing is order-dependent, and descending-start order makes the
 * admission test below essentially never pass, turning the fix into a
 * no-op). A unit is admitted into an existing display row only when it
 * starts at least `TIMELINE_ROW_BUFFER_MS` past that row's current end — a
 * TIME-expressed buffer (not pixels), so two group-rows sharing a display
 * row can never visually merge at any zoom, and row assignment stays
 * server-side, pure, and independent of the client's current view window.
 * This is what collapses many single-run groups onto a handful of shared
 * rows instead of one row each, while a lineage's own group-row is never
 * split across display rows. Display-row order is therefore first-fit
 * creation order (ascending-start-driven), not most-recently-active-first —
 * "a row" no longer means "one session lineage", it means "a set of
 * group-rows that do not overlap in time, plus a buffer".
 *
 * A run whose `followUpTo` points at another run present in THIS list gets a
 * connector edge `{fromId, toId}` (predecessor → this run), derived
 * pre-grouping and unaffected by either packing level. A `followUpTo`
 * pointing outside the list (the predecessor aged out of the 24h window)
 * instead sets `connectorTruncated: true` on the run itself, so the client can
 * still indicate "continues from an earlier run" with no from-node to draw
 * the edge from.
 *
 * @param {Array<Object>} runs - buildTimeline's flat run list
 * @param {{groupKeyOf?: (run: Object) => string}} [opts]
 * @returns {{rows: Array<Array<Object>>, connectors: Array<{fromId: string, toId: string}>}}
 */
export function packTimelineRows(runs, { groupKeyOf = (r) => r.groupKey } = {}) {
  if (!Array.isArray(runs) || !runs.length) return { rows: [], connectors: [] };

  const byId = new Map(runs.map(r => [r.id, r]));
  const connectors = [];
  // Decorate once, up front, so every emitted run carries `connectorTruncated`
  // (never leaving it absent-when-false) without mutating the input runs.
  const decorated = runs.map(r => {
    if (r.followUpTo && byId.has(r.followUpTo)) {
      connectors.push({ fromId: r.followUpTo, toId: r.id });
      return { ...r, connectorTruncated: false };
    }
    return { ...r, connectorTruncated: !!r.followUpTo };
  });

  const groups = new Map();
  for (const r of decorated) {
    const key = groupKeyOf(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  // Level 1 — intra-group pack, unchanged: each group's own runs, greedily
  // packed into the fewest rows with no in-row overlap. Iteration order over
  // `groups` doesn't matter here — each group is packed independently, and
  // the units it produces are re-ordered by start before level 2 anyway.
  const groupRowUnits = [];
  for (const groupRuns of groups.values()) {
    const sorted = [...groupRuns].sort((a, b) => (a.start || 0) - (b.start || 0));
    const groupRows = [];
    const rowEnds = []; // parallel to groupRows: each row's last-placed run end (Infinity = open-ended)
    for (const run of sorted) {
      const runEnd = run.end == null ? Infinity : run.end;
      let placed = false;
      for (let i = 0; i < groupRows.length; i++) {
        if ((run.start || 0) >= rowEnds[i]) {
          groupRows[i].push(run);
          rowEnds[i] = runEnd;
          placed = true;
          break;
        }
      }
      if (!placed) {
        groupRows.push([run]);
        rowEnds.push(runEnd);
      }
    }
    for (let i = 0; i < groupRows.length; i++) {
      groupRowUnits.push({ runs: groupRows[i], start: groupRows[i][0].start || 0, end: rowEnds[i] });
    }
  }

  // Level 2 — cross-group pack: first-fit every group-row unit, from every
  // group, into shared display rows, sorted ascending by start.
  groupRowUnits.sort((a, b) => a.start - b.start);
  const rows = [];
  const displayRowEnds = []; // parallel to rows: each display row's current end (Infinity = open-ended)
  for (const unit of groupRowUnits) {
    let placed = false;
    for (let i = 0; i < rows.length; i++) {
      if (unit.start >= displayRowEnds[i] + TIMELINE_ROW_BUFFER_MS) {
        rows[i].push(...unit.runs);
        displayRowEnds[i] = unit.end;
        placed = true;
        break;
      }
    }
    if (!placed) {
      rows.push([...unit.runs]);
      displayRowEnds.push(unit.end);
    }
  }

  return { rows, connectors };
}

/**
 * Event-arrival counts bucketed over the recent window, oldest→newest, for the
 * tempo sparkline. Bucket boundaries are upper-inclusive: an event exactly on a
 * boundary falls into the older adjacent bucket (a one-bar cosmetic shift at
 * exact-millisecond timestamps only). `ev.ts === now` lands in the newest
 * bucket; events at/older than the window start, or in the future, are ignored.
 *
 * @param {Array<{ts:number}>} ticks - anything with a numeric `ts` (events + heartbeats)
 * @param {{now: number, bucketMs?: number, buckets?: number}} opts
 * @returns {number[]} length === buckets
 */
export function bucketTempo(ticks, { now, bucketMs = DEFAULT_TEMPO_BUCKET_MS, buckets = DEFAULT_TEMPO_BUCKETS } = {}) {
  const out = new Array(buckets).fill(0);
  const windowStart = now - buckets * bucketMs;
  for (const t of ticks) {
    if (!t || t.ts <= windowStart || t.ts > now) continue;
    let idx = buckets - 1 - Math.floor((now - t.ts) / bucketMs);
    if (idx < 0) idx = 0;
    if (idx > buckets - 1) idx = buckets - 1;
    out[idx] += 1;
  }
  return out;
}

/**
 * Heartbeat-only density over a short, fine-grained window for the flowing
 * activity strip. Returns absolute-time anchors ({ endTs, bucketMs }) so the
 * client can map each bucket to an x-position and scroll it in real time.
 * Heartbeats only — discrete events are drawn as blips from `events`.
 *
 * Alongside the beat-count `buckets[]` (unchanged: `+= 1` per beat, the raw
 * data-rate signal), `load[]` accumulates each beat's own magnitude — `total`
 * falling back to `toolCount` — so the client can render how much work a beat
 * represents, not just that one landed. Same length/anchors as `buckets[]`,
 * purely additive: no existing consumer of `buckets[]` is affected.
 *
 * @param {Array<Object>} loops - lean loops with telemetry.metrics[]
 * @param {{now: number, windowMs?: number, bucketMs?: number}} opts
 * @returns {{bucketMs: number, endTs: number, buckets: number[], load: number[]}}
 */
export function buildPulse(loops, { now, windowMs = DEFAULT_PULSE_WINDOW_MS, bucketMs = DEFAULT_PULSE_BUCKET_MS } = {}) {
  const count = Math.max(1, Math.round(windowMs / bucketMs));
  const buckets = new Array(count).fill(0);
  const load = new Array(count).fill(0);
  const start = now - count * bucketMs;
  for (const lp of Array.isArray(loops) ? loops : []) {
    const ms = lp && lp.telemetry && Array.isArray(lp.telemetry.metrics) ? lp.telemetry.metrics : null;
    if (!ms) continue;
    for (const m of ms) {
      const t = _epoch(m && m.timestamp);
      if (t == null || t <= start || t > now) continue;
      let idx = count - 1 - Math.floor((now - t) / bucketMs);
      if (idx < 0) idx = 0;
      if (idx > count - 1) idx = count - 1;
      buckets[idx] += 1;
      const magnitude = m && m.toolCount != null ? m.toolCount : (m && m.total != null ? m.total : 0);
      load[idx] += magnitude;
    }
  }
  return { bucketMs, endTs: now, buckets, load };
}

/**
 * Slice a newest-first event list into a page, optionally starting strictly
 * older than a `before` cursor (the previous page's oldest ts). Powers the
 * "view more" affordance.
 *
 * @param {Array<Object>} events - newest-first
 * @param {{before?: number|null, pageSize?: number}} opts
 * @returns {{page: Array<Object>, hasMore: boolean, oldestTs: number|null}}
 */
export function pageEvents(events, { before = null, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const pool = before != null ? events.filter(e => e.ts < before) : events;
  const page = pool.slice(0, pageSize);
  const hasMore = pool.length > page.length;
  const oldestTs = page.length ? page[page.length - 1].ts : null;
  return { page, hasMore, oldestTs };
}

/**
 * Build the whole console feed. Pure and tolerant.
 *
 * @param {Array<Object>|{statusItems: Array<Object>, loops: Array<Object>}} input
 *   Either a bare status-item array (back-compat; no loops) or `{ statusItems, loops }`.
 * @param {Object} [opts]
 * @param {number} opts.now - epoch ms "now" (required for a meaningful tempo)
 * @param {number} [opts.pageSize=DEFAULT_PAGE_SIZE] - events per page (alias: maxEvents)
 * @param {number|null} [opts.before=null] - cursor: only events strictly older than this
 * @param {number} [opts.tempoBucketMs]
 * @param {number} [opts.tempoBuckets]
 * @param {boolean} [opts.sourceHasMore=false] - LIN-1494: the caller's stores
 *   truncated their reads (per-workspace row cap), so older rows exist beyond
 *   the pool this feed was built from. ORed into `hasMore` — deriving it from
 *   the already-truncated pool alone is what dead-ended "view earlier
 *   activity" while older events still existed. Only honest when the caller's
 *   cursor can genuinely advance past the cap (the store's `until` pushdown);
 *   without that, hasMore=true loops on empty pages.
 * @param {number|null} [opts.sourceTotal=null] - LIN-1494: the stores' exact
 *   pre-slice status-entry count (Σ per-workspace `total`). When supplied,
 *   `summary.total` = sourceTotal + the evidence events materialised here;
 *   omitted, it falls back to the pool length (back-compat, incl. the
 *   bare-array input form).
 * @param {Object<string, string>} [opts.credentialByToken={}] - LIN-1588: the
 *   route-resolved `tokenId → verdict` index (Beat 1's verdict, read at the
 *   route). Omitted, every loop lane resolves to `unknown` — never a false `ok`
 *   — and the rest of the feed is byte-unchanged.
 * @returns {{events, lanes, tempo, summary, hasMore, oldestTs}}
 */
export function buildConsoleFeed(input, opts = {}) {
  const {
    now = 0,
    before = null,
    tempoBucketMs = DEFAULT_TEMPO_BUCKET_MS,
    tempoBuckets = DEFAULT_TEMPO_BUCKETS,
    laneStaleMs = DEFAULT_LANE_STALE_MS,
    sourceHasMore = false,
    sourceTotal = null,
    credentialByToken = {},
  } = opts;
  const pageSize = opts.pageSize != null ? opts.pageSize : (opts.maxEvents != null ? opts.maxEvents : DEFAULT_PAGE_SIZE);

  let statusItems = [];
  let loops = [];
  if (Array.isArray(input)) {
    statusItems = input;
  } else if (input && typeof input === 'object') {
    statusItems = Array.isArray(input.statusItems) ? input.statusItems : [];
    loops = Array.isArray(input.loops) ? input.loops : [];
  }

  const statusEvents = statusItems.map(normalizeStatusEvent).filter(Boolean);
  const evidenceEvents = normalizeEvidenceEvents(loops);
  const allEvents = [...statusEvents, ...evidenceEvents].sort((a, b) => b.ts - a.ts);

  let lanes = mergeLanes(deriveLoopLanes(loops, { credentialByToken }), deriveLanes(statusEvents));
  // Drop stale lanes — a session stuck 'running' with no recent activity falls
  // off the feed once it crosses the staleness window (gap fix). Only applied
  // when a real `now` is supplied, so a lane's freshness can be judged.
  if (now) {
    lanes = lanes.filter(l => {
      const last = l.lastActivityMs != null ? l.lastActivityMs : l.sinceMs;
      return last != null && (now - last) <= laneStaleMs;
    });
  }

  // Tempo reflects ALL activity — discrete events AND heartbeat beats — so the
  // sparkline keeps moving during long phases between status steps.
  const ticks = allEvents.slice();
  for (const lp of loops) {
    const ms = lp && lp.telemetry && Array.isArray(lp.telemetry.metrics) ? lp.telemetry.metrics : null;
    if (!ms) continue;
    for (const m of ms) {
      const t = _epoch(m && m.timestamp);
      if (t != null) ticks.push({ ts: t });
    }
  }
  const tempo = bucketTempo(ticks, { now, bucketMs: tempoBucketMs, buckets: tempoBuckets });

  // LIN-1494 accepted + disclosed limitation: only the scalar `total` can be
  // corrected from the stores' pre-slice counts. The `done`/`failed`/`blocked`
  // kind counts, `tempo`, and `pulse` bucket shapes would need the dropped
  // rows themselves to reconstruct, so they remain pool-based (a recent-window
  // signal, not an all-time census).
  const summary = {
    active: lanes.length, done: 0, failed: 0, blocked: 0,
    total: sourceTotal != null ? sourceTotal + evidenceEvents.length : allEvents.length,
  };
  for (const ev of allEvents) {
    if (ev.kind === 'done') summary.done += 1;
    else if (ev.kind === 'failed') summary.failed += 1;
    else if (ev.kind === 'blocked') summary.blocked += 1;
  }

  const pulse = buildPulse(loops, { now });

  // Timeline: the last-24h swimlane panel's flat run list, sharing the SAME
  // staleness knob (`laneStaleMs`) as the lane-dropping filter above so the
  // two views can never disagree about "is this still going".
  const timelineRuns = buildTimeline(loops, { now, staleMs: laneStaleMs });
  const { rows: timelineRows, connectors: timelineConnectors } = packTimelineRows(timelineRuns.runs);
  const timeline = {
    rows: timelineRows,
    connectors: timelineConnectors,
    truncated: timelineRuns.truncated,
    totalInWindow: timelineRuns.totalInWindow,
  };

  const { page, hasMore, oldestTs } = pageEvents(allEvents, { before, pageSize });
  return { events: page, lanes, tempo, pulse, timeline, summary, hasMore: hasMore || sourceHasMore, oldestTs, serverNow: now };
}
