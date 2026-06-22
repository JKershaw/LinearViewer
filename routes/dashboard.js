/**
 * Dashboard routes — the experimental combined, realtime autopilot dashboard (LIN-509).
 *
 * Anchored at /workspace/:urlKey/dashboard (reusing workspaceFromUrl + the
 * pipeline feature-gate-redirect-to-settings pattern), the page is *anchored* to
 * one workspace for auth/navbar/gate but *operates* over every connected workspace
 * in `session.workspaces`: it merges the cheap per-workspace Loop reads
 * (getLoopsForWorkspace — pure Mongo, no Linear API) into one cross-workspace feed.
 *
 *   GET      /workspace/:urlKey/dashboard                          — page shell (gated)
 *   GET      /workspace/:urlKey/api/dashboard/loops                — merged cross-workspace runs (poll source)
 *   GET|POST /workspace/:urlKey/api/dashboard/run-summary/:loopId  — cached, on-demand short run summary
 *   GET|POST /workspace/:urlKey/api/dashboard/session-summary/:sessionId — cached session rollup (terminal); cheap latest-child statusLine proxy when live (LIN-592)
 *   GET      /workspace/:urlKey/api/dashboard/hydrate/:urlKey2/:identifier — lazy Linear hydration (drill-down only)
 *
 * Performance rule (LIN-509): the live feed reads Loops from Mongo only — it never
 * fans buildPipelineSnapshot/fetchProjects out per poll. Linear issue metadata is
 * hydrated lazily, only inside an open drill-down, for that one workspace's token,
 * best-effort (an expired-token workspace still lists its runs from Mongo).
 */

import { Router } from 'express';
import { renderDashboardPage } from '../lib/render-dashboard.js';
import { getLoopsForWorkspace, getSessionsForWorkspace } from '../lib/pipeline-loops.js';
import { deriveTerminalStatus, deriveCompletedAt } from '../lib/dispatch-terminal.js';
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
  const marker = deriveTerminalStatus(loop.feedback);
  return marker ? MARKER_TO_AGENT_STATE[marker] : loop.agentState;
}

function isTerminalLoop(loop) {
  return !!loop && TERMINAL_AGENT_STATES.has(loop.agentState);
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
  return {
    ...loop,
    agentState: effectiveAgentState(loop),
    completedAt: deriveCompletedAt(loop.feedback) || (isTerminalLoop(loop) ? (loop.resolvedAt || null) : null)
  };
}

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl        - middleware: session + req.workspace
 * @param {Object}   deps.dispatchQueueStore       - dispatch store (listItems/listHistory)
 * @param {Object}   deps.agentStatusStore             - agent status store
 * @param {Object}   deps.runSummaryCacheStore     - run-summary cache store
 * @param {Object}   deps.sessionSummaryCacheStore - session-summary cache store (LIN-592)
 * @param {Object}   deps.freeTierStore            - free-tier usage store (rate limit)
 * @param {Function} deps.getWorkspaceAccessToken  - (urlKey) → token (lazy hydration only)
 * @param {Function} deps.fetchIssueContext        - (token, identifier) → issue context (lazy hydration)
 * @param {Function} deps.getOpenRouterSource      - (req) → 'oauth'|'env'|'free'|null
 * @param {Function} deps.getDeployInfo            - () → deploy metadata
 * @param {number}   [deps.recentLimit=120]        - cap on terminal runs returned by /loops
 * @returns {Router}
 */
