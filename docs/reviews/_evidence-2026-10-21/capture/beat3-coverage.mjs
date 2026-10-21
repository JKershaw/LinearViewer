/**
 * LIN-3750 beat 3 — coverage assertion for the authenticated registry members.
 *
 * Reads registry.json + manifest.json, asserts every authenticated registry id (the app / provider
 * `ws-*` pages) has at least one fully-captured state (every theme x viewport cell ok, theme
 * assertion passed) OR a named limit below, and that every manifest entry maps to a registry id.
 * Writes the result into manifest.json under `beat3` and exits 1 on any unlisted id.
 *
 *   node beat3-coverage.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EVID, REGISTRY } from './beat3-lib.mjs';

const MANIFEST = path.join(EVID, 'manifest.json');
const m = JSON.parse(await readFile(MANIFEST, 'utf8'));
const entries = Object.values(m.entries);

const authIds = REGISTRY.entries.filter(e => e.id.startsWith('ws-')).map(e => e.id);
const authExtra = ['renderer:renderTaskNotFoundPage', 'renderer:renderMergeConfirmPage'];

// Named limits: what a capture of the id does NOT show, and why (carried to the report).
const NAMED_LIMITS = {
  'ws-effort-readout': 'empty state only — no seed seam (beat-1 grep of routes/test.js, registry.json seams)',
  'ws-task-chat': 'default state only — no seed seam beyond /test/clear-saved-chats (:1200); no conversation rendered',
  'ws-observation': 'Scan-due tab captured in its empty state only — no seed seam for a due scan; Autopilot/Sessions tabs populated via dispatch sessions',
  'ws-flight-companion': 'populated via set-flight-companion-playbook; a live chat turn is not driven',
  'ws-ship-biscuit': 'populated by one deterministic edition (POST .../api/ship-biscuit/generate); an AI-written article body is not driven',
  'ws-settings': 'model-picker <select> captured focused; the native popup list is not rendered in headless captures (option sets and computed styles are in the JSON)',
  'ws-task-edit': 'the default Linear-mock seed 500s (the mock cannot read the task: harness property, census measured:error-500); captured populated through the local-provider seam instead',
  'ws-task-page': 'the default Linear-mock seed 503s (the mock cannot read the tracker); the 200 task-body states are captured through the local-provider seam (/test/set-local-session). No state is captured under the Linear mock.',
};

const okCells = (id) => {
  const byState = {};
  for (const e of entries) if (e.registryId === id && !e.kind) (byState[e.state] ||= []).push(e);
  return Object.entries(byState).map(([state, cells]) => ({ state, cells: cells.length, allOk: cells.every(c => c.ok && (c.themeAssertion?.passed !== false)), populated: cells[0].populated ?? null, statuses: [...new Set(cells.map(c => c.httpStatus))] }));
};

const report = { generatedFor: 'LIN-3750', registryIdsChecked: 0, captured: {}, namedLimits: {}, unlisted: [], failedCells: [], orphanManifestEntries: [] };
for (const id of [...authIds, ...authExtra]) {
  report.registryIdsChecked++;
  const states = okCells(id);
  const focus = entries.filter(e => e.registryId === id && e.kind === 'focus-walk');
  const good = states.filter(s => s.allOk);
  if (good.length || (focus.length && authExtra.includes(id))) {
    report.captured[id] = { states: good.map(s => `${s.state}${s.populated === true ? ' (populated)' : s.populated === false ? ' (empty)' : ''} [${s.statuses.join('/')}]`), focusWalks: focus.length };
  }
  if (NAMED_LIMITS[id]) report.namedLimits[id] = NAMED_LIMITS[id];
  if (!good.length && !(focus.length && authExtra.includes(id))) report.unlisted.push(id);
  for (const s of states.filter(s => !s.allOk)) report.failedCells.push(`${id}|${s.state}`);
}
const ids = new Set(REGISTRY.entries.map(e => e.id));
for (const e of entries) if (!ids.has(e.registryId)) report.orphanManifestEntries.push(e.key);
report.lighthouse = entries.filter(e => e.kind === 'lighthouse').map(e => ({ id: e.registryId, state: e.state, ok: e.ok, scores: e.scores, failing: (e.failingAudits || []).map(a => a.id) }));
report.focusWalks = entries.filter(e => e.kind === 'focus-walk').map(e => ({ id: e.registryId, state: e.state, ok: e.ok }));
report.passed = report.unlisted.length === 0 && report.failedCells.length === 0 && report.orphanManifestEntries.length === 0;
m.beat3 = report;
await writeFile(MANIFEST, JSON.stringify(m, null, 2));
console.log(JSON.stringify({ ...report, captured: Object.keys(report.captured).length, namedLimits: Object.keys(report.namedLimits) }, null, 1));
process.exit(report.passed ? 0 : 1);
