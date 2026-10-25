// Usage: node transcript-cost.mjs <logmap.json> <out.json> <simple-dispatcher-dir> <linearviewer-dir> <workspaces-dir>
//
// Recomputes each launched session's cumulative usage from its on-disk Claude Code
// transcript, with simple-dispatcher's own walkUsage, and prices it with Harbour's
// computeUsageCostUsd. Transcripts are read from ~/.claude/projects, where Claude Code
// stores a session under its working directory with every "/" turned into "-".
// Stage 1 of the paper's method (needs the runner host). Writes only the output file.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const [, , mapPath, outPath, sdDir, lvDir, workspacesDir] = process.argv;
const require = createRequire(import.meta.url);
const { walkUsage } = require(path.join(sdDir, 'transcript.js'));
const { computeUsageCostUsd } = await import(path.join(lvDir, 'lib', 'model-pricing.js'));

const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const projects = path.join(os.homedir(), '.claude', 'projects');
const out = {};
for (const [item, rec] of Object.entries(map)) {
  if (!rec.session) continue;
  const cwd = path.join(workspacesDir, rec.session);
  const dir = path.join(projects, cwd.replace(/\//g, '-'));
  const main = path.join(dir, rec.session + '.jsonl');
  if (!fs.existsSync(main)) {
    out[item] = { session: rec.session, missing: true };
    continue;
  }
  const lines = fs.readFileSync(main, 'utf8').split('\n');
  const usage = walkUsage(lines);
  // Subagent turns live in their own files, not in the main transcript.
  const subDir = path.join(dir, rec.session, 'subagents');
  let subUsage = null;
  let subFiles = 0;
  if (fs.existsSync(subDir)) {
    const subLines = [];
    for (const f of fs.readdirSync(subDir)) {
      if (!f.endsWith('.jsonl')) continue;
      subFiles += 1;
      subLines.push(...fs.readFileSync(path.join(subDir, f), 'utf8').split('\n'));
    }
    subUsage = walkUsage(subLines);
  }
  // Count lines flagged as sidechains (subagent turns) in the main file. Zero means the
  // main file holds no subagent turns, so walkUsage's sidechain note cannot apply to it.
  const sidechainLines = lines.filter((l) => l.includes('"isSidechain":true')).length;
  out[item] = {
    session: rec.session,
    usage,
    cost: usage ? computeUsageCostUsd({ ...usage, harness: 'claude-code' }) : null,
    subUsage,
    subCost: subUsage ? computeUsageCostUsd({ ...subUsage, harness: 'claude-code' }) : null,
    subFiles,
    sidechainLines,
  };
}
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(Object.keys(out).length);
