/**
 * Observation routes — the first-class autopilot Observation page (LIN-595),
 * which supersedes the experimental autopilot dashboard (LIN-509).
 *
 * The page is *anchored* to one workspace for auth/navbar but *operates* over
 * every connected workspace in `session.workspaces`: it merges the cheap
 * per-workspace Loop / session reads (pure Mongo, no Linear API) into one
 * cross-workspace feed.
 *
 *   GET      /workspace/:urlKey/observation                        — page shell (first-class, no flag)
 *   GET      /workspace/:urlKey/dashboard                          — 302 → /observation (retired flag)
 *   GET      /workspace/:urlKey/api/dashboard/sessions             — sessionId-grouped feed (observation poll source; LIN-595)
 *   GET      /workspace/:urlKey/api/dashboard/loops                — merged cross-workspace runs (flat poll source)
 *   GET|POST /workspace/:urlKey/api/dashboard/run-summary/:loopId  — cached, on-demand short run summary
 *   GET|POST /workspace/:urlKey/api/dashboard/session-summary/:sessionId — cached session rollup (terminal); cheap latest-child statusLine proxy when live (LIN-592)
 *   GET      /workspace/:urlKey/api/dashboard/session-context/:sessionId — deterministic tasks-touched + relationship graph (LIN-593)
 *   GET      /workspace/:urlKey/api/dashboard/hydrate/:urlKey2/:identifier — lazy Linear hydration (drill-down only)
 *
 * Performance rule (LIN-509/595): the live feed reads Loops from Mongo only — it
 * never fans buildPipelineSnapshot/fetchProjects out per poll, and never spends an
 * LLM call per poll (summaries are on-demand + cached). Linear issue metadata is
 * hydrated lazily, only inside an open drill-down, for that one workspace's token,
 * best-effort (an expired-token workspace still lists its runs from Mongo).
 *
 * Tier note (LIN-595): the `/api/dashboard/*` endpoints are kept under their
 * original paths (the data layer the observation page reuses unchanged), but are
 * no longer gated by the retired experimental `dashboard` feature flag — the page
 * is first-class, so its data endpoints are session-authed only.
 */

import { Router } from 'express';
import { renderObservationPage } from '../lib/render-observation.js';
import { renderSessionPage } from '../lib/render-session.js';
import { getLoopsForWorkspace, getLoopsForIssue, getSessionsForWorkspace, getSessionsForIssues, deriveIssueGraph } from '../lib/pipeline-loops.js';
import { buildSessionContextGraph } from '../lib/context-graph.js';
import { deriveTerminalStatus, deriveCompletedAt, findWakeEvent } from '../lib/dispatch-terminal.js';
import { armKeepalive } from '../lib/http-keepalive.js';
import { createSessionsFeedCache } from '../lib/sessions-feed-cache.js';
import { createTaskDoneCache } from '../lib/task-done-cache.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { hasPaidEnvKey } from '../lib/openrouter.js';
import { resolveAiOperationModel } from '../lib/workspace-preferences.js';
import {
  generateRunSummary,
  parseRunSummaryResponse,
  DEFAULT_RUN_SUMMARY_MODEL
} from '../lib/run-summary.js';
import { hashLoop } from '../lib/run-summary-cache.js';
import {
  generateSessionSummary,
  parseSessionSummaryResponse,
  findAnchorLoop,
  childLoops,
  DEFAULT_SESSION_SUMMARY_MODEL
} from '../lib/session-summary.js';
import { hashSession } from '../lib/session-summary-cache.js';

// A run is summarisable only once it is immutable. agentState is terminal at
// 'complete'/'error'; until then a summary would snapshot a moving target and
// the cache (keyed on the immutable run) would serve stale content.
const TERMINAL_AGENT_STATES = new Set(['complete', 'error']);

// Map a dispatch terminal-feedback marker → a Loop agentState. `skipped`
// (LIN-946/LIN-951) is terminal-BENIGN → 'complete', NOT 'error': the runner
// refused a cascade abort into a human-continued session, which is an ended run,
// not a failed one. Deliberately distinct from `aborted` (→ 'error') so a skip is
// never rendered as an errored/aborted session.
const MARKER_TO_AGENT_STATE = { done: 'complete', failed: 'error', aborted: 'error', skipped: 'complete' };

// A non-terminal session whose last activity is older than this is considered
// "stale" — a worker that died without emitting a terminal marker would otherwise
// sit in the Active feed forever (Bug 3, LIN-608). Derived only: the stored record
// is never mutated, so a later heartbeat (which advances lastActivity) un-stales it.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // 24h ("after a day")

// Default archive page size for the observation /sessions feed (LIN-631). The
// client requests this many archived sessions per "load more"; the server caps
// any explicit ?limit at recentLimit.
const ARCHIVE_PAGE_SIZE = 30;

// Max workspace histories reconstructed concurrently in the cross-workspace
// fan-out. The old unbounded `Promise.allSettled` over every connected workspace
// made peak memory = the SUM of every workspace's full 30-day Loop graph
// materialised at once — the second amplifier behind the Observation memory
// spike (LIN-622). Capping it keeps peak at ~this many workspaces, not all.
const WORKSPACE_FANOUT_CONCURRENCY = 2;

// Max touched-task done-state backend reads the Observation feed hydrates per
// poll (LIN-1258, Axis B). Only errored-terminal sessions can flip to
// `done-with-warning`, and those are rare on a feed, so a small cap covers the
// visible collapsed error cards while bounding the per-poll cost to N backend
// reads regardless of feed size. Combined with the 60s task-done TTL cache this
// keeps the no-Linear-read-per-poll contract: only cache MISSES count against
// the cap, cached hits are free, and any overflow fills in over later polls.
const FEED_HYDRATION_CAP = 5;

/**
 * Run `mapper` over `items` with at most `limit` in flight, returning
 * `Promise.allSettled`-shaped results so a single workspace's failure is
 * isolated to its own slot (same degradation contract the feed already relies
 * on). Bounds the fan-out's peak memory (LIN-622).
 * @template T
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<any>} mapper
 * @returns {Promise<Array<{status:'fulfilled',value:any}|{status:'rejected',reason:any}>>}
 */
async function settleWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const runNext = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = { status: 'fulfilled', value: await mapper(items[i]) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, runNext);
  await Promise.all(workers);
  return results;
}

/**
 * Derive the *effective* agent state for a run.
 *
 * The Loop builder (lib/pipeline-loops.js) leaves a taken dispatch as 'running'
 * until a agent 'completed'/'failed' entry decorates it. But the dispatch
 * runner's own terminal signal is a "[done]"/"[failed]"/"[aborted]" feedback
 * marker (lib/dispatch-terminal.js — the same seam the proxy watch endpoint
 * reads). Without folding that in, every marker-but-no-agent run shows
 * "running" forever — the "all sessions appear in progress" report (LIN-509),
 * which also left the summary button permanently disabled. A terminal marker
 * therefore wins over a non-terminal derived state. Read-only; never mutates a
 * stored record, and never downgrades a state the builder already called terminal.
 *
 * @param {Object} loop
 * @returns {string} effective agentState
 */
function effectiveAgentState(loop) {
  if (!loop) return 'running';
  if (TERMINAL_AGENT_STATES.has(loop.agentState)) return loop.agentState;
  // Prefer the terminal status pipeline-loops pre-derived at build time (present
  // on every reconstructed loop); fall back to scanning raw feedback for loops
  // built elsewhere. The lean feed drops raw feedback[], so this read must not
  // depend on it (LIN-622).
  const marker = loop.terminalStatus !== undefined ? loop.terminalStatus : deriveTerminalStatus(loop.feedback);
  return marker ? MARKER_TO_AGENT_STATE[marker] : loop.agentState;
}

function isTerminalLoop(loop) {
  return !!loop && TERMINAL_AGENT_STATES.has(loop.agentState);
}

// Marker-aware terminal check for a raw session loop (loops from
// getSessionsForWorkspace / the read-model are not pre-enriched).
function loopIsTerminal(loop) {
  return isTerminalLoop(enrichLoop(loop));
}

