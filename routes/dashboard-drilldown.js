/**
 * The drill-down routes (LIN-3742 split of routes/dashboard.js):
 *
 *   GET /workspace/:urlKey/api/dashboard/session-context/:sessionId       — deterministic tasks-touched + relationship graph (LIN-593)
 *   GET /workspace/:urlKey/api/dashboard/hydrate/:wsUrlKey/:identifier    — lazy Linear hydration (drill-down only)
 *
 * `pointReadSession` arrives in `ctx` from the composer (it binds the dashboard's
 * loop deps; LIN-3812).
 */
import { Router } from 'express';
import { badRequest, jsonError, keepaliveError } from '../lib/errors.js';
import { getSessionsForWorkspace, deriveIssueGraph } from '../lib/pipeline-loops.js';
import { armKeepalive } from '../lib/http-keepalive.js';
import { getWorkspaceByUrlKey } from '../lib/workspace.js';
import { buildSessionContextGraph } from '../lib/context-graph.js';

// ─── Session context graph (deterministic; LIN-593) ───────────────────────────
//
// The relationship shape of everything a session touched: each touched task's
// neighborhood (parent/children/epic/blocks/related, reusing buildContextGraph)
// tagged with provenance (seed / descended / spun-off). No AI, nothing cached —
// it resolves entirely against the workspace's loaded issue set, the same as
// /api/context/:issueId. Loading that set also lets us derive the issueGraph the
// session inference fallback needs, repairing the degraded reconstruction the
// /loops + /session-summary paths run without (they pass no issueGraph).

// Find the one session by id. Prefer the materialized read-model point-read
// (LIN-632): on a hit we skip the full 30-day workspace reconstruction
// entirely. On a miss, degrade to the live reconstruction — which also
// needs the issueGraph for accurate session inference, so derive it only
// on that path (the read-model session already carries everything
// buildSessionContextGraph reads).
async function findSessionForContext({ observationSessionsStore, pointReadSession, loopDeps }, urlKey, sessionId, issues) {
  let session = null;
  if (observationSessionsStore) {
    session = await observationSessionsStore.getSession(urlKey, sessionId);
  }
  if (!session) {
    // LIN-1022: try the issue-scoped point-read first (same class fix as
    // session-summary). A stamped session is reconstructed faithfully without
    // the issueGraph; only a historical inference-grouped session (no sessionId
    // stamps) falls through to the issueGraph-enriched whole-workspace read,
    // which the inference fallback genuinely needs.
    session = await pointReadSession(urlKey, sessionId);
  }
  if (!session) {
    const issueGraph = deriveIssueGraph(issues);
    const sessions = await getSessionsForWorkspace(urlKey, { ...loopDeps, issueGraph });
    session = sessions.find(s => String(s.sessionId) === String(sessionId)) || null;
  }
  return session;
}

function sessionContext(ctx) {
  const { fetchWorkspaceIssues } = ctx;
  return async (req, res) => {
    const workspace = req.workspace;
    const { sessionId } = req.params;
    if (!sessionId) return badRequest.json(res, 'sessionId is required');

    // Bound the request with a keepalive heartbeat (LIN-615).
    const keepalive = armKeepalive(res);
    try {
      // The graph build always needs the workspace's full issue set (it resolves
      // each touched task's neighbourhood against it). Memoized at the source
      // (server.js, LIN-632) so warm drill-ins do NOT refetch all of Linear.
      const issues = fetchWorkspaceIssues ? (await fetchWorkspaceIssues(workspace)) || [] : [];

      const session = await findSessionForContext(ctx, workspace.urlKey, sessionId, issues);
      if (!session) {
        return keepaliveError(keepalive, 404, 'Session not found');
      }

      const graph = buildSessionContextGraph(issues, session.tasksTouched, {
        seedIssue: session.seedIssue,
        window: { start: session.dispatchedAt, end: session.completedAt }
      });

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
        return keepaliveError(keepalive, 401, 'Token expired or invalid');
      }
      return keepaliveError(keepalive, 500, 'Could not build session context');
    }
  };
}

// ─── Lazy Linear hydration (drill-down only) ──────────────────────────────────
// Best-effort: fetch live state/labels for ONE issue in ONE workspace, using
// that workspace's own token. Failure (expired token, not found) degrades to a
// null hydration — the run detail still renders from the Mongo Loop data.

// LIN-2775 Area 6: project a neighbourhood member (fetchIssueContext's raw
// parent/sibling/child/cousin node) down to the small, stable shape a
// membership/terminality check actually needs — never the full GraphQL node,
// which for siblings/children also carries labels/relations/grandchildren
// this consumer has no use for and no reason to expose over this route.
function projectNeighbor(node) {
  if (!node) return null;
  return {
    id: node.id || null,
    identifier: node.identifier || null,
    title: node.title || null,
    state: node.state ? { name: node.state.name, type: node.state.type } : null
  };
}

function hydrate({ getWorkspaceAccessToken, fetchIssueContext }) {
  return async (req, res) => {
    const { wsUrlKey, identifier } = req.params;
    // Only hydrate workspaces the user is actually connected to (never trust the path).
    const connected = !!getWorkspaceByUrlKey(req.session, wsUrlKey);
    if (!connected) return jsonError(res, 403, 'Not connected to that workspace');

    try {
      const token = await getWorkspaceAccessToken(wsUrlKey, req.session);
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
        url: issue.url || null,
        // LIN-2775 Area 6: additive, no second provider read — fetchIssueContext
        // above already resolved parent/siblings/children/cousins, each
        // carrying its own state. Widened so a caller resolving a declared
        // `record_on` target gets BOTH neighbourhood-membership (does this
        // identifier appear here at all) AND that member's own terminality
        // (its embedded `state.type`) from this one call — no second round
        // trip is needed to separately check the target's own state.
        neighborhood: {
          parent: projectNeighbor(context?.parent),
          siblings: (context?.siblings || []).map(projectNeighbor),
          children: (context?.children || []).map(projectNeighbor),
          cousins: (context?.cousins || []).map(projectNeighbor)
        }
      });
    } catch (error) {
      // Best-effort: never 500 the drill-down on a hydration miss.
      res.json({ hydrated: false, reason: /not found/i.test(error?.message) ? 'not_found' : 'unavailable' });
    }
  };
}

/**
 * @param {Object} ctx - the composer's resolved dependencies plus its shared closures
 * @returns {Router}
 */
export function createDashboardDrilldownRoutes(ctx) {
  const { workspaceFromUrl } = ctx;
  const router = Router();
  router.get('/workspace/:urlKey/api/dashboard/session-context/:sessionId', workspaceFromUrl, sessionContext(ctx));
  router.get('/workspace/:urlKey/api/dashboard/hydrate/:wsUrlKey/:identifier', workspaceFromUrl, hydrate(ctx));
  return router;
}
