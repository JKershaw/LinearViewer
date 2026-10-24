/**
 * The escalation KPIs routes (LIN-3742 split of routes/dashboard.js):
 *
 *   GET /workspace/:urlKey/escalation-kpis      — operator-facing escalation KPI audit page (LIN-1736); ?windowDays= (default 30), ?targetPerDay= (optional)
 *   GET /workspace/:urlKey/api/escalation-kpis  — the same KPIs as JSON
 *
 * Depends only on the stores in `ctx`: the computation shares nothing with the
 * other dashboard modules.
 */
import { Router } from 'express';
import { keepaliveError } from '../lib/errors.js';
import { renderErrorPage } from '../lib/render-pages.js';
import { getLoopsForWorkspace, resolvedDecisionEvents, firstRaisedAt } from '../lib/pipeline-loops.js';
import { computeEscalationKpis } from '../lib/escalation-kpis.js';
import { renderEscalationKpisPage } from '../lib/render-escalation-kpis.js';
import { collectUnansweredDecisions } from '../lib/unanswered-decisions.js';
import { armKeepalive } from '../lib/http-keepalive.js';
import { requestFeatureFlags } from '../lib/run-controls.js';

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
async function computeWorkspaceEscalationKpis(workspaces, { windowMs, now, targetPerDay }, { dispatchQueueStore, agentStatusStore, taskDecisionsStore }) {
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
  // LIN-2729 / LIN-2893 Step 5: same `workspaces` scope as the candidate
  // fetch immediately above — see that method's own doc for why this KPI
  // needs it too (an older unanswered row must not outlive its task's
  // true newest, outcome-bearing scan just because this reduction never
  // saw that newer row).
  const newestScanByTask = taskDecisionsStore
    ? await taskDecisionsStore.listNewestScanPerTask(workspaces)
    : {};
  // Same predicate the live rulings feed uses (routes/dashboard-rulings.js's own
  // /api/dashboard/rulings) — never a second, divergent "is this
  // unanswered" derivation. Deliberately OMITS `shelvedRulings`: unanswered
  // age must stay monotonic regardless of shelving (LIN-1727's own
  // constraint) — a shelved-but-still-unanswered decision must keep
  // counting toward this KPI, not be hidden by it the way it is hidden
  // from the live queue.
  const unansweredRulings = collectUnansweredDecisions({ loops, taskDecisions: taskUnansweredRows, newestScanByTask }, { now });

  const unansweredRows = unansweredRulings.map(row => unansweredAgeRow(row, loops, taskUnansweredRows));

  return computeEscalationKpis({
    resolvedEvents: [...loopResolvedEvents, ...taskResolvedEvents],
    unansweredRows,
    windowMs,
    targetPerDay,
    now
  });
}

// The `(decisionId, raisedAt)` pair the unanswered-age KPI reads for one
// unanswered ruling: task-bound rows re-join the scan row that raised them,
// loop-backed rows read their raising loop's feedback.
function unansweredAgeRow(row, loops, taskUnansweredRows) {
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
  // LIN-2991/LIN-3022 §4: the loop that actually raised (and carries the
  // feedback for) the CURRENT decision is the content loop
  // (`row.stampLoopId`), never the anchor alone — they diverge for any
  // decision raised on a non-root turn, which a grouped/wake-raised
  // decision always is. `firstRaisedAt` on the wrong (anchor's) feedback
  // would find no match and silently drop the row from `unansweredAge`.
  const loop = loops.find(l => l.loopId === (row.stampLoopId ?? row.anchor?.loopId));
  return { decisionId: row.decision?.decision_id, raisedAt: firstRaisedAt(loop?.feedback, row.decision?.decision_id) };
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

function escalationKpisPage(ctx) {
  return async (req, res) => {
    const workspace = req.workspace;
    const workspaces = (req.session.workspaces || []).map(w => w.urlKey);
    const windowDays = parseWindowDays(req);
    const targetPerDay = parseTargetPerDay(req);
    const now = new Date();

    try {
      const kpis = await computeWorkspaceEscalationKpis(workspaces, { windowMs: windowDays * 24 * 60 * 60 * 1000, now, targetPerDay }, ctx);
      res.send(renderEscalationKpisPage(workspace.name, {
        urlKey: workspace.urlKey,
        workspaces: req.session.workspaces || [],
        featureFlags: await requestFeatureFlags(req),
        kpis,
        windowDays,
        generatedAt: now.toISOString()
      }));
    } catch (error) {
      console.error('Escalation KPIs page error:', error);
      res.status(500).send(renderErrorPage('Something Went Wrong', 'Failed to compute escalation KPIs'));
    }
  };
}

function escalationKpisJson(ctx) {
  return async (req, res) => {
    const workspaces = (req.session.workspaces || []).map(w => w.urlKey);
    const windowDays = parseWindowDays(req);
    const targetPerDay = parseTargetPerDay(req);
    const now = new Date();
    const keepalive = armKeepalive(res);
    try {
      const kpis = await computeWorkspaceEscalationKpis(workspaces, { windowMs: windowDays * 24 * 60 * 60 * 1000, now, targetPerDay }, ctx);
      keepalive.send(200, { windowDays, generatedAt: now.toISOString(), ...kpis });
    } catch (error) {
      console.error('Escalation KPIs error:', error);
      keepaliveError(keepalive, 500, 'Could not compute escalation KPIs');
    }
  };
}

/**
 * @param {Object} ctx - the composer's resolved dependencies
 * @returns {Router}
 */
export function createDashboardKpisRoutes(ctx) {
  const { workspaceFromUrl } = ctx;
  const router = Router();
  router.get('/workspace/:urlKey/escalation-kpis', workspaceFromUrl, escalationKpisPage(ctx));
  router.get('/workspace/:urlKey/api/escalation-kpis', workspaceFromUrl, escalationKpisJson(ctx));
  return router;
}