/**
 * Is the whole session terminal (cacheable / summarisable)? Anchor-loop
 * terminality, with an all-loops-terminal fallback for anchorless/orphan
 * sessions. Module-scoped + exported (LIN-632) so the background summary
 * precompute (server.js → materializer) shares this exact gate instead of
 * forking a second definition that could drift.
 *
 * @param {Object} session - A lean session record (getSessionsForWorkspace shape).
 * @returns {boolean}
 */
export function sessionIsTerminal(session) {
  const anchor = findAnchorLoop(session);
  if (anchor) return loopIsTerminal(anchor);
  const loops = Array.isArray(session?.loops) ? session.loops : [];
  return loops.length > 0 && loops.every(loopIsTerminal);
}

/**
 * Is this a STANDALONE session — a single user-dispatched cli/web prompt that
 * `_buildSessions` pass 3 synthesized into its own single-loop session (LIN-1194)?
 *
 * This is the DERIVED read-time discriminator that keeps the two Observation tabs
 * apart WITHOUT changing the shared session builder (cross-cutting concern #1 in
 * the plan): the Autopilot feed filters standalone sessions OUT (so extending the
 * builder cannot leak them into the existing feed on a live-fallback read), and the
 * Sessions feed keeps them. A session is standalone iff it has NO autopilot anchor
 * AND none of its loops carries an explicit `sessionId` — the latter clause keeps
 * orphan explicit-`sessionId` worker groups (an aged-out orchestrator, `_buildSessions`
 * pass 2) on the Autopilot side, since those ARE autopilot-shaped. Pure; exported for
 * unit tests.
 *
 * @param {Object} session - a reconstructed session (getSessionsForWorkspace shape)
 * @returns {boolean}
 */
export function isStandaloneSession(session) {
  if (findAnchorLoop(session)) return false;                 // autopilot-anchored
  const loops = Array.isArray(session?.loops) ? session.loops : [];
  if (loops.length === 0) return false;
  return !loops.some(l => l && l.sessionId);                 // no explicit-sessionId group
}

/**
 * The observation session status string — the single contract consumed by the
 * client's icon/label maps and CSS (`public/observation.js` / `observation.css`).
 *
 * Six values: `stale`, `in-progress`, `waiting`, `error`, `done`, and
 * `done-with-warning`. `waiting` (LIN-1005) is the session-level "this session
 * needs you" rollup — a non-terminal session paused on a human (an agent-status
 * `blocked` run and/or a latest `[blocked]`/`[pending]` feedback marker). It is
 * deliberately NON-terminal: `[blocked]` stays a pause/wait signal, never a
 * terminal state, so a genuinely finished session is never shown as waiting.
 * `done-with-warning` (LIN-749) is the done/error split's 5th outcome: a terminal
 * session that had at least one errored run but whose touched task is now Done —
 * the autopilot finished the task despite the errors (the LIN-744 case).
 *
 * `taskDone` is the ONLY task-state input. It is NOT proof the task flipped
 * *during* this run (no start-state baseline is recorded; that precise per-run
 * attribution is a tracked cross-repo follow-up) — it approximates "done now ∧
 * ≥1 run errored". It is sourced solely from the existing Linear hydration seam
 * at the terminal boundary, never from the per-poll feed, which honours an
 * explicit no-Linear cost contract and always passes `taskDone=false`. `stale`
 * only ever holds for non-terminal sessions, so its branch is checked first to
 * keep the pre-existing outcomes byte-identical; `waiting` is a non-terminal
 * refinement checked AFTER terminal outcomes (a session that actually finished
 * wins over any lingering wait signal) and defaults false so existing call sites
 * that omit it stay byte-identical.
 *
 * Pure; exported for unit tests.
 *
 * @param {{terminal: boolean, stale: boolean, hasError: boolean, waiting?: boolean, taskDone?: boolean}} input
 * @returns {'stale'|'in-progress'|'waiting'|'error'|'done'|'done-with-warning'}
 */
export function deriveSessionStatus({ terminal, stale, hasError, waiting = false, taskDone = false }) {
  if (stale) return 'stale';
  if (terminal) return hasError ? (taskDone ? 'done-with-warning' : 'error') : 'done';
  if (waiting) return 'waiting';
  return 'in-progress';
}

// The wake markers that roll up to a session-level "waiting on user" state
// (LIN-1005). Mirrors WAITING_WAKE_MARKERS in pipeline-loops.js — a run whose
// pre-derived `wakeMarker` is one of these is paused on a human, not finished.
// ONLY `[blocked]` qualifies; `[pending]` is excluded (LIN-1025) because it is an
// agent-to-agent orchestrator handoff (LIN-843), not a request for user input —
// keep this in parity with the pipeline-loops.js definition.
const WAITING_WAKE_MARKERS = new Set(['blocked']);

/**
 * Is a single ENRICHED loop (effectiveAgentState applied) waiting on a human?
 *
 * Two independent runner channels, unioned (LIN-1005 — neither subsumes the
 * other): (a) an agent-status `blocked` entry surfaces as `agentState==='waiting'`
 * (lib/pipeline-loops.js `_deriveAgentState`), and (b) a `[blocked]`/`[pending]`
 * *feedback* marker, pre-derived at build time as `wakeMarker` so this read is
 * lean-safe (never touches raw `feedback[]`, which the feed drops). Terminal wins:
 * a run that actually finished (a terminal feedback marker folded in by
 * `effectiveAgentState`, or a native complete/error) is never waiting.
 *
 * @param {Object} loop - enriched loop (post-`enrichLoop`)
 * @returns {boolean}
 */
function loopIsWaiting(loop) {
  if (!loop || isTerminalLoop(loop)) return false;
  if (loop.agentState === 'waiting') return true;
  // Prefer the build-time `wakeMarker` (present on every reconstructed loop, lean
  // or not); fall back to scanning raw feedback for loops built elsewhere.
  const marker = loop.wakeMarker !== undefined
    ? loop.wakeMarker
    : (findWakeEvent(loop.feedback)?.marker || null);
  return marker != null && WAITING_WAKE_MARKERS.has(marker);
}

/**
 * Roll a session's ENRICHED loops up to a session-level waiting signal (LIN-1005):
 * `{ waiting, message }`. `waiting` is true when any loop is waiting on a human;
 * `message` is the first available blocked/pending text (falling back to the
 * waiting run's agent summary) so the UI can show the actual message rather than a
 * manufactured taxonomy. Pure; the single truth shared by the feed payload and the
 * session-page banner so they can never disagree.
 *
 * @param {Array<Object>} enrichedLoops - loops already run through `enrichLoop`
 * @returns {{waiting: boolean, message: string|null}}
 */
function deriveSessionWaiting(enrichedLoops) {
  let waiting = false;
  let message = null;
  for (const l of enrichedLoops) {
    if (!loopIsWaiting(l)) continue;
    waiting = true;
    if (!message) message = l.waitingMessage || l.agentSummary || null;
  }
  return { waiting, message };
}

/**
 * Most-relevant activity timestamp for a run, used to sort the merged feed.
 * Prefers the truthful completion time (terminal feedback marker) so a run that
 * just finished sorts above an older still-running one.
 * @param {Object} loop
 * @returns {number} epoch ms (0 when unknown)
 */
