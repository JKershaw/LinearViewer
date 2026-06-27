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
import { getLoopsForWorkspace, getSessionsForWorkspace, deriveIssueGraph } from '../lib/pipeline-loops.js';
import { buildSessionContextGraph } from '../lib/context-graph.js';
import { deriveTerminalStatus, deriveCompletedAt } from '../lib/dispatch-terminal.js';
import { armKeepalive } from '../lib/http-keepalive.js';
import { createSessionsFeedCache } from '../lib/sessions-feed-cache.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
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

// Map a dispatch terminal-feedback marker → a Loop agentState.
const MARKER_TO_AGENT_STATE = { done: 'complete', failed: 'error', aborted: 'error' };

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
 * The observation session status string — the single contract consumed by the
 * client's icon/label maps and CSS (`public/observation.js` / `observation.css`).
 *
 * Five values: `stale`, `in-progress`, `error`, `done`, and `done-with-warning`
 * (LIN-749). `done-with-warning` is the done/error split's 5th outcome: a
 * terminal session that had at least one errored run but whose touched task is
 * now Done — the autopilot finished the task despite the errors (the LIN-744
 * case: two runs failed to launch iTerm, the third completed the work).
 *
 * `taskDone` is the ONLY task-state input. It is NOT proof the task flipped
 * *during* this run (no start-state baseline is recorded; that precise per-run
 * attribution is a tracked cross-repo follow-up) — it approximates "done now ∧
 * ≥1 run errored". It is sourced solely from the existing Linear hydration seam
 * at the terminal boundary, never from the per-poll feed, which honours an
 * explicit no-Linear cost contract and always passes `taskDone=false`. `stale`
 * only ever holds for non-terminal sessions, so its branch is checked first to
 * keep the four pre-existing outcomes byte-identical.
 *
 * Pure; exported for unit tests.
 *
 * @param {{terminal: boolean, stale: boolean, hasError: boolean, taskDone?: boolean}} input
 * @returns {'stale'|'in-progress'|'error'|'done'|'done-with-warning'}
 */
