/**
 * The Observation feed routes (LIN-3742 split of routes/dashboard.js):
 *
 *   GET /workspace/:urlKey/observation                  — page shell (first-class, no flag)
 *   GET /workspace/:urlKey/api/dashboard/sessions       — sessionId-grouped feed (observation poll source; LIN-595)
 *   GET /workspace/:urlKey/api/dashboard/loops          — merged cross-workspace runs (flat poll source)
 *
 * Owns the session payload (the run projection and the session projection), the
 * cross-workspace merges, the bounded touched-task hydration and the descendant
 * recency rollup. The feed cache and the task-done cache are built by the
 * composer and arrive in `ctx`: the rulings feed and the run page read the very
 * same `sessionsFeedCache` instance this module fills.
 *
 * Performance rule (LIN-509/595): the live feed reads Loops from Mongo only — it
 * never fans buildPipelineSnapshot/fetchProjects out per poll, and never spends an
 * LLM call per poll.
 */
import { Router } from 'express';
import { keepaliveError } from '../lib/errors.js';
import { renderErrorPage } from '../lib/render-pages.js';
import { getLoopsForWorkspace, getSessionsForWorkspace } from '../lib/pipeline-loops.js';
import { isTerminalLoop, enrichLoop, sessionIsTerminal } from '../lib/run-loop-state.js';
import { armKeepalive } from '../lib/http-keepalive.js';
import { toEpochMs } from '../lib/utils/time.js';
import { requestFeatureFlags } from '../lib/run-controls.js';
import { findAnchorLoop, childLoops } from '../lib/session-summary.js';
import { STALE_AFTER_MS, WORKSPACE_FANOUT_CONCURRENCY, settleWithConcurrency, isStandaloneSession, deriveSessionStatus, deriveSessionWaiting, waitingLoops, loopActivityMs, peakToolCount, deriveFeedStatusLine, connectedWorkspaces } from './dashboard-session-state.js';

// Default archive page size for the observation /sessions feed (LIN-631). The
// client requests this many archived sessions per "load more"; the server caps
// any explicit ?limit at recentLimit.
const ARCHIVE_PAGE_SIZE = 30;

// Max touched-task done-state backend READS the Observation feed hydrates per
// poll (LIN-1258, Axis B). Only errored-terminal sessions can flip to
// `done-with-warning`, and those are rare on a feed, so a small cap covers the
// visible collapsed error cards while bounding the per-poll cost to N backend
// reads regardless of feed size. Combined with the 60s task-done TTL cache this
// keeps the no-Linear-read-per-poll contract: only cache MISSES count against
// the cap, cached hits are free, and any overflow fills in over later polls.
//
// The cap counts READS, not sessions (LIN-1259). Since the feed now hydrates the
// done-state of ANY touched task (not just the seed) to match the client's
// any-touched drill-in, a single multi-task session can cost up to one read per
// touched task; a per-session cap would let such a session multiply the per-poll
// backend cost this bound exists to hold. Reads short-circuit on the first Done
// touched task, so the common case (the seed is the done task) still costs one read.
const FEED_HYDRATION_CAP = 5;

/**
 * Merge Loops across every connected workspace, tagging each run with its
 * workspace. Pure Mongo reads. Per-workspace failures degrade to an empty list
 * for that workspace so one bad store never blanks the whole feed.
 *
 * @param {Array<{urlKey: string, name: string}>} workspaces
 * @param {{dispatchStore: Object, agentStatusStore: Object}} loopDeps
 * @returns {Promise<Array<Object>>} workspace-tagged Loop records, newest first
 */
export async function mergeLoopsFor(workspaces, loopDeps) {
  // Lean reconstruction (no promptText — the feed never reads it) + bounded
  // fan-out so peak memory tracks a couple of workspaces, not all (LIN-622).
  const settled = await settleWithConcurrency(workspaces, WORKSPACE_FANOUT_CONCURRENCY,
    async (ws) => {
      const loops = await getLoopsForWorkspace(ws.urlKey, { ...loopDeps, lean: true });
      return loops.map(loop => ({
        ...enrichLoop(loop),
        workspaceUrlKey: ws.urlKey,
        workspaceName: ws.name || ws.urlKey
      }));
    }
  );

  const merged = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') merged.push(...r.value);
    else console.error('Dashboard: loop read failed for a workspace:', r.reason?.message);
  }
  merged.sort((a, b) => loopActivityMs(b) - loopActivityMs(a));
  return merged;
}

// Most-recent activity across a session's (enriched) loops — the observation
// feed sort key. Falls back to the session's own completion/dispatch time.
function sessionActivityMs(enrichedLoops, session) {
  let max = 0;
  for (const l of enrichedLoops) max = Math.max(max, loopActivityMs(l));
  if (!max) max = toEpochMs(session.completedAt) ?? 0;
  if (!max) max = toEpochMs(session.dispatchedAt) ?? 0;
  return Number.isFinite(max) ? max : 0;
}