function loopActivityMs(loop) {
  const t = loop.completedAt || loop.agentTimestamp || loop.resolvedAt || loop.dispatchedAt;
  const ms = t ? new Date(t).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Enrich a Loop with its effective (marker-aware) agentState and completion
 * time. Returns a shallow copy; the stored record is never mutated.
 * @param {Object} loop
 * @returns {Object}
 */
function enrichLoop(loop) {
  // Prefer the build-time terminal completion (present on every reconstructed
  // loop); fall back to scanning raw feedback for loops built elsewhere. The
  // lean feed drops raw feedback[], so this must not depend on it (LIN-622).
  const terminalCompletedAt = loop.terminalCompletedAt !== undefined
    ? loop.terminalCompletedAt
    : deriveCompletedAt(loop.feedback);
  return {
    ...loop,
    agentState: effectiveAgentState(loop),
    completedAt: terminalCompletedAt || (isTerminalLoop(loop) ? (loop.resolvedAt || null) : null)
  };
}

/**
 * Peak tool-activity figure across a run's heartbeats — the single number the
 * feed's metric chip renders. Pre-computing it lets the feed ship only the
 * recent metrics tail instead of every heartbeat (an unbounded list on a long
 * run), which was pure per-poll waste (LIN-608 memory follow-up).
 * @param {Array<Object>} metrics
 * @returns {number|null}
 */
function peakToolCount(metrics) {
  if (!Array.isArray(metrics)) return null;
  let best = null;
  for (const m of metrics) {
    const v = m && m.total != null ? m.total : (m ? m.toolCount : null);
    if (v != null && (best == null || v > best)) best = v;
  }
  return best;
}

/**
 * Deterministic, cache-free live status line for a session's feed payload: the
 * most-recently-active child's own agent summary (capped). This is the SAME
 * fallback `liveStatusLine` derives, lifted onto the feed so a RUNNING session's
 * status needs no extra per-poll workspace scan — the client renders
 * `s.statusLine` directly instead of polling /session-summary every 5s. That
 * per-poll re-scan (its gate churns on every heartbeat), multiplied by every
 * active session, was the out-of-memory crash (LIN-608 memory follow-up).
 * @param {Array<Object>} children - enriched child loops
 * @returns {string}
 */
function deriveFeedStatusLine(children) {
  if (!Array.isArray(children) || !children.length) return '';
  let best = null;
  let bestMs = -Infinity;
  for (const c of children) {
    const ms = loopActivityMs(c);
    if (ms >= bestMs) { bestMs = ms; best = c; }
  }
  const text = best && best.agentSummary ? String(best.agentSummary) : '';
  return text.slice(0, 200);
}

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl        - middleware: session + req.workspace
 * @param {Object}   deps.dispatchQueueStore       - dispatch store (listItems/listHistory)
 * @param {Object}   deps.agentStatusStore             - agent status store
 * @param {Object}   [deps.observationSessionsStore]   - durable materialized sessions read-model (LIN-623); when present the feed reads it instead of replaying logs. Null ⇒ live path (byte-identical legacy behaviour).
 * @param {Object}   [deps.observationMaterializer]    - materializer used to backfill a workspace on a read-miss (LIN-623)
 * @param {Object}   deps.runSummaryCacheStore     - run-summary cache store
 * @param {Object}   deps.sessionSummaryCacheStore - session-summary cache store (LIN-592)
 * @param {Object}   deps.freeTierStore            - free-tier usage store (rate limit)
 * @param {Function} deps.getWorkspaceAccessToken  - (urlKey) → token (lazy hydration only)
 * @param {Function} deps.fetchIssueContext        - (token, identifier) → issue context (lazy hydration)
 * @param {Function} deps.fetchWorkspaceIssues     - (workspace) → canonical issue set (session-context; LIN-593)
 * @param {Function} deps.getOpenRouterSource      - (req) → 'oauth'|'env'|'free'|null
 * @param {Function} deps.getDeployInfo            - () → deploy metadata
 * @param {number}   [deps.recentLimit=120]        - cap on terminal runs returned by /loops
 * @param {Object}   [deps.sessionsFeedCache]      - short-TTL SWR cache for the /sessions feed (LIN-617)
 * @returns {Router}
 */
export function createDashboardRoutes({
  workspaceFromUrl,
  dispatchQueueStore,
  agentStatusStore,
  observationSessionsStore = null,
  observationMaterializer = null,
  runSummaryCacheStore,
  sessionSummaryCacheStore,
  // Brief/recap caches are per-issue (keyed by issue UUID); the per-session page
  // (LIN-1003) joins them onto a session by distinct loop.issueId. They are NOT
  // otherwise reachable in this router — the observation feed never reads issue
  // context — so they are injected here explicitly (default null → the join is
  // simply skipped, e.g. in tests that don't wire them).
  briefCacheStore = null,
  recapCacheStore = null,
  freeTierStore,
  getWorkspaceAccessToken,
  fetchIssueContext,
  fetchWorkspaceIssues,
  getOpenRouterSource,
  getDeployInfo,
  workspacePreferencesStore = null,
  recentLimit = 120,
  sessionsFeedCache = createSessionsFeedCache()
}) {
  const router = Router();
  const loopDeps = { dispatchStore: dispatchQueueStore, agentStatusStore };
  // Touched-task done-state TTL cache (LIN-1258): 60s, keyed `${wsUrlKey}::${identifier}`.
  // Under the LIN-617 feed-output cache: when the feed refreshes and re-runs
  // mergeSessions, an eligible session's seed task is served from here instead of
  // re-reading the backend every ~5s.
  const taskDoneCache = createTaskDoneCache();

  /**
   * Merge Loops across every connected workspace, tagging each run with its
   * workspace. Pure Mongo reads. Per-workspace failures degrade to an empty list
   * for that workspace so one bad store never blanks the whole feed.
   *
   * @param {Array<{urlKey: string, name: string}>} workspaces
   * @returns {Promise<Array<Object>>} workspace-tagged Loop records, newest first
   */
  async function mergeLoops(workspaces) {
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

  // ─── Session payload builders (observation feed; LIN-595) ─────────────────────

  // Most-recent activity across a session's (enriched) loops — the observation
  // feed sort key. Falls back to the session's own completion/dispatch time.
  function sessionActivityMs(enrichedLoops, session) {
    let max = 0;
    for (const l of enrichedLoops) max = Math.max(max, loopActivityMs(l));
    if (!max && session.completedAt) max = new Date(session.completedAt).getTime() || 0;
    if (!max && session.dispatchedAt) max = new Date(session.dispatchedAt).getTime() || 0;
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

  // Shape one reconstructed session for the observation feed. Loops are enriched
  // (marker-aware agentState/completedAt) so a marker-done run doesn't look live
  // forever; terminality follows the ANCHOR loop (LIN-592), not completedAt.
  function buildSessionPayload(session, ws, taskDone = false) {
    const anchor = findAnchorLoop(session);
    const enriched = (Array.isArray(session.loops) ? session.loops : []).map(enrichLoop);
    const children = childLoops(session).map(enrichLoop);
    const terminal = sessionIsTerminal(session);
    const lastActivityMs = sessionActivityMs(enriched, session);

    // Derived staleness (Bug 3): a non-terminal session with no activity for >24h
    // is bucketed out of Active. Purely derived from lastActivityMs — never a
    // mutation — so a later heartbeat advances lastActivity and un-stales it.
    const stale = !terminal && lastActivityMs > 0 && (Date.now() - lastActivityMs) > STALE_AFTER_MS;

    // Session-level "waiting on user" rollup (LIN-1005): unions any agent-status
    // `blocked` run and any latest `[blocked]`/`[pending]` feedback marker across
    // the session's loops, from the lean-safe pre-derived per-loop facts. Terminal
    // precedence is gated HERE on the emitted flag (not only in `deriveSessionStatus`):
    // the session anchor can post `[done]` while a worker loop lingers `[blocked]`, so
    // the raw rollup must be `&&`-gated on session terminality or the flag contradicts
    // the `done` status ("a finished session is never waiting", LIN-1005 review).
    const { waiting: rawWaiting, message: rawWaitingMessage } = deriveSessionWaiting(enriched);
    const waiting = !terminal && rawWaiting;
    const waitingMessage = waiting ? rawWaitingMessage : null;

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
    const runs = children.map(l => {
      const metrics = Array.isArray(l.telemetry?.metrics) ? l.telemetry.metrics : [];
      return {
        loopId: l.loopId,
        issueIdentifier: l.issueIdentifier || null,
        issueTitle: l.issueTitle || '',
        issueUrl: l.issueUrl || null,
        agentState: l.agentState,
        stage: l.stage || null,
        promptName: l.promptName || null,
        kind: l.kind || null,
        iteration: l.iteration ?? null,
        agentSummary: l.agentSummary || null,
        runtime: l.telemetry?.runtime || null,
        // The feed renders only the recent activity tail (last few beats) and the
        // single peak tool count — NOT the full heartbeat history, which on a long
        // run is unbounded. Shipping all of it on every poll was waste that scaled
        // with run length (LIN-608 memory follow-up).
        metrics: metrics.slice(-6),
        toolPeak: peakToolCount(metrics),
        producedArtifacts: Array.isArray(l.telemetry?.producedArtifacts) ? l.telemetry.producedArtifacts : []
      };
    });

    const telemetry = session.telemetry || {};

    return {
      sessionId: session.sessionId,
      workspaceUrlKey: ws.urlKey,
      workspaceName: ws.name || ws.urlKey,
      seedIssue: session.seedIssue || null,
      seedTitle: (anchor && anchor.issueTitle) || (session.loops?.[0]?.issueTitle) || session.seedIssue || '',
      tasksTouched: Array.isArray(session.tasksTouched) ? session.tasksTouched : [],
      status,
      terminal,
      stale,
      // Sessions-tab discriminators (LIN-1194; additive, Autopilot ignores them).
      standalone,
      taken,
      // Feed flag (LIN-1005): the client badges/filters waiting sessions and
      // surfaces the blocked message text. Null message when nothing is waiting.
      waiting,
      waitingMessage: waiting ? waitingMessage : null,
      runCount: runs.length,
      runs,
      recentKind: recentRunKind(children),
      dispatchedAt: session.dispatchedAt || null,
      completedAt: session.completedAt || null,
      lastActivity: lastActivityMs ? new Date(lastActivityMs).toISOString() : null,
      runtime: telemetry.runtime || null,
      model: telemetry.model || null,
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
  async function mergeSessions(workspaces, { live = false } = {}) {
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

    // Bounded, TTL-cached server-side hydration of the touched seed task's live
    // done-state (LIN-1258, Axis B) — the only way the collapsed/feed card can
    // reflect a `done-with-warning` without a per-poll Linear read. Mutates the
    // eligible entries' `.payload` in place.
    await hydrateTouchedTaskDone(built);

    const merged = built.map(b => b.payload);
    merged.sort((a, b) => (new Date(b.lastActivity || 0).getTime()) - (new Date(a.lastActivity || 0).getTime()));
    return merged;
  }

  /**
   * Bounded, TTL-cached server-side hydration of the touched seed task's live
   * done-state for the Observation feed (LIN-1258, Axis B).
   *
   * `taskDone` only changes a session's derived status on the `terminal &&
   * hasError` branch of `deriveSessionStatus` (it upgrades `error` →
   * `done-with-warning`, LIN-749); a terminal non-error session is already
   * `done` and a non-terminal one never consults `taskDone`. So the ELIGIBLE set
   * is exactly the errored-terminal sessions — pre-hydration `payload.status ===
   * 'error'`. For those:
   *
   *   - a fresh cache HIT is applied for free (no backend read) — always;
   *   - cache MISSES are read from the backend, but only up to FEED_HYDRATION_CAP
   *     per poll (cost bound); overflow keeps `taskDone=false` this poll and fills
   *     in over later polls (logged, never silently dropped).
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
  async function hydrateTouchedTaskDone(built) {
    // Eligible = errored-terminal sessions with a seed task. `payload.status ===
    // 'error'` is exactly `terminal && hasError` (deriveSessionStatus: `stale`
    // only holds for non-terminal sessions, and taskDone is false at this point).
    const eligible = built.filter(b =>
      b.payload.status === 'error' && b.payload.tasksTouched && b.payload.tasksTouched[0]);
    if (eligible.length === 0) return;

    const misses = [];
    for (const b of eligible) {
      const seed = b.payload.tasksTouched[0];
      const key = `${b.ws.urlKey}::${seed}`;
      const cached = taskDoneCache.peek(key);
      if (cached !== undefined) {
        // Free cache hit — apply immediately, no backend read, no cap spend.
        if (cached) b.payload = buildSessionPayload(b.session, b.ws, true);
      } else {
        misses.push({ b, key, seed });
      }
    }

    // Only cache misses cost a backend read; cap them per poll.
    const selected = misses.slice(0, FEED_HYDRATION_CAP);
    const overflow = misses.length - selected.length;
    if (overflow > 0) {
      console.log(`Observation: bounded feed hydration cap (${FEED_HYDRATION_CAP}) reached; deferring ${overflow} errored session(s) to a later poll (LIN-1258)`);
    }

    await Promise.all(selected.map(async ({ b, key, seed }) => {
      try {
        const taskDone = await taskDoneCache.get(key, async () => {
          const token = await getWorkspaceAccessToken(b.ws.urlKey);
          if (!token) return false;
          const context = await fetchIssueContext(token, seed);
          const issue = context?.issue || context || {};
          // Same "Done" signal as the drill-in hydrate route (LIN-749).
          return issue?.state?.type === 'completed';
        });
        if (taskDone) b.payload = buildSessionPayload(b.session, b.ws, true);
      } catch {
        // Best-effort: a hydration miss leaves the Mongo-sourced payload (error)
        // untouched; the throw is not cached, so a later poll retries.
      }
    }));
  }

  // ─── HTML page ──────────────────────────────────────────────────────────────

  // First-class observation page (LIN-595): no feature flag (mirrors swim).
  router.get('/workspace/:urlKey/observation', workspaceFromUrl, (req, res) => {
    const workspace = req.workspace;
    const html = renderObservationPage(
      {
        workspaces: (req.session.workspaces || []).map(w => ({ urlKey: w.urlKey, name: w.name }))
      },
      {
        deployInfo: getDeployInfo(),
        urlKey: workspace.urlKey,
        openRouterSource: getOpenRouterSource(req),
        workspaces: req.session.workspaces,
        featureFlags: getFeatureFlags(req.session)
      }
    );
    res.send(html);
  });

  // Dedicated per-session page (LIN-1003, Phase 1 of LIN-950). The Observation
  // in-feed drill-down promoted to a server-rendered page with its own URL.
  // Mounted under `workspaceFromUrl` so cookie-session auth + cross-workspace
  // isolation (unknown urlKey → 404) are inherited for free.
  //
  // Read-only + additive. The page needs the NON-lean transcript (`feedback[]`),
  // which the lean `observationSessionsStore.getSession` point-read drops
  // (pipeline-loops.js: `feedback: lean ? [] : feedback`). The original build read
  // it from the NON-lean whole-workspace `getSessionsForWorkspace(...).find(...)`,
  // which transferred every dispatch-history row's full `feedback[]` for the whole
  // 30-day workspace just to render ONE session — ~147s of history-read on
  // `linearviewer`, tripping Heroku's 30s H12 (LIN-1021). `loadSessionWithTranscript`
  // instead learns the session's issue set from tiny `{urlKey,sessionId}`-indexed
  // projected reads and rebuilds NON-lean over ONLY those issues via
  // `getSessionsForIssues` (LIN-623), so the read scales with one session, not the
  // whole workspace. Brief/recap are cache-ONLY reads on load (never an LLM spend on
  // page load); a miss renders an explicit affordance.
  router.get('/workspace/:urlKey/observation/session/:sessionId', workspaceFromUrl, async (req, res, next) => {
    try {
      const workspace = req.workspace;
      const { sessionId } = req.params;

      const pageOptions = {
        deployInfo: getDeployInfo(),
        urlKey: workspace.urlKey,
        openRouterSource: getOpenRouterSource(req),
        workspaces: req.session.workspaces,
        featureFlags: getFeatureFlags(req.session)
      };

      if (!sessionId) {
        return res.status(404).send(renderSessionPage({ session: null, sessionId: '', urlKey: workspace.urlKey }, pageOptions));
      }

      // NON-lean, issue-scoped point-read (LIN-1021) — the transcript needs
      // `feedback[]`, but scoped to this session's issues, not the whole workspace.
      const session = await loadSessionWithTranscript(workspace.urlKey, sessionId);
      if (!session) {
        return res.status(404).send(renderSessionPage({ session: null, sessionId, urlKey: workspace.urlKey }, pageOptions));
      }

      // Brief/recap cache-join over the session's distinct non-null issue UUIDs.
      // `.get()` is a pure Mongo lookup (no LLM, null on miss); null `issueId`
      // loops cannot be cache-joined and are skipped best-effort (mirrors the
      // lazy-hydration discipline). Never call the generating path on load.
      const issueContext = await joinSessionIssueContext(session, workspace.urlKey);

      // Session-level "waiting on user" banner (LIN-1005): the SAME rollup the
      // observation feed uses, computed here over the non-lean session's enriched
      // loops so the page and the feed agree. The banner directs the human to the
      // Phase 2 follow-up box. Terminal-gated identically to `buildSessionPayload`
      // (a finished session is never waiting, even with a lingering blocked worker).
      const enrichedLoops = (Array.isArray(session.loops) ? session.loops : []).map(enrichLoop);
      const sessionTerminal = sessionIsTerminal(session);
      const { waiting: rawWaiting, message: rawWaitingMessage } = deriveSessionWaiting(enrichedLoops);
      const waiting = !sessionTerminal && rawWaiting;
      const waitingMessage = waiting ? rawWaitingMessage : null;

      // Phase 2 human reply box (LIN-1004): gated to cli/web sessions (never
      // dash/local — the dispatch route rejects followUpTo for those anyway). The
      // reply is a plain follow-up to `session.sessionId` (the root dispatch id);
      // its `force` is conditional on the session's OWN terminal state (research:
      // terminal → force to bypass the busy-guard, waiting/warm → omit). Target is
      // taken from the anchor run so a `web`-dispatched session replies via `web`.
      const anchorLoop = findAnchorLoop(session) || (session.loops && session.loops[0]) || null;
      const anchorTarget = (anchorLoop && anchorLoop.target) || null;
      const canReply = anchorTarget !== 'dash' && anchorTarget !== 'local';
      const replyTarget = anchorTarget === 'web' ? 'web' : 'cli';

      const html = renderSessionPage(
        { session, sessionId, issueContext, waiting, waitingMessage, urlKey: workspace.urlKey, canReply, replyTarget, sessionTerminal },
        pageOptions
      );
      res.send(html);
    } catch (error) {
      next(error);
    }
  });

  // Retired experimental dashboard (LIN-509) → 302 to the first-class page.
  router.get('/workspace/:urlKey/dashboard', workspaceFromUrl, (req, res) => {
    res.redirect(`/workspace/${encodeURIComponent(req.workspace.urlKey)}/observation`);
  });

  /**
   * Load ONE reconstructed session WITH its non-lean transcript (`feedback[]`)
   * without paying for a whole-workspace reconstruction (LIN-1021).
   *
   * The page can't use the lean read-model point-read (it drops `feedback[]`),
   * and the whole-workspace non-lean read transfers every dispatch-history row's
   * feedback for 30 days (~147s on `linearviewer` → H12). Instead:
   *
   *   1. Derive the session's issue set cheaply. A `sessionId`-first session is,
   *      by `_buildSessions`' grouping, exactly {the root dispatch (id===sessionId)}
   *      ∪ {dispatches stamped `sessionId===sessionId`}. Both are `{urlKey,sessionId}`-
   *      indexed reads, and we project to `issueIdentifier` only — a few tiny rows.
   *   2. Rebuild NON-lean over ONLY those issues via `getSessionsForIssues` (LIN-623,
   *      issue-scoped/index-backed), which reuses the SAME builders as the live
   *      reconstruction, so the rebuilt session is faithful (verified: it reproduces
   *      the whole-workspace build's loop set exactly).
   *   3. Fall back to the full non-lean reconstruction only when the issue-scoped
   *      rebuild can't produce the session — a historical inference-grouped session
   *      (no explicit `sessionId` stamps) or one whose loops carry no `issueIdentifier`.
   *      Correct-but-slow, and the same degradation the sibling session-summary/
   *      context paths accept on a point-read miss; the common case never hits it.
   *
   * @param {string} urlKey
   * @param {string} sessionId
   * @returns {Promise<Object|null>} the non-lean session, or null if not found
   */
  async function loadSessionWithTranscript(urlKey, sessionId) {
    const hit = await pointReadSession(urlKey, sessionId);
    if (hit) return hit;
    // Fallback: historical inference-grouped or no-issue session → full read.
    const sessions = await getSessionsForWorkspace(urlKey, loopDeps);
    return sessions.find(s => String(s.sessionId) === String(sessionId)) || null;
  }

  /**
   * Issue-scoped point-read of ONE session by id — steps 1–2 of
   * loadSessionWithTranscript, WITHOUT the whole-workspace fallback (LIN-1022).
   *
   * Extracted so every reconstruct-by-sessionId handler (the per-session page,
   * session-summary, session-context) shares the one cheap path and each decides
   * for itself whether to pay the whole-workspace read on a point-read miss. It
   * returns the NON-lean session (feedback[] intact) built by getSessionsForIssues
   * — byte-identical to the whole-workspace build, restricted to the issues — or
   * null when issue-scoping can't produce the session.
   *
   * @param {string} urlKey
   * @param {string} sessionId
   * @returns {Promise<Object|null>}
   */
  async function pointReadSession(urlKey, sessionId) {
    const ids = new Set();
    // The root/orchestrator dispatch (id===sessionId) carries no self-referential
    // `sessionId`, so the sessionId-scoped reads below won't surface it — fetch its
    // own `issueIdentifier` (the seed) directly. Defensive: a store without
    // getItemStatus (test fakes) just contributes nothing here.
    const root = typeof dispatchQueueStore.getItemStatus === 'function'
      ? await Promise.resolve(dispatchQueueStore.getItemStatus(urlKey, sessionId)).catch(() => null)
      : null;
    if (root?.issueIdentifier) ids.add(root.issueIdentifier);
    const projection = { issueIdentifier: 1 };
    const [live, hist] = await Promise.all([
      Promise.resolve(dispatchQueueStore.listItems(urlKey, { sessionId, projection })).catch(() => []),
      Promise.resolve(dispatchQueueStore.listHistory(urlKey, { sessionId, projection })).catch(() => ({ items: [] }))
    ]);
    for (const r of (Array.isArray(live) ? live : [])) if (r?.issueIdentifier) ids.add(r.issueIdentifier);
    for (const r of (hist?.items || [])) if (r?.issueIdentifier) ids.add(r.issueIdentifier);

    if (!ids.size) return null;
    const rebuilt = await getSessionsForIssues(urlKey, loopDeps, [...ids], { lean: false });
    return rebuilt.find(s => String(s.sessionId) === String(sessionId)) || null;
  }

  /**
   * Point-read ONE run (Loop) by id (LIN-1022). A loopId IS the dispatch item id
   * (`_buildLoops` sets `loopId: item.id`), so getItemStatus resolves its issue and
   * getLoopsForIssue rebuilds that issue's runs issue-scoped/index-backed with the
   * SAME builders getLoopsForWorkspace runs — byte-identical. Falls back to the
   * whole-workspace read only when the loop can't be issue-scoped (no getItemStatus
   * match, or a loopId that isn't a live/historic dispatch id).
   *
   * @param {string} urlKey
   * @param {string} loopId
   * @returns {Promise<Object|null>} the enriched loop, or null if not found
   */
  async function loadRunForSummary(urlKey, loopId, { allowFullScan = true } = {}) {
    const item = typeof dispatchQueueStore.getItemStatus === 'function'
      ? await Promise.resolve(dispatchQueueStore.getItemStatus(urlKey, loopId)).catch(() => null)
      : null;
    if (item?.issueIdentifier) {
      const loops = await getLoopsForIssue(urlKey, item.issueIdentifier, loopDeps);
      const found = loops.find(l => String(l.loopId) === String(loopId));
      if (found) return enrichLoop(found);
    }
    // Whole-workspace fallback (loopId not resolvable to an issue). Skipped on a
    // cachedOnly peek so a stale/unresolvable loopId never pays the 30-day read.
    if (!allowFullScan) return null;
    const loops = await getLoopsForWorkspace(urlKey, loopDeps);
    const found = loops.find(l => String(l.loopId) === String(loopId));
    return found ? enrichLoop(found) : null;
  }

  /**
   * Cache-only brief/recap join for the per-session page (LIN-1003). Reduces the
   * session's loops to distinct non-null issue UUIDs and reads each issue's
   * cached brief + recap. Pure reads; a store miss (or an unwired store) yields
   * a null body → the renderer shows an explicit generate affordance.
   *
   * @param {Object} session - non-lean reconstructed session
   * @param {string} urlKey
   * @returns {Promise<Array<Object>>}
   */
  async function joinSessionIssueContext(session, urlKey) {
    const seen = new Set();
    const distinct = [];
    for (const loop of session.loops || []) {
      const issueId = loop.issueId || null;
      if (!issueId || seen.has(issueId)) continue; // null → skippable best-effort
      seen.add(issueId);
      distinct.push({ issueIdentifier: loop.issueIdentifier || null, issueId });
    }

    const out = [];
    for (const d of distinct) {
      const [brief, recap] = await Promise.all([
        briefCacheStore ? briefCacheStore.get(urlKey, d.issueId).catch(() => null) : Promise.resolve(null),
        recapCacheStore ? recapCacheStore.get(urlKey, d.issueId).catch(() => null) : Promise.resolve(null)
      ]);
      out.push({
        issueIdentifier: d.issueIdentifier,
        issueId: d.issueId,
        brief: brief?.brief || null,
        briefModel: brief?.model || null,
        briefGeneratedAt: brief?.generatedAt || null,
        recap: recap?.recap || null,
        recapModel: recap?.model || null,
        recapGeneratedAt: recap?.generatedAt || null
      });
    }
    return out;
  }

  // ─── Sessions feed (observation poll source; LIN-595) ─────────────────────────

  router.get('/workspace/:urlKey/api/dashboard/sessions', workspaceFromUrl, async (req, res) => {
    const workspaces = (req.session.workspaces || []).map(w => ({ urlKey: w.urlKey, name: w.name }));

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
        () => mergeSessions(workspaces, { live: isSessionsView })
      );

      let active;
      let archive;
      if (isSessionsView) {
        // Sessions view (LIN-1194): the in-flight predicate is running-only —
        // taken (past the live queue) AND non-terminal — NOT recency. Completed
        // sessions drop to the shared archive; queued-but-not-taken and non-taken
        // items are excluded from V1 entirely (the decided in-flight boundary).
        // Standalone sessions are kept here (they are filtered OUT of Autopilot).
        active = merged.filter(s => s.taken && !s.terminal);
        archive = merged.filter(s => s.terminal);
      } else {
        // Autopilot view — UNCHANGED (LIN-631): recency-only Active/Archive split
        // (Active iff touched within 24h, regardless of terminal state), mirrored
        // in public/observation.js so server and client buckets agree. Standalone
        // sessions are filtered OUT so extending `_buildSessions` cannot leak them
        // into the existing feed on a live-fallback read (LIN-1194, concern #1).
        const now = Date.now();
        const recentlyActive = (s) => {
          const t = Date.parse(s.lastActivity);
          return Number.isFinite(t) && (now - t) <= STALE_AFTER_MS;
        };
        const feed = merged.filter(s => !s.standalone);
        active = feed.filter(recentlyActive);
        archive = feed.filter(s => !recentlyActive(s));
      }

      // Archive is paginated (LIN-631): offset/limit page the bounded archive
      // instead of a hard slice(0, recentLimit) that silently hid older entries.
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || ARCHIVE_PAGE_SIZE), recentLimit);
      const recent = archive.slice(offset, offset + limit);

      keepalive.stop();
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
      keepalive.stop();
      keepalive.send(500, { error: 'Could not load sessions' });
    }
  });

  // ─── Merged cross-workspace loops (flat poll source) ──────────────────────────

  router.get('/workspace/:urlKey/api/dashboard/loops', workspaceFromUrl, async (req, res) => {
    const workspaces = (req.session.workspaces || []).map(w => ({ urlKey: w.urlKey, name: w.name }));

    // Workspace-wide read fanned across every connected workspace (LIN-615);
    // bound the request with a keepalive heartbeat, not a blanket store limit.
    const keepalive = armKeepalive(res);
    try {
      const merged = await mergeLoops(workspaces);
      const active = merged.filter(l => !isTerminalLoop(l));
      const recent = merged.filter(isTerminalLoop).slice(0, recentLimit);

      keepalive.stop();
      keepalive.send(200, {
        workspaces,
        active,
        recent,
        counts: { active: active.length, recent: recent.length, total: merged.length },
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Dashboard loops error:', error);
      keepalive.stop();
      keepalive.send(500, { error: 'Could not load runs' });
    }
  });

  // ─── On-demand short run summary (cached) ─────────────────────────────────────

  async function handleRunSummary(req, res, { force }) {
    if (!runSummaryCacheStore) {
      return res.status(503).json({ error: 'Run summary store unavailable' });
    }

    const workspace = req.workspace;
    const { loopId } = req.params;
    if (!loopId) return res.status(400).json({ error: 'loopId is required' });

    const isPeek = !force && (req.query.cachedOnly === '1' || req.query.cachedOnly === 'true');
    let loop;
    try {
      // LIN-1022: issue-scoped point-read (getItemStatus→getLoopsForIssue) instead of
      // a non-lean whole-workspace getLoopsForWorkspace reconstruct-by-loopId. The
      // whole-workspace fallback is skipped on a cachedOnly peek (same H12 guard as
      // session-summary): a peek with a stale/unresolvable loopId must not pay the
      // 30-day read.
      loop = await loadRunForSummary(workspace.urlKey, loopId, { allowFullScan: !isPeek });
    } catch (error) {
      console.error('Dashboard run-summary lookup error:', error);
      return res.status(500).json({ error: 'Could not load the run' });
    }
    if (!loop) {
      // Peek miss → cheap 204 (mirrors the cache-miss 204 below); else 404.
      return isPeek ? res.status(204).end() : res.status(404).json({ error: 'Run not found' });
    }

    // Immutability gate: only terminal runs are summarisable/cacheable.
    if (!isTerminalLoop(loop)) {
      return res.status(409).json({ error: 'Run is still active — a summary is available once it completes', agentState: loop.agentState });
    }

    const inputHash = hashLoop(loop);

    // Cache check (skip on force/POST).
    if (!force) {
      const cached = await runSummaryCacheStore.get(workspace.urlKey, loopId);
      if (cached && cached.inputHash === inputHash) {
        return res.json({ status: 'cached', loopId, summary: cached.summary, model: cached.model, generatedAt: cached.generatedAt });
      }
      // Peek mode: the overlay asks "is there a cached summary?" on open without
      // paying to generate one. A miss is a 204, so the UI shows its button
      // instead of silently spending an AI call on every drill-down (cost contract).
      if (req.query.cachedOnly === '1' || req.query.cachedOnly === 'true') {
        return res.status(204).end();
      }
    }

    // Test mode: deterministic summary, no OpenRouter call (keeps E2E offline).
    if (process.env.NODE_ENV === 'test') {
      const summary = buildTestSummary(loop);
      await runSummaryCacheStore.put(workspace.urlKey, loopId, { inputHash, summary, model: 'test-mock' });
      return res.json({ status: 'fresh', loopId, summary, model: 'test-mock', generatedAt: new Date().toISOString() });
    }

    // Resolve the OpenRouter key: user OAuth → env (via streamChat default) → free tier.
    const sessionApiKey = req.session.openRouterApiKey;
    const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
    const isFreeTier = !sessionApiKey && !hasPaidEnvKey() && !!freeTierKey;

    if (!sessionApiKey && !hasPaidEnvKey() && !freeTierKey) {
      return res.status(503).json({ error: 'AI summaries are not configured' });
    }

    if (isFreeTier && freeTierStore) {
      const check = await freeTierStore.tryUse(workspace.urlKey);
      if (!check.allowed) {
        return res.status(429).json({ error: check.reason, freeTier: { used: true, remaining: check.remaining, limit: check.limit, resetsAt: check.resetsAt } });
      }
    }

    try {
      const apiKey = sessionApiKey || (isFreeTier ? freeTierKey : undefined);
      const selectedModel = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'run-summary', forceDefault: isFreeTier });
      const { summary, model } = await generateRunSummary(loop, { apiKey, model: selectedModel });
      await runSummaryCacheStore.put(workspace.urlKey, loopId, { inputHash, summary, model });
      res.json({ status: 'fresh', loopId, summary, model, generatedAt: new Date().toISOString() });
    } catch (error) {
      console.error('Dashboard run-summary generation error:', error);
      res.status(502).json({ error: 'Could not generate the run summary' });
    }
  }

  // The summary routes are async handlers invoked as `(req, res) => handleX(...)`.
  // Express does not await the returned promise, so any rejection (e.g. a store
  // read inside liveStatusLine/gatherChildOutcomes, or a cache get/put outside the
  // inner try) would escape as an unhandled rejection and could crash the dyno
  // (LIN-608). `.catch(next)` routes it to the global error middleware → a visible
  // 500 instead of a crash.
  router.get('/workspace/:urlKey/api/dashboard/run-summary/:loopId', workspaceFromUrl, (req, res, next) =>
    handleRunSummary(req, res, { force: false }).catch(next));

  router.post('/workspace/:urlKey/api/dashboard/run-summary/:loopId', workspaceFromUrl, (req, res, next) =>
    handleRunSummary(req, res, { force: true }).catch(next));

  // ─── On-demand session rollup summary (cached; LIN-592) ───────────────────────
  //
  // Rolls a whole autopilot session (orchestrator + spawned workers across one or
  // more tasks) into a one-sentence outcome + present-tense statusLine. Mirrors
  // handleRunSummary, with two session-specific decisions:
  //
  //   (a) Terminal-session gate. The session record carries no terminal flag and
  //       completedAt is non-null as soon as ANY loop is terminal — not "the
  //       session is done." Terminality is derived from the ANCHOR loop
  //       (kind:'autopilot', loopId===sessionId) via the same marker-aware
  //       isTerminalLoop used for runs; an anchorless/orphan session requires ALL
  //       its loops terminal. Only a terminal session is generated and cached.
  //
  //   (b) Live statusLine honesty. A live session is NEVER generated or cached.
  //       Instead it returns a cheap proxy: the latest *terminal* child's cached
  //       run-summary.outcome (run-summary exists only for terminal children, so
  //       the truly-latest in-flight child usually has none). This lags the
  //       in-flight child — a named, accepted proxy, surfaced as live:true +
  //       statusLineSource:'latest-completed-child', not misrepresented as live.

  // Terminal checks are module-scoped + exported (sessionIsTerminal, loopIsTerminal)
  // so the background precompute shares the exact same gate (LIN-632).

  // The cheap live proxy for an in-progress session's status line. Deterministic:
  // never an LLM call (the cost contract). Bug 2 (LIN-608): a freshly-started
  // session has no terminal child and no cached run-summary, so the old
  // terminal-only filter returned '' forever and the card showed a permanent
  // "◐ working…" placeholder. We now fall back to the latest child's own
  // agentSummary/heartbeat — including a still-running child — so live work shows
  // real status. The richest signal is still preferred: the latest *terminal*
  // child's cached run-summary outcome wins when present.
  async function liveStatusLine(session, urlKey) {
    const children = childLoops(session)
      .map(enrichLoop)
      .sort((a, b) => loopActivityMs(b) - loopActivityMs(a));
    if (!children.length) return { statusLine: '', loopId: null };

    // Best signal: the latest completed child's cached run-summary outcome.
    const latestTerminal = children.find(isTerminalLoop);
    let outcome = '';
    if (latestTerminal && runSummaryCacheStore) {
      const cached = await runSummaryCacheStore.get(urlKey, latestTerminal.loopId);
      outcome = cached?.summary?.outcome || '';
    }

    // Fall back to the most-relevant child's own agent summary/heartbeat,
    // regardless of terminal state — this is what surfaces a running child's live
    // status. Attribute the line to the child it actually came from.
    const source = (latestTerminal && outcome) ? latestTerminal : children[0];
    if (!outcome) outcome = source.agentSummary ? String(source.agentSummary) : '';
    return { statusLine: outcome.slice(0, 200), loopId: source.loopId };
  }

  // Cached child run-summary outcomes for the generation context (no per-child
  // generation — only what is already cached for terminal children).
  async function gatherChildOutcomes(session, urlKey) {
    const out = {};
    if (!runSummaryCacheStore) return out;
    for (const loop of childLoops(session)) {
      if (!loopIsTerminal(loop)) continue;
      const cached = await runSummaryCacheStore.get(urlKey, loop.loopId);
      if (cached?.summary?.outcome) out[loop.loopId] = cached.summary.outcome;
    }
    return out;
  }

  async function handleSessionSummary(req, res, { force }) {
    if (!sessionSummaryCacheStore) {
      return res.status(503).json({ error: 'Session summary store unavailable' });
    }

    const workspace = req.workspace;
    const { sessionId } = req.params;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    // Find one session by id: materialized read-model point-read (LIN-632) →
    // issue-scoped point-read (LIN-1022) → whole-workspace reconstruction.
    //
    // The whole-workspace read is gated behind !isPeek. The Observation page fires
    // one session-summary?cachedOnly=1 PEEK per terminal card — including cards for
    // stale/expired sessionIds no longer in the 30-day window (getItemStatus NULL,
    // no scoped rows, absent from the whole-ws build). Paying the 30-day
    // reconstruction on each such peek — merely to 404 or serve a rollup — is what
    // fanned into the mass H12 (LIN-1022; measured 337s per whole-ws read on prod).
    // A peek must resolve CHEAPLY or not at all: on a miss it reports "no cached
    // summary" (204), exactly the response the client already treats as
    // "terminal but uncached → leave the affordance". Only a non-peek request
    // (force/POST generate, or a GET that will actually spend an LLM call) pays the
    // whole-workspace fallback — single, deliberate, and the only path that
    // reconstructs a genuinely inference-grouped historical session.
    const isPeek = !force && (req.query.cachedOnly === '1' || req.query.cachedOnly === 'true');
    let session = null;
    try {
      if (observationSessionsStore) {
        session = await observationSessionsStore.getSession(workspace.urlKey, sessionId);
      }
      if (!session) {
        session = await pointReadSession(workspace.urlKey, sessionId);
      }
      if (!session && !isPeek) {
        const sessions = await getSessionsForWorkspace(workspace.urlKey, loopDeps);
        session = sessions.find(s => String(s.sessionId) === String(sessionId)) || null;
      }
    } catch (error) {
      console.error('Dashboard session-summary lookup error:', error);
      return res.status(500).json({ error: 'Could not load the session' });
    }
    if (!session) {
      // Peek miss → cheap 204 (mirrors the cache-miss 204 below); else 404.
      return isPeek ? res.status(204).end() : res.status(404).json({ error: 'Session not found' });
    }

    // Live session: cheap proxy statusLine only, no generation, no caching.
    if (!sessionIsTerminal(session)) {
      const { statusLine, loopId } = await liveStatusLine(session, workspace.urlKey);
      return res.json({
        status: 'live',
        sessionId,
        live: true,
        summary: { outcome: '', statusLine, highlights: [] },
        statusLineSource: loopId ? 'latest-completed-child' : 'none',
        statusLineLoopId: loopId,
        model: null,
        generatedAt: null
      });
    }

    const inputHash = hashSession(session);

    // Cache check (skip on force/POST).
    if (!force) {
      const cached = await sessionSummaryCacheStore.get(workspace.urlKey, sessionId);
      if (cached && cached.inputHash === inputHash) {
        return res.json({ status: 'cached', sessionId, live: false, summary: cached.summary, model: cached.model, generatedAt: cached.generatedAt });
      }
      // Peek mode: "is there a cached session summary?" without paying to generate.
      if (req.query.cachedOnly === '1' || req.query.cachedOnly === 'true') {
        return res.status(204).end();
      }
    }

    // Test mode: deterministic summary, no OpenRouter call (keeps E2E offline).
    if (process.env.NODE_ENV === 'test') {
      const summary = buildTestSessionSummary(session);
      await sessionSummaryCacheStore.put(workspace.urlKey, sessionId, { inputHash, summary, model: 'test-mock' });
      return res.json({ status: 'fresh', sessionId, live: false, summary, model: 'test-mock', generatedAt: new Date().toISOString() });
    }

    // Resolve the OpenRouter key: user OAuth → env (via streamChat default) → free tier.
    const sessionApiKey = req.session.openRouterApiKey;
    const freeTierKey = process.env.OPENROUTER_FREE_TIER_KEY;
    const isFreeTier = !sessionApiKey && !hasPaidEnvKey() && !!freeTierKey;

    if (!sessionApiKey && !hasPaidEnvKey() && !freeTierKey) {
      return res.status(503).json({ error: 'AI summaries are not configured' });
    }

    if (isFreeTier && freeTierStore) {
      const check = await freeTierStore.tryUse(workspace.urlKey);
      if (!check.allowed) {
        return res.status(429).json({ error: check.reason, freeTier: { used: true, remaining: check.remaining, limit: check.limit, resetsAt: check.resetsAt } });
      }
    }

    try {
      const apiKey = sessionApiKey || (isFreeTier ? freeTierKey : undefined);
      const childOutcomes = await gatherChildOutcomes(session, workspace.urlKey);
      const selectedModel = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'session-summary', forceDefault: isFreeTier });
      const { summary, model } = await generateSessionSummary(session, { apiKey, model: selectedModel, childOutcomes });
      await sessionSummaryCacheStore.put(workspace.urlKey, sessionId, { inputHash, summary, model });
      res.json({ status: 'fresh', sessionId, live: false, summary, model, generatedAt: new Date().toISOString() });
    } catch (error) {
      console.error('Dashboard session-summary generation error:', error);
      res.status(502).json({ error: 'Could not generate the session summary' });
    }
  }

  router.get('/workspace/:urlKey/api/dashboard/session-summary/:sessionId', workspaceFromUrl, (req, res, next) =>
    handleSessionSummary(req, res, { force: false }).catch(next));

  router.post('/workspace/:urlKey/api/dashboard/session-summary/:sessionId', workspaceFromUrl, (req, res, next) =>
    handleSessionSummary(req, res, { force: true }).catch(next));

  // ─── Session context graph (deterministic; LIN-593) ───────────────────────────
  //
  // The relationship shape of everything a session touched: each touched task's
  // neighborhood (parent/children/epic/blocks/related, reusing buildContextGraph)
  // tagged with provenance (seed / descended / spun-off). No AI, nothing cached —
  // it resolves entirely against the workspace's loaded issue set, the same as
  // /api/context/:issueId. Loading that set also lets us derive the issueGraph the
  // session inference fallback needs, repairing the degraded reconstruction the
  // /loops + /session-summary paths run without (they pass no issueGraph).

  router.get('/workspace/:urlKey/api/dashboard/session-context/:sessionId', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { sessionId } = req.params;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    // Bound the request with a keepalive heartbeat (LIN-615).
    const keepalive = armKeepalive(res);
    try {
      // The graph build always needs the workspace's full issue set (it resolves
      // each touched task's neighbourhood against it). Memoized at the source
      // (server.js, LIN-632) so warm drill-ins do NOT refetch all of Linear.
      const issues = fetchWorkspaceIssues ? (await fetchWorkspaceIssues(workspace)) || [] : [];

      // Find the one session by id. Prefer the materialized read-model point-read
      // (LIN-632): on a hit we skip the full 30-day workspace reconstruction
      // entirely. On a miss, degrade to the live reconstruction — which also
      // needs the issueGraph for accurate session inference, so derive it only
      // on that path (the read-model session already carries everything
      // buildSessionContextGraph reads).
      let session = null;
      if (observationSessionsStore) {
        session = await observationSessionsStore.getSession(workspace.urlKey, sessionId);
      }
      if (!session) {
        // LIN-1022: try the issue-scoped point-read first (same class fix as
        // session-summary). A stamped session is reconstructed faithfully without
        // the issueGraph; only a historical inference-grouped session (no sessionId
        // stamps) falls through to the issueGraph-enriched whole-workspace read,
        // which the inference fallback genuinely needs.
        session = await pointReadSession(workspace.urlKey, sessionId);
      }
      if (!session) {
        const issueGraph = deriveIssueGraph(issues);
        const sessions = await getSessionsForWorkspace(workspace.urlKey, { ...loopDeps, issueGraph });
        session = sessions.find(s => String(s.sessionId) === String(sessionId)) || null;
      }
      if (!session) {
        keepalive.stop();
        return keepalive.send(404, { error: 'Session not found' });
      }

      const graph = buildSessionContextGraph(issues, session.tasksTouched, {
        seedIssue: session.seedIssue,
        window: { start: session.dispatchedAt, end: session.completedAt }
      });

      keepalive.stop();
      return keepalive.send(200, {
        sessionId,
        seedIssue: session.seedIssue,
        tasksTouched: session.tasksTouched,
        window: { dispatchedAt: session.dispatchedAt, completedAt: session.completedAt },
        graph,
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Dashboard session-context error:', error);
      keepalive.stop();
      if (error.response?.status === 401) {
        return keepalive.send(401, { error: 'Token expired or invalid' });
      }
      return keepalive.send(500, { error: 'Could not build session context' });
    }
  });

  // ─── Lazy Linear hydration (drill-down only) ──────────────────────────────────
  // Best-effort: fetch live state/labels for ONE issue in ONE workspace, using
  // that workspace's own token. Failure (expired token, not found) degrades to a
  // null hydration — the run detail still renders from the Mongo Loop data.

  router.get('/workspace/:urlKey/api/dashboard/hydrate/:wsUrlKey/:identifier', workspaceFromUrl, async (req, res) => {
    const { wsUrlKey, identifier } = req.params;
    // Only hydrate workspaces the user is actually connected to (never trust the path).
    const connected = (req.session.workspaces || []).some(w => w.urlKey === wsUrlKey);
    if (!connected) return res.status(403).json({ error: 'Not connected to that workspace' });

    try {
      const token = await getWorkspaceAccessToken(wsUrlKey);
      if (!token) return res.json({ hydrated: false, reason: 'no_token' });

      const context = await fetchIssueContext(token, identifier);
      const issue = context?.issue || context || {};
      res.json({
        hydrated: true,
        identifier,
        state: issue.state ? { name: issue.state.name, type: issue.state.type } : null,
        labels: Array.isArray(issue.labels?.nodes)
          ? issue.labels.nodes.map(l => l.name)
          : (Array.isArray(issue.labels) ? issue.labels : []),
        assignee: issue.assignee?.name || null,
        url: issue.url || null
      });
    } catch (error) {
      // Best-effort: never 500 the drill-down on a hydration miss.
      res.json({ hydrated: false, reason: /not found/i.test(error?.message) ? 'not_found' : 'unavailable' });
    }
  });

  return router;
}

