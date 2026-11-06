#!/usr/bin/env node
// census-by-merge.mjs — LIN-4315. Git-only step, run once after freeze.mjs on the same folder.
// For every LinearViewer first-parent merge in the window, reads tests/unit/fake-dom-census.test.js
// at that merge and records the HAND_WRITTEN_FAKE_DOM_FILES entries (movable vs `// stop:`).
// Writes <out-dir>/git/census-by-merge.json and adds it to manifest.json's file list.
// Usage: node docs/papers/harbour/cleaner-than-it-started-scripts/census-by-merge.mjs <out-dir>

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..', '..');
const outDir = process.argv[2];
if (!outDir) { console.error('usage: census-by-merge.mjs <out-dir>'); process.exit(2); }
const CENSUS = 'tests/unit/fake-dom-census.test.js';
const WINDOW_START = '2026-11-04T00:00:00Z';
const LV_PIN = '1d10f9b3';

const git = (args) => execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
const shas = git(['log', '--first-parent', LV_PIN, `--since=${WINDOW_START}`, '--format=%H|%cI|%s'])
  .split('\n').filter(Boolean).map((l) => { const [sha, committed, ...s] = l.split('|'); return { sha, committed, subject: s.join('|') }; })
  .reverse(); // oldest first

// Read the array body between `const HAND_WRITTEN_FAKE_DOM_FILES = [` and the closing `];`.
function parseCensus(src) {
  const m = src.match(/const HAND_WRITTEN_FAKE_DOM_FILES = \[([\s\S]*?)\n\];/);
  if (!m) return null;
  const entries = [];
  for (const line of m[1].split('\n')) {
    const e = line.match(/^\s*'([^']+)',?\s*(\/\/\s*(.*))?$/);
    if (e) entries.push({ path: e[1], stop: !!(e[3] && /^stop:/.test(e[3])), comment: e[3] ?? null });
  }
  return entries;
}

const rows = [];
for (const { sha, committed, subject } of shas) {
  let src = null;
  try { src = git(['show', `${sha}:${CENSUS}`]); } catch { src = null; } // absent before LIN-4265 (69e8f175)
  const entries = src === null ? null : parseCensus(src);
  rows.push({
    sha, short: sha.slice(0, 9), committed, subject,
    census_file_present: src !== null,
    census_array_found: entries !== null,
    entries: entries ?? [],
    count: entries ? entries.length : null,
    stop_count: entries ? entries.filter((e) => e.stop).length : null,
    movable_count: entries ? entries.filter((e) => !e.stop).length : null,
  });
}
const body = JSON.stringify({ census_path: CENSUS, source: 'git show <merge>:<census_path> at each LinearViewer first-parent merge', merges: rows }, null, 2) + '\n';
writeFileSync(path.join(outDir, 'git', 'census-by-merge.json'), body);

const manifestPath = path.join(outDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.files = (manifest.files || []).filter((f) => f.path !== 'git/census-by-merge.json');
manifest.files.push({ path: 'git/census-by-merge.json', bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex'), read_at: new Date().toISOString(), http_status: 'git' });
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.error(`census recorded at ${rows.length} merges`);