export function createDashboardRoutes({
  workspaceFromUrl,
  dispatchQueueStore,
  agentStatusStore,
  runSummaryCacheStore,
  sessionSummaryCacheStore,
  freeTierStore,
  getWorkspaceAccessToken,
  fetchIssueContext,
  getOpenRouterSource,
  getDeployInfo,
  recentLimit = 120
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
    const settled = await Promise.allSettled(
      workspaces.map(async (ws) => {
        const loops = await getLoopsForWorkspace(ws.urlKey, loopDeps);
        return loops.map(loop => ({
          ...enrichLoop(loop),
          workspaceUrlKey: ws.urlKey,
          workspaceName: ws.name || ws.urlKey
        }));
      })
    );

    const merged = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') merged.push(...r.value);
      else console.error('Dashboard: loop read failed for a workspace:', r.reason?.message);
    }
    merged.sort((a, b) => loopActivityMs(b) - loopActivityMs(a));
    return merged;
  }

  // ─── HTML page ──────────────────────────────────────────────────────────────

  router.get('/workspace/:urlKey/dashboard', workspaceFromUrl, (req, res) => {
    const workspace = req.workspace;
    const featureFlags = getFeatureFlags(req.session);

    // Gate: experimental feature must be enabled (mirrors pipeline/collective).
    if (featureFlags.dashboard !== true) {
      return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings`);
    }

    const html = renderDashboardPage(
      {
        workspaces: (req.session.workspaces || []).map(w => ({ urlKey: w.urlKey, name: w.name }))
      },
      {
        deployInfo: getDeployInfo(),
        urlKey: workspace.urlKey,
        openRouterSource: getOpenRouterSource(req),
        workspaces: req.session.workspaces,
        featureFlags
      }
    );
    res.send(html);
  });

  // ─── Merged cross-workspace loops (poll source) ───────────────────────────────

  router.get('/workspace/:urlKey/api/dashboard/loops', workspaceFromUrl, async (req, res) => {
    if (getFeatureFlags(req.session).dashboard !== true) {
      return res.status(403).json({ error: 'Dashboard feature is not enabled' });
    }

    const workspaces = (req.session.workspaces || []).map(w => ({ urlKey: w.urlKey, name: w.name }));

    try {
      const merged = await mergeLoops(workspaces);
      const active = merged.filter(l => !isTerminalLoop(l));
      const recent = merged.filter(isTerminalLoop).slice(0, recentLimit);

      res.json({
        workspaces,
        active,
        recent,
        counts: { active: active.length, recent: recent.length, total: merged.length },
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Dashboard loops error:', error);
      res.status(500).json({ error: 'Could not load runs' });
    }
  });

  // ─── On-demand short run summary (cached) ─────────────────────────────────────

  async function handleRunSummary(req, res, { force }) {
    if (getFeatureFlags(req.session).dashboard !== true) {
      return res.status(403).json({ error: 'Dashboard feature is not enabled' });
    }
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

  router.get('/workspace/:urlKey/api/dashboard/run-summary/:loopId', workspaceFromUrl, (req, res) =>
    handleRunSummary(req, res, { force: false }));

  router.post('/workspace/:urlKey/api/dashboard/run-summary/:loopId', workspaceFromUrl, (req, res) =>
    handleRunSummary(req, res, { force: true }));

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

  // Marker-aware terminal check for a raw session loop (loops from
  // getSessionsForWorkspace are not pre-enriched).
  function loopIsTerminal(loop) {
    return isTerminalLoop(enrichLoop(loop));
  }

  // Is the whole session terminal (cacheable)? Anchor-loop terminality, with an
  // all-loops-terminal fallback for anchorless/orphan sessions.
  function sessionIsTerminal(session) {
    const anchor = findAnchorLoop(session);
    if (anchor) return loopIsTerminal(anchor);
    const loops = Array.isArray(session.loops) ? session.loops : [];
    return loops.length > 0 && loops.every(loopIsTerminal);
  }

  // The cheap live proxy: latest terminal child's cached run-summary.outcome.
  async function liveStatusLine(session, urlKey) {
    const terminalChildren = childLoops(session)
      .filter(loopIsTerminal)
      .map(enrichLoop)
      .sort((a, b) => loopActivityMs(b) - loopActivityMs(a));
    const latest = terminalChildren[0];
    if (!latest) return { statusLine: '', loopId: null };
    let outcome = '';
    if (runSummaryCacheStore) {
      const cached = await runSummaryCacheStore.get(urlKey, latest.loopId);
      outcome = cached?.summary?.outcome || '';
    }
    // No cached run-summary for the latest completed child → fall back to its own
    // agent summary (still no LLM call). Empty when nothing is recorded.
    if (!outcome) outcome = latest.agentSummary ? String(latest.agentSummary) : '';
    return { statusLine: outcome.slice(0, 200), loopId: latest.loopId };
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
    if (getFeatureFlags(req.session).dashboard !== true) {
      return res.status(403).json({ error: 'Dashboard feature is not enabled' });
    }
    if (!sessionSummaryCacheStore) {
      return res.status(503).json({ error: 'Session summary store unavailable' });
    }

    const workspace = req.workspace;
    const { sessionId } = req.params;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    let session;
    try {
      const sessions = await getSessionsForWorkspace(workspace.urlKey, loopDeps);
      session = sessions.find(s => String(s.sessionId) === String(sessionId)) || null;
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

  router.get('/workspace/:urlKey/api/dashboard/session-summary/:sessionId', workspaceFromUrl, (req, res) =>
    handleSessionSummary(req, res, { force: false }));

  router.post('/workspace/:urlKey/api/dashboard/session-summary/:sessionId', workspaceFromUrl, (req, res) =>
    handleSessionSummary(req, res, { force: true }));

  // ─── Lazy Linear hydration (drill-down only) ──────────────────────────────────
  // Best-effort: fetch live state/labels for ONE issue in ONE workspace, using
  // that workspace's own token. Failure (expired token, not found) degrades to a
  // null hydration — the run detail still renders from the Mongo Loop data.

  router.get('/workspace/:urlKey/api/dashboard/hydrate/:wsUrlKey/:identifier', workspaceFromUrl, async (req, res) => {
    if (getFeatureFlags(req.session).dashboard !== true) {
      return res.status(403).json({ error: 'Dashboard feature is not enabled' });
    }

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
