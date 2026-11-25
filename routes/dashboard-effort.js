/**
 * The effort read-out routes (LIN-3742 split of routes/dashboard.js):
 *
 *   GET /workspace/:urlKey/effort-readout      — operator-facing per-kind effort x cost x duration x survived-the-next-gate read-out (LIN-2641); URL-only, unflagged and unlinked
 *   GET /workspace/:urlKey/api/effort-readout  — the same read-out as JSON
 *
 * Page-load-only: it reads records on each load, so it never joins the poll
 * path (see the comment on `computeWorkspaceEffortReadout`).
 */
import { Router } from 'express';
import { keepaliveError, classifyUpstreamError, isAuthError } from '../lib/errors.js';
import { renderUpstreamAwareErrorPage, renderErrorPage } from '../lib/render-pages.js';
import { computeEffortReadout, eligibleIssueIdentifiers } from '../lib/effort-readout.js';
import { anchorOf } from '../lib/lineage-membership.js';
import { requireRequestUsageLoader } from '../lib/request-usage-loader.js';
import { renderEffortReadoutPage } from '../lib/render-effort-readout.js';
import { armKeepalive } from '../lib/http-keepalive.js';
import { requestFeatureFlags } from '../lib/run-controls.js';

// The history read's row bound (LIN-2641). `listHistory` sorts { resolvedAt: -1 }
// and pushes this into the query, so it means "the 200 most recently RESOLVED
// rows", not the 200 most recently dispatched. The paired live read
// (`listItems`) takes NO limit — the method has no such option; it is bounded
// only by its own TTL predicate (expiresAt > now). The two reads therefore
// carry two different bounds, and the page states each honestly rather than
// one shared number.
const EFFORT_READOUT_HISTORY_LIMIT = 200;

// ─── Effort self-assessment read-out (LIN-2641, Phase 2 of LIN-2566) ───────
//
// Per-kind effort x cost x duration x survived-the-next-gate over this
// workspace's recent dispatch rows. Modelled on the escalation-kpis pair
// (dashboard-kpis.js): a URL-only operator page (unflagged, unlinked) that
// computes on page load rather than being polled.
//
// NOT on the poll path, deliberately. Its reads are the dispatch queue and the
// records (batched, one read per kind, per load), which the poll path does not
// make; it must stay a page-load-only surface. Never move this computation into
// /api/dashboard/sessions.

async function computeWorkspaceEffortReadout(workspace, { now }, { dispatchQueueStore, requestUsageLoader, recordsStore = null }) {
  const urlKey = workspace.urlKey;
  const loader = requireRequestUsageLoader(requestUsageLoader, 'effort read-out');

  // Two reads, two DIFFERENT bounds (see the constants above). `listItems`
  // is given no `limit` because it accepts none; `listHistory` carries the
  // real one. Projection excludes only `prompt` — `status`, `feedback` and
  // `rootItemId` are all load-bearing for the adapter and both joins.
  const [liveRows, history] = await Promise.all([
    dispatchQueueStore.listItems(urlKey, { projection: { prompt: 0 } }),
    dispatchQueueStore.listHistory(urlKey, { limit: EFFORT_READOUT_HISTORY_LIMIT, projection: { prompt: 0 } }),
  ]);
  const historyRows = history.items || [];
  // LIN-4177: the founder lookup for every lineage these rows belong to (scalar, uncapped), so the cost read
  // names a lineage by its true issue and kind even when its founder is older than the 200-row read.
  const anchors = [...new Set([...liveRows, ...historyRows].map(anchorOf).filter(Boolean))];
  // LIN-4226: the founder lookup and the lineages' request records run in parallel, as at HEAD: the lookup is started
  // now and awaited inside the cost read, which starts the records load (through the loader) alongside it. It is
  // marked handled at once, so a rejection while the records are read is not an unhandled rejection; the read still
  // re-raises it when it awaits the lookup.
  const identityRows = Promise.resolve(dispatchQueueStore.lineageIdentityRows(urlKey, { anchors }));
  identityRows.catch(() => {});

  // The issues the survival walk will actually score — derived through the
  // SAME population rule the compute layer uses, so the set read and the set
  // scored cannot drift.
  const identifiers = eligibleIssueIdentifiers({ liveRows, historyRows });

  // LIN-4519: the gate verdicts come from verdict records, one batched read for every scored issue, and the plan-review
  // gate from plan records (LIN-4504). No provider is asked for comments. No store or a fault leaves a read not measured
  // (never zero, never read from a comment).
  const verdictFacts = await readVerdictFacts(recordsStore, urlKey, identifiers);
  const planFacts = await readPlanFacts(recordsStore, urlKey, identifiers);

  return computeEffortReadout({
    liveRows,
    historyRows,
    historyTotal: history.total ?? historyRows.length,
    asOf: now.toISOString(),
    skipped: 0,
    survivalAvailable: verdictFacts !== null,
    planFacts,
    verdictFacts,
    identityRows,
    requestSource: loader,
    urlKey,
  });
}

