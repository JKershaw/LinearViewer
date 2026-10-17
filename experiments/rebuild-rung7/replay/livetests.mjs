#!/usr/bin/env node
// Live unit-test tier: run the origin/main unit tests that reach
// routes/workspace-api.js (import, mount via server.js, or source-text read of
// routes/) once per side on an overlay of the snapshot, and compare per-test
// verdicts. See README.md.
//   node livetests.mjs --new <dirOrFile> [--old pinned/origin-main] [--all] [--jobs 6] [--out reports/livetests.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLiveTests } from '../../replay-kit/lib/router/livetests.mjs';

const TOOL = path.dirname(fileURLToPath(import.meta.url));
const SNAP = path.join(TOOL, '../../replay-kit/snapshots/16e7ae77');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : d; };
const oldSpec = arg('--old', path.join(TOOL, 'pinned', 'origin-main'));
const newSpec = arg('--new', null);
if (!newSpec) { console.error('usage: node livetests.mjs --new <dirOrFile> [--old dir] [--all] [--jobs 6] [--out f]'); process.exit(2); }
const out = path.resolve(arg('--out', path.join(TOOL, 'work', 'livetests.json')));

function srcFiles(spec) {
  const p = path.resolve(spec);
  const files = {};
  if (fs.statSync(p).isDirectory()) {
    const walk = (d, rel) => { for (const e of fs.readdirSync(d)) { const a = path.join(d, e); if (fs.statSync(a).isDirectory()) walk(a, path.join(rel, e)); else if (/\.m?js$/.test(e)) files[path.join('routes', rel, e)] = a; } };
    walk(p, '');
  } else files['routes/workspace-api.js'] = p;
  if (!files['routes/workspace-api.js']) { const m = Object.keys(files).find(k => /workspace-api\.mjs$/.test(k)); if (m) files['routes/workspace-api.js'] = files[m]; }
  if (!files['routes/workspace-api.js']) throw new Error(`${spec}: no workspace-api.js`);
  return files;
}

const all = fs.readdirSync(path.join(SNAP, 'tests/unit')).filter(f => f.endsWith('.test.js')).map(f => `tests/unit/${f}`);
const RE = /workspace-api|createWorkspaceApiRoutes|server\.js|readdirSync\([^)]*routes|'routes'\)|join\([^)]*'routes'/;
const testFiles = argv.includes('--all') ? all : all.filter(f => RE.test(fs.readFileSync(path.join(SNAP, f), 'utf8')));
const t0 = Date.now();
const r = await runLiveTests({ snapshotDir: SNAP, sides: [{ label: 'old', srcFiles: srcFiles(oldSpec) }, { label: 'new', srcFiles: srcFiles(newSpec) }], testFiles, jobs: Number(arg('--jobs', 6)), workDir: path.join(TOOL, 'work') });
r.elapsedMs = Date.now() - t0;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(r, null, 2));
console.log(`\nlive tests: ${r.files} files, ${r.tests} tests (failing on old: ${r.failingOnOld}); files whose verdicts differ: ${r.differingFiles} (${Math.round(r.elapsedMs / 1000)} s)`);
for (const d of r.diffs) { console.log(`  ${d.file}  exit ${d.exit.old}→${d.exit.new}`); for (const t of d.tests.slice(0, 6)) console.log(`     ${t.test}: ${t.old} → ${t.new}`); }
console.log(`report: ${out}`);
process.exit(r.differingFiles ? 1 : 0);
