/**
 * Runner setup page route (LIN-3098 S4): the UI mint, reachable from
 * "○ set up ›", "run on my machine ›" beside the ladder, and the Dispatch
 * page, and usable from a phone (John's 29 Sep requirement).
 *
 *   GET /workspace/:urlKey/runner
 *
 * It NEVER redirects: every state renders a page that says what it needs
 * (lib/render-runner-setup.js). The state comes from the session's feature
 * flags and the owner check:
 *
 *   proxy off                  → proxy-off (the owner check isn't asked)
 *   owner, dispatch on / off   → owner / owner-dispatch-off
 *   not the owner / no owner   → not-owner / no-owner
 *   the owner check throws     → unavailable
 *
 * The owner check is `checkWorkspaceOwner` (lib/workspace-owner.js), the same
 * seam the server-side runner mint uses, which canonicalises a merged account
 * on both sides (NB7), so this page can't disagree with the mint. The mint
 * itself stays authoritative: this page only decides what to offer.
 *
 * The served runner prompt (lib/prompts/runner-kickoff.js) is built for this
 * request's base URL and shown in every state, so a person without a runner
 * credential can still read it.
 */

import { Router } from 'express';
import { renderRunnerSetupPage } from '../lib/render-runner-setup.js';
import { renderErrorPage } from '../lib/render.js';
import { getFeatureFlags } from '../lib/feature-defaults.js';
import { checkWorkspaceOwner } from '../lib/workspace-owner.js';
import { buildRunnerKickoff } from '../lib/prompts/runner-kickoff.js';

/**
 * @param {Object} deps
 * @param {Function} deps.workspaceFromUrl      - middleware: session + req.workspace
 * @param {Function} deps.getOpenRouterSource   - (req) → 'oauth'|'env'|'free'|null
 * @param {Function} deps.getDeployInfo         - () → deploy metadata
 * @param {Object}   [deps.accountWorkspaceStore] - for the default owner check
 * @param {Object}   [deps.accountStore]          - for the default owner check
 * @param {Function} [deps.ownerCheck]          - ({workspaceId, accountId}) → {status}; default checkWorkspaceOwner
 * @param {Function} [deps.buildPrompt]         - ({baseUrl}) → string; default buildRunnerKickoff
 * @returns {Router}
 */
export function createRunnerSetupRoutes({
  workspaceFromUrl,
  getOpenRouterSource,
  getDeployInfo,
  accountWorkspaceStore,
  accountStore,
  ownerCheck = (args) => checkWorkspaceOwner(args, { accountWorkspaceStore, accountStore }),
  buildPrompt = buildRunnerKickoff
}) {
  const router = Router();

  router.get('/workspace/:urlKey/runner', workspaceFromUrl, async (req, res) => {
    const workspace = req.workspace;
    const featureFlags = getFeatureFlags(req.session);
    const accountId = req.session?.accountId || null;

    let state;
    if (featureFlags.proxy !== true) {
      state = 'proxy-off';
    } else {
      let status;
      try {
        ({ status } = await ownerCheck({ workspaceId: workspace.id, accountId }));
      } catch (err) {
        console.warn(`Runner setup: owner check unavailable (urlKey=${workspace.urlKey}): ${err.message}`);
        status = 'unavailable';
      }
      if (status === 'owner') state = featureFlags.dispatch === true ? 'owner' : 'owner-dispatch-off';
      else if (status === 'no-owner') state = 'no-owner';
      else if (status === 'unavailable') state = 'unavailable';
      else state = 'not-owner';
    }

    try {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const html = renderRunnerSetupPage(
        { state, urlKey: workspace.urlKey, accountId, prompt: buildPrompt({ baseUrl }), baseUrl },
        {
          deployInfo: getDeployInfo(),
          openRouterSource: getOpenRouterSource(req),
          workspaces: req.session.workspaces,
          featureFlags
        }
      );
      res.send(html);
    } catch (error) {
      console.error('Runner setup page error:', error);
      res.status(500).send(renderErrorPage('Something Went Wrong', 'Could not load the runner setup page. Please try again.', {
        action: 'Try again',
        actionUrl: `/workspace/${encodeURIComponent(workspace.urlKey)}/runner`
      }));
    }
  });

  return router;
}
