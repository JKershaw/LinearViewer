/**
 * Provider → auth-router wiring (LIN-675).
 *
 * `server.js` is the composition root: it decides which login router serves
 * which provider. That decision used to live inside each provider class
 * (`getAuthRouter`), which forced `lib/providers/*` to import `routes/*-auth.js`
 * — a `lib/ → routes/` edge per provider. It lives here now, so `routes/` imports
 * `lib/` and never the reverse, and no provider module knows about Express.
 *
 * Adding a provider with a login flow = one row in `AUTH_ROUTER_FACTORIES`.
 */
import { createAuthRoutes } from './auth.js'
import { createGitHubAuthRoutes } from './github-auth.js'
import { createGitHubProjectsAuthRoutes } from './github-projects-auth.js'
import { createJiraAuthRoutes } from './jira-auth.js'

/**
 * Provider name → auth-route factory. `null` = the provider has no login flow
 * (`local`). Registry order is owned by lib/providers/index.js, not this table.
 */
const AUTH_ROUTER_FACTORIES = Object.freeze({
  linear: createAuthRoutes,
  github: createGitHubAuthRoutes,
  'github-projects': createGitHubProjectsAuthRoutes,
  jira: createJiraAuthRoutes,
  local: null,
})

/**
 * Build the auth router for a registered provider.
 * @param {{ name: string }} provider - The registry instance (injected into the factory as `provider`).
 * @param {Object} deps - The dependency object, spread through to the factory unchanged.
 * @returns {import('express').Router | null} null when the provider has no login flow.
 * @throws {Error} when the provider has no row in the table — a provider that
 *   forgot its wiring must fail at boot, not ship with no login.
 */
export function createProviderAuthRouter(provider, deps) {
  if (!Object.hasOwn(AUTH_ROUTER_FACTORIES, provider.name)) {
    throw new Error(`No auth-router wiring for provider "${provider.name}" — add it to routes/provider-auth-routers.js`)
  }
  const factory = AUTH_ROUTER_FACTORIES[provider.name]
  return factory ? factory({ ...deps, provider }) : null
}
