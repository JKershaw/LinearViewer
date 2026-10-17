#!/usr/bin/env node
// Pin one commit of <repo> into <dir> for the replay: git archive + node_modules link + .pinned-sha.
//   node pin-side.mjs <repo> <sha> <dir>
// An existing <dir> is reused only when its .pinned-sha is the same commit; a folder recorded
// under a different SHA is refused, never overwritten (the replay-kit pin.mjs bug).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const [repo, sha, dir] = process.argv.slice(2);
if (!repo || !sha || !dir) { console.error('usage: pin-side.mjs <repo> <sha> <dir>'); process.exit(2); }
const full = execFileSync('git', ['-C', repo, 'rev-parse', `${sha}^{commit}`]).toString().trim();
if (existsSync(dir)) {
  const rec = existsSync(join(dir, '.pinned-sha')) ? readFileSync(join(dir, '.pinned-sha'), 'utf8').trim() : null;
  if (rec === full) { console.log(`reuse ${dir} @ ${full}`); process.exit(0); }
  if (rec || readdirSync(dir).length) { console.error(`refusing: ${dir} holds ${rec || 'unrecorded content'}, not ${full}; pin into a fresh folder`); process.exit(2); }
}
mkdirSync(dir, { recursive: true });
execFileSync('sh', ['-c', `git -C "${repo}" archive "${full}" | tar -x -C "${dir}"`]);
symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'));
writeFileSync(join(dir, '.pinned-sha'), full + '\n');
console.log(`pinned ${full} -> ${dir}`);
