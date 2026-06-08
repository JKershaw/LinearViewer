/**
 * Stub provider fixture (LIN-332, S0 of LIN-177 Phase 3).
 *
 * Builds a minimal provider whose `ui` surface has arbitrary, independently
 * settable flags — so the capability-aware render (S3), prompt-formatters (S4),
 * and prompt-template (S5) tests can exercise every flag permutation WITHOUT
 * mutating the real `LinearProvider` singleton.
 *
 * Imports ONLY the base `ProviderInterface` — deliberately no Linear coupling.
 * `displayName` defaults to `name` (mirroring the base getter's fallback) so a
 * read is always a string, never undefined.
 */
import { ProviderInterface } from '../../lib/providers/interface.js'

export function makeStubProvider({
  name = 'stub', write = false, comments = false,
  estimates = false, subtasks = false, displayName,
} = {}) {
  const ui = { write, comments, estimates, subtasks, displayName: displayName ?? name }
  const stub = new ProviderInterface()
  stub.name = name
  // `ui` is a getter-only accessor on ProviderInterface.prototype, so a plain
  // assignment (or Object.assign) throws — install our own getter to override it.
  Object.defineProperty(stub, 'ui', { get() { return ui }, configurable: true })
  return stub
}