// Top-level "what is this session doing" signal (LIN-631): the run kind to
// surface on the card. Prefer the most-recently-active among the still-running
// runs (what the session is doing right now); fall back to the most-recent
// terminal run's kind (what it last did) when nothing is live.
function recentRunKind(children) {
  const live = children.filter(l => !isTerminalLoop(l));
  const pool = live.length ? live : children.filter(isTerminalLoop);
  let best = null;
  for (const l of pool) {
    if (!best || loopActivityMs(l) >= loopActivityMs(best)) best = l;
  }
  return best ? (best.kind || null) : null;
}

// ─── Session payload builders (observation feed; LIN-595) ─────────────────────

// One run's projection for the feed (the progress-bar segment and its Level-3
// drill-down payload). Every key is an allow-list entry, in the order the client
// sees it: the identity block, then the telemetry block, spread in place.
function projectRun(l) {
  return { ...runIdentity(l), ...runTelemetry(l) };
}

function runIdentity(l) {
  return {
    loopId: l.loopId,
    // Lineage identity (LIN-1487): carry the read-only `lineageId` derived
    // upstream (`lib/pipeline-loops.js` — `rootItemId ?? loopId`, emitted
    // ungated by `lean`) through the projection so the client can fold a
    // multi-wake lineage into one group at RENDER time. `runs[]` stays N
    // entries — this is additive, never a payload-side fold — so the repaint
    // signature and every per-run-keyed client site keep reading unfolded
    // runs. Null only for stale docs materialized before the field existed;
    // the client's `?? loopId` grouping fallback degrades those to a
    // lineage-of-one.
    lineageId: l.lineageId || null,
    issueIdentifier: l.issueIdentifier || null,
    issueTitle: l.issueTitle || '',
    issueUrl: l.issueUrl || null,
    // LIN-3331 / LIN-3335: the run's task kind-only source, projected
    // SPARSELY (an unstamped/legacy loop adds no key, keeping the feed row
    // byte-identical) so the Observation task block's task-page link can
    // carry it. Selection-only provenance, never a credential (B1).
    ...(l.issueSource != null ? { issueSource: l.issueSource } : {}),
    agentState: l.agentState,
    stage: l.stage || null,
    promptName: l.promptName || null,
    kind: l.kind || null,
    iteration: l.iteration ?? null,
    agentSummary: l.agentSummary || null
  };
}

function runTelemetry(l) {
  const metrics = Array.isArray(l.telemetry?.metrics) ? l.telemetry.metrics : [];
  return {
    runtime: l.telemetry?.runtime || null,
    // The feed renders only the recent activity tail (last few beats) and the
    // single peak tool count — NOT the full heartbeat history, which on a long
    // run is unbounded. Shipping all of it on every poll was waste that scaled
    // with run length (LIN-608 memory follow-up).
    metrics: metrics.slice(-6),
    // LIN-3011: prefer the loop's own digest-sourced `toolPeak` (an
    // always-full-window peak, lib/pipeline-loops.js `_buildLoops`) when
    // present — on the lean path `metrics` above is itself the digest's
    // RETAINED (possibly trimmed) subset (R4), so recomputing over it
    // would under-report a peak outside the retention window. Falls back
    // to the old recompute for a non-lean loop (`l.toolPeak` is always
    // `null` there) or a stale-shape doc materialized before the field
    // existed, where `metrics` is still the full list either way.
    toolPeak: l.toolPeak != null ? l.toolPeak : peakToolCount(metrics),
    producedArtifacts: Array.isArray(l.telemetry?.producedArtifacts) ? l.telemetry.producedArtifacts : [],
    resources: l.telemetry?.resources || null,
    // LIN-2243: a worker-lane's per-ticket walk, parsed from this run's own
    // [ticket] markers (lib/session-telemetry.js). null for a non-lane run —
    // never an empty array, so the client can tell "not a lane" apart from
    // "a lane that hasn't emitted a marker yet".
    ticketWalk: l.telemetry?.ticketWalk || null,
    // LIN-2244: currently parked on an async wait (e.g. a ScheduleWakeup
    // CI poll) — distinct from both "working" and "blocked on a human"
    // (the `decision`/waiting fields below). null when not currently
    // parked; never inferred from staleness, only from the run's own
    // latest feedback text (lib/session-telemetry.js's parseParkedWait).
    parkedWait: l.telemetry?.parkedWait || null,
    // LIN-2184 (H5): carry the loop's own build-time decision facts (LIN-2182
    // / H3, routes/dashboard.js:570's rollup reads the SAME fields from this
    // loop) through this allow-list projection — otherwise they never reach
    // the feed card. Deliberately NOT gated on `waiting`; the render is
    // waiting-gated downstream, the payload is not (H4 review ledger).
    decision: l.decision || null,
    decisionCase: Array.isArray(l.decisionCase) ? l.decisionCase : []
  };
}

