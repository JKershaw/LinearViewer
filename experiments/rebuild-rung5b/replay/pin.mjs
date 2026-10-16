#!/usr/bin/env node
// Pin the four renderer modules from a commit into pinned/<name>/ with relative
// imports rewritten to absolute file:// URLs into /home/user/LinearViewer/lib
// (line-stable).  node pin.mjs [commit=f4749b91] [name=origin-main]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pinRewrite, TARGETS, REPO, DEFAULT_LIB } from './lib/load.mjs';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const commit = process.argv[2] || 'f4749b91';
const name = process.argv[3] || 'origin-main';
const dir = path.join(HERE, 'pinned', name);
fs.mkdirSync(dir, { recursive: true });
const manifest = { commit: execFileSync('git', ['-C', REPO, 'rev-parse', commit], { encoding: 'utf8' }).trim(), lib: DEFAULT_LIB, files: {} };
for (const f of Object.values(TARGETS)) {
  const src = execFileSync('git', ['-C', REPO, 'show', `${commit}:lib/${f}`], { encoding: 'utf8' });
  const out = pinRewrite(src);
  fs.writeFileSync(path.join(dir, f), out);
  manifest.files[f] = { lines: src.split('\n').length, rewrittenImportLines: src.split('\n').filter((l, i) => l !== out.split('\n')[i]).length };
}
fs.writeFileSync(path.join(dir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
