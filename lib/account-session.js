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
 * @param {Object} session - `req.session` (mutated: sets `session.accountId` on success; also
 *   canonicalizes a pre-existing `session.accountId` in place — LIN-2265 — even on a conflict
 *   return, since that's an id normalization, not a sign-in outcome).
 * @param {import('./account-store.js').AccountStore} accountStore
 * @param {import('./account-workspace-store.js').AccountWorkspaceStore} accountWorkspaceStore
 * @param {string} provider - identity provider name (`'linear'` | `'github'` | `'local'`).
 * @param {string} scope - the human's provider-side user id (or, for local, the urlKey).
 * @param {Object} credentials - identity metadata merged onto the identity record.
 * @param {string} workspaceId - the session workspace id this sign-in binds to.
 * @returns {Promise<{ok: true, accountId: string}|{ok: false, conflict: {accountId: string}}|{ok: false, reason: string}>}
 */
// LIN-2233 (LIN-2231 operator review, amendment A1): the confirmed-merge
// path (routes/auth.js) must prove BOTH sides freshly authenticated, not just
// a live session for one side plus a fresh auth for the other — otherwise a
// stolen/left-open session for the canonical account plus the sitting
// party's own real login yields a merge the session owner never proved.
// `establishAccount` stamps this on every success (mint, link, or idempotent
// re-link) — it is the one seam every sign-in path converges on, so this is
// "a real provider auth exchange just confirmed an identity now attached to
// session.accountId's account", precisely the proof a merge confirm needs.
export const MERGE_CONFIRM_FRESH_AUTH_WINDOW_MS = 10 * 60 * 1000;

/**
 * Whether `session.identityAuthenticatedAt` (set by a successful
 * `establishAccount` call) falls within `windowMs` of now — the "freshly
 * authenticated" half of the merge-confirm proof standard ("two identities
 * each freshly authenticated in one session", LIN-2231 amendment A1).
 * @param {Object} session
 * @param {number} [windowMs]
 * @returns {boolean}
 */
export function isFreshlyAuthenticated(session, windowMs = MERGE_CONFIRM_FRESH_AUTH_WINDOW_MS) {
  const at = session?.identityAuthenticatedAt;
  if (!Number.isFinite(at)) return false;
  return Date.now() - at <= windowMs;
}

/**
 * Clears a `session.accountId` that `establishAccount` just reported as
 * unresolvable (`{ok: false, reason: 'unknown-account'}` — no merge
 * candidate), plus the OAuth state/intent riding alongside it. This IS the
 * non-mergeable branch of `respondToAccountConflict`
 * (`lib/account-conflict.js`), which as of LIN-2304 calls this helper
 * directly rather than keeping its own inline copy. NOT a general
 * session-reset helper, and deliberately NOT called on a mergeable
 * `conflict` return, where the id must survive for the merge-confirm flow.
 * @param {Object} session - `req.session`
 */
export function clearUnresolvableAccountSession(session) {
  delete session.accountId
  delete session.identityAuthenticatedAt
  delete session.oauthState
  delete session.oauthIntent
}

/**
 * Resolve `accountId` to its canonical (post-merge) form, degrading to the
 * uncanonicalized id rather than throwing — LIN-2265's degrade-never-throw
 * discipline, extracted here by LIN-2285 so every call site in
 * `establishAccount` (the self-heal, the merged-side decision, the
 * `linkIdentity` race sibling, and the final session/workspace write)
 * degrades identically.
 *
 * `resolveCanonicalAccountId` THROWS on a corrupt `mergedInto` chain (a
 * pre-existing cycle, or one deeper than maxDepth) and on a store failure.
 * Only data corrupted BEFORE LIN-2265's write-path guard shipped can reach
 * that — no new cycle can be created now — but for such an account an
 * unwrapped call would turn sign-in into a throw where it previously
 * proceeded, and on entry paths that don't wrap their `establishAccount`
 * call (POST /auth/jira/link) that rejection is unhandled rather than a
 * clean error page. Degrading instead keeps the id uncanonicalized, exactly
 * as before LIN-2265. That is safe because the write-path guard in
 * `mergeAccounts` is independent of this one — a cycle-forming merge built
 * from a stale id still fails closed there.
 * @param {import('./account-store.js').AccountStore} accountStore
 * @param {string} accountId
 * @param {string} context - short label identifying the call site, for the degrade log line
 * @returns {Promise<string>}
 */
async function resolveCanonicalDegraded(accountStore, accountId, context) {
  try {
    return await accountStore.resolveCanonicalAccountId(accountId);
  } catch (err) {
    console.error(`[account-session] canonical account resolution failed for ${accountId} (${context}); continuing with the uncanonicalized id:`, err);
    return accountId;
  }
}

export async function establishAccount(session, accountStore, accountWorkspaceStore, provider, scope, credentials, workspaceId) {
  // LIN-2265: self-heal a stale, previously-merged `session.accountId` to its
  // current canonical form BEFORE it's used for the ownership comparison
  // below. `mergeAccounts` never touches `identities[]`, so a merged
  // account's identity stays registered on it — a later front-door login
  // with that identity puts the MERGED (non-canonical) id straight back into
  // `session.accountId`. Left uncorrected, that stale id then feeds the
  // conflict decision and the merge-confirm flow it builds
  // (`lib/account-conflict.js`'s `respondToAccountConflict`), which is what
  // let a later merge attempt offer — and confirm — a merge in the
  // OPPOSITE direction, writing a `mergedInto` CYCLE. Canonicalizing here,
  // at the one seam every sign-in path converges on, means every downstream
  // reader of `session.accountId` sees the true canonical id, not a merged one.
  if (session.accountId) {
    session.accountId = await resolveCanonicalDegraded(accountStore, session.accountId, 'self-heal');
  }

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
    // LIN-2285: canonicalize the OWNER for the decision and any conflict it
    // raises — `existingOwner._id` may itself have since been merged away.
    // `accountId` below stays raw (the identity's real current owner): that
    // is what `linkIdentity` needs for its own ownership re-check two lines
    // down, and naive canonicalization there would false-conflict it.
    const resolvedOwnerId = await resolveCanonicalDegraded(accountStore, existingOwner._id, 'merged-side decision');
    // Signed in as a different account than the one this identity already
    // belongs to. Strict per LIN-1326: surface the conflict, never auto-merge.
    // `session.accountId` was already canonicalized above, so this is a
    // canonical-vs-canonical comparison: when the arriving identity's
    // resolved owner IS the account already live in this session (its owner
    // was merged into it), the condition below is FALSE and execution falls
    // straight through to the idempotent re-link below — no conflict raised.
    // Deliberate, bounded behavior change (LIN-2285): this suppresses only
    // that same-account no-op confirmation (`mergeAccounts` writes nothing
    // for it either way); a merge offer against any genuinely distinct
    // canonical account is still raised exactly as before.
    if (session.accountId && session.accountId !== resolvedOwnerId) {
      return { ok: false, conflict: { accountId: resolvedOwnerId } };
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
    if (!minted && linked.conflict) {
      // LIN-2285: a race between the `findAccountByIdentity` lookup above
      // and this write — some owner attached to the identity in between.
      // Canonicalize it before deciding whether this is a genuine conflict
      // or a same-side no-op, mirroring the decision above. Must NOT fall
      // into the mint-only adoption branch below: `accountId` here is an
      // EXISTING account with its own identities, not a brand-new orphan —
      // unconditional canonicalization regressed a currently-working sign-in
      // into a `self-merge` 500 when the raced-in owner resolved to the
      // account already being linked to (plan-review F1).
      const resolvedRaceOwnerId = await resolveCanonicalDegraded(accountStore, linked.conflict.accountId, 'linkIdentity race conflict');
      if (resolvedRaceOwnerId !== accountId) {
        return { ok: false, conflict: { accountId: resolvedRaceOwnerId } };
      }
      // Equal: the raced-in owner resolves to the very account already being
      // established here — a same-side no-op, not a merge candidate. Fall
      // through to the shared write below with `accountId` unchanged; no
      // push to identities[] happened on this call, so the identity
      // self-heals to canonical the same way the decision above does.
    } else if (!linked.conflict) {
      return linked;
    } else {
      // Self-inflicted race, mint branch ONLY: `accountId` was minted a
      // moment ago specifically because no owner existed, so it holds zero
      // identities and no session ever pointed at it. A conflict here can
      // only mean another concurrent first-sign-in for the SAME identity won
      // the unique-index race between our pre-check and our write — never a
      // genuine pre-existing owner (that would have surfaced via
      // `existingOwner` above). Adopt the winner and drop the orphan instead
      // of reporting a false conflict against the user's own sign-in. This
      // adoption must not generalise to the two branches above, or
      // LIN-1326's strict no-auto-merge invariant breaks.
      await accountStore.deleteAccount(accountId);
      accountId = linked.conflict.accountId;
    }
  }

  // LIN-2285: canonicalize once more before the write every branch above
  // converges on — the existing-owner branch's `accountId` and the mint-race
  // adoption's `linked.conflict.accountId` are both still raw at this point.
  // Every reachable branch lands here with a value this makes canonical,
  // which is what makes `established.accountId` — and every downstream
  // owner-credential write and preference read keyed off it — canonical too.
  accountId = await resolveCanonicalDegraded(accountStore, accountId, 'session write');
  await accountWorkspaceStore.bindAccountToWorkspace(accountId, workspaceId);
  session.accountId = accountId;
  // LIN-2233: a real provider auth exchange just confirmed an identity for
  // this accountId in this session — the freshness clock the merge-confirm
  // proof standard (amendment A1) checks. See `isFreshlyAuthenticated` above.
  session.identityAuthenticatedAt = Date.now();
  return { ok: true, accountId };
}
