/**
 * Shared account-merge confirm/decline routes (LIN-2304, extracted from
 * routes/auth.js). Mounted exactly ONCE at the app root (server.js) — every
 * provider auth router mounts at root too, so a per-provider registration of
 * these same paths would be shadowed by whichever router mounts first
 * (Linear, by registry order).
 */
import { Router } from 'express'
import { renderErrorPage } from '../lib/render-pages.js'
import { upsertWorkspace, saveSession, persistOwnerCredential, getBindingCredentials } from '../lib/workspace.js'
import { writeConnection } from '../lib/connection-store.js'
import { onAccountMerged } from '../lib/connection-lifecycle.js'
import { convertToConnectionBacked, bindingShapeAt, CONNECTION_RETRY_TITLE, CONNECTION_RETRY_MESSAGE } from '../lib/connection-credential.js'
import { isFreshlyAuthenticated, MERGE_CONFIRM_FRESH_AUTH_WINDOW_MS } from '../lib/account-session.js'
import { applyUserPreferencesToSession } from '../lib/user-preferences.js'

/**
 * LIN-2285: `mergeAccounts` (lib/account-store.js) has exactly six failure
 * reasons — the primary LIN-2285 fix means the acceptance-witness flow no
 * longer reaches this residual branch at all, but it stays reachable via a
 * narrow inter-session race (another session merges the canonical account
 * between offer and confirm → `canonical-already-merged`), so the generic
 * "Merge Failed" dead-end this ticket exists to remove must not survive here
 * either. `self-merge`/`missing-id` are defence in depth: the corrected
 * `establishAccount` race handling (`lib/account-session.js`) is designed so
 * neither should reach this handler, but "should not be reachable" is not
 * the same guarantee as "cannot fall back to the generic copy if it is".
 */
const MERGE_FAILURE_COPY = {
  'missing-id': 'Could not complete the merge: one of the accounts involved could not be identified. Please try again.',
  'self-merge': 'Could not complete the merge: these are the same account. No merge is needed.',
  'unknown-canonical': 'Could not complete the merge: your account could not be found. Please sign in again.',
  'unknown-merged': 'Could not complete the merge: the other account could not be found. Please try again.',
  'canonical-already-merged': 'Could not complete the merge: your account has already been merged into another account since this offer was made. Please sign in again.',
  'already-merged': 'Could not complete the merge: the other account has already been merged into a different account since this offer was made. Please sign in again.',
}

/**
 * @param {Object} options
 * @param {import('../lib/account-store.js').AccountStore} options.accountStore
 * @param {import('../lib/account-workspace-store.js').AccountWorkspaceStore} options.accountWorkspaceStore
 * @param {import('../lib/owner-credential-store.js').OwnerCredentialStore} [options.ownerCredentialStore]
 * @param {import('../lib/account-merge-log.js').AccountMergeLogStore} [options.accountMergeLogStore]
 * @param {Object} [options.userPreferencesStore] - LIN-2304: the confirm-completion step is now uniform across every provider (including Linear), so it needs the same preferences rehydration every non-conflict success path already performs.
 * @returns {Router}
 */
