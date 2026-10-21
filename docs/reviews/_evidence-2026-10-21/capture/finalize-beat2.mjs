/**
 * LIN-3749: stamp registry ids on the beat-2 manifest rows and list cold registry members with no row.
 * Docs-only. Run from the repo root: node docs/reviews/_evidence-2026-10-21/capture/finalize-beat2.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const man = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
const reg = JSON.parse(await readFile(path.join(dir, '..', 'registry.json'), 'utf8'));
const ids = new Set(reg.entries.map(e => e.id));
const MAP = {
  'swipe-public': 'swipe-public', 'swim-public': 'swim-public', 'ship-public': 'ship-public', landing: 'landing', templates: 'templates', styleguide: 'styleguide', privacy: 'privacy', terms: 'terms',
  'archive-404': 'archive-999',
  'err-merge-confirm': 'renderer:renderMergeConfirmPage', 'err-merge-reauth': 'renderer:renderMergeReauthRequiredPage', 'err-generic': 'renderer:renderErrorPage',
  'err-workspace-notfound': 'renderer:renderWorkspaceNotFoundPage', 'err-upstream-auth': 'renderer:renderUpstreamAwareErrorPage', 'err-upstream-5xx': 'renderer:renderUpstreamAwareErrorPage',
  'err-upstream-429': 'renderer:renderUpstreamAwareErrorPage', 'err-upstream-net': 'renderer:renderUpstreamAwareErrorPage', 'err-upstream-internal': 'renderer:renderUpstreamAwareErrorPage',
  'gh-repo-picker': 'renderer:renderGitHubRepoSelectPage', 'gh-projects-picker': 'renderer:renderGitHubProjectSelectPage', 'jira-site-picker': 'renderer:renderJiraSiteSelectPage',
  'jira-link-form': 'auth-jira-form', 'openrouter-consent': 'renderer:renderOpenRouterConsentPage', 'library-404': 'state-library-404',
  'library-paper-figures': 'library-paper', 'library-paper-svg': 'library-paper', 'library-doc-listed': 'library-doc'
};
let stamped = 0; const unknown = [];
for (const row of Object.values(man)) {
  let id = row.registryId || MAP[row.surface] || (/^archive-\d$/.test(row.surface) ? row.surface : null);
  if (!id) continue;
  if (!ids.has(id)) { unknown.push([row.surface, id]); continue; }
  if (row.registryId !== id) { row.registryId = id; stamped += 1; }
}
await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(man, null, 2));
const cold = reg.entries.filter(e => (e.seed === 'none' && e.kind === 'page') || /^(archive-|state-|legacy-)/.test(e.id) || e.id === 'library-doc:*' || /^renderer:/.test(e.id) && e.kind === 'page');
const covered = new Set(Object.values(man).filter(r => r.ok && r.registryId).map(r => r.registryId));
const missing = cold.filter(e => !covered.has(e.id)).map(e => e.id);
console.log(JSON.stringify({ manifestRows: Object.keys(man).length, withRegistryId: Object.values(man).filter(r => r.registryId).length, stamped, unknown, coldMembers: cold.length, coveredCold: cold.length - missing.length, missing, rowsWithoutId: Object.values(man).filter(r => !r.registryId).map(r => r.surface).filter((v, i, a) => a.indexOf(v) === i) }, null, 1));
