/**
 * The on-demand summary routes (LIN-3742 split of routes/dashboard.js):
 *
 *   GET|POST /workspace/:urlKey/api/dashboard/run-summary/:loopId       — cached, on-demand short run summary
 *   GET|POST /workspace/:urlKey/api/dashboard/session-summary/:sessionId — cached session rollup (terminal); cheap latest-child statusLine proxy when live (LIN-592)
 *
 * TWO handlers on purpose, each with its own free-tier gate call and its own
 * model clamp. A shared summary pipeline would fold the two gate call sites and
 * the two `forceDefault: isFreeTier` clamps into one, and the censuses over
 * the dashboard unit (LIN-513, LIN-2978, LIN-3658) count exactly two of each: one
 * quota unit per request, one clamp per billed call. What the two share is only
 * what does not touch the gate or the clamp (the peek parse, the test-mode flag,
 * the cache-hit replies).
 */
import { Router } from 'express';
import { badRequest, jsonError, notFound, serverError, serviceUnavailable } from '../lib/errors.js';
import { getLoopsForWorkspace, getLoopsForIssue, getSessionsForWorkspace } from '../lib/pipeline-loops.js';
import { isTerminalLoop, loopIsTerminal, enrichLoop, sessionIsTerminal } from '../lib/run-loop-state.js';
import { resolveChatCredential, checkFreeTierGate, freeTierRefusalBlock } from '../lib/chat-request.js';
import { resolveAiOperationModel } from '../lib/workspace-preferences.js';
import { generateRunSummary, parseRunSummaryResponse } from '../lib/run-summary.js';
import { hashLoop } from '../lib/run-summary-cache.js';
import { generateSessionSummary, parseSessionSummaryResponse, childLoops } from '../lib/session-summary.js';
import { hashSession } from '../lib/session-summary-cache.js';
import { loopActivityMs } from './dashboard-session-state.js';

// A peek asks "is there a cached summary?" without paying to generate one.
const isCachedOnly = (req) => req.query.cachedOnly === '1' || req.query.cachedOnly === 'true';

// Test mode: deterministic summary, no OpenRouter call (keeps E2E offline). The full-system
// hermetic suite sets HARBOUR_DISABLE_AI_MOCK=1 to force the REAL model path against a wire-fake
// OpenRouter endpoint (Tap 1); unset (every existing test) preserves the offline mock exactly.
const isTestMock = () => process.env.NODE_ENV === 'test' && process.env.HARBOUR_DISABLE_AI_MOCK !== '1';

// ─── On-demand short run summary (cached) ─────────────────────────────────────

/**
 * Point-read ONE run (Loop) by id (LIN-1022). A loopId IS the dispatch item id
 * (`_buildLoops` sets `loopId: item.id`), so getItemStatus resolves its issue and
 * getLoopsForIssue rebuilds that issue's runs issue-scoped/index-backed with the
 * SAME builders getLoopsForWorkspace runs — byte-identical. Falls back to the
 * whole-workspace read only when the loop can't be issue-scoped (no getItemStatus
 * match, or a loopId that isn't a live/historic dispatch id).
 *
 * @param {Object} ctx - `dispatchQueueStore`, `loopDeps`
 * @param {string} urlKey
 * @param {string} loopId
 * @returns {Promise<Object|null>} the enriched loop, or null if not found
 */
async function loadRunForSummary({ dispatchQueueStore, loopDeps }, urlKey, loopId, { allowFullScan = true } = {}) {
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

// The credential, gate, model and generation tail of a run summary: reached only
// for a terminal run with no cached summary, outside test mode.
async function generateRunSummaryReply(ctx, req, res, { loop, inputHash }) {
  const { runSummaryCacheStore, freeTierStore, workspacePreferencesStore } = ctx;
  const workspace = req.workspace;
  const { loopId } = req.params;

  // Resolve the OpenRouter key: user OAuth → env (via streamChat default) → free tier.
  const { apiKey, isFreeTier } = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });

  if (!apiKey) {
    return serviceUnavailable.json(res, 'AI summaries are not configured');
  }

  if (isFreeTier && freeTierStore) {
    const check = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
    if (check) {
      return jsonError(res, 429, check.reason, freeTierRefusalBlock(check));
    }
  }

  try {
    const selectedModel = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'run-summary', forceDefault: isFreeTier });
    const { summary, model } = await generateRunSummary(loop, { apiKey, model: selectedModel, callMeta: { urlKey: workspace.urlKey } });
    await runSummaryCacheStore.put(workspace.urlKey, loopId, { inputHash, summary, model });
    res.json({ status: 'fresh', loopId, summary, model, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Dashboard run-summary generation error:', error);
    jsonError(res, 502, 'Could not generate the run summary');
  }
}

