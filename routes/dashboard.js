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
 *   GET      /workspace/:urlKey/api/dashboard/rulings              — unanswered-decision feed (ambient count + rulings tab; LIN-1728)
 *   POST     /workspace/:urlKey/api/dashboard/rulings/dismiss      — dismiss a loop-backed ruling with no comment (LIN-2225; the task-bound sibling reuses the existing scan dismiss route instead)
 *   POST     /workspace/:urlKey/api/dashboard/rulings/shelve       — shelve any ruling with a reason + re-surface timer (LIN-1727; view-only, works uniformly for loop-backed and task-bound)
 *   GET      /workspace/:urlKey/escalation-kpis                    — operator-facing escalation KPI audit page (LIN-1736; rate, time-to-response, false-escalation, unanswered age); ?windowDays= (default 30), ?targetPerDay= (optional)
 *   GET      /workspace/:urlKey/api/escalation-kpis                — the same KPIs as JSON
 *   GET      /workspace/:urlKey/effort-readout                     — operator-facing per-kind effort x cost x duration x survived-the-next-gate read-out (LIN-2641); URL-only, unflagged and unlinked
 *   GET      /workspace/:urlKey/api/effort-readout                 — the same read-out as JSON
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

import { Router, json } from 'express';
import { jsonError } from '../lib/errors.js';
import { renderObservationPage as renderObservationPageImpl } from '../lib/render-observation.js';
import { renderSessionPage } from '../lib/render-session.js';
import { getLoopsForWorkspace, getLoopsForIssue, getSessionsForWorkspace, getSessionsForIssues, deriveIssueGraph, resolvedDecisionEvents, firstRaisedAt } from '../lib/pipeline-loops.js';
import { computeEscalationKpis } from '../lib/escalation-kpis.js';
import { renderEscalationKpisPage } from '../lib/render-escalation-kpis.js';
import { computeEffortReadout, eligibleIssueIdentifiers } from '../lib/effort-readout.js';
import { renderEffortReadoutPage } from '../lib/render-effort-readout.js';
import { classifyUpstreamError, isAuthError } from '../lib/errors.js';
import { renderUpstreamAwareErrorPage } from '../lib/render-pages.js';
import { resolveIssueBinding } from '../lib/workspace.js';
import { buildSessionContextGraph } from '../lib/context-graph.js';
import { deriveTerminalStatus, deriveCompletedAt, findWakeEvent } from '../lib/dispatch-terminal.js';
import { armKeepalive } from '../lib/http-keepalive.js';
import { createSessionsFeedCache } from '../lib/sessions-feed-cache.js';
import { createTaskDoneCache } from '../lib/task-done-cache.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { computeSupersededLoopIds } from '../lib/loop-supersede.js';
import { collectUnansweredDecisions } from '../lib/unanswered-decisions.js';
import { collectAgentTokenIds, foldCredentialIndex } from '../lib/credential-state.js';
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

// Max per-issue provider round trips in flight for the effort read-out's
// comment/description fan-out (LIN-2641). Deliberately its OWN constant rather
// than a reuse of WORKSPACE_FANOUT_CONCURRENCY above: that one bounds a
// cross-WORKSPACE Loop-graph fan-out whose per-slot cost is a full 30-day
// history materialisation, while this bounds per-ISSUE HTTP reads against one
// provider. They are different resources with different right answers, and
// coupling them would make a change to either silently re-tune the other.
const EFFORT_READOUT_ISSUE_CONCURRENCY = 4;

