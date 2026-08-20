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
