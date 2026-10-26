/**
 * Live Console routes (LIN-1436; promoted out of experimental by LIN-3977).
 *
 * Anchored at /workspace/:urlKey/live-console (reusing workspaceFromUrl and the
 * feature-gate-redirect-to-settings pattern shared by collective/task-chat). The
 * page is a provider-free shell; the client polls an events
 * endpoint built from:
 *   - the agent-status log → the discrete step stream,
 *   - lean dispatch loops  → currently-working lanes (with live heartbeats),
 *     [evidence] artifacts and the moments each run records about itself
 *     (started / finished / failed / waiting on you) as stream events, and
 *   - the session ledger's run id per loop, so every row can link to its run.
 *
 *   GET /workspace/:urlKey/live-console              — page shell (gated)
 *   GET /workspace/:urlKey/api/live-console/events   — feed (JSON)
 *       ?scope=current|all   — the current workspace (default) or every connected one (LIN-3977)
 *       ?before=<epochMs>&limit=<n> — a history PAGE from the same event pool as the poll
 *
 * Cost contract: the poll spends NO LLM call. It is pure Mongo reads and a
 * deterministic transform. The history page reads the loops too (one lean read
 * per workspace per "view earlier" click, not per poll), so that the events it
 * shows are the same ones the poll would have shown.
 */

import { Router } from 'express';
import { renderLiveConsolePage } from '../lib/render-live-console.js';
import { renderErrorPage } from '../lib/render.js';
import { jsonError, serverError } from '../lib/errors.js';
import { findWorkspaceByUrlKey } from '../lib/workspace-lookup.js';
import { requestFeatureFlags } from '../lib/run-controls.js';
import {
  buildConsoleEvents, buildConsoleFeed, DEFAULT_PAGE_SIZE, FOLD_SKEW_MS, isLaneMember, pageEvents, snapPulseWindowMs,
} from '../lib/live-console.js';
import { getLoopsForWorkspace, sessionIdByLoop } from '../lib/pipeline-loops.js';
import { computeSupersededLoopIds } from '../lib/loop-supersede.js';
import { collectAgentTokenIds, foldCredentialIndex } from '../lib/credential-state.js';

// Live window: peak memory tracks recent activity, not the 30-day window.
const FEED_WINDOW_MS = 24 * 60 * 60 * 1000;      // 24h
// History (view-more) reaches further back, still bounded.
const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7d
// Per-workspace row cap so the read is bounded at the store/DB layer.
const FEED_PER_WORKSPACE_LIMIT = 300;
const HISTORY_PER_WORKSPACE_LIMIT = 500;
const MAX_HISTORY_PAGE = 100;

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl - middleware: session + req.workspace
 * @param {Object}   deps.agentStatusStore - agent status store (listStatus)
 * @param {Object}   deps.dispatchQueueStore - dispatch store (loops → lanes/heartbeats/evidence)
 * @param {Object}   [deps.proxyEventStore] - proxy-event store; source of Beat 1's
 *   per-token credential verdict (LIN-1588). Optional: unwired (tests) → every
 *   lane's credential resolves to `unknown`, exactly as it does when no lane
 *   carries a token.
 * @param {Function} deps.getOpenRouterSource - (req) → 'oauth'|'env'|'free'|null
 * @param {Function} deps.getDeployInfo - () → deploy metadata
 * @returns {Router}
 */