// The session's identity block: the keys between the workspace tags and the
// derived status in the payload, spread in place so the key order is unchanged.
function sessionIdentity(session, anchor) {
  return {
    seedIssue: session.seedIssue || null,
    // LIN-2934 (S7): the fallback used to read `session.loops?.[0]?.issueTitle`
    // unconditionally — safe when every loop carried a real issue, but R1 now
    // retains a GENERAL run's own anchor loop as `loops[0]` with no
    // `issueTitle` at all (a goal-only kickoff names no single task). Skip to
    // the first loop that actually HAS a title (the first worker, for a
    // general run) instead of stopping at a title-less loops[0], so the card
    // keeps showing a worker's title rather than regressing to the "autopilot
    // session" placeholder.
    seedTitle: (anchor && anchor.issueTitle) || (session.loops || []).find(l => l.issueTitle)?.issueTitle || session.seedIssue || '',
    tasksTouched: Array.isArray(session.tasksTouched) ? session.tasksTouched : [],
    // Budget "n of N" (LIN-2934), derived read-time by pipeline-loops.js's
    // `_assembleSession` off the run's own `maxTasks` —
    // null when the run declared no such bound. Additive; the client chip
    // renders nothing when it is null.
    taskPosition: session.taskPosition || null
  };
}

// The session-level telemetry block, spread in place (the keys after
// `lastActivity`). `telemetry` is the session's own, or {}.
function sessionTelemetry(telemetry) {
  return {
    runtime: telemetry.runtime || null,
    model: telemetry.model || null,
    resources: telemetry.resources || null,
    // LIN-2243: session-level ticket walk, assembled the same way
    // runtime/model/resources already are — and, like `model`/`resources`
    // (not `runtime`), it is FEEDBACK-derived, so it is unconditionally null
    // on this endpoint: `buildSessionPayload` is only ever called over a
    // `lean: true` build (session.loops[].feedback already dropped), which
    // empties before `_assembleSession` re-flattens it. The card reads the
    // per-run `runs[].ticketWalk` instead (public/observation.js's
    // `laneTicketWalk`) — this field is kept only for callers of a non-lean
    // session build (e.g. the per-session page), where it is NOT dead.
    ticketWalk: telemetry.ticketWalk || null
  };
}

