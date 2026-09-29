/**
 * Store-free connection-binding predicates and the per-request credential
 * side-table (LIN-3124 PR2, D1/D15).
 *
 * This module deliberately imports NONE of `connection-store.js`,
 * `connection-credential.js` or `connection-lifecycle.js`, so the D6(c)
 * protected modules (the resolver, the refresh module, the sweep,
 * `routes/workspace-api.js`, `lib/workspace.js`, the title resolver, the suspect
 * refresh and the gate) may import it. The credential itself is never a property
 * of a session object — it is held here in WeakMaps keyed on the binding /
 * workspace OBJECTS, and ONLY `lib/connection-credential.js` writes them (the
 * D6 caller pin on the setters enforces that).
 *
 * The read accessors (`lib/workspace.js`'s `getWorkspaceToken` /
 * `getWorkspaceCallScope` / `getBindingCredentials`) consult the side-table and
 * otherwise evaluate the verbatim legacy expression. That hook-up is PR3's read
 * cutover (S4); in PR2 the table is written by the hydration middleware but read
 * by nothing, so every legacy read is byte-identical.
 *
 * `discriminate()` is the single definition of "connection-backed":
 * `typeof connectionId === 'string'`. A legacy binding has no `connectionId`.
 */

/** binding object -> hydrated credentials object (per request) */
const byBinding = new WeakMap();
/** workspace object -> hydrated credentials of its ACTIVE binding (per request) */
const byWorkspace = new WeakMap();

/** A connection-backed binding/workspace carries a string `connectionId`. */
export function isConnectionBacked(entity) {
  return !!(entity && typeof entity.connectionId === 'string');
}

// Eligible providers (D5/D8). Provided this as a store-free predicate so both
// the credential seam and the lifecycle can gate on the provider kind without
// importing the store: refresh-token kinds rotate a durable owner record;
// remint kinds re-mint from the Connection row. `local`, Jira Basic and PAT are
// never connection-backed.
const REFRESH_TOKEN_KINDS = new Set(['linear', 'jira']);
const REMINT_KINDS = new Set(['github', 'github-projects']);

/** Normalized-provider predicate: a rotating-refresh-token connection. */
export function isRefreshTokenKind(provider) {
  return REFRESH_TOKEN_KINDS.has(provider);
}

/** Normalized-provider predicate: a re-mintable (GitHub-family) connection. */
export function isRemintKind(provider) {
  return REMINT_KINDS.has(provider);
}

/** Write the hydrated credential for one binding. Caller: connection-credential.js only. */
export function setBindingCredential(binding, credentials) {
  if (binding && typeof binding === 'object') byBinding.set(binding, credentials);
}

/** The hydrated credential for one binding, or `undefined` when unhydrated (fail closed). */
export function readBindingCredential(binding) {
  return binding && typeof binding === 'object' ? byBinding.get(binding) : undefined;
}

/** Write the hydrated credential for the workspace's active binding. Caller: connection-credential.js only. */
export function setWorkspaceCredential(workspace, credentials) {
  if (workspace && typeof workspace === 'object') byWorkspace.set(workspace, credentials);
}

/** The hydrated active-binding credential for a workspace, or `undefined` (fail closed). */
export function readWorkspaceCredential(workspace) {
  return workspace && typeof workspace === 'object' ? byWorkspace.get(workspace) : undefined;
}

/** Test-only: drop a workspace entry when a request's transient object is discarded. */
export function clearWorkspaceCredential(workspace) {
  if (workspace && typeof workspace === 'object') byWorkspace.delete(workspace);
}
