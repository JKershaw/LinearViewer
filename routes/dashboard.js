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
 *   POST     /workspace/:urlKey/api/dashboard/rulings/reverse-withdrawal — reverse a `decision-withdrawn` stamp, terminal (LIN-2891/LIN-3035; session-auth-only, no UI button yet)
 *   POST     /workspace/:urlKey/api/dashboard/rulings/answer       — stamp a TASK-BOUND ruling answered with no comment, durable optionId (LIN-2754 Track B; the answer already lives on the ticket, this is bookkeeping only)
 *   POST     /workspace/:urlKey/api/dashboard/rulings/shelve       — shelve any ruling with a reason + re-surface timer (LIN-1727; view-only, works uniformly for loop-backed and task-bound)
 *   POST     /workspace/:urlKey/api/dashboard/rulings/keep         — withdraw a proposed dismissal (LIN-2444; view-only — never touches answer state, arms no keepalive)
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

import { Router } from 'express';
import { jsonError } from '../lib/errors.js';
import { resolveRunnerOwnerRefusal, sendRunnerRefusal } from '../lib/runner-owner-gate.js';
import { dispatchSessionFollowUp } from '../lib/follow-up-dispatch.js';
import { dispatchQueueLimiter } from './dispatch.js';
import { renderObservationPage as renderObservationPageImpl } from '../lib/render-observation.js';
import { renderSessionPage } from '../lib/render-session.js';
import { buildRunView } from '../lib/run-view.js';
import { pointReadSession as pointReadSessionFor, readSessionById } from '../lib/dispatch-session-read.js';
import { resolveIssueBinding } from '../lib/workspace.js';
import { readRunEvidence, buildRunEvidence } from '../lib/run-evidence.js';
import { createPrStateStore, resolveRunPrRef } from '../lib/pr-state-store.js';
import { resolvePrReadToken } from '../lib/github-pr-status.js';
import { prStateCopy } from '../lib/pr-state-copy.js';
import { readTaskRunFacts } from '../lib/task-run-facts.js';
// LIN-3717: the loop/session terminal checks live in lib/run-loop-state.js (Runs &
// dispatch, decided by the dispatch terminal markers). The three formerly exported
// names are re-exported here so server.js and routes/task-chat.js keep resolving them.
import { isTerminalLoop, enrichLoop, sessionIsTerminal } from '../lib/run-loop-state.js';
export { isTerminalLoop, sessionIsTerminal, enrichLoop };
import { createSessionsFeedCache } from '../lib/sessions-feed-cache.js';
import { createTaskDoneCache } from '../lib/task-done-cache.js';
import { requestFeatureFlags } from '../lib/run-controls.js';
import { collectAgentTokenIds, foldCredentialIndex } from '../lib/credential-state.js';
import { findAnchorLoop } from '../lib/session-summary.js';
import { NON_SESSION_TARGETS } from '../lib/dispatch-targets.js';
import { publicOrigin } from '../lib/public-origin.js';
import { mergeLoopsFor, createDashboardFeedRoutes } from './dashboard-feed.js';
import { createDashboardRulingsRoutes } from './dashboard-rulings.js';
import { createDashboardKpisRoutes } from './dashboard-kpis.js';
import { createDashboardEffortRoutes } from './dashboard-effort.js';
import { createDashboardSummariesRoutes, buildTestSummary, buildTestSessionSummary } from './dashboard-summaries.js';
import { createDashboardDrilldownRoutes } from './dashboard-drilldown.js';
import { deriveSessionWaiting, deriveSessionDecisions, settleWithConcurrency, isStandaloneSession, deriveSessionStatus } from './dashboard-session-state.js';
export { settleWithConcurrency, isStandaloneSession, deriveSessionStatus, deriveSessionWaiting, deriveSessionDecisions, buildTestSummary, buildTestSessionSummary };


// PR-state cache + upstream budget (LIN-3251) live in `lib/pr-state-store.js`
// since LIN-3311 (one store instance, shared by every reader server.js wires).
// The test seams stay re-exported here so `routes/test.js` is unchanged.
export { primePrStateCache, clearPrStateCache, prStateUpstreamFetchCount } from '../lib/pr-state-store.js';

/**
 * `[evidence]` telemetry URLs across a session's runs — the corroborating (never
 * sole) PR-URL source the run-evidence model takes (LIN-3247/LIN-3251).
 * @param {Object|null} session
 * @returns {string[]}
 */