export function createAccountMergeRoutes({ accountStore, accountWorkspaceStore, ownerCredentialStore, accountMergeLogStore, userPreferencesStore, connectionStore }) {
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
      const message = MERGE_FAILURE_COPY[merged.reason] || 'Could not complete the merge. Please try again.'
      const html = renderErrorPage('Merge Failed', message, {
        action: 'Go to homepage',
        actionUrl: '/'
      })
      return res.status(500).send(html)
    }

    const canonicalAccountId = pending.canonicalAccountId
    // LIN-3124 PR2 (D4/D10): drop the merged account's unreferenced
    // connection-backed rows and their owner records. A row with referents
    // stays and keeps resolving; a LIN-3127-born row (no origin) is never
    // deleted. Inert until PR3 writes connection-backed bindings. This is not a
    // workspace-keyed write, so it runs for EVERY merge — including S3-2's
    // null-workspace (email link-mode) case below.
    await onAccountMerged({ connectionStore, ownerCredentialStore, mergedAccountId: pending.mergedAccountId })
    // S3-2 (LIN-1892): a null-workspace merge (an email link-mode conflict is
    // its only producer) still performs the account merge and the session
    // canonicalisation, but skips EVERY workspace-keyed write — the session
    // upsert, the account↔workspace edge, the LIN-3127 Connection record, the
    // owner credential, and `activeWorkspaceId`. The provider merge flows all
    // pass a real workspace and are byte-identical below.
    const hasWorkspace = pending.workspace != null
    let conversion = { connectionBacked: false, error: null }
    if (hasWorkspace) {
      // LIN-3124 PR3 (D2a): the binding shape before this upsert decides whether
      // the arriving binding is new (converts) or a re-link of a legacy one.
      const workspaceBeforeMerge = (req.session.workspaces || []).find(w => w.id === pending.workspace.id)
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

      // LIN-3127: additive, write-only Connection dual-write (best-effort) for
      // EVERY provider — deliberately NOT gated on pending.refreshToken (that
      // gate is for the owner-credential write only), so a GitHub/GitHub-Projects
      // merge (which offers no refreshToken) still writes. Runs after both
      // refusal returns above. `pendingMerge` carries no `scope`, so derive it
      // from the container's SINGLE binding for `pending.provider` (all four
      // respondToAccountConflict callers pass a freshly-built container with
      // exactly one binding); if it is not exactly one, skip and log — never
      // guess (N2).
      const matches = (pending.workspace.bindings || []).filter(b => b.provider === pending.provider)
      // LIN-3124 PR3 (D2a phase B): the arriving binding becomes connection-backed
      // on the canonical account (after both refusal returns above). The legacy
      // writes below are the fallback, unchanged. The merge has no call-site
      // credentials of its own: the arriving container's single binding was
      // built by the originating flow's phase A from ITS call-site credentials,
      // and is read through the accessor (legacy: the same object).
      if (matches.length === 1) {
        conversion = await convertToConnectionBacked({
          connectionStore, ownerCredentialStore, session: req.session, accountId: canonicalAccountId,
          workspaceId: pending.workspace.id, provider: pending.provider, scope: matches[0].scope,
          credentials: getBindingCredentials(matches[0]), refreshToken: pending.refreshToken,
          prior: bindingShapeAt(workspaceBeforeMerge, pending.provider, matches[0].scope),
        })
      }
      if (!conversion.connectionBacked) {
        if (connectionStore) {
          if (matches.length === 1) {
            await writeConnection(connectionStore, canonicalAccountId, pending.workspace, pending.provider, matches[0].scope)
          } else {
            console.warn(`LIN-3127 merge-confirm: expected exactly one binding for provider "${pending.provider}", found ${matches.length}; skipping Connection write`)
          }
        }
        // LIN-2304: conditional on pending.refreshToken — persistOwnerCredential
        // itself has no internal skip-on-missing-refreshToken guard, so gating
        // the CALL is what keeps GitHub/GitHub Projects (which pass no
        // refreshToken into the offer) from gaining an owner-credential write
        // they never had on their normal sign-in path.
        if (pending.refreshToken) {
          await persistOwnerCredential(canonicalAccountId, pending.workspace, ownerCredentialStore, pending.refreshToken)
        }
      }

      // LIN-2304: uniform confirm-completion, run identically for every
      // provider (no per-provider branch) — mirrors the activeWorkspaceId +
      // preferences steps already present on every provider's non-conflict
      // success path. This is a deliberate extension of Linear's own confirm
      // behavior, which previously set neither.
      req.session.activeWorkspaceId = pending.workspace.id
    }
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

    if (conversion.error) {
      return res.status(503).send(renderErrorPage(CONNECTION_RETRY_TITLE, CONNECTION_RETRY_MESSAGE, {
        action: 'Go to homepage', actionUrl: '/'
      }))
    }
    if (hasWorkspace && pending.mode === 'add-source') {
      return res.redirect(`/workspace/${encodeURIComponent(pending.returnUrlKey)}/settings?provider_ok=${encodeURIComponent(pending.provider)}`)
    }
    if (hasWorkspace) {
      return res.redirect(`/workspace/${encodeURIComponent(pending.workspace.urlKey)}/`)
    }
    // Null-workspace merge: land on the session's first workspace, or the
    // account home when there is none (the email-only link-mode case).
    const firstWorkspace = req.session.workspaces?.[0]
    return res.redirect(firstWorkspace ? `/workspace/${encodeURIComponent(firstWorkspace.urlKey)}/` : '/account')
  })

  return router
}
