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

/** `workspace.provider`, normalized the way the rest of the app reads it (absent = linear). */
function markerProvider(provider) {
  return provider || 'linear';
}

/**
 * D2 (LIN-3124 PR3): the workspace's ACTIVE connection-backed binding, or null.
 * The active binding is identified by the session-resident
 * `workspace.activeBinding = {provider, scope}` marker set by the converter /
 * `setActiveProvider` / `unlinkProvider`. The ONE shared predicate (review
 * blocker 5): a marker whose provider is not the workspace's active provider is
 * stale — e.g. a legacy re-login of another provider replaced the scalar mirror
 * — and matches nothing, so a stale marker can never route a credential, a
 * refresh or a revoke. Store-free, so protected modules may import it. A legacy
 * workspace has no marker, so this is null.
 */
export function activeConnectionBackedBinding(workspace) {
  const marker = workspace?.activeBinding;
  if (!marker || !Array.isArray(workspace.bindings)) return null;
  if (markerProvider(marker.provider) !== markerProvider(workspace.provider)) return null;
  const match = workspace.bindings.find(b => b && b.provider === marker.provider && b.scope === marker.scope);
  return isConnectionBacked(match) ? match : null;
}

/** True when {@link activeConnectionBackedBinding} finds one. */
export function activeBindingIsConnectionBacked(workspace) {
  return activeConnectionBackedBinding(workspace) !== null;
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

/**
 * Derives the provider's connection unit (the third `_id` component) from a
 * binding. Returns `null` for a provider with no connection unit (e.g. local).
 *
 * @param {Object} binding - a workspace binding `{ provider, scope, credentials }`
 * @returns {string|null}
 */
export function unitIdForBinding(binding) {
  switch (binding.provider) {
    case 'github':
    case 'github-projects':
      return binding.credentials.installationId;
    case 'jira':
      // Site URL, never cloudId — a Basic binding carries no cloudId. Basic's
      // scope is normalizeJiraSite's canonical `https://<host>`; OAuth's scope
      // is the raw `site.url` from accessible-resources. The two key the SAME
      // record only when byte-identical for a tenant (N6) — the same condition
      // that already governs the binding's Basic->OAuth upgrade-in-place.
      return binding.scope;
    case 'linear':
      // org.id — linkProvider's 3rd arg IS the org id (routes/auth.js:213).
      // connectionUnit is null for Linear, so this reads binding.scope exactly
      // like Jira's case, not a provider-declared unit label.
      return binding.scope;
    default:
      return null;
  }
}

/**
 * LIN-3124 PR3 (D2a creation rule): the shape of the `(provider, scope)`
 * binding on a workspace BEFORE phase A's `linkProvider` runs — `'none'`,
 * `'legacy'` or `'connection'`. A seam snapshots it so the converter can tell a
 * new binding (eligible) from a re-link of a legacy one (stays legacy).
 *
 * @param {Object|null|undefined} workspace
 * @param {string} provider
 * @param {string} scope
 * @returns {'none'|'legacy'|'connection'}
 */
export function bindingShapeAt(workspace, provider, scope) {
  const binding = (workspace?.bindings || []).find(b => b && b.provider === provider && b.scope === scope);
  if (!binding) return 'none';
  return isConnectionBacked(binding) ? 'connection' : 'legacy';
}