function collectRunEvidenceUrls(session) {
  const urls = [];
  const loops = Array.isArray(session && session.loops) ? session.loops : [];
  for (const loop of loops) {
    const feedback = Array.isArray(loop && loop.feedback) ? loop.feedback : [];
    for (const entry of feedback) {
      if (entry && entry.url && typeof entry.message === 'string' && entry.message.startsWith('[evidence]')) {
        urls.push(entry.url);
      }
    }
  }
  return urls;
}

/**
 * The latest `kind: 'assistant-text'` message on a loop, or null. LIN-3252 S2.7:
 * a bare `[blocked]` loop has no `decisionCase` (that correlation needs a
 * decision entry), so its card's "why is Harbour asking?" falls back to what the
 * worker was last saying. Pure; reads the non-lean session's `feedback[]`.
 *
 * @param {Object} loop
 * @returns {string|null}
 */
function latestAssistantText(loop) {
  const feedback = Array.isArray(loop && loop.feedback) ? loop.feedback : [];
  for (let i = feedback.length - 1; i >= 0; i--) {
    const entry = feedback[i];
    if (entry && entry.kind === 'assistant-text' && entry.message) return String(entry.message);
  }
  return null;
}

// Dependencies a caller may leave out, with what each defaults to. The rule is
// the destructuring-default rule the signature used to carry: only `undefined`
// takes the default, so an explicit `null` stays `null` and reaches the stores
// and checks as `null` (e.g. `dispatchSessionFollowUp({ workspacePreferencesStore,
// proxyTokenStore, ownerCheck })` sees exactly what the caller passed). The cache
// factories are lazy: they run only when the dependency is absent, once per call.
const DEP_DEFAULTS = {
  // Durable materialized sessions read-model (LIN-623); null ⇒ live path (byte-identical legacy behaviour).
  observationSessionsStore: () => null,
  // Materializer used to backfill a workspace on a read-miss (LIN-623).
  observationMaterializer: () => null,
  // Durable run-paragraph store (LIN-3253, LIN-2948 S3). Read ONLY by the run
  // page — the page route must never generate. Default null → the slot renders
  // empty, the same graceful degrade as the other unwired page caches.
  runParagraphStore: () => null,
  // Brief/recap caches are per-issue (keyed by issue UUID); the per-session page
  // (LIN-1003) joins them onto a session by distinct loop.issueId. They are NOT
  // otherwise reachable in this router — the observation feed never reads issue
  // context — so they are injected here explicitly (default null → the join is
  // simply skipped, e.g. in tests that don't wire them).
  briefCacheStore: () => null,
  recapCacheStore: () => null,
  // LIN-1588: the proxy-event store, source of Beat 1's per-token credential
  // verdict. Read ONLY by the per-session page (a page load, never the feed
  // poll). Default null → the credential line degrades to `unknown`, which is
  // also its ordinary rendering, so an unwired test sees no behaviour change.
  proxyEventStore: () => null,
  workspacePreferencesStore: () => null,
  // LIN-3383: the hoisted workspace-owner seam (server.js). Apply is owner-only.
  workspaceOwnerCheck: () => null,
  recentLimit: () => 120,
  sessionsFeedCache: createSessionsFeedCache,
  // Touched-task done-state TTL cache (LIN-1258): 60s, keyed `${wsUrlKey}::${identifier}`.
  // Under the LIN-617 feed-output cache: when the feed refreshes and re-runs
  // mergeSessions, an eligible session's touched tasks are served from here instead
  // of re-reading the backend every ~5s. Injectable (like sessionsFeedCache) so a
  // test can supply an injectable-clock cache and drive the cross-TTL boundary
  // directly (LIN-1259, item 2 hardening).
  taskDoneCache: createTaskDoneCache,
  // Scan-produced task decisions (LIN-2215), the rulings feed's second input
  // alongside `loops` — see the rulings GET (dashboard-rulings.js). Default
  // null → the taskDecisions branch is simply skipped (collectUnansweredDecisions
  // defaults it to []), same degrade-gracefully convention as briefCacheStore/
  // recapCacheStore/proxyEventStore above, so an unwired test sees no behaviour change.
  taskDecisionsStore: () => null,
  // Shelved rulings (LIN-1727), the rulings feed's THIRD input, alongside
  // `loops` and `taskDecisions`. Default null → the shelving branch is simply
  // skipped (collectUnansweredDecisions defaults it to []), same
  // degrade-gracefully convention as taskDecisionsStore above.
  shelvedRulingsStore: () => null,
  // Proposed dismissals (LIN-2444), the rulings feed's FOURTH input. An agent
  // may PROPOSE that a ruling be dismissed and never perform one, so the
  // proposal has to reach the surface where a human can agree to it — the
  // rulings feed. Without it the whole feature is write-only. Default null → the
  // suggestion join is skipped and every row reports
  // `suggestedDismissal: null`, same degrade-gracefully convention as the
  // three stores above.
  dismissalSuggestionsStore: () => null,
  // Per-LLM-call cost log (LIN-418), read ONLY by the Observation page load
  // (LIN-2706) to derive the Scan-due tab's pre-run cost estimate. Default
  // null -> the estimate degrades to `unknown` via the `.catch(() => null)`
  // in the page handler, same degrade-gracefully convention as the stores above.
  llmCallLogStore: () => null,
  // Run proposals (LIN-3254): the "Proposed in chat" rows on the run page and
  // the Apply / Decline actions. Default null → no rows render and Apply /
  // Decline 503, same degrade-gracefully convention as the stores above.
  runProposalsStore: () => null,
  // Credential store the Apply dispatch finishes with (dispatchSessionFollowUp),
  // same provisioning posture as approve-follow-up (LIN-3134/LIN-3139).
  proxyTokenStore: () => null,
  // DI seam (LIN-2706), defaulting to the real renderer: this module has no
  // module-mock story (mock.module needs --experimental-test-module-mocks,
  // not opted into anywhere in this repo — same constraint documented in
  // tests/unit/flight-companion-turn-route.test.js), so a test that needs the
  // observation page handler's try/catch to see a throwing render call
  // injects a stub here instead, same narrow-DI pattern as that file's
  // `chatClient`/`createToolCatalog`.
  renderObservationPage: () => renderObservationPageImpl,
  // LIN-3247: the run-evidence reader for the temporary session-page mount.
  // Default null -> the mount is skipped entirely, so an unwired test (and every
  // existing session-page assertion) sees no provider I/O and no page change.
  // server.js injects the real `lib/run-evidence.js` reader.
  readRunEvidence: () => null,
  // LIN-3285: `installationTokenFor({ workspaceId, repo })` (lib/connection-credential.js),
  // the owner's GitHub App installation token for a Linear/Jira workspace's PR reads.
  installationTokenFor: () => null,
  // LIN-3251: PR-state cache/budget/DI seam. Default null -> a fresh per-router
  // store, which is process-wide in production (one router). Tests inject
  // `{ now, resolveProvider, loadRun, githubFetch, cache, bucket }`.
  prState: () => null,
  // LIN-3311: the ONE shared PR-state store server.js builds
  // (`lib/pr-state-store.js`), so this router spends one 36/h
  // budget and fills one cache. When given it wins over the store fields of the
  // `prState` bag (`cache`/`bucket`/`now`/`githubFetch`); the
  // bag's route seams (`loadRun`/`resolveProvider`) still apply.
  prStateStore: () => null
};

