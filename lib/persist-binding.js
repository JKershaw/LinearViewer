/**
 * LIN-3125 Phase 2 — the shared persist seam.
 *
 * The three GitHub flow locations that pair `convertToConnectionBacked` with the
 * `writeConnection` fallback (add-source, existing-container, new-container) all
 * funnel through this one helper, so sign-up (credentials mode) and a
 * signed-in add (held mode) end in the same create path while every caller keeps
 * its own ordering, redirects, flash and error pages.
 *
 * Injection, not import: `convertToConnectionBacked` and `writeConnection` are
 * passed in by the caller (`lib/github-install-flow.js` already imports both).
 * This module therefore imports neither `connection-store.js` nor
 * `connection-credential.js` — and no provider or route module — so the D6
 * connection-access guard's exact importer allow-lists (arms a1/a2) and
 * `READ_ALLOWED_MODULES` stay untouched. It is IO-free and unit-testable with
 * fakes.
 *
 * Behaviour (preserved exactly from the inlined call sites):
 *   - credentials mode: convert, then a best-effort legacy `writeConnection`
 *     fallback on any `connectionBacked:false` result (including residual (a)
 *     `{error:'retryable'}`) and only when a store and writer exist, exactly as
 *     the inline pairs and the 7 sibling seams do. A `connectionBacked:true`
 *     result — including `error:'retryable'` for a failed update of an existing
 *     binding — never falls back. Throws propagate unchanged so the callers'
 *     catches still fire.
 *   - held mode (`heldConnectionId`): convert-only. There is no credential to
 *     copy, so it NEVER falls back to a legacy write; any failure returns
 *     `error:'retryable'` (the Phase 1 C3 shape). F3: on any failure it restores
 *     a caller-supplied `session.workspaces` snapshot, so a half-created
 *     workspace never survives. It does not call `establishAccount`, stamp
 *     `identityAuthenticatedAt`, or write the owner edge (Phase 3).
 */

/**
 * @param {Object} args
 * @param {import('./connection-store.js').ConnectionStore} [args.connectionStore]
 * @param {Object} args.session - `req.session`
 * @param {string} args.accountId - the established (canonical) account id
 * @param {Object} args.workspace - the container the binding was linked onto
 * @param {string} args.provider
 * @param {string} args.scope
 * @param {Object} [args.credentials] - credentials mode: the call-site credentials
 * @param {string} [args.heldConnectionId] - held mode: bind onto this Connection
 * @param {'none'|'legacy'|'connection'} [args.prior]
 * @param {string} [args.refreshToken]
 * @param {Object} [args.staged]
 * @param {(id: string) => (string|Promise<string>)} [args.resolveCanonicalAccountId]
 * @param {boolean} [args.writesEnabled]
 * @param {Object[]} [args.workspacesSnapshot] - F3: `session.workspaces` taken
 *   before `upsertWorkspace`; restored on any held failure.
 * @param {(args: Object) => Promise<Object>} args.convertToConnectionBacked - injected seam
 * @param {(connectionStore: Object, accountId: string, workspace: Object, provider: string, scope: string) => Promise<void>} [args.writeConnection] - injected legacy fallback
 * @param {(workspace: Object, provider: string, scope: string) => (string|null)} [args.sameKindRefusal] - LIN-3334: injected one-source-per-kind policy; returns the plain refusal message when `(provider, scope)` would add a second source of a kind the workspace already holds, else null. Armed only by the held add-source caller (`routes/held-connection.js`); see the top-of-function check.
 * @returns {Promise<{connectionBacked: boolean, connectionId?: string, error: string|null, message?: string}>}
 */
export async function persistBinding({
  connectionStore,
  session,
  accountId,
  workspace,
  provider,
  scope,
  credentials,
  heldConnectionId = null,
  prior = 'none',
  refreshToken,
  staged = null,
  resolveCanonicalAccountId,
  writesEnabled,
  workspacesSnapshot,
  sameKindRefusal,
  convertToConnectionBacked,
  writeConnection,
} = {}) {
  const workspaceId = workspace?.id;

  // LIN-3334 — the one-ticket-source-per-kind refusal, checked BEFORE the held
  // try/catch, the snapshot and `convertToConnectionBacked` → `addReferent`. It
  // RETURNS a distinct non-retryable `{error:'refused'}` instead of throwing, so
  // none of the three catch layers that convert *any* held throw into
  // `retryable` (the converter catch, this module's held catch, and the route
  // catches) can swallow it — and no durable write can happen before the check.
  //
  // Only the held add-source caller (`bindAddSource`) arms this: the three
  // credentials-mode GitHub callers have already run `linkProvider` (which
  // throws on a same-kind/different-scope link), and held-new is on a fresh
  // container with no bindings. The injected policy (`sameKindSourceBound` in
  // `lib/workspace.js`) reads through `getBindingsForWorkspace`, so a legacy
  // container is seen as its one binding.
  if (typeof sameKindRefusal === 'function') {
    const refusalMessage = sameKindRefusal(workspace, provider, scope);
    if (refusalMessage) {
      return { connectionBacked: false, connectionId: undefined, error: 'refused', message: refusalMessage };
    }
  }

  if (heldConnectionId) {
    // Held mode: convert-only, and every failure is retryable. With the
    // production injection (`convertToConnectionBacked`) a held throw is already
    // caught inside the converter and returned as `retryable`, so this catch is
    // not reached by that path — it is the defensive contract guard for the
    // injected seam itself (a future/alternative converter), and is exercised by
    // `lin-3125-phase2-persist-binding.test.js` "held mode: a thrown converter".
    let conversion;
    try {
      conversion = await convertToConnectionBacked({
        connectionStore,
        session,
        accountId,
        workspaceId,
        provider,
        scope,
        heldConnectionId,
        resolveCanonicalAccountId,
        writesEnabled,
      });
    } catch (err) {
      // Mirrors the converter's own held contract: a held failure is retryable,
      // never a legacy result and never allowed to surface as a 500.
      console.error('[persist-binding] held conversion failed:', err);
      restoreWorkspaces(session, workspacesSnapshot);
      return { connectionBacked: false, connectionId: undefined, error: 'retryable' };
    }
    if (conversion?.connectionBacked) {
      return { connectionBacked: true, connectionId: conversion.connectionId, error: null };
    }
    restoreWorkspaces(session, workspacesSnapshot);
    return { connectionBacked: false, connectionId: undefined, error: 'retryable' };
  }

  // Credentials mode: reproduce the inline convert + legacy fallback semantics.
  const conversion = await convertToConnectionBacked({
    connectionStore,
    session,
    accountId,
    workspaceId,
    provider,
    scope,
    credentials,
    refreshToken,
    prior,
    staged,
    resolveCanonicalAccountId,
    writesEnabled,
  });
  if (!conversion.connectionBacked && connectionStore && typeof writeConnection === 'function') await writeConnection(connectionStore, accountId, workspace, provider, scope);
  return { connectionBacked: conversion.connectionBacked, connectionId: conversion.connectionId, error: conversion.error };
}

/** F3: put `session.workspaces` back to the pre-upsert snapshot. No-op when absent. */
function restoreWorkspaces(session, workspacesSnapshot) {
  if (session && workspacesSnapshot !== undefined) session.workspaces = workspacesSnapshot;
}