/**
 * Deterministic run summary for test mode — derived from the Loop fields, no AI.
 * Exported for unit tests.
 */
export function buildTestSummary(loop) {
  const what = [];
  if (loop.stage) what.push(`Ran the ${loop.stage} stage`);
  if (loop.agentSummary) what.push(String(loop.agentSummary).slice(0, 120));
  const fbCount = Array.isArray(loop.feedback) ? loop.feedback.length : 0;
  if (fbCount) what.push(`${fbCount} feedback message${fbCount === 1 ? '' : 's'} posted`);
  return parseRunSummaryResponse(JSON.stringify({
    outcome: `${loop.issueIdentifier || 'Run'} ${loop.agentState === 'error' ? 'ended with an error' : 'completed'} (iteration ${loop.iteration ?? 1})`,
    whatHappened: what.length ? what : ['No additional run detail recorded'],
    blockers: loop.agentState === 'error' ? ['Run reported an error state'] : [],
    next: ''
  }));
}

/**
 * Deterministic session summary for test mode — derived from the session record,
 * no AI. Exported for unit tests (LIN-592).
 */
export function buildTestSessionSummary(session) {
  const tasks = Array.isArray(session?.tasksTouched) ? session.tasksTouched : [];
  const n = tasks.length;
  const plural = n === 1 ? '' : 's';
  return parseSessionSummaryResponse(JSON.stringify({
    outcome: `Session ${session?.sessionId || 'unknown'} completed across ${n} task${plural}${tasks.length ? ` (${tasks.join(', ')})` : ''}`,
    statusLine: `Wrapping up ${n} task${plural}`,
    highlights: tasks.slice(0, 4).map(t => `Touched ${t}`)
  }));
}
