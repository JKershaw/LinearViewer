#!/usr/bin/env node
// Every area-note entry at one commit, with a stable id, for coding (LIN-4479).
//
//   node dump-entries.mjs <repo> <ref> <prefix> > entries.json
//
// id = <prefix>:<slug>:<L|W><n>, n counting from 1 within the section, in file order.
// Entries are split as notes-history.mjs splits them.
import { execFileSync } from 'node:child_process';

const [repo, ref = 'HEAD', prefix = 'LV'] = process.argv.slice(2);
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
const files = git('ls-tree', '--name-only', `${ref}:docs/areas`).trim().split('\n')
  .filter((f) => f.endsWith('.md') && f !== 'README.md');
const out = [];
for (const f of files) {
  const slug = f.slice(0, -3);
  const lists = { Lessons: [], Waiting: [] };
  let section = null;
  for (const line of git('show', `${ref}:docs/areas/${f}`).split('\n')) {
    const h = /^## (.*)$/.exec(line);
    if (h) { section = h[1].trim(); continue; }
    if (!lists[section]) continue;
    if (line.startsWith('- ')) lists[section].push(line.slice(2));
    else if (/^\s+\S/.test(line) && lists[section].length) lists[section][lists[section].length - 1] += ` ${line.trim()}`;
  }
  for (const [section, items] of Object.entries(lists)) {
    items.forEach((text, i) => out.push({ id: `${prefix}:${slug}:${section[0]}${i + 1}`, slug, section, text }));
  }
}
process.stdout.write(JSON.stringify({ repo, ref: git('rev-parse', ref).trim(), entries: out }, null, 1));