// Shape one reconstructed session for the observation feed. Loops are enriched
// (marker-aware agentState/completedAt) so a marker-done run doesn't look live
// forever; terminality follows the ANCHOR loop (LIN-592), not completedAt.
//
// `lastActivityOverrideMs` (LIN-1314) lets the post-build descendant rollup pass
// (`rollupDescendantActivity`) re-derive a session's payload with a subtree-wide
// recency value instead of its own-group `sessionActivityMs` — the same
// in-place-mutate-and-re-derive shape `hydrateTouchedTaskDone` already uses for
// `taskDone`, so `stale`/`status`/the emitted `lastActivity` stamp stay
// consistent with whichever value is authoritative.
export function buildSessionPayload(session, ws, taskDone = false, lastActivityOverrideMs = null) {
  const anchor = findAnchorLoop(session);
  const enriched = (Array.isArray(session.loops) ? session.loops : []).map(enrichLoop);
  const children = childLoops(session).map(enrichLoop);
  const terminal = sessionIsTerminal(session);
  const lastActivityMs = lastActivityOverrideMs != null ? lastActivityOverrideMs : sessionActivityMs(enriched, session);

  // Derived staleness (Bug 3): a non-terminal session with no activity for >24h
  // is bucketed out of Active. Purely derived from lastActivityMs — never a
  // mutation — so a later heartbeat advances lastActivity and un-stales it.
  const stale = !terminal && lastActivityMs > 0 && (Date.now() - lastActivityMs) > STALE_AFTER_MS;

  // Session-level "waiting on user" rollup (LIN-1005): unions any agent-status
  // `blocked` run and any latest `[blocked]` feedback marker across
  // the session's loops, from the lean-safe pre-derived per-loop facts. Terminal
  // precedence is gated HERE on the emitted flag (not only in `deriveSessionStatus`):
  // the session anchor can post `[done]` while a worker loop lingers `[blocked]`, so
  // the raw rollup must be `&&`-gated on session terminality or the flag contradicts
  // the `done` status ("a finished session is never waiting", LIN-1005 review).
  const { waiting: rawWaiting, message: rawWaitingMessage, producerLoopId, decision, decisionCase } = deriveSessionWaiting(enriched);
  const waiting = !terminal && rawWaiting;
  const waitingMessage = waiting ? rawWaitingMessage : null;
  // LIN-3983: every loop this session is waiting on, by id, for the Observation
  // waiting block (see `waitingLoops`). Empty when terminal, like waitingMessage.
  const waitingLoopIds = waiting ? waitingLoops(enriched).map(l => l.loopId) : [];

  // Sessions-tab discriminators (LIN-1194), both additive fields the Autopilot
  // tab ignores. `standalone` routes a synthesized single-loop session to the
  // Sessions view only (never the Autopilot feed). `taken` is the running-only
  // in-flight boundary: a loop is taken once it leaves the live queue (its
  // agentState is anything but 'queued' — see `_deriveAgentState`), so a
  // queued-but-not-yet-taken dispatch is excluded from the Sessions in-flight
  // list (the decided V1 boundary), while completed sessions fall to the archive.
  const standalone = isStandaloneSession(session);
  const taken = enriched.some(l => l.agentState !== 'queued');

  // `taskDone` is the touched seed task's live done-state. It defaults false so
  // the per-poll feed still honours the no-Linear cost contract for every
  // session, and every call site that omits it stays byte-identical. When the
  // bounded feed hydration (LIN-1258) resolves a real done-state for an
  // errored-terminal session, it re-invokes this with taskDone=true so
  // `deriveSessionStatus` emits `done-with-warning` (LIN-749) server-side —
  // making the server the single owner of that upgrade instead of the drill-in
  // client seam. `deriveSessionStatus` owns the status contract (and its
  // `waiting` value) in one unit-tested place for both paths.
  const status = deriveSessionStatus({
    terminal,
    stale,
    hasError: enriched.some(l => l.agentState === 'error'),
    waiting,
    taskDone
  });

  // One segment per worker run for the progress bar (state-colored; the live
  // one pulses client-side). Each run also carries the Level-3 drill-down
  // payload — its per-run telemetry (runtime / activity metrics / produced
  // artifacts, already computed read-only in pipeline-loops, LIN-594), its
  // agent summary, and its issueUrl. This stays inside the per-poll cost
  // contract: it is pure Mongo, no Linear call and no LLM (the on-demand
  // run-summary recap is fetched lazily, per node, by the client; LIN-595).
  const runs = children.map(projectRun);

  return {
    sessionId: session.sessionId,
    workspaceUrlKey: ws.urlKey,
    workspaceName: ws.name || ws.urlKey,
    ...sessionIdentity(session, anchor),
    status,
    terminal,
    stale,
    // Sessions-tab discriminators (LIN-1194; additive, Autopilot ignores them).
    standalone,
    taken,
    // Feed flag (LIN-1005): the client badges/filters waiting sessions and
    // surfaces the blocked message text. Null message when nothing is waiting.
    waiting,
    waitingMessage,
    waitingLoopIds,
    // LIN-2184 (H5): the rollup's decision facts (from the SAME producing loop
    // as `message`/`waitingMessage` above — `deriveSessionWaiting`'s "one
    // producer, always" rule) — deliberately NOT gated on `waiting`, unlike
    // `waitingMessage` just above. The render is waiting-gated (beats 3/4);
    // the payload must not be, per H4's review ledger.
    producerLoopId,
    decision,
    decisionCase,
    runCount: runs.length,
    runs,
    recentKind: recentRunKind(children),
    dispatchedAt: session.dispatchedAt || null,
    completedAt: session.completedAt || null,
    lastActivity: lastActivityMs ? new Date(lastActivityMs).toISOString() : null,
    ...sessionTelemetry(session.telemetry || {}),
    // Live status line served on the feed (deterministic, cache-free) so the
    // client never issues a per-poll /session-summary scan for a running
    // session. Null for terminal sessions — they render their cached AI summary.
    statusLine: terminal ? null : deriveFeedStatusLine(children)
  };
}

/**
 * Merge reconstructed autopilot sessions across every connected workspace,
 * newest activity first. Pure Mongo reads (no Linear, no LLM — the per-poll
 * cost contract). No issueGraph is injected here: lazy Linear hydration is a
 * drill-down concern (session-context), so explicit `sessionId` grouping
 * (forward-stamped runs, LIN-599) carries the feed and the inference fallback
 * degrades to each seed's own loops. One bad store degrades to empty.
 *
 * @param {Array<{urlKey: string, name: string}>} workspaces
 * @param {Object} [opts]
 * @param {boolean} [opts.live=false] - force the LIVE reconstruction and bypass the
 *   materialized `observation-sessions` store. The Sessions tab (LIN-1194) needs this
 *   because the materializer's discovery (`_sessionsTouchingIssue`) only marks
 *   autopilot/explicit-`sessionId` rows as session targets, so a store-backed read
 *   stays blind to standalone dispatches even after the `_buildSessions` pass-3
 *   extension. Reading live sidesteps that second seam entirely (V1).
 * @returns {Promise<Array<Object>>}
 */