async function handleRunSummary(ctx, req, res, { force }) {
  const { runSummaryCacheStore } = ctx;
  if (!runSummaryCacheStore) {
    return serviceUnavailable.json(res, 'Run summary store unavailable');
  }

  const workspace = req.workspace;
  const { loopId } = req.params;
  if (!loopId) return badRequest.json(res, 'loopId is required');

  const isPeek = !force && isCachedOnly(req);
  let loop;
  try {
    // LIN-1022: issue-scoped point-read (getItemStatus→getLoopsForIssue) instead of
    // a non-lean whole-workspace getLoopsForWorkspace reconstruct-by-loopId. The
    // whole-workspace fallback is skipped on a cachedOnly peek (same H12 guard as
    // session-summary): a peek with a stale/unresolvable loopId must not pay the
    // 30-day read.
    loop = await loadRunForSummary(ctx, workspace.urlKey, loopId, { allowFullScan: !isPeek });
  } catch (error) {
    console.error('Dashboard run-summary lookup error:', error);
    return serverError.json(res, 'Could not load the run');
  }
  if (!loop) {
    // Peek miss → cheap 204 (mirrors the cache-miss 204 below); else 404.
    return isPeek ? res.status(204).end() : notFound.json(res, 'Run not found');
  }

  // Immutability gate: only terminal runs are summarisable/cacheable.
  if (!isTerminalLoop(loop)) {
    return jsonError(res, 409, 'Run is still active — a summary is available once it completes', { agentState: loop.agentState });
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
    if (isCachedOnly(req)) {
      return res.status(204).end();
    }
  }

  if (isTestMock()) {
    const summary = buildTestSummary(loop);
    await runSummaryCacheStore.put(workspace.urlKey, loopId, { inputHash, summary, model: 'test-mock' });
    return res.json({ status: 'fresh', loopId, summary, model: 'test-mock', generatedAt: new Date().toISOString() });
  }

  return generateRunSummaryReply(ctx, req, res, { loop, inputHash });
}

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

// Terminal checks (sessionIsTerminal, loopIsTerminal) live in lib/run-loop-state.js
// (LIN-3717) and are imported here, so the background precompute shares the exact
// same gate (LIN-632).

// The cheap live proxy for an in-progress session's status line. Deterministic:
// never an LLM call (the cost contract). Bug 2 (LIN-608): a freshly-started
// session has no terminal child and no cached run-summary, so the old
// terminal-only filter returned '' forever and the card showed a permanent
// "◐ working…" placeholder. We now fall back to the latest child's own
// agentSummary/heartbeat — including a still-running child — so live work shows
// real status. The richest signal is still preferred: the latest *terminal*
// child's cached run-summary outcome wins when present.
async function liveStatusLine({ runSummaryCacheStore }, session, urlKey) {
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
async function gatherChildOutcomes({ runSummaryCacheStore }, session, urlKey) {
  const out = {};
  if (!runSummaryCacheStore) return out;
  for (const loop of childLoops(session)) {
    if (!loopIsTerminal(loop)) continue;
    const cached = await runSummaryCacheStore.get(urlKey, loop.loopId);
    if (cached?.summary?.outcome) out[loop.loopId] = cached.summary.outcome;
  }
  return out;
}

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
async function findSessionForSummary({ observationSessionsStore, pointReadSession, loopDeps }, urlKey, sessionId, isPeek) {
  let session = null;
  if (observationSessionsStore) {
    session = await observationSessionsStore.getSession(urlKey, sessionId);
  }
  if (!session) {
    session = await pointReadSession(urlKey, sessionId);
  }
  if (!session && !isPeek) {
    const sessions = await getSessionsForWorkspace(urlKey, loopDeps);
    session = sessions.find(s => String(s.sessionId) === String(sessionId)) || null;
  }
  return session;
}

// The credential, gate, model and generation tail of a session summary (the
// session twin of generateRunSummaryReply, with its own gate and its own clamp).
async function generateSessionSummaryReply(ctx, req, res, { session, inputHash }) {
  const { sessionSummaryCacheStore, freeTierStore, workspacePreferencesStore } = ctx;
  const workspace = req.workspace;
  const { sessionId } = req.params;

  // Resolve the OpenRouter key: user OAuth → env (via streamChat default) → free tier.
  const { apiKey, isFreeTier } = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });

  if (!apiKey) {
    return serviceUnavailable.json(res, 'AI summaries are not configured');
  }

  if (isFreeTier && freeTierStore) {
    const check = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
    if (check) {
      return jsonError(res, 429, check.reason, freeTierRefusalBlock(check));
    }
  }

  try {
    const childOutcomes = await gatherChildOutcomes(ctx, session, workspace.urlKey);
    const selectedModel = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'session-summary', forceDefault: isFreeTier });
    const { summary, model } = await generateSessionSummary(session, { apiKey, model: selectedModel, childOutcomes, callMeta: { urlKey: workspace.urlKey } });
    await sessionSummaryCacheStore.put(workspace.urlKey, sessionId, { inputHash, summary, model });
    res.json({ status: 'fresh', sessionId, live: false, summary, model, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Dashboard session-summary generation error:', error);
    jsonError(res, 502, 'Could not generate the session summary');
  }
}

