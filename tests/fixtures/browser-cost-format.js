/**
 * tests/fixtures/browser-cost-format.js: the shared USD formatter (lib/cost-format.js, LIN-4179; served to the browser
 * as /lib/cost-format.js, LIN-4446, LIN-4471) given to a vm sandbox, as the module shim gives it to the page. A browser test
 * that evaluates a page script which formats a cost calls `loadCostFormat(sandbox)` after `vm.createContext(sandbox)`,
 * so `window.CostFormat` exists. The function is the server's own, so plain strings cross the vm boundary safely.
 */
import { formatUsd } from '../../lib/cost-format.js';

/** Sets `window.CostFormat` on the sandbox's window, as public/cost-format-global.js does in the browser. */
export function loadCostFormat(sandbox) {
  sandbox.window.CostFormat = { formatUsd };
}
