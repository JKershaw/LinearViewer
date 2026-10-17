#!/usr/bin/env node
// Pin one commit of a repo into a FRESH folder as a full replay side.
//   node pin-side.mjs <repo> <sha|ref> <outDir>
// - git archive of <sha> (routes/, lib/, server.js, tests/, docs/, scripts/, content/, public/, package.json)
// - node_modules symlinked from <repo> (or /home/user/LinearViewer)
// - writes <outDir>/.replay-sha
// Refuses (exit 2) when <outDir> exists and is not empty: a folder recorded under
// another SHA is never overwritten (the replay-kit pin.mjs bug), and a folder under
// the same SHA is reused only when its .replay-sha matches exactly.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';

const [repoArg, refArg, outArg] = process.argv.slice(2);
if (!repoArg || !refArg || !outArg) { process.stderr.write('usage: node pin-side.mjs <repo> <sha|ref> <outDir>\n'); process.exit(2); }
const repo = path.resolve(repoArg);
const out = path.resolve(outArg);
const sha = execFileSync('git', ['-C', repo, 'rev-parse', `${refArg}^{commit}`], { encoding: 'utf8' }).trim();
if (existsSync(out) && readdirSync(out).length) {
  let have = null;
  try { have = readFileSync(path.join(out, '.replay-sha'), 'utf8').trim(); } catch { /* none */ }
  if (have === sha) { process.stdout.write(`${out} already holds ${sha}; reused\n`); process.exit(0); }
  process.stderr.write(`refusing: ${out} is not empty and holds ${have ?? 'an unknown tree'}, not ${sha}. Pin into a fresh folder.\n`);
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const paths = ['routes', 'lib', 'server.js', 'tests', 'docs', 'scripts', 'content', 'public', 'package.json']
  .filter(p => { try { execFileSync('git', ['-C', repo, 'cat-file', '-e', `${sha}:${p}`], { stdio: 'ignore' }); return true; } catch { return false; } });
const tar = execFileSync('git', ['-C', repo, 'archive', '--format=tar', sha, ...paths], { maxBuffer: 1 << 30 });
execFileSync('tar', ['-x', '-C', out], { input: tar });
const nm = [path.join(repo, 'node_modules'), '/home/user/LinearViewer/node_modules'].find(existsSync);
if (nm) symlinkSync(nm, path.join(out, 'node_modules'), 'dir');
writeFileSync(path.join(out, '.replay-sha'), `${sha}\n`);
process.stdout.write(`pinned ${sha} into ${out}${nm ? ` (node_modules -> ${nm})` : ''}\n`);