async function handleSessionSummary(ctx, req, res, { force }) {
  const { sessionSummaryCacheStore } = ctx;
  if (!sessionSummaryCacheStore) {
    return serviceUnavailable.json(res, 'Session summary store unavailable');
  }

  const workspace = req.workspace;
  const { sessionId } = req.params;
  if (!sessionId) return badRequest.json(res, 'sessionId is required');

  const isPeek = !force && isCachedOnly(req);
  let session;
  try {
    session = await findSessionForSummary(ctx, workspace.urlKey, sessionId, isPeek);
  } catch (error) {
    console.error('Dashboard session-summary lookup error:', error);
    return serverError.json(res, 'Could not load the session');
  }
  if (!session) {
    // Peek miss → cheap 204 (mirrors the cache-miss 204 below); else 404.
    return isPeek ? res.status(204).end() : notFound.json(res, 'Session not found');
  }

  // Live session: cheap proxy statusLine only, no generation, no caching.
  if (!sessionIsTerminal(session)) {
    const { statusLine, loopId } = await liveStatusLine(ctx, session, workspace.urlKey);
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
    if (isCachedOnly(req)) {
      return res.status(204).end();
    }
  }

  if (isTestMock()) {
    const summary = buildTestSessionSummary(session);
    await sessionSummaryCacheStore.put(workspace.urlKey, sessionId, { inputHash, summary, model: 'test-mock' });
    return res.json({ status: 'fresh', sessionId, live: false, summary, model: 'test-mock', generatedAt: new Date().toISOString() });
  }

  return generateSessionSummaryReply(ctx, req, res, { session, inputHash });
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

/**
 * @param {Object} ctx - the composer's resolved dependencies plus its shared closures
 * @returns {Router}
 */
export function createDashboardSummariesRoutes(ctx) {
  const { workspaceFromUrl } = ctx;
  const router = Router();

  // The summary routes are async handlers invoked as `(req, res) => handleX(...)`.
  // Express does not await the returned promise, so any rejection (e.g. a store
  // read inside liveStatusLine/gatherChildOutcomes, or a cache get/put outside the
  // inner try) would escape as an unhandled rejection and could crash the process
  // (LIN-608). `.catch(next)` routes it to the global error middleware → a visible
  // 500 instead of a crash.
  router.get('/workspace/:urlKey/api/dashboard/run-summary/:loopId', workspaceFromUrl, (req, res, next) =>
    handleRunSummary(ctx, req, res, { force: false }).catch(next));

  router.post('/workspace/:urlKey/api/dashboard/run-summary/:loopId', workspaceFromUrl, (req, res, next) =>
    handleRunSummary(ctx, req, res, { force: true }).catch(next));

  router.get('/workspace/:urlKey/api/dashboard/session-summary/:sessionId', workspaceFromUrl, (req, res, next) =>
    handleSessionSummary(ctx, req, res, { force: false }).catch(next));

  router.post('/workspace/:urlKey/api/dashboard/session-summary/:sessionId', workspaceFromUrl, (req, res, next) =>
    handleSessionSummary(ctx, req, res, { force: true }).catch(next));

  return router;
}
