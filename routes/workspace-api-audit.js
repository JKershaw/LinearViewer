/**
 * Audit route (LIN-3883, LIN-2246: extracted from workspace-api.js): GET /api/audit,
 * the workspace audit. `registerAuditRoutes` puts it on the router
 * createWorkspaceApiRoutes hands it, at the place the audit block sat in that file
 * (after the prompts routes, before the recommend routes), so the route table's order
 * and the path's `Allow` (GET,HEAD) are unchanged. The steps it shares with the
 * composer (`failureOf`, `refuseCapability`) live in workspace-api-steps.js.
 */
import { jsonError } from '../lib/errors.js';
import { runAudit, computeAuditFromData } from '../lib/audit.js';
import { getWorkspaceToken, isActiveProviderLinear } from '../lib/workspace.js';
import { buildMockAuditData } from '../lib/workspace-api-mocks.js';
import { failureOf, refuseCapability } from './workspace-api-steps.js';

export function registerAuditRoutes(router, { workspaceFromUrl }) {
  // ===========================================================================
  // Audit API
  // ===========================================================================

  /**
   * Audit API endpoint - runs a workspace audit and returns JSON.
   * Requires authentication.
   */
  router.get('/workspace/:urlKey/api/audit', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;

    try {
      // Use mock audit data in test mode. Audit is NOT provider-routed —
      // runAudit() goes straight to GraphQL — so the local provider can't back
      // this surface; instead the deterministic mock gate is widened to fire for
      // local sessions too (LIN-412). This stays a DATA-mock carve-out (its own
      // predicate, NOT shouldMockAi): the semantics are "serve the deterministic
      // audit report", not "mock the AI call". The mock data below is unchanged —
      // the local-seed identity only affects session/workspace resolution.
      if (process.env.NODE_ENV === 'test' &&
          (workspace.accessToken === 'test-token' || workspace.provider === 'local')) {
        return res.json(computeAuditFromData(buildMockAuditData()));
      }

      // LIN-1899: the audit is a Linear-SPECIFIC capability — it reads the
      // provider-agnostic scalar mirror `workspace.accessToken` and hands it to
      // a statically Linear-bound GraphQL client (lib/audit.js:180). For a
      // non-Linear active binding that mirror holds THAT provider's credential
      // (a raw Jira API token, say), so the call below discloses it to
      // api.linear.app — and returns a misleading 401 from the catch branch
      // because Linear rejects it. Refuse instead: a capability endpoint with no
      // meaningful non-Linear rendering declines with 422 CAPABILITY_NOT_SUPPORTED
      // (the denyIfUnsupported envelope, routes/proxy.js:750-757), not the 503
      // workspaceUnavailable envelope — a provider mismatch is not transient.
      //
      // Placed AFTER the test-mode mock branch above so the LIN-412 local
      // carve-out keeps firing (tests/e2e/audit.spec.js runs on a genuine
      // `provider: 'local'` seed). Consequence, recorded deliberately: a local
      // workspace is mocked in test but REFUSED in production — today it sends
      // its urlKey to Linear for a fake 401, and 422 is the honest answer.
      // `linear`-only, never `linear` OR `local` (LIN-1891's settled rule); the
      // sibling asset relay withholds the header instead of refusing, because
      // capability endpoints refuse and asset relays degrade (see /api/image).
      if (!isActiveProviderLinear(workspace)) {
        return refuseCapability(res, workspace.provider, 'audit', 'this');
      }

      const report = await runAudit(getWorkspaceToken(workspace));
      res.json(report);
    } catch (error) {
      console.error('Audit error:', error);
      jsonError(res, ...failureOf(error, 'Audit failed', { notFound: false }));
    }
  });
}
