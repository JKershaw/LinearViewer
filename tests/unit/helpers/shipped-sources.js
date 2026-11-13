// The shipped JavaScript the source censuses scan: lib/, routes/, server.js and the stability script that
// reads the blind-read ledger. One list for LIN-4458's comment-kind census
// (tests/unit/lin-4458-comment-kind-census.test.js) and LIN-4466's blind-read words scan
// (tests/unit/stage-kind-tables.test.js), so the two scans cannot drift apart. Tracked files only, as
// git sees them, that still exist in the working copy.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const SHIPPED_SOURCE_ROOTS = Object.freeze(['lib', 'routes', 'server.js', 'scripts/stability-measures-blind.mjs']);

/** Repo-relative paths of the tracked .js/.mjs files under SHIPPED_SOURCE_ROOTS. */
export function shippedSourceFiles() {
  const tracked = execFileSync('git', ['ls-files', ...SHIPPED_SOURCE_ROOTS], { cwd: REPO, encoding: 'utf8' }).split('\n');
  return [...new Set(tracked)].filter(f => /\.m?js$/.test(f) && existsSync(join(REPO, f)));
}