export function createLiveConsoleRoutes({ workspaceFromUrl, agentStatusStore, dispatchQueueStore, proxyEventStore = null, getOpenRouterSource, getDeployInfo }) {
  const router = Router();

  function connectedWorkspaces(req, workspace) {
    const workspaces = (req.session.workspaces || []).map(w => ({ urlKey: w.urlKey, name: w.name }));
    if (!findWorkspaceByUrlKey(workspaces, workspace.urlKey)) {
      workspaces.push({ urlKey: workspace.urlKey, name: workspace.name || workspace.urlKey });
    }
    return workspaces;
  }

  // Merge one read across every workspace; per-workspace failures degrade to []
  // for that workspace so one bad store never blanks the whole feed.
  async function mergeAcross(workspaces, readOne, label) {
    const settled = await Promise.allSettled(workspaces.map(readOne));
    const merged = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') merged.push(...r.value);
      else console.error(`Live console: ${label} read failed for a workspace:`, r.reason?.message);
    }
    return merged;
  }

  // Status reads are CAPPED per workspace, and listStatus returns the exact
  // pre-slice `total` beside the capped `items` (LIN-1494). Aggregate the
  // per-workspace truncation signal (any ws with total > items.length) and the
  // Σ of totals so the feed can report honest hasMore/summary.total instead of
  // deriving them from the already-truncated pool. Failure discipline matches
  // mergeAcross: a failed workspace contributes nothing — no phantom totals,
  // no poisoned hasMore.
  async function readStatusAcross(workspaces, readOne, label) {
    const settled = await Promise.allSettled(workspaces.map(readOne));
    const statusItems = [];
    let sourceTotal = 0;
    let sourceHasMore = false;
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        statusItems.push(...r.value.items);
        sourceTotal += r.value.total;
        if (r.value.total > r.value.items.length) sourceHasMore = true;
      } else {
        console.error(`Live console: ${label} read failed for a workspace:`, r.reason?.message);
      }
    }
    return { statusItems, sourceTotal, sourceHasMore };
  }

  // LIN-1588 (Beat 2): resolve the per-token credential verdict for the tokens
  // the CURRENT working lanes actually carry, so a stranded worker is visible on
  // the lane rail instead of only in the BLOCKED park it wrote.
  //
  // Reuse, not reimplementation: the verdict is computed exactly once, inside
  // Beat 1's own `listCredentialHealth` (lib/proxy-events.js). This function
  // only reads it and folds it to an index the pure transform can be handed.
  //
  // Cost contract: the read is SKIPPED ENTIRELY when no active loop carries a
  // non-null `agentTokenId` — the ~99.86% case per LIN-1585 — so the ordinary
  // poll issues no additional query at all and stays "pure Mongo reads + a
  // deterministic transform" (see the header). The window is Beat 1's own 15-min
  // default and is deliberately NOT widened to make more lanes resolve: a lane
  // older than the credential window has no recent evidence, and `unknown` is
  // the honest answer for that.
  async function readCredentialIndex(workspaces, loops, superseded) {
    if (!proxyEventStore) return {};
    // LIN-3977: the membership predicate, so a waiting run's token is read too
    // (LIN-1588's stranded-worker case), with the same superseded set the feed uses.
    const tokenIds = collectAgentTokenIds(loops, lp => isLaneMember(lp, superseded));
    if (!tokenIds.size) return {};

    // Per-workspace failure discipline matches mergeAcross: a workspace whose
    // read fails contributes nothing, so its lanes fall back to `unknown`
    // rather than the feed losing every verdict.
    const rows = await mergeAcross(workspaces, async (ws) => {
      const { tokens } = await proxyEventStore.listCredentialHealth(ws.urlKey);
      return tokens || [];
    }, 'credential-health');

    return foldCredentialIndex(rows.filter(t => t && tokenIds.has(t.tokenId)));
  }

  // ─── HTML page ────────────────────────────────────────────────────────────
  router.get('/workspace/:urlKey/live-console', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const featureFlags = await requestFeatureFlags(req);
    if (featureFlags.liveConsole !== true) {
      return res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings/features`);
    }
    try {
      res.send(renderLiveConsolePage({
        deployInfo: getDeployInfo(),
        urlKey: workspace.urlKey,
        openRouterSource: getOpenRouterSource(req),
        workspaces: req.session.workspaces,
        featureFlags,
      }));
    } catch (error) {
      console.error('Live console page error:', error);
      res.status(500).send(renderErrorPage('Something Went Wrong', 'Could not load the Live Console. Please try again.', {
        action: 'Try again',
        actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/live-console`,
      }));
    }
  });

  // Every workspace's lean loops, tagged with their workspace. One read per
  // workspace; the poll and the history page both call it.
  async function readLoops(workspaces) {
    if (!dispatchQueueStore) return [];
    return mergeAcross(workspaces, async (ws) => {
      const wsLoops = await getLoopsForWorkspace(ws.urlKey, { dispatchStore: dispatchQueueStore, agentStatusStore, lean: true });
      return (wsLoops || []).map(lp => ({ ...lp, workspaceUrlKey: ws.urlKey, workspaceName: ws.name || ws.urlKey }));
    }, 'loops');
  }

  // ─── Events endpoint (poll source + history pages) ──────────
  router.get('/workspace/:urlKey/api/live-console/events', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    // LIN-3977: the page's own resolution (stored flag, else the owner-with-runner
    // rule), so the page and this data cannot disagree about who may see it.
    const featureFlags = await requestFeatureFlags(req);
    if (featureFlags.liveConsole !== true) {
      return jsonError(res, 403, 'Live console feature is not enabled');
    }

    // LIN-3977 (C2): the current workspace by default; every connected one on
    // `scope=all`. Filtering the read (not the output) keeps the banner's counts
    // in step with what is shown.
    const scope = req.query.scope === 'all' ? 'all' : 'current';
    const workspaces = scope === 'all'
      ? connectedWorkspaces(req, workspace)
      : [{ urlKey: workspace.urlKey, name: workspace.name || workspace.urlKey }];
    const now = Date.now();
    const beforeRaw = Number(req.query.before);
    const before = Number.isFinite(beforeRaw) && beforeRaw > 0 ? beforeRaw : null;

    try {
      if (before) {
        // ── History page: the SAME event pool the poll builds (LIN-3977, N1). ──
        // The `before` cursor is pushed DOWN into the status read as an exclusive
        // `until` bound, widened by FOLD_SKEW_MS: a status row just past the cursor
        // can still fold into a moment before it, so it must be read. The pool is
        // built and folded first, and only then cut at the cursor, so a row shows
        // once, on the page its moment falls on.
        const pageSize = Math.min(Math.max(1, Number(req.query.limit) || 40), MAX_HISTORY_PAGE);
        const since = new Date(now - HISTORY_WINDOW_MS);
        const until = new Date(before + FOLD_SKEW_MS);
        const [statusRead, loops] = await Promise.all([
          readStatusAcross(workspaces, async (ws) => {
            const { items, total } = await agentStatusStore.listStatus(ws.urlKey, { since, until, limit: HISTORY_PER_WORKSPACE_LIMIT });
            return { items: (items || []).map(item => ({ ...item, workspaceUrlKey: ws.urlKey, workspaceName: ws.name || ws.urlKey })), total: total || 0 };
          }, 'status(history)'),
          readLoops(workspaces),
        ]);
        const superseded = computeSupersededLoopIds(loops);
        const { events } = buildConsoleEvents({
          statusItems: statusRead.statusItems,
          loops,
          derivedSinceMs: now - HISTORY_WINDOW_MS,
          superseded,
          sessionIdByLoop: sessionIdByLoop(loops, { now: new Date(now) }),
        });
        const { page, hasMore, oldestTs } = pageEvents(events, { before, pageSize });
        return res.json({ events: page, hasMore: hasMore || statusRead.sourceHasMore, oldestTs });
      }

      // ── Live poll: status stream + loops (lanes/heartbeats/evidence/tempo). ──
      // LIN-1494: thread the stores' truncation signal + Σ pre-slice totals
      // into the feed so `hasMore` and `summary.total` are honest about rows
      // the per-workspace cap dropped, instead of being derived from the
      // truncated pool.
      const since = new Date(now - FEED_WINDOW_MS);
      const [statusRead, loops] = await Promise.all([
        readStatusAcross(workspaces, async (ws) => {
          const { items, total } = await agentStatusStore.listStatus(ws.urlKey, { since, limit: FEED_PER_WORKSPACE_LIMIT });
          return { items: (items || []).map(item => ({ ...item, workspaceUrlKey: ws.urlKey, workspaceName: ws.name || ws.urlKey })), total: total || 0 };
        }, 'status'),
        readLoops(workspaces),
      ]);

      // LIN-3977: one superseded set and one run-id index per poll, built from the
      // loops the route already holds (CPU only, no further read).
      const superseded = computeSupersededLoopIds(loops);
      const sessionIds = sessionIdByLoop(loops, { now: new Date(now) });

      // Depends on `loops`, so it runs after the read above rather than inside
      // the Promise.all — it is the empty-set short-circuit that keeps the
      // ordinary poll free, and there is nothing to ask for until we know which
      // tokens the working lanes carry.
      const credentialByToken = await readCredentialIndex(workspaces, loops, superseded);

      // LIN-1505 Phase C: the strip's requested zoom span. Never trust the
      // raw query value as a store-facing window — snap it to one of the
      // fixed rungs, so the wire (and buildPulse's bucket count) carries at
      // most four shapes. The `loops` read above already covers FEED_WINDOW_MS
      // (24h), which exceeds the widest rung (6h), so no extra store read.
      const pulseWindowMs = snapPulseWindowMs(req.query.pulseSpanMs);

      const feed = buildConsoleFeed({ statusItems: statusRead.statusItems, loops }, {
        now,
        pageSize: DEFAULT_PAGE_SIZE,
        sourceHasMore: statusRead.sourceHasMore,
        sourceTotal: statusRead.sourceTotal,
        credentialByToken,
        pulseWindowMs,
        sessionIdByLoop: sessionIds,
        superseded,
        derivedSinceMs: now - FEED_WINDOW_MS,
      });
      res.json(feed);
    } catch (error) {
      console.error('Live console events error:', error);
      serverError.json(res, 'Failed to load the live feed');
    }
  });

  return router;
}
