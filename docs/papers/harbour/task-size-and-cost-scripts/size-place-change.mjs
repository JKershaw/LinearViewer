#!/usr/bin/env node
// size-place-change.mjs — LIN-4257. Bound size, the area-map sub-sense: runs the existing
// experiments/place-change/place-change.mjs on every LinearViewer merge whose day is on or
// after the window start, base = first parent, head = merge. Prints one JSON row per PR.
// Read-only. Reports, never gates (the tool's own contract).
//
// Usage (LinearViewer root): node docs/papers/harbour/task-size-and-cost-scripts/size-place-change.mjs <lv-prs.json>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');
const TOOL = path.join(REPO, 'experiments', 'place-change', 'place-change.mjs');
const GUIDE = path.join(REPO, 'scripts', 'code-shape', 'areas.json');
const WINDOW_DAY = '2026-11-04';

const prs = JSON.parse(readFileSync(process.argv[2], 'utf8')).filter((r) => r.day >= WINDOW_DAY);
const git = (args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).trim();
const out = [];
for (const r of prs) {
  const head = git(['rev-parse', `${r.sha}`]);
  let base;
  try { base = git(['rev-parse', `${head}^1`]); } catch { base = null; }
  if (!base) { out.push({ pr: r.pr, ticket: r.ticket, day: r.day, error: 'no first parent' }); continue; }
  try {
    const res = execFileSync('node', [TOOL, REPO, base, head, GUIDE], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
    out.push({ pr: r.pr, ticket: r.ticket, day: r.day, base: base.slice(0, 8), head: head.slice(0, 8), change: JSON.parse(res) });
  } catch (err) {
    out.push({ pr: r.pr, ticket: r.ticket, day: r.day, error: String(err.message).split('\n')[0] });
  }
}
console.log(JSON.stringify(out));