// The history read's row bound (LIN-2641). `listHistory` sorts { resolvedAt: -1 }
// and pushes this into the query, so it means "the 200 most recently RESOLVED
// rows", not the 200 most recently dispatched. The paired live read
// (`listItems`) takes NO limit — the method has no such option; it is bounded
// only by its own TTL predicate (expiresAt > now). The two reads therefore
// carry two different bounds, and the page states each honestly rather than
// one shared number.
const EFFORT_READOUT_HISTORY_LIMIT = 200;

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
export async function settleWithConcurrency(items, limit, mapper) {
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
 * `{ waiting, message }`. `waiting` is true when a chain TAIL loop is waiting on a
 * human; `message` is the first available blocked/pending text (falling back to
 * the waiting run's agent summary) so the UI can show the actual message rather
 * than a manufactured taxonomy. Pure; the single truth shared by the feed payload
 * and the session-page banner so they can never disagree.
 *
 * LIN-1341 (RC2, block-then-replied): a loop that has since been followed up on
 * WITHIN THIS SESSION is superseded by its follower and excluded from the
 * rollup — otherwise a reply that resolves a `[blocked]` loop would leave the
 * session waiting forever, since feedback is append-only per loop and the
 * original loop's last marker never changes. A loop nothing in the session
 * resumes (the common case, and every chain's tail) still counts, so an
 * ordinary standalone block is unaffected; a session with several independent
 * chains/workers evaluates each chain's own tail.
 *
 * Exported for unit tests (LIN-1478) — the supersede characterization/agreement
 * test asserts this against `lib/render-session.js`'s per-run mirror directly.
 *
 * @param {Array<Object>} enrichedLoops - loops already run through `enrichLoop`
 * @returns {{
 *   waiting: boolean,
 *   message: string|null,
 *   producerLoopId: string|null,
 *   decision: Object|null,
 *   decisionCase: Array
 * }} `message`/`producerLoopId`/`decision`/`decisionCase` all come from the
 *   SAME loop — the first non-superseded, waiting loop whose
 *   `waitingMessage || agentSummary` is truthy (one producer, always). If
 *   `waiting` is true but no waiting loop has message text, all four stay
 *   null/empty — a provenance pointer is meaningless without a message to
 *   attach it to, so a message-less loop's decision is never surfaced this way.
 */
export function deriveSessionWaiting(enrichedLoops) {
  const supersededLoopIds = computeSupersededLoopIds(enrichedLoops);
  let waiting = false;
  let message = null;
  let producerLoopId = null;
  let decision = null;
  let decisionCase = [];
  let foundProducer = false;
  for (const l of enrichedLoops) {
    if (!l || supersededLoopIds.has(l.loopId)) continue;
    if (!loopIsWaiting(l)) continue;
    waiting = true;
    if (foundProducer) continue;
    const text = l.waitingMessage || l.agentSummary || null;
    if (!text) continue;
    foundProducer = true;
    message = text;
    producerLoopId = l.loopId;
    decision = l.decision || null;
    decisionCase = Array.isArray(l.decisionCase) ? l.decisionCase : [];
  }
  return { waiting, message, producerLoopId, decision, decisionCase };
}

/**
 * Most-relevant activity timestamp for a run, used to sort the merged feed.
 * Prefers the truthful completion time (terminal feedback marker) so a run that
 * just finished sorts above an older still-running one.
 *
 * LIN-1477: also takes the lineage heartbeat (`loop.lineageLastActivityMs`,
 * emitted by `lib/pipeline-loops.js`) into account, so a loop whose lineage has
 * since beaten on a follow-up run reads as recently active even though ITS OWN
 * timestamps predate that beat — the max of the two, never a replacement. This
 * is the only lineage input into the activity clock; identity/terminal
 * derivation elsewhere are untouched.
 * @param {Object} loop
 * @returns {number} epoch ms (0 when unknown)
 */
function loopActivityMs(loop) {
  const t = loop.completedAt || loop.agentTimestamp || loop.resolvedAt || loop.dispatchedAt;
  const ownMs = t ? new Date(t).getTime() : 0;
  const lineageMs = Number.isFinite(loop.lineageLastActivityMs) ? loop.lineageLastActivityMs : 0;
  const ms = Math.max(ownMs, lineageMs);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Enrich a Loop with its effective (marker-aware) agentState and completion
 * time. Returns a shallow copy; the stored record is never mutated.
 * @param {Object} loop
 * @returns {Object}
 */
// Exported for routes/proxy-rulings.js (LIN-2444): the consumer-API rulings
// read needs loops shaped exactly as the rulings feed shapes them, because
// `resolveDisposition` (lib/unanswered-decisions.js) reads `agentState`. Shared
// by export rather than copied — a second local enrichment would drift from
// this one silently, and the two would then disagree about whether a ruling can
// be replied to.
export function enrichLoop(loop) {
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
 * @param {Object}   [deps.taskDecisionsStore]     - scan-produced task decisions store (LIN-2215), threaded into /api/dashboard/rulings
 * @param {Object}   [deps.shelvedRulingsStore]    - shelved-rulings store (LIN-1727), threaded into /api/dashboard/rulings
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
  // LIN-1588: the proxy-event store, source of Beat 1's per-token credential
  // verdict. Read ONLY by the per-session page (a page load, never the feed
  // poll). Default null → the credential line degrades to `unknown`, which is
  // also its ordinary rendering, so an unwired test sees no behaviour change.
  proxyEventStore = null,
  freeTierStore,
  getWorkspaceAccessToken,
  fetchIssueContext,
  fetchWorkspaceIssues,
  getOpenRouterSource,
  getDeployInfo,
  workspacePreferencesStore = null,
  recentLimit = 120,
  sessionsFeedCache = createSessionsFeedCache(),
  // Touched-task done-state TTL cache (LIN-1258): 60s, keyed `${wsUrlKey}::${identifier}`.
  // Under the LIN-617 feed-output cache: when the feed refreshes and re-runs
  // mergeSessions, an eligible session's touched tasks are served from here instead
  // of re-reading the backend every ~5s. Injectable (like sessionsFeedCache) so a
  // test can supply an injectable-clock cache and drive the cross-TTL boundary
  // directly (LIN-1259, item 2 hardening).
  taskDoneCache = createTaskDoneCache(),
  // Scan-produced task decisions (LIN-2215), the rulings feed's second input
  // alongside `loops` — see the /api/dashboard/rulings handler below. Default
  // null → the taskDecisions branch is simply skipped (collectUnansweredDecisions
  // defaults it to []), same degrade-gracefully convention as briefCacheStore/
  // recapCacheStore/proxyEventStore above, so an unwired test sees no behaviour change.
  taskDecisionsStore = null,
  // Shelved rulings (LIN-1727), the rulings feed's THIRD input, alongside
  // `loops` and `taskDecisions` — see the /api/dashboard/rulings handler
  // below. Default null → the shelving branch is simply skipped
  // (collectUnansweredDecisions defaults it to []), same degrade-gracefully
  // convention as taskDecisionsStore above.
  shelvedRulingsStore = null,
  // Proposed dismissals (LIN-2444), the rulings feed's FOURTH input. An agent
  // may PROPOSE that a ruling be dismissed and never perform one, so the
  // proposal has to reach the surface where a human can agree to it — this
  // one. Without it the whole feature is write-only. Default null → the
  // suggestion join is skipped and every row reports
  // `suggestedDismissal: null`, same degrade-gracefully convention as the
  // three stores above.
  dismissalSuggestionsStore = null,
  // Per-LLM-call cost log (LIN-418), read ONLY by the Observation page load
  // (LIN-2706) to derive the Scan-due tab's pre-run cost estimate. Default
  // null -> the estimate degrades to `unknown` via the `.catch(() => null)`
  // below, same degrade-gracefully convention as the stores above.
  llmCallLogStore = null,
  // DI seam (LIN-2706), defaulting to the real renderer: this module has no
  // module-mock story (mock.module needs --experimental-test-module-mocks,
  // not opted into anywhere in this repo — same constraint documented in
  // tests/unit/flight-companion-turn-route.test.js), so a test that needs the
  // observation page handler's try/catch to see a throwing render call
  // injects a stub here instead, same narrow-DI pattern as that file's
  // `chatClient`/`createToolCatalog`.
  renderObservationPage = renderObservationPageImpl
}) {
  const router = Router();
  const loopDeps = { dispatchStore: dispatchQueueStore, agentStatusStore };

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
  //
  // `lastActivityOverrideMs` (LIN-1314) lets the post-build descendant rollup pass
  // (`rollupDescendantActivity`) re-derive a session's payload with a subtree-wide
  // recency value instead of its own-group `sessionActivityMs` — the same
  // in-place-mutate-and-re-derive shape `hydrateTouchedTaskDone` already uses for
  // `taskDone`, so `stale`/`status`/the emitted `lastActivity` stamp stay
  // consistent with whichever value is authoritative.
  function buildSessionPayload(session, ws, taskDone = false, lastActivityOverrideMs = null) {
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
    // `blocked` run and any latest `[blocked]`/`[pending]` feedback marker across
    // the session's loops, from the lean-safe pre-derived per-loop facts. Terminal
    // precedence is gated HERE on the emitted flag (not only in `deriveSessionStatus`):
    // the session anchor can post `[done]` while a worker loop lingers `[blocked]`, so
    // the raw rollup must be `&&`-gated on session terminality or the flag contradicts
    // the `done` status ("a finished session is never waiting", LIN-1005 review).
    const { waiting: rawWaiting, message: rawWaitingMessage, producerLoopId, decision, decisionCase } = deriveSessionWaiting(enriched);
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
      ticketWalk: telemetry.ticketWalk || null,
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

    // Bounded, TTL-cached server-side hydration of the touched tasks' live
    // done-state (LIN-1258/LIN-1259, Axis B) — the only way the collapsed/feed card
    // can reflect a `done-with-warning` without a per-poll Linear read. Mutates the
    // eligible entries' `.payload` in place.
    await hydrateTouchedTaskDone(built);

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
  async function hydrateTouchedTaskDone(built) {
    // Eligible = errored-terminal sessions with ≥1 touched task. `payload.status
    // === 'error'` is exactly `terminal && hasError` (deriveSessionStatus: `stale`
    // only holds for non-terminal sessions, and taskDone is false at this point).
    const eligible = built.filter(b =>
      b.payload.status === 'error' && Array.isArray(b.payload.tasksTouched) && b.payload.tasksTouched.length > 0);
    if (eligible.length === 0) return;

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
    if (pending.length === 0) return;

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
            const token = await getWorkspaceAccessToken(b.ws.urlKey);
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

    if (deferred > 0) {
      console.log(`Observation: bounded feed hydration read cap (${FEED_HYDRATION_CAP}) reached; deferring ${deferred} errored session(s) to a later poll (LIN-1258/LIN-1259)`);
    }
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

  // ─── HTML page ──────────────────────────────────────────────────────────────

  // First-class observation page (LIN-595): no feature flag (mirrors swim).
  //
  // Async since LIN-2706, to await the scan cost estimate read below.
  // Express ^4.18.2 never awaits a route handler's returned promise, so the
  // entire body -- the store read, renderObservationPage, and res.send --
  // stays inside one try/catch: an uncaught rejection anywhere here would
  // otherwise become an unhandled rejection that server.js's process-level
  // net logs but never answers, hanging the request instead of 500ing it
  // (mirrors /escalation-kpis and /effort-readout below).
  router.get('/workspace/:urlKey/observation', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    try {
      const scanCostEstimate = llmCallLogStore
        ? await llmCallLogStore.summarizeByFeature(workspace.urlKey, 'scan').catch(() => null)
        : null;
      const html = renderObservationPage(
        {
          workspaces: (req.session.workspaces || []).map(w => ({ urlKey: w.urlKey, name: w.name }))
        },
        {
          deployInfo: getDeployInfo(),
          urlKey: workspace.urlKey,
          openRouterSource: getOpenRouterSource(req),
          workspaces: req.session.workspaces,
          featureFlags: getFeatureFlags(req.session),
          scanCostEstimate
        }
      );
      res.send(html);
    } catch (error) {
      console.error('Observation page error:', error);
      res.status(500).send('Failed to render the Observation page');
    }
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
      const { waiting: rawWaiting, message: rawWaitingMessage, producerLoopId, decision, decisionCase } = deriveSessionWaiting(enrichedLoops);
      const waiting = !sessionTerminal && rawWaiting;
      const waitingMessage = waiting ? rawWaitingMessage : null;

      // Per-run inline reply (LIN-1004/LIN-1133; LIN-1163 removed the page-level
      // box): gated to cli/web sessions (never dash/local — the dispatch route
      // rejects followUpTo for those anyway). Each run's own box replies via its
      // own `loop.target`, so the session-wide target no longer needs deriving
      // here — only the gate (from the anchor run) is still needed.
      const anchorLoop = findAnchorLoop(session) || (session.loops && session.loops[0]) || null;
      const anchorTarget = (anchorLoop && anchorLoop.target) || null;
      const canReply = anchorTarget !== 'dash' && anchorTarget !== 'local';
      const anchorIssueTitle = (anchorLoop && anchorLoop.issueTitle) || null;

      // Per-session credential state (LIN-1588, Beat 2). One bounded, single-
      // workspace Mongo read on a PAGE-LOAD path — never the feed poll, whose
      // no-LLM/no-fan-out cost contract is untouched — and skipped entirely when
      // no run in this session carries a credential identity (the ordinary case
      // per LIN-1585). The verdict itself is Beat 1's, computed inside
      // `listCredentialHealth`; nothing here re-derives it.
      const credentialByToken = await readSessionCredentials(workspace.urlKey, session);

      const html = renderSessionPage(
        { session, sessionId, issueContext, waiting, waitingMessage, producerLoopId, decision, decisionCase, urlKey: workspace.urlKey, canReply, sessionTerminal, credentialByToken, anchorIssueTitle },
        pageOptions
      );
      res.send(html);
    } catch (error) {
      next(error);
    }
  });

  /**
   * Resolve the credential verdicts for the tokens THIS session's runs carry
   * (LIN-1588, Beat 2 of LIN-1577).
   *
   * Reuse by call: the rule lives in Beat 1's `listCredentialHealth`
   * (lib/proxy-events.js) and executes there; this only reads it and folds the
   * result to the `tokenId → verdict` index the renderer resolves against.
   *
   * Skipped entirely when no run carries a non-null `agentTokenId` — per
   * LIN-1585 that is ~99.86% of sessions — so the common page load pays nothing.
   * Beat 1's own 15-minute window is used unwidened: a session older than it has
   * no recent evidence, and `unknown` is the honest answer for that, not a
   * reason to ask a longer question.
   *
   * Degrades to `{}` (→ every run `unknown`) on a failed read rather than
   * failing the page: the credential line is a diagnostic, not the content.
   *
   * @param {string} urlKey
   * @param {Object} session - the non-lean reconstructed session
   * @returns {Promise<Object<string, string>>} tokenId → verdict
   */
  async function readSessionCredentials(urlKey, session) {
    if (!proxyEventStore) return {};
    const loops = Array.isArray(session && session.loops) ? session.loops : [];
    if (!collectAgentTokenIds(loops).size) return {};
    try {
      const { tokens } = await proxyEventStore.listCredentialHealth(urlKey);
      return foldCredentialIndex(tokens || []);
    } catch (err) {
      console.error('Session page credential-health read failed:', err.message);
      return {};
    }
  }

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

  // ─── Filtered rulings feed (LIN-1728 Phase 2) ─────────────────────────────────

  // One cached read backs both consumers (the ambient nav badge, Phase 3, and the
  // rulings tab, Phase 4) — same `sessionsFeedCache` instance as `/sessions`, just
  // a separate `rulings` view namespace so the two payload shapes never collide on
  // one cache entry for the same workspace set (LIN-1728 plan decision 2/3).
  // Cross-workspace by design (decision 2's "third obs-tab" host), but per the
  // plan's constraint the ambient count stays scoped to `req.session.workspaces`
  // like every other Observation read here — never fleet-wide.
  router.get('/workspace/:urlKey/api/dashboard/rulings', workspaceFromUrl, async (req, res) => {
    const workspaces = (req.session.workspaces || []).map(w => ({ urlKey: w.urlKey, name: w.name }));

    const keepalive = armKeepalive(res);
    try {
      const merged = await sessionsFeedCache.get(
        sessionsFeedCache.keyFor(workspaces, 'rulings'),
        () => mergeLoops(workspaces)
      );
      // Additive second input (LIN-2215) — same `workspaces` scope as the
      // loops read above, never fleet-wide. The store read is local/fast
      // (matching this route's other per-request store calls), so no second
      // caching layer is introduced here. The `loops` line/logic above is
      // untouched.
      const taskDecisions = taskDecisionsStore
        ? await taskDecisionsStore.listUnansweredForWorkspaces(workspaces.map(w => w.urlKey))
        : [];
      // Additive THIRD input (LIN-1727) — same `workspaces` scope, same
      // local/fast-read discipline as taskDecisions above; no new caching
      // layer. Raw rows; collectUnansweredDecisions owns the active/lapsed
      // reduction.
      const shelvedRulings = shelvedRulingsStore
        ? await shelvedRulingsStore.listForWorkspaces(workspaces.map(w => w.urlKey))
        : [];
      // Additive FOURTH input (LIN-2444). Scoped to the same `workspaces` set
      // as every other read here, never fleet-wide; a WITHDRAWN row is not a
      // standing proposal (the human already pressed Keep) and is excluded
      // here rather than in the store, which returns raw rows so exactly one
      // place owns that predicate.
      const suggestions = dismissalSuggestionsStore
        ? await dismissalSuggestionsStore.listForWorkspaces(workspaces.map(w => w.urlKey))
        : [];
      const standingSuggestions = new Map();
      for (const s of suggestions) {
        if (!s.withdrawn && s.urlKey && s.decisionId) standingSuggestions.set(`${s.urlKey}::${s.decisionId}`, s);
      }

      const rulings = collectUnansweredDecisions({ loops: merged, taskDecisions, shelvedRulings }, { now: new Date() })
        .map(row => {
          // Keyed on (workspace, decisionId), not decisionId alone: a
          // decision_id is agent-invented free text and is not globally
          // unique, so the same string in two workspaces must not share one
          // proposal — the same composite-key reasoning
          // lib/shelved-rulings-store.js already records.
          const key = `${row.anchor?.workspaceUrlKey || ''}::${row.decision?.decision_id || ''}`;
          const suggestion = standingSuggestions.get(key) || null;
          return {
            ...row,
            suggestedDismissal: suggestion
              ? { reason: suggestion.reason, suggestedBy: suggestion.suggestedBy, suggestedAt: suggestion.suggestedAt }
              : null
          };
        });

      keepalive.stop();
      keepalive.send(200, {
        workspaces,
        count: rulings.length,
        rulings,
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Dashboard rulings error:', error);
      keepalive.stop();
      keepalive.send(500, { error: 'Could not load rulings' });
    }
  });

  // ─── Dismiss a loop-backed ruling (LIN-2225) ──────────────────────────────
  //
  // The task-bound sibling already has a dismiss path — a scan-produced
  // decision's own `outcome: 'dismissed'` column
  // (`POST /workspace/:urlKey/api/scan/:issueId/dismiss`, LIN-2211/LIN-2197
  // Phase 4) — so the Rulings page client calls that route directly for a
  // task-bound row rather than duplicating it here. A loop-backed decision has
  // no such column: `dispatchQueueStore` only ever carries the single
  // `decision-answer` stamp, so dismiss reuses `markDecisionAnswered` verbatim
  // with an explicit `'dismissed'` outcome tagged into that same stamp
  // (`lib/dispatch-store.js`) — the ruling clears from the unanswered queue
  // exactly like a genuine answer (`lib/pipeline-loops.js`'s
  // `_findDecisionAnswer` only ever reads `decision_id`), while staying
  // distinguishable in storage for a later false-escalation KPI read
  // (LIN-1736). No comment is posted — dismiss is deliberately silent, unlike
  // an answer.
  //
  // `:urlKey` targets the RULING's own workspace, mirroring the existing
  // comment route the free-text/option reply already targets
  // (`public/observation.js`'s `deliverRulingReply`) — the rulings feed is
  // cross-workspace, so this is not necessarily the page being viewed from.
  router.post('/workspace/:urlKey/api/dashboard/rulings/dismiss', workspaceFromUrl, json(), async (req, res) => {
    const workspace = req.workspace;
    const { decisionLoopId, decisionId } = req.body || {};
    if (typeof decisionLoopId !== 'string' || !decisionLoopId || typeof decisionId !== 'string' || !decisionId) {
      return jsonError(res, 400, 'decisionLoopId and decisionId are both required');
    }
    try {
      const stamped = await dispatchQueueStore.markDecisionAnswered(decisionLoopId, workspace.urlKey, decisionId, 'dismissed');
      if (!stamped) {
        return jsonError(res, 404, 'No matching ruling to dismiss');
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Ruling dismiss error:', error);
      jsonError(res, 500, 'Failed to dismiss ruling');
    }
  });

  // ─── Shelve a ruling (LIN-1727) ──────────────────────────────────────────
  //
  // A deliberate, designed defer — a reason and a re-surface timer are both
  // required (docs/escalation-philosophy.md §6: silent muting is forbidden).
  // Works uniformly for a loop-backed OR task-bound ruling — unlike answer/
  // dismiss, a shelve never writes to the underlying loop/task-decision row
  // at all (it is a VIEW operation only, keyed on `(urlKey, decisionId)` in
  // `lib/shelved-rulings-store.js`), so this route needs no anchor/disposition
  // branching the way `.../rulings/dismiss` above does.
  const MIN_SHELVE_MS = 5 * 60 * 1000; // 5 minutes
  const MAX_SHELVE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  router.post('/workspace/:urlKey/api/dashboard/rulings/shelve', workspaceFromUrl, json(), async (req, res) => {
    const workspace = req.workspace;
    const { decisionId, reason, resurfaceInMs } = req.body || {};
    if (typeof decisionId !== 'string' || !decisionId) {
      return jsonError(res, 400, 'decisionId is required');
    }
    if (typeof reason !== 'string' || !reason.trim()) {
      return jsonError(res, 400, 'A shelve reason is required — silent muting is not allowed');
    }
    if (typeof resurfaceInMs !== 'number' || !Number.isFinite(resurfaceInMs) || resurfaceInMs < MIN_SHELVE_MS || resurfaceInMs > MAX_SHELVE_MS) {
      return jsonError(res, 400, `resurfaceInMs must be between ${MIN_SHELVE_MS} and ${MAX_SHELVE_MS}`);
    }
    if (!shelvedRulingsStore) {
      return jsonError(res, 503, 'Shelved-rulings store not configured');
    }
    try {
      const record = await shelvedRulingsStore.shelve({ urlKey: workspace.urlKey, decisionId, reason, resurfaceInMs });
      if (!record) {
        return jsonError(res, 500, 'Failed to shelve ruling');
      }
      res.json({ success: true, shelf: record });
    } catch (error) {
      console.error('Ruling shelve error:', error);
      jsonError(res, 500, 'Failed to shelve ruling');
    }
  });

  // ─── Escalation KPIs — operator-facing audit page (LIN-1736) ────────────────
  //
  // Per docs/escalation-philosophy.md §7: escalation rate, time-to-response,
  // false-escalation rate, unanswered age — the tuning loop that keeps the
  // whole system honest. Session-authed, cross-workspace like the rest of
  // Observation; never the public /kpis surface (lib/kpi-stats.js's privacy
  // boundary is untouched by this route). Loads on demand rather than being
  // polled, so a full NON-lean per-workspace read (real feedback[], needed
  // for resolvedDecisionEvents) is acceptable here in a way it would not be
  // on the ambient rulings poll (LIN-2227's own lesson).
  //
  // "Escalation rate per human" reduces here to "per workspace" — see
  // lib/escalation-kpis.js's own docstring for why. `targetPerDay` is
  // deliberately not hardcoded (no software-engineering-context figure has
  // been established for this product); pass `?targetPerDay=` to set one.
  async function computeWorkspaceEscalationKpis(workspaces, { windowMs, now, targetPerDay }) {
    const sinceMs = now.getTime() - windowMs;

    const perWorkspaceLoops = await Promise.all(workspaces.map(urlKey =>
      getLoopsForWorkspace(urlKey, { dispatchStore: dispatchQueueStore, agentStatusStore, lean: false }).catch(() => [])
    ));
    const loops = perWorkspaceLoops.flat();

    const loopResolvedEvents = loops.flatMap(loop => resolvedDecisionEvents(loop.feedback));

    const taskResolvedRows = taskDecisionsStore
      ? await taskDecisionsStore.listResolvedForWorkspaces(workspaces, sinceMs)
      : [];
    const taskResolvedEvents = taskResolvedRows.map(r => ({
      decisionId: r.id, raisedAt: r.scannedAt, resolvedAt: r.outcomeAt, outcome: r.outcome
    }));

    const taskUnansweredRows = taskDecisionsStore
      ? await taskDecisionsStore.listUnansweredForWorkspaces(workspaces)
      : [];
    // Same predicate the live rulings feed uses (routes/dashboard.js's own
    // /api/dashboard/rulings above) — never a second, divergent "is this
    // unanswered" derivation. Deliberately OMITS `shelvedRulings`: unanswered
    // age must stay monotonic regardless of shelving (LIN-1727's own
    // constraint) — a shelved-but-still-unanswered decision must keep
    // counting toward this KPI, not be hidden by it the way it is hidden
    // from the live queue.
    const unansweredRulings = collectUnansweredDecisions({ loops, taskDecisions: taskUnansweredRows }, { now });

    const unansweredRows = unansweredRulings.map(row => {
      if (row.disposition === 'task-bound') {
        // Keyed on the store's OWN key shape: `(id, urlKey)`.
        //
        // The join used to be `(urlKey, decision_id)`. `decision_id` is
        // content, and content is not identity — LIN-2291 fixed one collision
        // on it and LIN-2367 found another. So the id half changes kind: a
        // read-side join keys on the record's own id, which
        // `taskDecisionAnchor` already stamps (`taskDecisionId: entry.id`) and
        // which the store's `toRecord` fills from `_id`.
        //
        // `urlKey` STAYS, and that is not belt-and-braces. `_id` alone is not
        // unique in this system: `_id` is `scan_<issueId8>_<inputHash12>`, and
        // the store partitions by workspace — every one of its own operations
        // is `{_id, urlKey}`-scoped, its own test deliberately creates two rows
        // sharing an `_id` across `ws-a`/`ws-b`, and the MangoDB dev backend
        // does not enforce `_id` uniqueness at all (its default `_id` index
        // carries no `unique: true`). Dropping `urlKey` would have traded one
        // collision axis for another and quietly undone LIN-2291.
        //
        // So this is the store's key, used as a key. Both sides derive from the
        // SAME read in this request, so the match is exact. It is also the
        // shape the rest of the system already uses: the RESOLVED half of this
        // function keys on `r.id` (above), and the reply/dismiss write path
        // calls `markOutcome({urlKey, issueId, id})`.
        //
        // On whether this fixes a LIVE bug: it does not. `lib/scan.js` sets
        // `decision_id` to the same `buildId(issueId, inputHash)` that becomes
        // `_id`, so no producer past or present can emit a colliding
        // `decision_id` here. This closes the class by construction, which is a
        // sufficient reason on its own. (Earlier drafts justified it with a
        // reachable collision instead — first from agent-invented ids, then
        // from a legacy-row window; both were false. See `c07d9f8d` /
        // `10c0f7db` rather than re-deriving them.)
        //
        // The `anchorId` ternary stops an id-less row matching another id-less
        // row. TRADE-OFF, not free: an unmatchable row gets `raisedAt: null`,
        // and `lib/escalation-kpis.js` skips null-raised rows before counting,
        // so it vanishes from `unansweredAge` rather than being mis-aged —
        // honest, but it HIDES a stale ruling, which
        // docs/escalation-philosophy.md §4 calls a defect rather than
        // furniture. Unreachable today: `_id` is always set on a stored row.
        //
        // THE PERMANENT FIX, named and not taken (LIN-313): stamping
        // `scannedAt` onto the anchor in `collectUnansweredDecisions` deletes
        // this re-join outright. It widens into a shape the rulings feed also
        // consumes, so it belongs in its own ticket.
        const anchorId = row.anchor?.taskDecisionId || null;
        const match = anchorId
          ? taskUnansweredRows.find(t => t.id === anchorId && t.urlKey === row.anchor?.workspaceUrlKey)
          : null;
        return { decisionId: row.decision?.decision_id, raisedAt: match?.scannedAt || null };
      }
      const loop = loops.find(l => l.loopId === row.anchor?.loopId);
      return { decisionId: row.decision?.decision_id, raisedAt: firstRaisedAt(loop?.feedback, row.decision?.decision_id) };
    });

    return computeEscalationKpis({
      resolvedEvents: [...loopResolvedEvents, ...taskResolvedEvents],
      unansweredRows,
      windowMs,
      targetPerDay,
      now
    });
  }

  function parseWindowDays(req) {
    const parsed = parseInt(req.query.windowDays, 10);
    return Number.isFinite(parsed) ? Math.max(1, Math.min(365, parsed)) : 30;
  }

  function parseTargetPerDay(req) {
    if (req.query.targetPerDay === undefined) return null;
    const parsed = parseFloat(req.query.targetPerDay);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  router.get('/workspace/:urlKey/escalation-kpis', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const workspaces = (req.session.workspaces || []).map(w => w.urlKey);
    const windowDays = parseWindowDays(req);
    const targetPerDay = parseTargetPerDay(req);
    const now = new Date();

    try {
      const kpis = await computeWorkspaceEscalationKpis(workspaces, { windowMs: windowDays * 24 * 60 * 60 * 1000, now, targetPerDay });
      res.send(renderEscalationKpisPage(workspace.name, {
        urlKey: workspace.urlKey,
        workspaces: req.session.workspaces || [],
        featureFlags: getFeatureFlags(req.session),
        kpis,
        windowDays,
        generatedAt: now.toISOString()
      }));
    } catch (error) {
      console.error('Escalation KPIs page error:', error);
      res.status(500).send('Failed to compute escalation KPIs');
    }
  });

  router.get('/workspace/:urlKey/api/escalation-kpis', workspaceFromUrl, async (req, res) => {
    const workspaces = (req.session.workspaces || []).map(w => w.urlKey);
    const windowDays = parseWindowDays(req);
    const targetPerDay = parseTargetPerDay(req);
    const now = new Date();
    const keepalive = armKeepalive(res);
    try {
      const kpis = await computeWorkspaceEscalationKpis(workspaces, { windowMs: windowDays * 24 * 60 * 60 * 1000, now, targetPerDay });
      keepalive.stop();
      keepalive.send(200, { windowDays, generatedAt: now.toISOString(), ...kpis });
    } catch (error) {
      console.error('Escalation KPIs error:', error);
      keepalive.stop();
      keepalive.send(500, { error: 'Could not compute escalation KPIs' });
    }
  });

  // ─── Effort self-assessment read-out (LIN-2641, Phase 2 of LIN-2566) ───────
  //
  // Per-kind effort x cost x duration x survived-the-next-gate over this
  // workspace's recent dispatch rows. Modelled on the escalation-kpis pair
  // above: a URL-only operator page (unflagged, unlinked) that computes on
  // page load rather than being polled.
  //
  // NOT on the poll path, deliberately. `public/llms.txt` documents that the
  // live feed reads Mongo only — no provider calls per poll — and this route
  // DOES make per-issue provider reads, so it must stay a page-load-only
  // surface. Never move this computation into /api/dashboard/sessions.
  async function computeWorkspaceEffortReadout(workspace, { now }) {
    const urlKey = workspace.urlKey;

    // Two reads, two DIFFERENT bounds (see the constants above). `listItems`
    // is given no `limit` because it accepts none; `listHistory` carries the
    // real one. Projection excludes only `prompt` — `status`, `feedback` and
    // `rootItemId` are all load-bearing for the adapter and both joins.
    const [liveRows, history] = await Promise.all([
      dispatchQueueStore.listItems(urlKey, { projection: { prompt: 0 } }),
      dispatchQueueStore.listHistory(urlKey, { limit: EFFORT_READOUT_HISTORY_LIMIT, projection: { prompt: 0 } }),
    ]);
    const historyRows = history.items || [];

    // The issues the survival walk will actually score — derived through the
    // SAME population rule the compute layer uses, so the set fetched and the
    // set scored cannot drift.
    const identifiers = eligibleIssueIdentifiers({ liveRows, historyRows });

    // One binding for the whole read, resolved from the workspace itself — a
    // dispatch row carries no per-issue provenance to thread as `source`. On a
    // multi-binding workspace a foreign-source issue therefore reads against
    // the wrong provider and fails; that failure is counted as a skip and
    // DISCLOSED in `completeness` rather than silently dropped, so the page
    // under-reports honestly instead of mis-attributing. Threading per-issue
    // provenance would need a `source` on the dispatch row itself.
    const { provider, callScope } = resolveIssueBinding(workspace, null);
    const supports = (name) => typeof provider?.supports === 'function' && provider.supports(name);
    const survivalAvailable = supports('fetchIssueComments');
    // `description` is what `GATE_DUE_MARKER` matches for gateDue/gateHonoured.
    // Without it those two fields would render a uniform zero that is not a
    // measurement, so the compute layer omits them instead.
    const gateFieldsAvailable = supports('fetchIssueFields');

    const issueContext = new Map();
    let skipped = 0;

    if (survivalAvailable && identifiers.length) {
      const settled = await settleWithConcurrency(identifiers, EFFORT_READOUT_ISSUE_CONCURRENCY, async (identifier) => {
        // `fetchIssueComments` (not `fetchIssueContext`) because the verdict
        // walk needs each comment's own `id` + `createdAt`, which only this
        // reader emits. `fetchIssueFields` supplies the description the gate
        // fields are derived from.
        const [comments, fields] = await Promise.all([
          provider.fetchIssueComments(callScope, identifier),
          gateFieldsAvailable ? provider.fetchIssueFields(callScope, identifier) : Promise.resolve(null),
        ]);
        return {
          identifier,
          id: fields?.id || identifier,
          description: typeof fields?.description === 'string' ? fields.description : '',
          comments: Array.isArray(comments) ? comments : [],
        };
      });

      for (const outcome of settled) {
        if (outcome.status === 'fulfilled') {
          const ctx = outcome.value;
          issueContext.set(ctx.identifier, ctx);
          continue;
        }
        // An auth rejection is NOT a skip (LIN-1984's lesson: a run that
        // silently skipped most of its reads still reported success). It is
        // non-retryable and cannot be fixed by rendering partial numbers, so
        // it propagates to the caller's upstream-aware error branch.
        if (isAuthError(outcome.reason)) throw outcome.reason;
        // Retryable (429/5xx/network) — count it, still render, and say so.
        skipped += 1;
      }
    }

    return computeEffortReadout({
      liveRows,
      historyRows,
      historyTotal: history.total ?? historyRows.length,
      issueContext,
      asOf: now.toISOString(),
      skipped,
      survivalAvailable,
      gateFieldsAvailable,
    });
  }

  router.get('/workspace/:urlKey/effort-readout', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const now = new Date();
    try {
      const readout = await computeWorkspaceEffortReadout(workspace, { now });
      res.send(renderEffortReadoutPage(workspace.name, {
        urlKey: workspace.urlKey,
        workspaces: req.session.workspaces || [],
        featureFlags: getFeatureFlags(req.session),
        readout,
        generatedAt: now.toISOString(),
      }));
    } catch (error) {
      if (isAuthError(error)) {
        // No numbers at all on an auth failure. No `actionUrl` is passed on
        // purpose: `renderUpstreamAwareErrorPage` overrides it to /logout for
        // the auth category anyway, because a "Try again" against the same
        // rejected credential is a dead end. Supplying one would read as if
        // the button came back here.
        return res.status(401).send(renderUpstreamAwareErrorPage(error, { time: now.toISOString() }));
      }
      console.error('Effort read-out page error:', error);
      res.status(500).send('Failed to compute the effort read-out');
    }
  });

  router.get('/workspace/:urlKey/api/effort-readout', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const now = new Date();
    const keepalive = armKeepalive(res);
    try {
      const readout = await computeWorkspaceEffortReadout(workspace, { now });
      keepalive.stop();
      keepalive.send(200, { generatedAt: now.toISOString(), ...readout });
    } catch (error) {
      keepalive.stop();
      if (isAuthError(error)) {
        const classified = classifyUpstreamError(error);
        return keepalive.send(401, { error: classified.detail, code: classified.code, retryable: classified.retryable });
      }
      console.error('Effort read-out error:', error);
      keepalive.send(500, { error: 'Could not compute the effort read-out' });
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

    // Test mode: deterministic summary, no OpenRouter call (keeps E2E offline). The full-system
    // hermetic suite sets HARBOUR_DISABLE_AI_MOCK=1 to force the REAL model path against a wire-fake
    // OpenRouter endpoint (Tap 1); unset (every existing test) preserves the offline mock exactly.
    if (process.env.NODE_ENV === 'test' && process.env.HARBOUR_DISABLE_AI_MOCK !== '1') {
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
  // inner try) would escape as an unhandled rejection and could crash the process
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

    // Test mode: deterministic summary, no OpenRouter call (keeps E2E offline). HARBOUR_DISABLE_AI_MOCK=1
    // forces the REAL model path against a wire-fake (Tap 1); unset preserves the offline mock exactly.
    if (process.env.NODE_ENV === 'test' && process.env.HARBOUR_DISABLE_AI_MOCK !== '1') {
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
