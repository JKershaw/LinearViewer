import { saveSession } from './workspace.js'
import { renderErrorPage, renderMergeConfirmPage, renderMergeReauthRequiredPage } from './render-pages.js'
import { isFreshlyAuthenticated, MERGE_CONFIRM_FRESH_AUTH_WINDOW_MS, clearUnresolvableAccountSession } from './account-session.js'

/**
 * Shared account-conflict responder (LIN-2304, extracted from routes/auth.js —
 * the seam every `establishAccount` conflict-handling call site converges on,
 * Linear's own two plus the three non-Linear `mode:'new'` regenerate branches).
 *
 * `established.conflict` present means the arriving identity already belongs
 * to a DIFFERENT, pre-existing account: a real merge candidate. Anything else
 * (e.g. `established.reason === 'unknown-account'` — a stale/unrecognised
 * `session.accountId`) is not mergeable and stays the pre-existing dead-end
 * "Account Conflict" page, unchanged.
 *
 * For a real merge candidate, amendment A1 (LIN-2231) requires BOTH sides
 * freshly authenticated before a merge can be offered as a one-click confirm
 * — a live session for the canonical side plus a fresh auth for the arriving
 * side is NOT enough (a stolen/left-open canonical session + the sitting
 * party's own real login would otherwise yield a merge the session owner
 * never proved). `isFreshlyAuthenticated` checks the canonical side's own
 * last proven identity link in THIS session; the arriving side is fresh by
 * construction (its OAuth exchange just completed, this request). When the
 * canonical side isn't fresh, the merge is refused outright (re-auth-required
 * page, no pending state stored) rather than offered — retry after fresh
 * sign-in.
 *
 * Never writes anything to the account/workspace stores itself — only
 * `POST /auth/merge/confirm` does that, after a second freshness check at
 * confirm time. Declining (not confirming, or navigating away) therefore
 * leaves both accounts byte-identical to today.
 *
 * @param {Object} params
 * @param {Object} params.req
 * @param {Object} params.res
 * @param {{ok: false, conflict?: {accountId: string}, reason?: string}} params.established
 * @param {Object} params.workspace - the arriving identity's workspace (already populated by linkProvider)
 * @param {string} [params.refreshToken] - the arriving identity's OAuth refresh token, if any (absent for a non-refreshable provider, e.g. GitHub-family)
 * @param {'new'|'add-source'} params.mode
 * @param {string} params.returnUrlKey - urlKey to land on if the merge is later confirmed
 * @param {string} params.identityLabel - the provider-facing label for the arriving identity's copy (e.g. "Linear", "GitHub", "Jira") — never derived from a provider's display name or entryCta, both of which can diverge from the identity provider (LIN-2304).
 * @param {string} params.reauthUrl - where "Sign in again" should send the user to re-prove freshness — never derived from `provider.entryCta.href`, which is `null` for GitHub Projects.
 * @param {string} params.provider - the identity provider name stored on the pending merge, read back at confirm time to build the correct `provider_ok` redirect.
 * @returns {Promise<void>}
 */
export async function respondToAccountConflict({ req, res, established, workspace, refreshToken, mode, returnUrlKey, identityLabel, reauthUrl, provider }) {
  if (!established.conflict) {
    // Non-mergeable: establishAccount refused with no merge candidate — today
    // that's exclusively `reason: 'unknown-account'` (lib/account-store.js), a
    // session.accountId that no longer resolves to a real account (deleted
    // account, restored/repointed datastore). Clear it — and its freshness
    // stamp — before rendering, or the SAME stale id is carried into every
    // retry and this 409 becomes a permanent login lockout (LIN-2266) instead
    // of the pre-LIN-2233 self-heal. Also clears the OAuth state/intent here
    // — this early return used to skip the LIN-1351 hygiene the mergeable
    // branches below still do, leaking oauthState/oauthIntent across a failed
    // round-trip.
    clearUnresolvableAccountSession(req.session)
    const html = renderErrorPage('Account Conflict', `This ${identityLabel} account is already linked to a different Harbour account. Please sign in with that account, or contact support.`, {
      action: 'Go to homepage',
      actionUrl: '/'
    })
    return res.status(409).send(html)
  }

  const canonicalAccountId = req.session.accountId
  const mergedAccountId = established.conflict.accountId

  if (!isFreshlyAuthenticated(req.session, MERGE_CONFIRM_FRESH_AUTH_WINDOW_MS)) {
    delete req.session.oauthState
    delete req.session.oauthIntent
    const html = renderMergeReauthRequiredPage({ identityLabel, reauthUrl })
    return res.status(409).send(html)
  }

  req.session.pendingMerge = {
    canonicalAccountId,
    mergedAccountId,
    workspace,
    refreshToken: refreshToken || null,
    mode,
    returnUrlKey,
    provider,
    createdAt: Date.now()
  }
  delete req.session.oauthState
  delete req.session.oauthIntent
  await saveSession(req.session)

  const html = renderMergeConfirmPage({ identityLabel })
  return res.status(409).send(html)
}