export async function mergeSessions(workspaces, { live = false, session = null } = {}, deps) {
  const { loopDeps, observationSessionsStore, observationMaterializer } = deps;
  // Per-workspace source of the session objects (LIN-623): the durable
  // `observation-sessions` read-model when present, else the live 30-day
  // reconstruction. The read swap changes ONLY where the session objects come
  // from — `buildSessionPayload` runs byte-identical at read time over either,
  // so the now-relative status/stale/statusLine stay live. issueGraph is still
  // omitted here (a drill-down concern); the materializer matches that by
  // building with no graph too.
  const sessionsForWorkspace = async (ws) => {
    // Sessions tab (LIN-1194): skip the materialized store and read live, so
    // standalone sessions (which the materializer never discovers) surface.
    if (live) return getSessionsForWorkspace(ws.urlKey, { ...loopDeps, lean: true });
    if (observationSessionsStore) {
      const { sessions, backfilledAt } = await observationSessionsStore.findByWorkspace(ws.urlKey);
      // Hit: derived docs exist, OR the workspace was backfilled and is genuinely
      // empty (so we don't re-fan to the live path on every 5s poll forever).
      if (sessions.length > 0 || backfilledAt) return sessions;
      // Miss (pre-backfill): serve the correct live reconstruction now and kick a
      // one-time background build→persist so subsequent polls are cheap. The
      // derived path is thus a pure optimization that always degrades to live.
      if (observationMaterializer) {
        Promise.resolve(observationMaterializer.backfillWorkspace(ws.urlKey)).catch(() => {});
      }
    }
    return getSessionsForWorkspace(ws.urlKey, { ...loopDeps, lean: true });
  };

  // Bounded fan-out so peak memory tracks a couple of workspaces, not all
  // (LIN-622); the derived read makes each workspace cheap. Each built entry
  // keeps its source `session` + `ws` alongside the payload so the bounded feed
  // hydration below can re-build a payload with a real `taskDone` (LIN-1258).
  const settled = await settleWithConcurrency(workspaces, WORKSPACE_FANOUT_CONCURRENCY,
    async (ws) => {
      const sessions = await sessionsForWorkspace(ws);
      return sessions.map(s => ({ session: s, ws, payload: buildSessionPayload(s, ws) }));
    }
  );
  const built = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') built.push(...r.value);
    else console.error('Observation: session read failed for a workspace:', r.reason?.message);
  }

  // Bounded, TTL-cached server-side hydration of the touched tasks' live
  // done-state (LIN-1258/LIN-1259, Axis B) — the only way the collapsed/feed card
  // can reflect a `done-with-warning` without a per-poll Linear read. Mutates the
  // eligible entries' `.payload` in place.
  await hydrateTouchedTaskDone(built, session, deps);

  // Descendant recency rollup (LIN-1314): fold each session's transitive
  // child-autopilot sessions' activity into its own `lastActivity` hub field so
  // an actively-working grandchild keeps the whole ancestor chain fresh. Must
  // run AFTER hydrateTouchedTaskDone so a re-derive here preserves any taskDone
  // upgrade already applied. Mutates the eligible entries' `.payload` in place.
  rollupDescendantActivity(built);

  const merged = built.map(b => b.payload);
  merged.sort((a, b) => (new Date(b.lastActivity || 0).getTime()) - (new Date(a.lastActivity || 0).getTime()));
  return merged;
}

/**
 * Bounded, TTL-cached server-side hydration of a session's touched-task live
 * done-state for the Observation feed (LIN-1258, extended to any-touched-task
 * by LIN-1259, Axis B).
 *
 * `taskDone` only changes a session's derived status on the `terminal &&
 * hasError` branch of `deriveSessionStatus` (it upgrades `error` →
 * `done-with-warning`, LIN-749); a terminal non-error session is already
 * `done` and a non-terminal one never consults `taskDone`. So the ELIGIBLE set
 * is exactly the errored-terminal sessions — pre-hydration `payload.status ===
 * 'error'`.
 *
 * A session is upgraded when ANY touched task is Done, matching the client's
 * `ensureHydration` any-touched OR (public/observation.js) — the seed-only
 * server hydration LIN-1258 shipped disagreed with the client for a multi-task
 * session whose seed is not done but a later touched task is (feed showed
 * `error`, drill-in showed `done-with-warning`). `deriveSessionStatus` is
 * unchanged: the OR-across-touched-tasks happens here and still passes a single
 * boolean into `buildSessionPayload` (no signature change).
 *
 * Cost is bounded in two layers:
 *   - a fresh cache HIT is applied for free (no backend read) — always; a
 *     session with any cached-true touched task resolves for free, and one
 *     whose touched tasks are all cached-false resolves (as not-done) for free;
 *   - cache MISSES are read from the backend, but only up to FEED_HYDRATION_CAP
 *     READS per poll (LIN-1259: the cap counts reads, not sessions, because a
 *     multi-task session can now cost several reads). Reads SHORT-CIRCUIT on the
 *     first Done touched task, so the common case (seed done) stays one read;
 *     overflow keeps `taskDone=false` this poll and fills in over later polls
 *     (logged, never silently dropped).
 *
 * Reads go through the same `getWorkspaceAccessToken` + `fetchIssueContext`
 * deps the drill-in hydrate route uses, so "Done" is the identical signal
 * (`state.type === 'completed'`). A read that throws is swallowed (best-effort:
 * a hydration miss never breaks the feed) and — because the cache does not
 * store a thrown producer — is retried on a later poll. Mutates eligible
 * entries' `.payload` in place by re-building with `taskDone=true`; nothing
 * else in the payload changes.
 *
 * @param {Array<{session: Object, ws: {urlKey: string, name?: string}, payload: Object}>} built
 * @returns {Promise<void>}
 */
