/**
 * The workspace-API unit (LIN-3861): the files that together are "the workspace
 * API routes", judged as one set by the censuses that used to pin
 * `routes/workspace-api.js` alone (the gate count, the credential and egress
 * census, the mint census, the feedback owner gate, the model clamp wiring).
 *
 * This is a PLACEMENT CONVENTION, said out loud for the LIN-2246 moves out of
 * `createWorkspaceApiRoutes`: its route groups live in `routes/` as
 * `routes/workspace-api.js` or `routes/workspace-api-<name>.js`. The unit is flat
 * on purpose. Whole-tree scanners such as run-limit-gating.test.js read `routes/`
 * with a non-recursive `readdirSync`, so a `routes/workspace-api/` directory would
 * be a blind spot for them; keeping the unit flat leaves those scanners untouched.
 * A move that wants a subdirectory re-anchors THIS helper and
 * run-limit-gating.test.js in the commit that creates it (workspace-api-unit.test.js
 * fails until it does).
 *
 * `lib/` is not in the unit. Pure helpers moved to `lib/` are already seen by the
 * whole-tree scanners; a credential, gate or store site moved to `lib/` fails the
 * unit rules (an exact count), and the move re-anchors them in the same commit.
 *
 * A plain (non-`.test.js`) module on purpose: importing a `.test.js` file would
 * register its tests a second time.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const UNIT_FILE = /^routes\/workspace-api(?:-[^/]+)?\.js$/;

/**
 * Whether the repo-relative path (forward slashes) is in the workspace-API unit.
 * @param {string} rel
 * @returns {boolean}
 */
export function isWorkspaceApiUnitFile(rel) {
  return UNIT_FILE.test(rel);
}

/**
 * The workspace-API unit's files under `root`, repo-relative and sorted.
 * @param {string} root the repository root
 * @returns {string[]}
 */
export function workspaceApiUnitFiles(root) {
  return readdirSync(join(root, 'routes'), { withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => `routes/${e.name}`)
    .filter(isWorkspaceApiUnitFile)
    .sort();
}
