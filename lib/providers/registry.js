// =============================================================================
// Provider Registry (LIN-176 Phase 2, Subtask 1 — the Contract)
// =============================================================================
//
// A tiny name → provider-instance registry. Single-provider (Linear) this
// phase; the map shape is here so LIN-306/307 can add more without touching
// call sites.
//
// --- Init lifecycle: module-load self-registration ---------------------------
// Chosen lifecycle: each provider self-registers as a side effect of its module
// being imported (see `lib/providers/linear/index.js`, which calls
// `registerProvider(linearProvider)` at module scope). There is NO explicit
// "register all providers" call at server startup.
//
// Why this over explicit startup registration:
//   * The dashboard already boots by importing `lib/linear.js`, which is now a
//     shim that re-exports from the Linear provider module. That import alone
//     pulls in the provider and triggers its self-registration — so the
//     registry is populated for free, with no new wiring in server.js.
//   * Zero behavior change is the hard constraint this phase. An explicit
//     startup call would be a new boot step that could be forgotten or ordered
//     wrong; piggy-backing on the existing import graph cannot regress.
//   * This matters for LIN-331: when consumers migrate to `getProvider('linear')`
//     they only need to ensure the provider module is in their import graph
//     (it already is, transitively), not to add a registration step.
//
// Trade-off: registration is import-order-dependent. In practice the provider
// module is imported eagerly via the shim before any `getProvider` call runs,
// so this is not a problem. If a future provider must register without being
// imported by the shim, switch to explicit startup registration then.

const providers = new Map()

/**
 * Register a provider instance under its `.name`.
 * Idempotent: re-registering the same name overwrites (last write wins).
 * @param {{name: string}} provider - A ProviderInterface instance.
 * @returns {{name: string}} The registered provider (for chaining).
 */
export function registerProvider(provider) {
  if (!provider || typeof provider.name !== 'string' || !provider.name) {
    throw new Error('registerProvider: provider must have a non-empty string name')
  }
  providers.set(provider.name, provider)
  return provider
}

/**
 * Look up a registered provider by name.
 * @param {string} name
 * @returns {object|undefined} The provider instance, or undefined if unknown.
 */
export function getProvider(name) {
  return providers.get(name)
}

/**
 * All registered provider instances.
 * @returns {object[]}
 */
export function getAllProviders() {
  return [...providers.values()]
}

/**
 * Resolve the provider for a workspace, falling back to the Linear provider.
 *
 * Centralizes the fallback used by every render surface (dashboard, swipe,
 * foreman) so they resolve provider display strings identically (LIN-177 S3).
 * Legacy workspaces have no `provider` field and the unauthenticated landing
 * page has no workspace at all — both resolve to Linear, keeping display
 * strings byte-identical to before.
 *
 * @param {{provider?: string}} [workspace]
 * @returns {object|undefined} Provider instance (Linear fallback), or undefined
 *   only if even the Linear provider is unregistered (not possible at runtime).
 */
export function getProviderForWorkspace(workspace) {
  return providers.get(workspace?.provider) || providers.get('linear')
}
