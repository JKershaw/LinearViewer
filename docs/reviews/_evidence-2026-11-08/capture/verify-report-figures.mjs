/**
 * LIN-3752 (beat 5): spot-check report figures against the evidence JSON.
 * Usage (repo root):  node docs/reviews/_evidence-2026-10-21/capture/verify-report-figures.mjs
 * Writes remeasure/report-figure-check.json and exits 1 on any mismatch. Docs-only tooling.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const j = p => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const census = j('census.json');
const sweep = j('data/library-sweep.json');
const f4 = j('remeasure/f4.json');
const f6 = j('remeasure/f6.json');
const clip = j('remeasure/library-table-clip.json');

const groupsOf = (id, theme) => census.entries[id]?.themes?.[theme]?.groups ?? [];
const allGroups = (theme, el) => Object.values(census.entries).flatMap(e => e.themes?.[theme]?.groups ?? []).filter(g => g.element === el);
const idsWith = (theme, el) => Object.values(census.entries).filter(e => (e.themes?.[theme]?.groups ?? []).some(g => g.element === el)).length;
const minOf = arr => Math.min(...arr.map(g => g.ratio));
const lightSweep = sweep.sweep.filter(r => r.scheme === 'light');
const tableRight = r => Math.max(0, ...r.spill.filter(s => s.startsWith('table.')).map(s => +s.match(/@(\d+)/)[1]));
const lh = n => j(`lighthouse/${n}.json`).scores.accessibility;
const countPngs = dir => readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? countPngs(new URL(e.name + '/', dir)) : /\.png$/.test(e.name) ? 1 : 0), 0);

const checks = [
  ['census registry ids', 249, census.coverage.registryIds],
  ['census measured ids', 201, census.coverage.measured + census.coverage.measuredUnexpectedOutcome.length],
  ['census excluded ids', 48, census.coverage.excluded],
  ['library documents swept', 104, sweep.documents],
  ['library documents overflowing at 390', 74, new Set(lightSweep.filter(r => r.overflows).map(r => r.slug)).size],
  ['library documents with a table past the viewport', 70, lightSweep.filter(r => tableRight(r) > 390).length],
  ['library widest table right edge (which-rules-pay)', 1086, tableRight(lightSweep.find(r => r.slug === '/library/which-rules-pay'))],
  ['library witness: widest table at 320', 1086, clip.rows.find(r => r.slug === '/library/which-rules-pay' && r.width === 320).tableRight],
  ['library witness: scrollX after scrollTo(9999)', 0, clip.rows.find(r => r.slug === '/library/which-rules-pay' && r.width === 390).scrolledX],
  ['library documents rendering two h1', 104, lightSweep.filter(r => r.h1 === 2).length],
  ['dark button.action-btn lowest ratio', 1.35, minOf(allGroups('dark', 'button.action-btn'))],
  ['white-on-teal a.login-button lowest ratio (light)', 3.74, minOf(allGroups('light', 'a.login-button'))],
  ['ids carrying span.wordmark-accent (light)', 33, idsWith('light', 'span.wordmark-accent')],
  ['landing Linear door ratio', 4.43, minOf(groupsOf('landing', 'light').filter(g => g.element === 'a.landing-cta.landing-cta-linear'))],
  ['archive p.sig light', 2.94, minOf(f6.rows.filter(r => r.element === 'p.sig' && r.theme === 'light'))],
  ['archive p.foot dark', 3.87, minOf(f6.rows.filter(r => r.element === 'p.foot' && r.theme === 'dark'))],
  ['UA-blue link on dark (jira form)', 1.89, f4.pages['jira-link-form'].dark.links[0].ratio],
  ['guest-share 404 Lighthouse accessibility', 0.89, lh('guest-share')],
  ['email-signin Lighthouse accessibility', 0.9, lh('email-signin')],
  ['kpis-public Lighthouse accessibility', 1, lh('kpis-public')],
  ['kept PNG count (after the merge trim)', 51, countPngs(root)],
  ['visual-pass.md PNG lines', 690, readFileSync(new URL('visual-pass.md', root), 'utf8').split('\n').filter(l => /^- `.*\.png`/.test(l)).length],
].map(([name, expected, actual]) => ({ name, expected, actual, ok: expected === actual }));

writeFileSync(new URL('remeasure/report-figure-check.json', root), JSON.stringify({ checks, passed: checks.every(c => c.ok) }, null, 2));
for (const c of checks) console.log(c.ok ? 'ok  ' : 'FAIL', c.name, '| expected', c.expected, '| actual', c.actual);
process.exit(checks.every(c => c.ok) ? 0 : 1);
