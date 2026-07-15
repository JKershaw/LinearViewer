/**
 * The single seam every sign-in path converges on (LIN-1329, Phase C of
 * LIN-1326): find-or-create the durable account, link the sign-up identity,
 * propagate any conflict, bind the account to the workspace, and set
 * `session.accountId`. Structurally prevents the five paths (Linear OAuth,
 * Linear PAT, GitHub App, GitHub Projects, Local) from duplicating this logic
 * — mirrors the anti-divergence role `linkProvider` (lib/workspace.js, LIN-562)
 * plays for provider bindings.
 *
 * Identity `scope` is ALWAYS the human's provider-side user id — Linear's
 * `viewer.id`, GitHub's user id, or (for local) the freshly-minted, globally
 * unique urlKey — NEVER a resource address (repo slug, board slug, org id).
 * This is the LIN-1329 Q1 ruling: `linkIdentity` conflicts on `(provider,
 * scope)`, so a resource-scoped identity would let two humans sharing that
 * resource false-conflict and lock the second out of ever creating an account.
 *
 * GitHub App and GitHub Projects share ONE identity provider, `github` (Q3):
 * the same human reaches the same account whichever door they sign in
 * through, even though the two providers keep separate workspace BINDINGS.
 */

/**
 * @param {Object} session - `req.session` (mutated: sets `session.accountId` on success).
 * @param {import('./account-store.js').AccountStore} accountStore
 * @param {import('./account-workspace-store.js').AccountWorkspaceStore} accountWorkspaceStore
 * @param {string} provider - identity provider name (`'linear'` | `'github'` | `'local'`).
 * @param {string} scope - the human's provider-side user id (or, for local, the urlKey).
 * @param {Object} credentials - identity metadata merged onto the identity record.
 * @param {string} workspaceId - the session workspace id this sign-in binds to.
 * @returns {Promise<{ok: true, accountId: string}|{ok: false, conflict: {accountId: string}}|{ok: false, reason: string}>}
 */
export async function establishAccount(session, accountStore, accountWorkspaceStore, provider, scope, credentials, workspaceId) {
  // Resolve the identity's account FIRST, before deciding whether to mint a
  // fresh one: a returning user signs in with no `session.accountId` (a new
  // browser session, or one that logged out) but their identity is already
  // linked to their original account. Minting a new empty account here and
  // THEN calling linkIdentity would immediately self-conflict against the
  // account that actually owns the identity — silently locking a normal
  // returning user out of their own account.
  const existingOwner = await accountStore.findAccountByIdentity(provider, scope);

  let accountId;
  let minted = false;
  if (existingOwner) {
    if (session.accountId && session.accountId !== existingOwner._id) {
      // Signed in as a different account than the one this identity already
      // belongs to. Strict per LIN-1326: surface the conflict, never auto-merge.
      return { ok: false, conflict: { accountId: existingOwner._id } };
    }
    accountId = existingOwner._id;
  } else if (session.accountId) {
    // Already signed in, linking a NEW identity onto the current account
    // (e.g. GitHub add-source from an active Linear-authenticated session).
    accountId = session.accountId;
  } else {
    const created = await accountStore.createAccount();
    accountId = created._id;
    minted = true;
  }

  // linkIdentity re-checks ownership itself (guards a race between the lookup
  // above and this write), so its result is the one propagated on conflict.
  const linked = await accountStore.linkIdentity(accountId, provider, scope, credentials);
  if (!linked.ok) {
    // Self-inflicted race, mint branch ONLY: `accountId` was minted a moment
    // ago specifically because no owner existed, so it holds zero identities
    // and no session ever pointed at it. A conflict here can only mean another
    // concurrent first-sign-in for the SAME identity won the unique-index race
    // between our pre-check and our write — never a genuine pre-existing
    // owner (that would have surfaced via `existingOwner` above). Adopt the
    // winner and drop the orphan instead of reporting a false conflict against
    // the user's own sign-in. The two conflict returns that reach here via the
    // existingOwner/session.accountId branches above stay terminal — this
    // adoption must not generalise to them, or LIN-1326's strict no-auto-merge
    // invariant breaks.
    if (!minted || !linked.conflict) return linked;
    await accountStore.deleteAccount(accountId);
    accountId = linked.conflict.accountId;
  }

  await accountWorkspaceStore.bindAccountToWorkspace(accountId, workspaceId);
  session.accountId = accountId;
  return { ok: true, accountId };
}