async function hydrateTouchedTaskDone(built, session, deps) {
  // Eligible = errored-terminal sessions with ≥1 touched task. `payload.status
  // === 'error'` is exactly `terminal && hasError` (deriveSessionStatus: `stale`
  // only holds for non-terminal sessions, and taskDone is false at this point).
  const eligible = built.filter(b =>
    b.payload.status === 'error' && Array.isArray(b.payload.tasksTouched) && b.payload.tasksTouched.length > 0);
  if (eligible.length === 0) return;

  const pending = applyCachedTaskDone(eligible, deps.taskDoneCache);
  if (pending.length === 0) return;
  const deferred = await readPendingTaskDone(pending, session, deps);

  if (deferred > 0) {
    console.log(`Observation: bounded feed hydration read cap (${FEED_HYDRATION_CAP}) reached; deferring ${deferred} errored session(s) to a later poll (LIN-1258/LIN-1259)`);
  }
}

function applyCachedTaskDone(eligible, taskDoneCache) {
  // Phase 1 — free cache application (no backend read, no cap spend). For each
  // eligible session, scan ALL its touched tasks: a cached-true task upgrades the
  // session immediately (any-touched OR, short-circuit); otherwise the cache-MISS
  // task keys are collected (in touched order) for phase 2. A session with no
  // misses is fully resolved here — Done if any hit was true, left `error` if
  // every touched task was a fresh cache-false.
  const pending = []; // { b, misses: Array<{key, ident}> } — sessions still needing ≥1 read
  for (const b of eligible) {
    const misses = [];
    let doneFromCache = false;
    for (const ident of b.payload.tasksTouched) {
      const key = `${b.ws.urlKey}::${ident}`;
      const cached = taskDoneCache.peek(key);
      if (cached === true) { doneFromCache = true; break; } // free hit → upgrade, short-circuit
      if (cached === undefined) misses.push({ key, ident });
      // cached === false: this task is not done; keep scanning the rest
    }
    if (doneFromCache) { b.payload = buildSessionPayload(b.session, b.ws, true); b.taskDone = true; }
    else if (misses.length > 0) pending.push({ b, misses });
    // else: every touched task was a fresh cache-false ⇒ resolved not-done, free
  }
  return pending;
}

async function readPendingTaskDone(pending, session, { taskDoneCache, getWorkspaceAccessToken, fetchIssueContext }) {
  // Phase 2 — bounded backend reads under a shared READ budget (LIN-1259). Reads
  // are issued concurrently across sessions; within a session the missed tasks are
  // read in touched order and short-circuit on the first Done. `budget` is a plain
  // counter reserved synchronously before each await — safe on the single JS
  // thread — so total reads never exceed FEED_HYDRATION_CAP regardless of how many
  // sessions or touched tasks are outstanding. A session that runs out of budget
  // before finding a Done task keeps `taskDone=false` this poll and re-reads later.
  let budget = FEED_HYDRATION_CAP;
  let deferred = 0;
  await Promise.all(pending.map(async ({ b, misses }) => {
    for (const { key, ident } of misses) {
      // Re-peek: a sibling session sharing this task key may have populated it
      // since phase 1 (mild dedup; full in-flight dedup is LIN-1259 item 3, out
      // of scope). A fresh answer here costs no read and no budget.
      const fresh = taskDoneCache.peek(key);
      if (fresh === true) { b.payload = buildSessionPayload(b.session, b.ws, true); b.taskDone = true; return; }
      if (fresh === false) continue;
      if (budget <= 0) { deferred++; return; } // out of read budget this poll
      budget--;
      try {
        const taskDone = await taskDoneCache.get(key, async () => {
          const token = await getWorkspaceAccessToken(b.ws.urlKey, session);
          if (!token) return false;
          const context = await fetchIssueContext(token, ident);
          const issue = context?.issue || context || {};
          // Same "Done" signal as the drill-in hydrate route (LIN-749).
          return issue?.state?.type === 'completed';
        });
        if (taskDone) { b.payload = buildSessionPayload(b.session, b.ws, true); b.taskDone = true; return; } // short-circuit
      } catch {
        // Best-effort: a hydration miss leaves the Mongo-sourced payload (error)
        // untouched; the throw is not cached, so a later poll retries. Keep
        // scanning the session's remaining touched tasks under the same budget.
      }
    }
  }));

  return deferred;
}

