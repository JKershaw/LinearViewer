/**
 * The dashboard unit (LIN-3840): the files that together are "the dashboard
 * routes", judged as one set by the censuses that used to pin `routes/dashboard.js`
 * alone (the credential census, the free-tier gate count, the model clamp wiring,
 * the dispatch-store reader kinds).
 *
 * This is a PLACEMENT CONVENTION, said out loud for the rebuild of
 * `createDashboardRoutes` (LIN-3742): its route modules live in `routes/` as
 * `routes/dashboard.js` or `routes/dashboard-<name>.js`. The unit is flat on purpose.
 * Whole-tree scanners such as run-limit-gating.test.js read `routes/` with a
 * non-recursive `readdirSync`, so a `routes/dashboard/` directory would be a blind
 * spot for them; keeping the unit flat leaves those scanners untouched. A rebuild
 * that wants a subdirectory re-anchors THIS helper and run-limit-gating.test.js in
 * the commit that creates it (dashboard-unit.test.js fails until it does).
 *
 * `lib/` is not in the unit. Pure helpers moved to `lib/` are already seen by the
 * whole-tree scanners; a store read or credential site moved to `lib/` fails the
 * unit rules (an exact count, a "must occur" kind), and the rebuild re-anchors
 * them in the same commit.
 *
 * A plain (non-`.test.js`) module on purpose: importing a `.test.js` file would
 * register its tests a second time.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const UNIT_FILE = /^routes\/dashboard(?:-[^/]+)?\.js$/;

/**
 * Whether the repo-relative path (forward slashes) is in the dashboard unit.
 * @param {string} rel
 * @returns {boolean}
 */
export function isDashboardUnitFile(rel) {
  return UNIT_FILE.test(rel);
}

/**
 * The dashboard unit's files under `root`, repo-relative and sorted.
 * @param {string} root the repository root
 * @returns {string[]}
 */
export function dashboardUnitFiles(root) {
  return readdirSync(join(root, 'routes'), { withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => `routes/${e.name}`)
    .filter(isDashboardUnitFile)
    .sort();
}
