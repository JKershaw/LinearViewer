// =============================================================================
// Provider Barrel (LIN-2010) — registration + the readers this ticket migrates
// =============================================================================
//
// Owns the five self-registering provider imports, moved here from
// server.js:68-72. Scoped honestly (plan-review F6): this barrel is the sole
// owner of *registration* and of the render-surface reads LIN-2010 migrates —
// it is NOT claimed as the only path to the registry. 15 pre-existing modules
// import lib/providers/registry.js directly (lib/render.js, lib/workspace.js,
// routes/auth.js, etc.) and stay that way; none of them are a display/identity
// surface this ticket owns.
//
// Import order is `linear, github, github-projects, jira, local` — load-bearing
// (LIN-2010 plan, Design decision 1 / step 5): lib/render-settings.js's add-row
// loop iterates `getAllProviders().filter(p => p.addProvider)`, and this order
// makes that iteration byte-identical to today's hand-maintained
// `KNOWN_ADD_PROVIDERS` literal order — NOT server.js's current incidental
// `linear, local, github, github-projects, jira` sequence. Do not reorder
// without re-checking that dependency.
//
// Ordering caveat (LIN-2010 review ledger item 6): barrel order determines
// registration order only because this barrel is the FIRST thing in the entry
// graph to reach each provider module. Production order is set by the ENTRY
// import graph as a whole, not by this file alone — an import added ABOVE
// server.js:66 that transitively pulls any `<provider>/index.js` would register
// that provider first and reorder Settings' add rows, while
// tests/unit/lin-2010-provider-identity-registry.test.js still passes (it
// imports lib/render-settings.js directly, so its graph is always barrel-first).
// Nothing above server.js:66 reaches a provider today; re-check that when
// adding an import there, not just when editing the list below.
import './linear/index.js'
import './github/index.js'
import './github-projects/index.js'
import './jira/index.js'
import { localProvider } from './local/index.js'

export {
  getAllProviders,
  getProvider,
  registerProvider,
  getProviderForWorkspace,
} from './registry.js'

export { localProvider }