/**
 * Descendant recency rollup for the Observation feed (LIN-1314).
 *
 * "Sub-session" here means a descendant CHILD-AUTOPILOT session — a separate
 * `sessionId` group fanned out from this one — not a worker loop within the
 * same session (`sessionActivityMs` already maxes over those). A child
 * autopilot dispatched with `sessionId=<parent>` sits in the parent's own
 * `session.loops` as a `kind:'autopilot'` member (so its OWN activity already
 * counts toward the parent), but it stamps ITS OWN workers with its OWN
 * `loopId` — the same per-level lineage `collectCascadeTargets` walks
 * (`lib/dispatch-store.js`) — so those grandchild workers form a separate
 * session whose activity the parent's stamp never folds in.
 *
 * Rollup rule: each session's recency becomes the most-recent activity across
 * itself and its whole transitive descendant subtree. The descendant graph is
 * built entirely from loops already in `built` (no new store reads — the
 * per-poll cost contract holds), and the walk is cycle-guarded with a visited
 * set exactly like `collectCascadeTargets`. A descendant missing from `built`
 * (materializer lag) degrades safely to today's own-group value.
 *
 * Only sessions whose rolled value beats their own are re-derived — via the
 * same `buildSessionPayload` re-invocation `hydrateTouchedTaskDone` already
 * uses for `taskDone` — so `stale`/`status`/the emitted `lastActivity` stamp
 * (the hub field the sort + both Active/Archive splits read) all move
 * together, and a session with no descendants is left byte-identical.
 * Terminal precedence is preserved for free: `deriveSessionStatus` only reads
 * `stale` for non-terminal sessions, so a finished parent stays `done` (or
 * `error`/`done-with-warning`) even when a descendant is still active.
 *
 * @param {Array<{session: Object, ws: Object, payload: Object, taskDone?: boolean}>} built
 * @returns {void}
 */
function rollupDescendantActivity(built) {
  const bySessionId = new Map();
  for (const b of built) bySessionId.set(String(b.session.sessionId), b);

  // A session's direct child-autopilot sessions: every `kind:'autopilot'` loop
  // in its own loop set other than its own anchor (mirrors `childLoops`, but
  // narrowed to autopilot members — the ones that anchor a session of their own).
  const childSessionIdsOf = (b) => {
    const ownId = String(b.session.sessionId);
    const loops = Array.isArray(b.session.loops) ? b.session.loops : [];
    const ids = [];
    for (const l of loops) {
      if (l && l.kind === 'autopilot' && String(l.loopId) !== ownId) ids.push(String(l.loopId));
    }
    return ids;
  };

  for (const b of built) {
    const ownMs = Date.parse(b.payload.lastActivity || '') || 0;
    let maxMs = ownMs;

    const visited = new Set([String(b.session.sessionId)]);
    const frontier = childSessionIdsOf(b);
    while (frontier.length) {
      const id = frontier.shift();
      if (visited.has(id)) continue;
      visited.add(id);

      const descendant = bySessionId.get(id);
      if (!descendant) continue; // missing (lag) → degrade safely, contributes nothing

      const descendantMs = Date.parse(descendant.payload.lastActivity || '') || 0;
      if (descendantMs > maxMs) maxMs = descendantMs;
      frontier.push(...childSessionIdsOf(descendant));
    }

    if (maxMs > ownMs) {
      b.payload = buildSessionPayload(b.session, b.ws, b.taskDone || false, maxMs);
    }
  }
}

// ─── Route handlers ─────────────────────────────────────────────────────────

// First-class observation page (LIN-595): no feature flag (mirrors swim).
//
// Async since LIN-2706, to await the scan cost estimate read below.
// Express ^4.18.2 never awaits a route handler's returned promise, so the
// entire body -- the store read, renderObservationPage, and res.send --
// stays inside one try/catch: an uncaught rejection anywhere here would
// otherwise become an unhandled rejection that server.js's process-level
// net logs but never answers, hanging the request instead of 500ing it
// (mirrors /escalation-kpis and /effort-readout).
function observationPage({ llmCallLogStore, renderObservationPage, getDeployInfo, getOpenRouterSource }) {
  return async (req, res) => {
    const workspace = req.workspace;
    try {
      const scanCostEstimate = llmCallLogStore
        ? await llmCallLogStore.summarizeByFeature(workspace.urlKey, 'scan').catch(() => null)
        : null;
      const html = renderObservationPage(
        {
          workspaces: connectedWorkspaces(req.session)
        },
        {
          deployInfo: getDeployInfo(),
          urlKey: workspace.urlKey,
          openRouterSource: getOpenRouterSource(req),
          workspaces: req.session.workspaces,
          featureFlags: await requestFeatureFlags(req),
          scanCostEstimate
        }
      );
      res.send(html);
    } catch (error) {
      console.error('Observation page error:', error);
      res.status(500).send(renderErrorPage('Something Went Wrong', 'Failed to render the Observation page'));
    }
  };
}

// Split the merged sessions into the polling tab's Active list and Archive.
// Touched within the last day (LIN-631): the one Active/Archive rule, mirrored
// in public/observation.js (`isRecentlyActive`).
function recentlyActiveAt(now) {
  return (s) => {
    const t = Date.parse(s.lastActivity);
    return Number.isFinite(t) && (now - t) <= STALE_AFTER_MS;
  };
}

