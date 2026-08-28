/**
 * Shared account-merge confirm/decline routes (LIN-2304, extracted from
 * routes/auth.js). Mounted exactly ONCE at the app root (server.js) — every
 * provider auth router mounts at root too, so a per-provider registration of
 * these same paths would be shadowed by whichever router mounts first
 * (Linear, by registry order).
 */
import { Router } from 'express'
import { renderErrorPage } from '../lib/render-pages.js'
import { upsertWorkspace, saveSession, persistOwnerCredential } from '../lib/workspace.js'
import { isFreshlyAuthenticated, MERGE_CONFIRM_FRESH_AUTH_WINDOW_MS } from '../lib/account-session.js'
import { applyUserPreferencesToSession } from '../lib/user-preferences.js'

/**
 * @param {Object} options
 * @param {import('../lib/account-store.js').AccountStore} options.accountStore
 * @param {import('../lib/account-workspace-store.js').AccountWorkspaceStore} options.accountWorkspaceStore
 * @param {import('../lib/owner-credential-store.js').OwnerCredentialStore} [options.ownerCredentialStore]
 * @param {import('../lib/account-merge-log.js').AccountMergeLogStore} [options.accountMergeLogStore]
 * @param {Object} [options.userPreferencesStore] - LIN-2304: the confirm-completion step is now uniform across every provider (including Linear), so it needs the same preferences rehydration every non-conflict success path already performs.
 * @returns {Router}
 */
export function createAccountMergeRoutes({ accountStore, accountWorkspaceStore, ownerCredentialStore, accountMergeLogStore, userPreferencesStore }) {
  const router = Router()

  /**
   * Decline a pending account merge (LIN-2233, L2.2). Byte-identical to
   * today's behavior: clears the pending offer, writes nothing to either
   * account.
   */
  router.post('/auth/merge/decline', (req, res) => {
    delete req.session.pendingMerge
    req.session.save(() => {
      res.redirect('/')
    })
  })

  /**
   * Confirm a pending account merge (LIN-2233, L2.2 + LIN-2231 amendment A1).
   *
   * Re-checks freshness at confirm time, not just at offer time — the offer
   * page can sit open; the proof standard ("two identities each freshly
   * authenticated in one session") must hold when the merge actually writes,
   * not merely when it was proposed. Also re-checks that the confirming
   * session is still the SAME canonical account the pending merge was built
   * for, so a session swap mid-flow can't redirect a stale pending merge onto
   * a different account.
   *
   * On success: writes the merge (`mergeAccounts`), then completes the
   * identity link exactly as the non-conflict path would have — binds the
   * arriving workspace onto the canonical account, conditionally persists its
   * owner credential there (LIN-2304: only when `pending.refreshToken` is
   * truthy — GitHub-family write no owner credential today, and the confirm
   * path must not introduce one for them), and applies the same uniform
   * completion step every provider's non-conflict success path already runs
   * (`activeWorkspaceId` + rehydrated preferences — LIN-2304, applied to
   * Linear's own confirm path too, closing a pre-existing gap rather than
   * forking it). The arriving identity itself is NOT attached to canonical's
   * `identities[]` (`mergeAccounts` never touches `identities[]` — it stays
   * recorded on the merged account and resolves through `mergedInto`).
   */
  router.post('/auth/merge/confirm', async (req, res) => {
    const pending = req.session.pendingMerge
    if (!pending) {
      const html = renderErrorPage('Merge Expired', 'This merge confirmation has expired or was never started. Please try connecting the account again.', {
        action: 'Go to homepage',
        actionUrl: '/'
      })
      return res.status(400).send(html)
    }

    const stillFresh = isFreshlyAuthenticated(req.session, MERGE_CONFIRM_FRESH_AUTH_WINDOW_MS) &&
      (Date.now() - pending.createdAt) <= MERGE_CONFIRM_FRESH_AUTH_WINDOW_MS
    const sameSession = req.session.accountId === pending.canonicalAccountId

    if (!stillFresh || !sameSession) {
      delete req.session.pendingMerge
      const html = renderErrorPage('Merge Expired', 'This merge confirmation is no longer fresh. Please sign in again and retry connecting the account.', {
        action: 'Go to homepage',
        actionUrl: '/'
      })
      return res.status(400).send(html)
    }

    const merged = await accountStore.mergeAccounts(pending.canonicalAccountId, pending.mergedAccountId, { accountWorkspaceStore, mergeLogStore: accountMergeLogStore })
    if (!merged.ok) {
      delete req.session.pendingMerge
      const html = renderErrorPage('Merge Failed', 'Could not complete the merge. Please try again.', {
        action: 'Go to homepage',
        actionUrl: '/'
      })
      return res.status(500).send(html)
    }

    const canonicalAccountId = pending.canonicalAccountId
    try {
      upsertWorkspace(req.session, pending.workspace)
    } catch (limitError) {
      delete req.session.pendingMerge
      const html = renderErrorPage('Workspace Limit Reached', 'You have reached the maximum number of connected workspaces. Please remove one before adding another.', {
        action: 'Go to dashboard',
        actionUrl: '/'
      })
      return res.status(400).send(html)
    }
    await accountWorkspaceStore.bindAccountToWorkspace(canonicalAccountId, pending.workspace.id)
    // LIN-2304: conditional on pending.refreshToken — persistOwnerCredential
    // itself has no internal skip-on-missing-refreshToken guard, so gating
    // the CALL is what keeps GitHub/GitHub Projects (which pass no
    // refreshToken into the offer) from gaining an owner-credential write
    // they never had on their normal sign-in path.
    if (pending.refreshToken) {
      await persistOwnerCredential(canonicalAccountId, pending.workspace, ownerCredentialStore, pending.refreshToken)
    }

    // LIN-2304: uniform confirm-completion, run identically for every
    // provider (no per-provider branch) — mirrors the activeWorkspaceId +
    // preferences steps already present on every provider's non-conflict
    // success path. This is a deliberate extension of Linear's own confirm
    // behavior, which previously set neither.
    req.session.activeWorkspaceId = pending.workspace.id
    if (userPreferencesStore) {
      const savedPrefs = await userPreferencesStore.getUserPreferences(canonicalAccountId)
      applyUserPreferencesToSession(req.session, savedPrefs)
    }

    // LIN-2231 amendment A2: canonicalize the CONFIRMING session explicitly,
    // even though it should already hold canonicalAccountId (canonical is, by
    // definition, the account already live in this session when the offer was
    // made). Cheap insurance, stated explicitly per the amendment. Other
    // still-live sessions of the MERGED account are a documented, accepted
    // tail — they keep resolving under the old id until they naturally expire
    // (≤24h); the canonicalization chokepoint at resolveWorkspaceAccess is
    // what actually closes that gap, not this route.
    req.session.accountId = canonicalAccountId

    delete req.session.pendingMerge
    await saveSession(req.session)

    if (pending.mode === 'add-source') {
      return res.redirect(`/workspace/${encodeURIComponent(pending.returnUrlKey)}/settings?provider_ok=${encodeURIComponent(pending.provider)}`)
    }
    return res.redirect(`/workspace/${encodeURIComponent(pending.workspace.urlKey)}/`)
  })

  return router
}
