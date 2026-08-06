/**
 * Jira Cloud auth routes (LIN-1885, Phase 1 of LIN-275) — the API-token
 * Basic-auth consumer of the LIN-562 provider-binding seam.
 *
 * Unlike GitHub's three-step OAuth App flow (install → callback → link), Jira
 * Phase 1 has no OAuth exchange at all: it is a SYNCHRONOUS validate-then-link,
 * closer to the Local provider's non-OAuth create (routes/workspace.js) than
 * to GitHub's picker. Two routes:
 *
 *   GET  /auth/jira        → render the {email, apiToken, site} link form
 *                             (lib/render-pages.js renderJiraLinkForm), for the
 *                             target workspace named in `?workspace=<urlKey>`.
 *   POST /auth/jira/link   → validate the credential via a lightweight read
 *                             probe (provider.validateCredential — GET
 *                             /rest/api/3/myself), then linkProvider it onto
 *                             that same workspace.
 *
 * Jira Phase 1 is ADD-SOURCE ONLY — there is no top-level "Continue with
 * Jira" login entry point (no KNOWN_ADD_PROVIDERS/landing wiring points here
 * without an existing workspace; that wiring is LIN-1885 beat 4). Because
 * there is no OAuth redirect round-trip, the target workspace's urlKey rides
 * as a plain form field (GET → hidden POST field) rather than session-carried
 * `mode`/`workspaceUrlKey` intent the way GitHub's flow needs it.
 */
import { Router } from 'express'
import { renderErrorPage, renderJiraLinkForm } from '../lib/render-pages.js'
import { getWorkspaceByUrlKey, validateWorkspaceUrlKey, linkProvider, saveSession } from '../lib/workspace.js'
import { establishAccount } from '../lib/account-session.js'

const NO_WORKSPACE_MESSAGE = 'Jira can only be added as an additional source on an existing workspace — open Settings on the workspace you want to add it to, then try again.'

/**
 * @param {Object} options
 * @param {import('../lib/providers/jira/index.js').JiraProvider} options.provider - injected by JiraProvider.getAuthRouter().
 * @param {import('../lib/account-store.js').AccountStore} [options.accountStore] - LIN-1329: find-or-create the durable account for the signing-in Jira identity.
 * @param {import('../lib/account-workspace-store.js').AccountWorkspaceStore} [options.accountWorkspaceStore] - LIN-1329: bind the account to the workspace.
 * @returns {import('express').Router}
 */
export function createJiraAuthRoutes({ provider, accountStore, accountWorkspaceStore } = {}) {
  const router = Router()

  /**
   * Step 1: render the link form for the workspace the user is adding Jira
   * onto. `?workspace=<urlKey>` mirrors every other add-source entry point's
   * `workspace` query param (routes/github-auth.js), even though Jira never
   * carries a `mode` — it has no "new" (fresh top-level) path this phase.
   */
  router.get('/auth/jira', (req, res) => {
    const workspaceUrlKey = req.query.workspace
    if (!validateWorkspaceUrlKey(workspaceUrlKey) || !getWorkspaceByUrlKey(req.session, workspaceUrlKey)) {
      return res.status(400).send(renderErrorPage('No Workspace Selected', NO_WORKSPACE_MESSAGE, {
        action: 'Go to homepage', actionUrl: '/'
      }))
    }
    res.send(renderJiraLinkForm({ workspaceUrlKey }))
  })

  /**
   * Step 2: validate-then-link, synchronously — no redirect round-trip.
   */
  router.post('/auth/jira/link', async (req, res) => {
    const { email, apiToken, site, workspace: workspaceUrlKey } = req.body || {}

    const workspace = validateWorkspaceUrlKey(workspaceUrlKey) && getWorkspaceByUrlKey(req.session, workspaceUrlKey)
    if (!workspace) {
      return res.status(400).send(renderErrorPage('No Active Workspace', NO_WORKSPACE_MESSAGE, {
        action: 'Go to homepage', actionUrl: '/'
      }))
    }

    if (!email || !apiToken || !site) {
      return res.status(400).send(renderJiraLinkForm({
        workspaceUrlKey,
        error: 'Email, API token, and site are all required.',
      }))
    }
    const normalizedSite = String(site).replace(/\/+$/, '')

    // Validate BEFORE linking — a lightweight read probe (GET /rest/api/3/myself)
    // rather than the settings refresh route's generic READ_PROBES list, which
    // Jira's Phase 1 surface has no fetchViewer/fetchOrganization/
    // fetchProjectsList to satisfy. A failed probe never links a dead credential.
    let myself
    try {
      myself = await provider.validateCredential({ email, apiToken, site: normalizedSite })
    } catch (err) {
      return res.status(400).send(renderJiraLinkForm({
        workspaceUrlKey,
        error: 'Could not authenticate with Jira. Check the email, API token, and site URL and try again.',
      }))
    }

    // LIN-1329: establish the durable account for this identity. `jira` is
    // its own identity provider (mirrors GitHub's userId-keyed identity,
    // github-projects/routes/github-auth.js), keyed on the human's Jira
    // accountId — never the workspace/site, which is a resource address, not
    // an identity (the LIN-1329 Q1 ruling: a resource-scoped identity would
    // let two humans sharing a site false-conflict).
    const established = await establishAccount(
      req.session, accountStore, accountWorkspaceStore, 'jira', myself.accountId,
      { email: myself.emailAddress, displayName: myself.displayName }, workspace.id
    )
    if (!established.ok) {
      return res.status(409).send(renderErrorPage('Account Conflict', 'This Jira account is already linked to a different Harbour account. Please sign in with that account, or contact support.', {
        action: 'Go to homepage', actionUrl: '/'
      }))
    }

    // linkProvider (lib/workspace.js) is the single seam: it writes
    // `credentials` into the (provider, scope) BINDING (the durable source of
    // truth) and, for the active binding, copies `tokenExpiresAt` onto the
    // legacy scalar mirror too — one write, both projections (LIN-1885
    // research finding 3: the MAX_SAFE_INTEGER stamp must land in
    // `binding.credentials`, not only the scalar mirror, so a later
    // setActiveProvider/mirrorActiveBinding re-point carries it forward, and
    // so the headless-resolve token-expiry check — which reads the scalar
    // mirror — sees it too). `site` is the binding's `scope` (third arg),
    // exactly like a GitHub binding's `scope` is its repo — not duplicated
    // into `credentials`, so there is only one place it can drift from.
    linkProvider(workspace, 'jira', normalizedSite, {
      token: apiToken,
      email,
      tokenExpiresAt: Number.MAX_SAFE_INTEGER,
    })

    await saveSession(req.session)
    res.redirect(`/workspace/${encodeURIComponent(workspace.urlKey)}/settings?provider_ok=jira`)
  })

  return router
}
