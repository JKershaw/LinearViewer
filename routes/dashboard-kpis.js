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
import { computeEscalationKpis, escalationEventsOfQuestions } from '../lib/escalation-kpis.js';
import { renderEscalationKpisPage } from '../lib/render-escalation-kpis.js';
import { questionFacts } from '../lib/records/question-facts.js';
import { armKeepalive } from '../lib/http-keepalive.js';
import { requestFeatureFlags } from '../lib/run-controls.js';

// ─── Escalation KPIs — operator-facing audit page (LIN-1736) ────────────────
//
// Per docs/escalation-philosophy.md §7: escalation rate, time-to-response,
// false-escalation rate, unanswered age — the tuning loop that keeps the
// whole system honest. Session-authed, cross-workspace like the rest of
// Observation; never the public /kpis surface (lib/kpi-stats.js's privacy
// boundary is untouched by this route). Loads on demand rather than being
// polled.
//
// LIN-4538 (P7a): the KPIs read question records (lib/records/question-facts.js).
// A dismissal is a question a person ended `dismissed` (LIN-4550), or, before
// that, ended `withdrawn` "dismissed" by a person: questionOutcomeOf reads both.
// A question whose ticket closed ends `withdrawn` "ticket closed" and is
// self-resolved, never a dismissal; an agent's own withdrawal is neither.
//
// "Escalation rate per human" reduces here to "per workspace" — see
// lib/escalation-kpis.js's own docstring for why. `targetPerDay` is
// deliberately not hardcoded (no software-engineering-context figure has
// been established for this product); pass `?targetPerDay=` to set one.
async function computeWorkspaceEscalationKpis(workspaces, { windowMs, now, targetPerDay }, { recordsStore }) {
  // A workspace whose records read fails contributes nothing, as its loops did before (a partial page, not a 500).
  const facts = recordsStore
    ? (await Promise.all(workspaces.map((urlKey) => questionFacts(recordsStore, urlKey).catch(() => [])))).flat()
    : [];
  const { resolvedEvents, unansweredRows } = escalationEventsOfQuestions(facts);
  return computeEscalationKpis({ resolvedEvents, unansweredRows, windowMs, targetPerDay, now });
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
