/**
 * The effort read-out routes (LIN-3742 split of routes/dashboard.js):
 *
 *   GET /workspace/:urlKey/effort-readout      — operator-facing per-kind effort x cost x duration x survived-the-next-gate read-out (LIN-2641); URL-only, unflagged and unlinked
 *   GET /workspace/:urlKey/api/effort-readout  — the same read-out as JSON
 *
 * Page-load-only: it makes per-issue provider reads, so it never joins the poll
 * path (see the comment on `computeWorkspaceEffortReadout`).
 */
import { Router } from 'express';
import { keepaliveError, classifyUpstreamError, isAuthError } from '../lib/errors.js';
import { renderUpstreamAwareErrorPage, renderErrorPage } from '../lib/render-pages.js';
import { resolveIssueBinding } from '../lib/workspace.js';
import { computeEffortReadout, eligibleIssueIdentifiers } from '../lib/effort-readout.js';
import { renderEffortReadoutPage } from '../lib/render-effort-readout.js';
import { armKeepalive } from '../lib/http-keepalive.js';
import { requestFeatureFlags } from '../lib/run-controls.js';
import { settleWithConcurrency } from './dashboard-session-state.js';

// Max per-issue provider round trips in flight for the effort read-out's
// comment/description fan-out (LIN-2641). Deliberately its OWN constant rather
// than a reuse of WORKSPACE_FANOUT_CONCURRENCY (dashboard-session-state.js):
// that one bounds a cross-WORKSPACE Loop-graph fan-out whose per-slot cost is a
// full 30-day history materialisation, while this bounds per-ISSUE HTTP reads
// against one provider. They are different resources with different right
// answers, and coupling them would make a change to either silently re-tune the
// other.
const EFFORT_READOUT_ISSUE_CONCURRENCY = 4;

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
// NOT on the poll path, deliberately. `public/llms.txt` documents that the
// live feed reads Mongo only — no provider calls per poll — and this route
// DOES make per-issue provider reads, so it must stay a page-load-only
// surface. Never move this computation into /api/dashboard/sessions.

// LIN-3242 (LIN-3126 §4) / LIN-3335: group the eligible population by the
// dispatch row's OWN provider-kind `issueSource`, not by the workspace's
// active binding. Each DISTINCT stamped source resolves ONCE via the
// source-only `resolveIssueBinding`; the call scope/credential always comes
// from the hydrated binding. An UNSTAMPED issue keeps today's behaviour: the
// null group resolves to the workspace's active binding. The pair-era scope
// plumbing is gone.
function groupBySource(identifiers, rows) {
  const stampByIdentifier = new Map();
  for (const row of rows) {
    const id = row.issueIdentifier;
    if (!id) continue;
    const stamped = row.issueSource != null;
    const existing = stampByIdentifier.get(id);
    if (existing === undefined || (existing === null && stamped)) {
      stampByIdentifier.set(id, stamped ? row.issueSource : null);
    }
  }
  const groups = new Map();
  for (const identifier of identifiers) {
    const selector = stampByIdentifier.get(identifier) ?? null;
    const key = selector ?? '';
    let group = groups.get(key);
    if (!group) {
      group = { selector, identifiers: [] };
      groups.set(key, group);
    }
    group.identifiers.push(identifier);
  }
  return groups;
}

// One group's per-issue reads, `{ contexts, skipped }`. An auth rejection is NOT
// a skip (LIN-1984's lesson: a run that silently skipped most of its reads still
// reported success). It is non-retryable and cannot be fixed by rendering
// partial numbers, so it propagates to the caller's upstream-aware error branch.
async function readGroupContexts(group, provider, callScope, supports) {
  const settled = await settleWithConcurrency(group.identifiers, EFFORT_READOUT_ISSUE_CONCURRENCY, async (identifier) => {
    // `fetchIssueComments` (not `fetchIssueContext`) because the verdict
    // walk needs each comment's own `id` + `createdAt`, which only this
    // reader emits. `fetchIssueFields` supplies the description the gate
    // fields are derived from.
    const [comments, fields] = await Promise.all([
      provider.fetchIssueComments(callScope, identifier),
      supports('fetchIssueFields') ? provider.fetchIssueFields(callScope, identifier) : Promise.resolve(null),
    ]);
    return {
      identifier,
      id: fields?.id || identifier,
      description: typeof fields?.description === 'string' ? fields.description : '',
      comments: Array.isArray(comments) ? comments : [],
    };
  });

  const contexts = [];
  let skipped = 0;
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      contexts.push(outcome.value);
      continue;
    }
    if (isAuthError(outcome.reason)) throw outcome.reason;
    // Retryable (429/5xx/network) — count it, still render, and say so.
    skipped += 1;
  }
  return { contexts, skipped };
}

// Capability flags: the workspace's own default resolution (today's single
// read) PLUS every resolved stamped group, so a stamped binding that can serve
// comments still lights the survival columns even when the active binding
// refuses.
async function readIssueContexts(workspace, groups) {
  const defaultBinding = resolveIssueBinding(workspace, null);
  const defaultSupports = (name) => typeof defaultBinding.provider?.supports === 'function' && defaultBinding.provider.supports(name);
  const supportsFns = [defaultSupports];
  const issueContext = new Map();
  let skipped = 0;

  for (const group of groups.values()) {
    const binding = resolveIssueBinding(workspace, group.selector);
    if (binding.error) {
      // Unstamped on a multi-binding workspace, or a stale stamped key:
      // disclose by counting the whole group as skipped, never throw.
      skipped += group.identifiers.length;
      continue;
    }
    const { provider, callScope } = binding;
    const supports = (name) => typeof provider?.supports === 'function' && provider.supports(name);
    supportsFns.push(supports);
    if (!supports('fetchIssueComments')) continue;

    const read = await readGroupContexts(group, provider, callScope, supports);
    for (const ctx of read.contexts) issueContext.set(ctx.identifier, ctx);
    skipped += read.skipped;
  }
  return { issueContext, skipped, supportsFns };
}

async function computeWorkspaceEffortReadout(workspace, { now }, { dispatchQueueStore }) {
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

  const groups = groupBySource(identifiers, [...liveRows, ...historyRows]);
  const { issueContext, skipped, supportsFns } = await readIssueContexts(workspace, groups);

  const survivalAvailable = supportsFns.some((fn) => fn('fetchIssueComments'));
  const gateFieldsAvailable = supportsFns.some((fn) => fn('fetchIssueFields'));

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