function resolveDeps(deps) {
  // Destructuring (not spreading) so a missing `deps` throws, as the signature's
  // own destructuring did.
  const { ...resolved } = deps;
  for (const [name, makeDefault] of Object.entries(DEP_DEFAULTS)) {
    if (resolved[name] === undefined) resolved[name] = makeDefault();
  }
  return resolved;
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
 * @param {Object}   [deps.runParagraphStore]      - durable run-paragraph store (LIN-3253); the run page READS it only and never generates. Default null → no paragraph renders.
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
export function createDashboardRoutes(deps) {
  const resolved = resolveDeps(deps);
  // The names the run-page block below reads, under the names it reads them.
  const {
    workspaceFromUrl,
    dispatchQueueStore,
    agentStatusStore,
    runParagraphStore,
    briefCacheStore,
    recapCacheStore,
    proxyEventStore,
    workspacePreferencesStore,
    workspaceOwnerCheck,
    getOpenRouterSource,
    getDeployInfo,
    runProposalsStore,
    proxyTokenStore,
    sessionsFeedCache,
    readRunEvidence: readRunEvidenceFn,
    installationTokenFor,
    prState,
    prStateStore: sharedPrStateStore
  } = resolved;
  const router = Router();
  const loopDeps = { dispatchStore: dispatchQueueStore, agentStatusStore };


  // PR-state store (LIN-3251, C1). `cache`/`bucket` default to this router's own
  // process-wide state; a test overrides any subset. `loadRun` and
  // `resolveProvider` are seams so a route test needs no Mongo or provider bind.
  //
  // NOTE: there is deliberately NO run->PR pointer cache. Every GET re-reads the
  // run's tracker comments and re-extracts the PR URL, so a PR posted after the
  // first poll is picked up on the next one. The only thing cached across polls
  // is the PR-state result per `owner/repo#number` (LIN-3333 removed the
  // per-workspace repo-allowlist cache that used to sit alongside it).
  //
  // Without an injected store the router builds its own from the `prState`
  // bag: the shared process-wide cache and a fresh budget log (the pre-LIN-3311
  // defaults, unchanged).
  const prStateStore = sharedPrStateStore || createPrStateStore(prState || {});
  const prStateSeams = {
    resolveProvider: (prState && prState.resolveProvider) || ((workspace, selector) => resolveIssueBinding(workspace, selector)),
    loadRun: (prState && prState.loadRun) || defaultLoadRun
  };

  /**
   * Resolve a run id to its seed issue + the run's `[evidence]` telemetry URLs.
   * The same non-lean point-read the page uses; null when the session is gone.
   */
  async function defaultLoadRun(urlKey, runId) {
    const session = await loadSessionWithTranscript(urlKey, runId);
    if (!session) return null;
    return { issueIdentifier: session.seedIssue || null, evidenceUrls: collectRunEvidenceUrls(session) };
  }

  // The shared closures the route modules take by argument (they never import
  // one another): one instance of each, here. `ctx` carries every resolved
  // dependency, so the feed, rulings and run page all see the very same
  // `sessionsFeedCache`.
  const mergeLoops = (workspaces) => mergeLoopsFor(workspaces, loopDeps);
  const ctx = { ...resolved, loopDeps, mergeLoops, pointReadSession };

  router.use(createDashboardFeedRoutes(ctx));

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
        featureFlags: await requestFeatureFlags(req)
      };

      if (!sessionId) {
        return res.status(404).send(renderSessionPage({ session: null, sessionId: '', urlKey: workspace.urlKey }, pageOptions));
      }

      // The local half (LIN-3311): session, issue context, run view, stored
      // paragraph — Mongo only, no request input. Everything below that reads
      // `req` or is owner-only stays in this route.
      const local = await loadRunLocal(workspace.urlKey, sessionId);
      if (!local) {
        return res.status(404).send(renderSessionPage({ session: null, sessionId, urlKey: workspace.urlKey }, pageOptions));
      }
      const { session, issueContext, anchorLoop, anchorIssueTitle, runView, runParagraph } = local;

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

      // Pinned question card (LIN-3252 S2 / LIN-3260): the session's unanswered
      // decisions, read independently of `waiting` so the card shows on a
      // non-waiting or finished session too. Rows stay session-membership scoped
      // (no shelves, no task-decisions), but the liveness predicate must see a
      // live run on the anchor in ANOTHER session — so feed `deriveSessionDecisions`
      // the workspace-wide loop set from the warm `rulings` entry (the SAME cache
      // the Rulings feed / nav-badge poll fills). This is a NON-producing `peek`:
      // the run page must never trigger the whole-workspace reconstruction a
      // producing `get` would (LIN-1021/H12). A cold cache falls back to the
      // session's own loops (the prior behaviour).
      //
      // The `rulings` entry is merged across `req.session.workspaces`, and issue
      // identifiers are only per-TEAM unique, so the SAME identifier can exist in
      // two connected workspaces — scope the set to the workspace being viewed
      // (`workspaceUrlKey`) so a same-named issue elsewhere cannot force `record`
      // on this card.
      const sessionWorkspaces = (req.session.workspaces || []).map(w => ({ urlKey: w.urlKey, name: w.name }));
      const cachedLoopSet = typeof sessionsFeedCache.peek === 'function'
        ? sessionsFeedCache.peek(sessionsFeedCache.keyFor(sessionWorkspaces, 'rulings'))
        : undefined;
      const liveLoops = Array.isArray(cachedLoopSet)
        ? enrichedLoops.concat(cachedLoopSet.filter(l => l && l.workspaceUrlKey === workspace.urlKey))
        : enrichedLoops;
      const sessionDecisions = deriveSessionDecisions(enrichedLoops, { now: new Date(), liveLoops });

      // Per-run inline reply (LIN-1004/LIN-1133; LIN-1163 removed the page-level
      // box): gated to cli/web sessions (never dash/local — the dispatch route
      // rejects followUpTo for those anyway). Each run's own box replies via its
      // own `loop.target`, so the session-wide target no longer needs deriving
      // here — only the gate (from the anchor run) is still needed.
      const anchorTarget = (anchorLoop && anchorLoop.target) || null;
      const canReply = !NON_SESSION_TARGETS.includes(anchorTarget);

      // Per-session credential state (LIN-1588, Beat 2). One bounded, single-
      // workspace Mongo read on a PAGE-LOAD path — never the feed poll, whose
      // no-LLM/no-fan-out cost contract is untouched — and skipped entirely when
      // no run in this session carries a credential identity (the ordinary case
      // per LIN-1585). The verdict itself is Beat 1's, computed inside
      // `listCredentialHealth`; nothing here re-derives it.
      const credentialByToken = await readSessionCredentials(workspace.urlKey, session);

      // LIN-3254: the run's proposals, newest-first. Empty when the feature's
      // store is unwired; never a page-load failure.
      const proposals = runProposalsStore
        ? await runProposalsStore.list(workspace.urlKey, sessionId)
        : [];

      // LIN-3247/3248: the evidence fragment + close-out box mounted at the top
      // of the session page, guarded to the ONE seam LIN-2948 will lift out.
      // Skipped when the reader is not wired (tests, and any deployment without
      // the module), and fail-open: a read error renders no evidence rather than
      // a broken page. The run's `stopAt` comes off the seed issue's rows, then
      // the sessionId hop to the parent run row (LIN-3725); its variant comes off
      // the seed issue's own kickoff row only (P1a/P1b): a standard run's box
      // carries the seam-guard promise, a stepped run's does not (N2).
      //
      // `runFacts` (a dispatch-row read) and `runnerReady` (a session feature
      // flag) are owner inputs read here and handed to the external half.
      const runFacts = await readRunFacts(dispatchQueueStore, workspace.urlKey, session.seedIssue);
      const runEvidence = await readRunExternal(workspace, session, {
        asked: anchorIssueTitle,
        viewerIsOwner: true,
        runFacts,
        runnerReady: (await requestFeatureFlags(req)).runControls === true,
      });

      // Bare-BLOCKED card inputs (LIN-3252 S2.7): the waiting producer loop
      // carries the reply target/issue the follow-up must resume and the latest
      // assistant text its "why" falls back to when there is no `decisionCase`.
      const producerLoop = producerLoopId
        ? enrichedLoops.find(l => l.loopId === producerLoopId) || null
        : null;
      const lastAssistantText = latestAssistantText(producerLoop);
      const producer = producerLoop ? {
        loopId: producerLoop.loopId || null,
        target: producerLoop.target || null,
        issueId: producerLoop.issueId || null,
        issueIdentifier: producerLoop.issueIdentifier || null,
        case: lastAssistantText ? [lastAssistantText] : []
      } : null;

      const html = renderSessionPage(
        { session, sessionId, issueContext, waiting, waitingMessage, producerLoopId, decision, decisionCase, decisions: sessionDecisions, producer, urlKey: workspace.urlKey, canReply, sessionTerminal, credentialByToken, anchorIssueTitle, runView, proposals, runEvidence, runParagraph },
        pageOptions
      );
      res.send(html);
    } catch (error) {
      next(error);
    }
  });

  // ─── Live PR state (LIN-3251, S1b of LIN-2948, condition C1) ────────────────
  //
  // GET /workspace/:urlKey/api/run/:runId/pr-state. Resolves the run's PR URL
  // through LIN-2949's run-evidence model (the run's own tracker comments,
  // `[evidence]` corroborating only), then reads the live PR state through the
  // shared `lib/github-pr-status.js` reader. It never calls LIN-2949's
  // side-effecting POST `.../check`. The whole reader result is cached per
  // `owner/repo#number`; run pages share the process-wide 36-calls/hour budget.
  // Unreadable cases (private/unknown, rate-limited, budget spent with no
  // stale value) resolve to the "state not reported" (`unknown`) state — never a
  // 403, never a thrown read.

  // The sliding budget, counting fetch, TTL rule and payload shapes are
  // `lib/pr-state-store.js`'s (LIN-3311); this route only resolves the run's PR
  // and asks the store.

  router.get('/workspace/:urlKey/api/run/:runId/pr-state', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const { runId } = req.params;
    if (!runId || runId.length > 200) {
      return jsonError(res, 400, 'Invalid run id');
    }
    const nowMs = prStateStore.now();
    try {
      // Re-resolve the run's PR URL on EVERY request (no run->PR pointer cache),
      // so a PR posted after the first poll is seen on the next one.
      const run = await prStateSeams.loadRun(workspace.urlKey, runId);
      if (!run || !run.issueIdentifier) {
        return res.json({ state: 'none', number: null, checks: null, url: null, message: prStateCopy({ state: 'none' }) });
      }
      const { provider, callScope } = prStateSeams.resolveProvider(workspace, null);
      const comments = await provider.fetchIssueComments(callScope, run.issueIdentifier);
      // Through LIN-2949's run-evidence model, not a new parser.
      const model = buildRunEvidence({
        issueIdentifier: run.issueIdentifier,
        comments,
        evidenceUrls: run.evidenceUrls || [],
        prStatus: null
      });
      const { status, ref } = resolveRunPrRef(model);
      if (status !== 'one') {
        // zero PRs -> "none"; several -> withhold (never pick one silently)
        const state = status === 'none' ? 'none' : 'unknown';
        const payload = { state, number: null, checks: null, url: null };
        return res.json({ ...payload, message: prStateCopy(payload) });
      }
      // LIN-3443: the bound repo is read with the workspace's own token.
      // LIN-3285: a Linear/Jira workspace reads with the owner's installation token.
      const token = await resolvePrReadToken({ callScope, repo: ref.repo, providerKind: provider?.name, workspaceId: workspace.id, installationTokenFor });
      const payload = await prStateStore.readPayload(ref, nowMs, token ? { token, scopeKey: workspace.urlKey } : undefined);
      return res.json({ ...payload, message: prStateCopy(payload) });
    } catch (error) {
      console.error('Run PR-state error:', error.message);
      const payload = { state: 'unknown', number: null, checks: null, url: null };
      return res.json({ ...payload, message: prStateCopy(payload) });
    }
  });

  /**
   * Apply a run proposal (LIN-3254): dispatch the STORED prompt to the run's
   * lineage tail. Session-auth + the shared dispatch limiter; the request body
   * is ignored entirely (a client-supplied prompt is never trusted).
   *
   * Ordering: the compare-and-set `proposed → applied` runs FIRST as the
   * dispatch-once gate (a double POST loses the CAS and never reaches the
   * dispatch), then the dispatch runs; a failed or refused dispatch REVERTS the
   * row to `proposed`, so a proposal is never left `applied` with nothing
   * dispatched. `appliedItemId` is recorded once the dispatch lands.
   */
  router.post('/workspace/:urlKey/api/run/:runId/proposals/:id/apply', dispatchQueueLimiter, workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const dispatchedBy = req.session && req.session.accountId;
    if (!dispatchedBy) {
      return jsonError(res, 401, 'Authentication required to apply a proposal');
    }
    if (!runProposalsStore || !dispatchQueueStore || !agentStatusStore) {
      return jsonError(res, 503, 'Run proposals are not configured for this workspace');
    }

    const { runId, id } = req.params;
    try {
      const proposal = await runProposalsStore.get(workspace.urlKey, runId, id);
      if (!proposal) return jsonError(res, 404, `Proposal ${id} not found`);
      // The run's session, scoped to THIS workspace — another workspace's run
      // is refused before anything is claimed or dispatched.
      const session = await loadSessionWithTranscript(workspace.urlKey, runId);
      if (!session) return jsonError(res, 404, `Run ${runId} not found`);

      // LIN-3383 / LIN-3254: a refusal decidable without dispatching happens
      // BEFORE the claim, so a non-owner never flips the row to `applied` (an
      // owner's concurrent Apply/Decline would 409 in that window). The seam
      // inside dispatchSessionFollowUp stays as the fail-closed backstop. The
      // anchor's target is cli or web (dash/local cannot follow up), so the
      // owner verdict is the same for either.
      const refusal = await resolveRunnerOwnerRefusal({
        ownerCheck: workspaceOwnerCheck,
        workspaceId: workspace.id,
        accountId: dispatchedBy,
        target: 'cli'
      });
      if (refusal) return sendRunnerRefusal(res, refusal);

      const claimed = await runProposalsStore.apply(workspace.urlKey, runId, id);
      if (!claimed) return jsonError(res, 409, 'Proposal already decided');

      try {
        const outcome = await dispatchSessionFollowUp({
          dispatchQueueStore,
          agentStatusStore,
          workspacePreferencesStore,
          proxyTokenStore,
          urlKey: workspace.urlKey,
          sessionId: runId,
          prompt: proposal.prompt,
          baseUrl: publicOrigin(req),
          dispatchedBy,
          ownerCheck: workspaceOwnerCheck,
          workspaceId: workspace.id,
        });
        if (outcome.status !== 200) {
          await runProposalsStore.revert(workspace.urlKey, runId, id);
          return res.status(outcome.status).json(outcome.body);
        }
        await runProposalsStore.recordAppliedItem(workspace.urlKey, runId, id, outcome.body.itemId);
        return res.json({ applied: true, itemId: outcome.body.itemId });
      } catch (dispatchError) {
        console.error('Run proposal apply dispatch error:', dispatchError);
        await runProposalsStore.revert(workspace.urlKey, runId, id);
        return jsonError(res, 502, 'Failed to dispatch the proposal');
      }
    } catch (error) {
      console.error('Run proposal apply error:', error);
      return jsonError(res, 502, 'Failed to apply the proposal');
    }
  });

  /**
   * Decline a run proposal (LIN-3254): compare-and-set `proposed → declined.
   * Dispatches nothing.
   */
  router.post('/workspace/:urlKey/api/run/:runId/proposals/:id/decline', dispatchQueueLimiter, workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const dispatchedBy = req.session && req.session.accountId;
    if (!dispatchedBy) {
      return jsonError(res, 401, 'Authentication required to decline a proposal');
    }
    if (!runProposalsStore) {
      return jsonError(res, 503, 'Run proposals are not configured for this workspace');
    }

    const { runId, id } = req.params;
    try {
      const declined = await runProposalsStore.decline(workspace.urlKey, runId, id);
      if (!declined) {
        const existing = await runProposalsStore.get(workspace.urlKey, runId, id);
        return existing
          ? jsonError(res, 409, 'Proposal already decided')
          : jsonError(res, 404, `Proposal ${id} not found`);
      }
      return res.json({ declined: true });
    } catch (error) {
      console.error('Run proposal decline error:', error);
      return jsonError(res, 502, 'Failed to decline the proposal');
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

  /**
   * The run page's LOCAL half (LIN-3311): everything the page
   * model needs that is Mongo-only and request-free — the NON-lean session
   * (LIN-1021 point-read), the brief/recap cache-join, the anchor loop and its
   * title, the run view, and the stored run paragraph. No tracker or GitHub
   * read, no `req`, no owner-only input, so it also runs as a cheap local probe.
   *
   * @param {string} urlKey
   * @param {string} sessionId
   * @param {{ now?: Date|string|number }} [opts] - the run view's clock
   * @returns {Promise<null|{ session: Object, issueContext: Array, anchorLoop: (Object|null), anchorIssueTitle: (string|null), runView: Object, paragraph: (Object|null), runParagraph: (string|null) }>}
   *   null when the session is gone; `paragraph` is the stored record
   *   (`{ paragraph, inputHash, final, … }`), `runParagraph` its text.
   */
  async function loadRunLocal(urlKey, sessionId, { now = new Date() } = {}) {
    // NON-lean, issue-scoped point-read (LIN-1021) — the transcript needs
    // `feedback[]`, but scoped to this session's issues, not the whole workspace.
    const session = await loadSessionWithTranscript(urlKey, sessionId);
    if (!session) return null;

    // Brief/recap cache-join over the session's distinct non-null issue UUIDs.
    // `.get()` is a pure Mongo lookup (no LLM, null on miss); null `issueId`
    // loops cannot be cache-joined and are skipped best-effort (mirrors the
    // lazy-hydration discipline). Never call the generating path on load.
    const issueContext = await joinSessionIssueContext(session, urlKey);

    const anchorLoop = findAnchorLoop(session) || (session.loops && session.loops[0]) || null;
    const anchorIssueTitle = (anchorLoop && anchorLoop.issueTitle) || null;

    // The run view model is built ONCE here (the renderer only formats it).
    const runView = buildRunView(session, { now });

    // The stored run paragraph (LIN-3253, S3): ONE read-only lookup, never a
    // generation. A miss — or an unwired store — renders nothing.
    const paragraph = runParagraphStore
      ? ((await runParagraphStore.get(urlKey, sessionId)) || null)
      : null;

    return { session, issueContext, anchorLoop, anchorIssueTitle, runView, paragraph, runParagraph: paragraph?.paragraph || null };
  }

  /**
   * The run page's EXTERNAL half (LIN-3311, S2a; was LIN-3247's
   * `readSessionRunEvidence`): the tracker evidence and the PR state the
   * evidence model folds in, through the injected `readRunEvidence`
   * (lib/run-evidence.js) so the route stays free of the reader's internals and
   * tests can skip it. Skipped (null) when the reader is unwired or the run has
   * no seed issue; fail-open: any error renders no evidence, never a broken page.
   *
   * `[evidence]` telemetry URLs from the session's runs are passed as the
   * corroborating source only — the reader never lets them be the sole PR-URL
   * source (S1).
   *
   * Owner-only inputs come in as arguments, never read here: `viewerIsOwner`
   * (default false), the dispatch-row `runFacts` and the `runnerReady` flag.
   * Omitted, they take the guest-safe defaults (`stopAt: null`,
   * `variant: 'unknown'`, not ready).
   *
   * @param {Object} workspace
   * @param {Object} session
   * @param {Object} [opts]
   * @param {string|null} [opts.asked] - the "asked" line (the anchor title); falls back to the seed
   * @param {boolean} [opts.viewerIsOwner=false]
   * @param {{ stopAt?: ('pr'|null), variant?: string }|null} [opts.runFacts]
   * @param {boolean} [opts.runnerReady=false]
   * @returns {Promise<Object|null>}
   */
  async function readRunExternal(workspace, session, {
    asked = null,
    viewerIsOwner = false,
    runFacts = null,
    runnerReady = false
  } = {}) {
    if (!readRunEvidenceFn || !session || !session.seedIssue) return null;
    const facts = runFacts || {};
    try {
      const evidenceUrls = collectRunEvidenceUrls(session);
      const { provider, callScope } = resolveIssueBinding(workspace, null);
      return await readRunEvidenceFn({
        issueIdentifier: session.seedIssue,
        provider,
        callScope,
        viewerIsOwner: !!viewerIsOwner,
        evidenceUrls,
        asked: asked || session.seedIssue,
        urlKey: workspace.urlKey,
        workspaceId: workspace.id,
        installationTokenFor,
        stopAt: facts.stopAt || null,
        variant: facts.variant || 'unknown',
        runnerReady: !!runnerReady,
      });
    } catch (err) {
      console.error('Session page run-evidence read failed:', err.message);
      return null;
    }
  }

  /**
   * The run's boundary facts for the close-out box, off its own dispatch row(s)
   * (LIN-3248), then the sessionId hop for `stopAt` (LIN-3725). `stopAt: 'pr'`
   * is P1a's run fact; the run variant is the row's
   * own persisted `variant` field (`resolveRunVariant`, never `promptName`), so
   * N2's copy can be chosen at render time. Fail-open to the safe defaults:
   * no stop, `unknown` variant (the promise stays closed), never a broken page.
   *
   * @param {Object} store - dispatchQueueStore
   * @param {string} urlKey
   * @param {string|null} issueIdentifier
   * @returns {Promise<{stopAt: ('pr'|null), variant: ('standard'|'stepper'|'unknown')}>}
   */
  async function readRunFacts(store, urlKey, issueIdentifier) {
    // LIN-3725: the same read as the task page, so the two agree on `stopAt`
    // (own rows first, then the sessionId hop to the parent run row). The hop
    // lifts `stopAt` only: `variant` stays the seed issue's own kickoff row.
    // (`await` keeps this frame on the async stack for the test's facts-read probe.)
    return await readTaskRunFacts({ store, urlKey, issueIdentifier, hopVariant: false });
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
    // Point read, then (historical inference-grouped or no-issue session) the full read.
    return readSessionById(urlKey, sessionId, loopDeps);
  }

  /**
   * Issue-scoped point-read of ONE session by id (LIN-1022): the shared path now
   * lives in lib/dispatch-session-read.js (LIN-3812); this binds the dashboard's deps.
   */
  function pointReadSession(urlKey, sessionId) {
    return pointReadSessionFor(urlKey, sessionId, loopDeps);
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

  router.use(createDashboardRulingsRoutes(ctx));
  router.use(createDashboardKpisRoutes(ctx));
  router.use(createDashboardEffortRoutes(ctx));
  router.use(createDashboardSummariesRoutes(ctx));
  router.use(createDashboardDrilldownRoutes(ctx));

  return router;
}