function splitSessionsFeed(merged, isSessionsView) {
  const now = Date.now();
  const recentlyActive = recentlyActiveAt(now);
  if (isSessionsView) {
    // Sessions source (LIN-1194, LIN-3983): standalone sessions included, and
    // the SAME recency rule as Autopilot, so one bucketing rule holds for every
    // filter on Observation. Taken sessions only: a queued-but-not-taken
    // dispatch is still excluded from the feed (the in-flight boundary).
    const taken = merged.filter(s => s.taken);
    return {
      active: taken.filter(recentlyActive),
      archive: taken.filter(s => !recentlyActive(s))
    };
  }
  // Autopilot view — UNCHANGED (LIN-631): recency-only Active/Archive split
  // (Active iff touched within 24h, regardless of terminal state), mirrored
  // in public/observation.js so server and client buckets agree. Standalone
  // sessions are filtered OUT so extending `_buildSessions` cannot leak them
  // into the existing feed on a live-fallback read (LIN-1194, concern #1).
  const feed = merged.filter(s => !s.standalone);
  return {
    active: feed.filter(recentlyActive),
    archive: feed.filter(s => !recentlyActive(s))
  };
}

function sessionsFeed(ctx) {
  const { sessionsFeedCache, recentLimit } = ctx;
  return async (req, res) => {
    const workspaces = connectedWorkspaces(req.session);

    // Workspace-wide read fanned across every connected workspace (LIN-615). It
    // has no selective predicate to push down, so we bound the *request* with a
    // keepalive heartbeat rather than capping the store read (the workspace
    // branch of _fetchWorkspaceData stays option-free; truncation-footgun guard).
    // Which Observation tab is polling (LIN-1194). `sessions` = the new in-flight
    // Sessions view (live read, standalone sessions included, running-only split);
    // anything else = the default Autopilot feed (byte-identical legacy behaviour).
    const isSessionsView = req.query.view === 'sessions';

    const keepalive = armKeepalive(res);
    try {
      // Short-TTL stale-while-revalidate cache (LIN-617): only the first poll for
      // this workspace set pays the full scan/reconstruction; later polls are
      // served instantly (refreshed in the background) so the banner stops
      // sitting on its initial "loading…" placeholder. Caches the merged OUTPUT,
      // not the store reads, so the truncation-footgun guard above is untouched.
      // The two tabs carry different payloads for the same workspace set, so the
      // Sessions view rides a view-namespaced cache key + a live-forced producer
      // (LIN-1194) rather than colliding on the Autopilot entry.
      const merged = await sessionsFeedCache.get(
        sessionsFeedCache.keyFor(workspaces, isSessionsView ? 'sessions' : undefined),
        () => mergeSessions(workspaces, { live: isSessionsView, session: req.session }, ctx)
      );

      const { active, archive } = splitSessionsFeed(merged, isSessionsView);

      // Archive is paginated (LIN-631): offset/limit page the bounded archive
      // instead of a hard slice(0, recentLimit) that silently hid older entries.
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || ARCHIVE_PAGE_SIZE), recentLimit);
      const recent = archive.slice(offset, offset + limit);

      keepalive.send(200, {
        workspaces,
        view: isSessionsView ? 'sessions' : 'autopilot',
        active,
        recent,
        recentTotal: archive.length,
        recentOffset: offset,
        recentLimit: limit,
        counts: { active: active.length, recent: archive.length, total: active.length + archive.length },
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Observation sessions error:', error);
      keepaliveError(keepalive, 500, 'Could not load sessions');
    }
  };
}

// ─── Merged cross-workspace loops (flat poll source) ──────────────────────────

function loopsFeed({ mergeLoops, recentLimit }) {
  return async (req, res) => {
    const workspaces = connectedWorkspaces(req.session);

    // Workspace-wide read fanned across every connected workspace (LIN-615);
    // bound the request with a keepalive heartbeat, not a blanket store limit.
    const keepalive = armKeepalive(res);
    try {
      const merged = await mergeLoops(workspaces);
      const active = merged.filter(l => !isTerminalLoop(l));
      const recent = merged.filter(isTerminalLoop).slice(0, recentLimit);

      keepalive.send(200, {
        workspaces,
        active,
        recent,
        counts: { active: active.length, recent: recent.length, total: merged.length },
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Dashboard loops error:', error);
      keepaliveError(keepalive, 500, 'Could not load runs');
    }
  };
}

/**
 * @param {Object} ctx - the composer's resolved dependencies plus its shared closures
 * @returns {Router}
 */
export function createDashboardFeedRoutes(ctx) {
  const { workspaceFromUrl } = ctx;
  const router = Router();
  router.get('/workspace/:urlKey/observation', workspaceFromUrl, observationPage(ctx));
  router.get('/workspace/:urlKey/api/dashboard/sessions', workspaceFromUrl, sessionsFeed(ctx));
  router.get('/workspace/:urlKey/api/dashboard/loops', workspaceFromUrl, loopsFeed(ctx));
  return router;
}
