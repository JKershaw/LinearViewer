/**
 * Change size per ticket, from the repository's history (LIN-3932). One git log pass, read
 * as `git log --grep <id> --shortstat` would read it: a commit counts for every LIN-nnnn its
 * message names, and its insertions plus deletions are that ticket's size.
 *
 * Bands are those of how-a-task-is-composed.md: small 2–197 lines, mid 201–602, large 613 and
 * up. The gaps (198–200, 603–612) go to the lower band here.
 *
 * Usage: node sizebands.mjs <out-json>
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..', '..');
const [outPath] = process.argv.slice(2);
if (!outPath) {
  console.error('usage: node sizebands.mjs <out-json>');
  process.exit(2);
}

const log = execFileSync('git', ['log', '--format=%x1e%H%x1f%s%x1f%b', '--shortstat'], { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const sizes = {};
for (const entry of log.split('\x1e').slice(1)) {
  const [head, ...rest] = entry.split('\x1f');
  const body = rest.join('\x1f');
  const ids = new Set([...body.matchAll(/\bLIN-(\d+)\b/g)].map(m => `LIN-${m[1]}`));
  if (!ids.size) continue;
  const ins = Number((body.match(/(\d+) insertion/) || [])[1] || 0);
  const del = Number((body.match(/(\d+) deletion/) || [])[1] || 0);
  const lines = ins + del;
  for (const id of ids) {
    sizes[id] ??= { lines: 0, commits: 0 };
    sizes[id].lines += lines;
    sizes[id].commits += 1;
  }
}
const band = (lines) => (lines === 0 ? 'none' : lines <= 200 ? 'small' : lines <= 612 ? 'mid' : 'large');
for (const id of Object.keys(sizes)) sizes[id].band = band(sizes[id].lines);
writeFileSync(outPath, JSON.stringify({ rule: 'git log --grep LIN-n --shortstat, all refs', tickets: Object.keys(sizes).length, sizes }, null, 1) + '\n');
console.log(JSON.stringify({ tickets: Object.keys(sizes).length }));