export function deriveSessionStatus({ terminal, stale, hasError, taskDone = false }) {
  if (stale) return 'stale';
  if (!terminal) return 'in-progress';
  if (hasError) return taskDone ? 'done-with-warning' : 'error';
  return 'done';
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
  freeTierStore,
  getWorkspaceAccessToken,
  fetchIssueContext,
  fetchWorkspaceIssues,
  getOpenRouterSource,
  getDeployInfo,
  recentLimit = 120,
  sessionsFeedCache = createSessionsFeedCache()
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
  function buildSessionPayload(session, ws) {
    const anchor = findAnchorLoop(session);
    const enriched = (Array.isArray(session.loops) ? session.loops : []).map(enrichLoop);
    const children = childLoops(session).map(enrichLoop);
    const terminal = sessionIsTerminal(session);
    const lastActivityMs = sessionActivityMs(enriched, session);

    // Derived staleness (Bug 3): a non-terminal session with no activity for >24h
    // is bucketed out of Active. Purely derived from lastActivityMs — never a
    // mutation — so a later heartbeat advances lastActivity and un-stales it.
    const stale = !terminal && lastActivityMs > 0 && (Date.now() - lastActivityMs) > STALE_AFTER_MS;

    // The per-poll feed honours an explicit no-Linear cost contract, so it never
    // looks up the touched task's current state — `taskDone` stays false here.
    // The `done-with-warning` upgrade (LIN-749) is applied client-side from the
    // existing drill-down hydration seam; `deriveSessionStatus` owns the status
    // contract (and its 5th value) in one unit-tested place for both paths.
    const status = deriveSessionStatus({
      terminal,
      stale,
      hasError: enriched.some(l => l.agentState === 'error')
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
   * @returns {Promise<Array<Object>>}
   */
  async function mergeSessions(workspaces) {
    // Per-workspace source of the session objects (LIN-623): the durable
    // `observation-sessions` read-model when present, else the live 30-day
    // reconstruction. The read swap changes ONLY where the session objects come
    // from — `buildSessionPayload` runs byte-identical at read time over either,
    // so the now-relative status/stale/statusLine stay live. issueGraph is still
    // omitted here (a drill-down concern); the materializer matches that by
    // building with no graph too.
    const sessionsForWorkspace = async (ws) => {
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
    // (LIN-622); the derived read makes each workspace cheap.
    const settled = await settleWithConcurrency(workspaces, WORKSPACE_FANOUT_CONCURRENCY,
      async (ws) => {
        const sessions = await sessionsForWorkspace(ws);
        return sessions.map(s => buildSessionPayload(s, ws));
      }
    );
    const merged = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') merged.push(...r.value);
      else console.error('Observation: session read failed for a workspace:', r.reason?.message);
    }
    merged.sort((a, b) => (new Date(b.lastActivity || 0).getTime()) - (new Date(a.lastActivity || 0).getTime()));
    return merged;
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

  // Retired experimental dashboard (LIN-509) → 302 to the first-class page.
  router.get('/workspace/:urlKey/dashboard', workspaceFromUrl, (req, res) => {
    res.redirect(`/workspace/${encodeURIComponent(req.workspace.urlKey)}/observation`);
  });

  // ─── Sessions feed (observation poll source; LIN-595) ─────────────────────────

  router.get('/workspace/:urlKey/api/dashboard/sessions', workspaceFromUrl, async (req, res) => {
    const workspaces = (req.session.workspaces || []).map(w => ({ urlKey: w.urlKey, name: w.name }));

    // Workspace-wide read fanned across every connected workspace (LIN-615). It
    // has no selective predicate to push down, so we bound the *request* with a
    // keepalive heartbeat rather than capping the store read (the workspace
    // branch of _fetchWorkspaceData stays option-free; truncation-footgun guard).
    const keepalive = armKeepalive(res);
    try {
      // Short-TTL stale-while-revalidate cache (LIN-617): only the first poll for
      // this workspace set pays the full scan/reconstruction; later polls are
      // served instantly (refreshed in the background) so the banner stops
      // sitting on its initial "loading…" placeholder. Caches the merged OUTPUT,
      // not the store reads, so the truncation-footgun guard above is untouched.
      const merged = await sessionsFeedCache.get(
        sessionsFeedCache.keyFor(workspaces),
        () => mergeSessions(workspaces)
      );
      // Active vs Archive is recency-only (LIN-631): a session is Active iff it
      // has been touched within the last 24h, regardless of terminal state — so a
      // run that completed <24h ago still shows as Active, and an old non-terminal
      // session correctly drops into Archive. The same predicate is mirrored in
      // public/observation.js (renderFeeds) so server and client buckets agree.
      const now = Date.now();
      const recentlyActive = (s) => {
        const t = Date.parse(s.lastActivity);
        return Number.isFinite(t) && (now - t) <= STALE_AFTER_MS;
      };
      const active = merged.filter(recentlyActive);
      const archive = merged.filter(s => !recentlyActive(s));

      // Archive is paginated (LIN-631): offset/limit page the bounded archive
      // instead of a hard slice(0, recentLimit) that silently hid older entries.
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || ARCHIVE_PAGE_SIZE), recentLimit);
      const recent = archive.slice(offset, offset + limit);

      keepalive.stop();
      keepalive.send(200, {
        workspaces,
        active,
        recent,
        recentTotal: archive.length,
        recentOffset: offset,
        recentLimit: limit,
        counts: { active: active.length, recent: archive.length, total: merged.length },
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

    let loop;
    try {
      const loops = await getLoopsForWorkspace(workspace.urlKey, loopDeps);
      const found = loops.find(l => String(l.loopId) === String(loopId));
      loop = found ? enrichLoop(found) : null;
    } catch (error) {
      console.error('Dashboard run-summary lookup error:', error);
      return res.status(500).json({ error: 'Could not load the run' });
    }
    if (!loop) return res.status(404).json({ error: 'Run not found' });

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
    const useFreeTier = !sessionApiKey && !process.env.OPENROUTER_API_KEY && !!freeTierKey;

    if (!sessionApiKey && !process.env.OPENROUTER_API_KEY && !freeTierKey) {
      return res.status(503).json({ error: 'AI summaries are not configured' });
    }

    if (useFreeTier && freeTierStore) {
      const check = await freeTierStore.tryUse(workspace.urlKey);
      if (!check.allowed) {
        return res.status(429).json({ error: check.reason, freeTier: { used: true, remaining: check.remaining, limit: check.limit, resetsAt: check.resetsAt } });
      }
    }

    try {
      const apiKey = sessionApiKey || (useFreeTier ? freeTierKey : undefined);
      const { summary, model } = await generateRunSummary(loop, { apiKey, model: DEFAULT_RUN_SUMMARY_MODEL });
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

    // Find one session by id. Prefer the materialized read-model point-read
    // (LIN-632) and degrade to the full 30-day workspace reconstruction on a
    // miss — the same fix as the session-context path, removing a second
    // reconstruct-by-id antipattern.
    let session = null;
    try {
      if (observationSessionsStore) {
        session = await observationSessionsStore.getSession(workspace.urlKey, sessionId);
      }
      if (!session) {
        const sessions = await getSessionsForWorkspace(workspace.urlKey, loopDeps);
        session = sessions.find(s => String(s.sessionId) === String(sessionId)) || null;
      }
    } catch (error) {
      console.error('Dashboard session-summary lookup error:', error);
      return res.status(500).json({ error: 'Could not load the session' });
    }
    if (!session) return res.status(404).json({ error: 'Session not found' });

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
    const useFreeTier = !sessionApiKey && !process.env.OPENROUTER_API_KEY && !!freeTierKey;

    if (!sessionApiKey && !process.env.OPENROUTER_API_KEY && !freeTierKey) {
      return res.status(503).json({ error: 'AI summaries are not configured' });
    }

    if (useFreeTier && freeTierStore) {
      const check = await freeTierStore.tryUse(workspace.urlKey);
      if (!check.allowed) {
        return res.status(429).json({ error: check.reason, freeTier: { used: true, remaining: check.remaining, limit: check.limit, resetsAt: check.resetsAt } });
      }
    }

    try {
      const apiKey = sessionApiKey || (useFreeTier ? freeTierKey : undefined);
      const childOutcomes = await gatherChildOutcomes(session, workspace.urlKey);
      const { summary, model } = await generateSessionSummary(session, { apiKey, model: DEFAULT_SESSION_SUMMARY_MODEL, childOutcomes });
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