/** LIN-4519: the scored issues' verdict facts from records, or null (not measured) with no store or on a fault (logged). */
async function readVerdictFacts(recordsStore, urlKey, identifiers) {
  if (!recordsStore || typeof recordsStore.verdictFactsForTickets !== 'function') return null;
  try {
    return await recordsStore.verdictFactsForTickets(urlKey, identifiers);
  } catch (err) {
    console.error(`[effort-readout] verdict facts could not be read (${urlKey}): ${err?.message || err}`);
    return null;
  }
}

/** LIN-4504: the scored issues' plan facts from records, or null (not measured) with no store or on a fault (logged). */
async function readPlanFacts(recordsStore, urlKey, identifiers) {
  if (!recordsStore || typeof recordsStore.planFactsForTickets !== 'function') return null;
  try {
    return await recordsStore.planFactsForTickets(urlKey, identifiers);
  } catch (err) {
    console.error(`[effort-readout] plan facts could not be read (${urlKey}): ${err?.message || err}`);
    return null;
  }
}

function effortReadoutPage(ctx) {
  return async (req, res) => {
    const workspace = req.workspace;
    const now = new Date();
    try {
      const readout = await computeWorkspaceEffortReadout(workspace, { now }, ctx);
      res.send(renderEffortReadoutPage(workspace.name, {
        urlKey: workspace.urlKey,
        workspaces: req.session.workspaces || [],
        featureFlags: await requestFeatureFlags(req),
        // LIN-4565: the frame's rail status and footer stamp, the same as every other page's.
        openRouterSource: ctx.getOpenRouterSource ? ctx.getOpenRouterSource(req) : null,
        deployInfo: ctx.getDeployInfo ? ctx.getDeployInfo() : {},
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
      res.status(500).send(renderErrorPage('Something Went Wrong', 'Failed to compute the effort read-out'));
    }
  };
}

function effortReadoutJson(ctx) {
  return async (req, res) => {
    const workspace = req.workspace;
    const now = new Date();
    const keepalive = armKeepalive(res);
    try {
      const readout = await computeWorkspaceEffortReadout(workspace, { now }, ctx);
      keepalive.send(200, { generatedAt: now.toISOString(), ...readout });
    } catch (error) {
      keepalive.stop();
      if (isAuthError(error)) {
        const classified = classifyUpstreamError(error);
        return keepaliveError(keepalive, 401, classified.detail, { code: classified.code, retryable: classified.retryable });
      }
      console.error('Effort read-out error:', error);
      keepaliveError(keepalive, 500, 'Could not compute the effort read-out');
    }
  };
}

/**
 * @param {Object} ctx - the composer's resolved dependencies
 * @returns {Router}
 */
export function createDashboardEffortRoutes(ctx) {
  const { workspaceFromUrl } = ctx;
  const router = Router();
  router.get('/workspace/:urlKey/effort-readout', workspaceFromUrl, effortReadoutPage(ctx));
  router.get('/workspace/:urlKey/api/effort-readout', workspaceFromUrl, effortReadoutJson(ctx));
  return router;
}
