/**
 * tests/fixtures/browser-cost-format.js: the shared browser USD formatter (public/cost-format.js, LIN-4179) loaded into
 * a vm sandbox, as the page loads it before its own scripts. A browser test that evaluates a page script which formats
 * a cost calls `loadCostFormat(sandbox)` after `vm.createContext(sandbox)`, so `window.CostFormat` exists.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const COST_FORMAT_SRC = readFileSync(new URL('../../public/cost-format.js', import.meta.url), 'utf8');

/** Runs the shared formatter into the sandbox (it sets `window.CostFormat` on the sandbox's window). */
export function loadCostFormat(sandbox) {
  vm.runInContext(COST_FORMAT_SRC, sandbox, { filename: 'cost-format.js' });
}
