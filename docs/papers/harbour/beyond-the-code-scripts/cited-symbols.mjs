#!/usr/bin/env node
// Which code names an area note cites still exist in the code (LIN-4479).
//
//   node cited-symbols.mjs <repo> [ref] > out.json
//
// The guard (tests/unit/area-notes.test.js) checks that every cited *path* exists. Notes also cite
// *names*: functions, constants, tables. Nothing checks those. This reads every note at <ref>
// (default HEAD), takes each backtick span that looks like an identifier (camelCase, PascalCase or
// UPPER_SNAKE, at least 4 characters, optionally called as `name()` or dotted as `a.b`), and asks
// `git grep -w` whether the last dotted part appears anywhere outside docs/
// at that ref. A name found nowhere is "missing": the note names code that is
// not there (renamed, deleted, or never spelled that way).
import { execFileSync } from 'node:child_process';

const [repo, ref = 'HEAD'] = process.argv.slice(2);
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
const files = git('ls-tree', '--name-only', `${ref}:docs/areas`).trim().split('\n')
  .filter((f) => f.endsWith('.md') && f !== 'README.md');
const IDENT = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(\))?$/;
const looksLikeCode = (s) => /[a-z][A-Z]/.test(s) || /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(s) || /^[A-Z][a-z]+[A-Z]/.test(s);
const exists = new Map();
function found(name) {
  if (!exists.has(name)) {
    try {
      git('grep', '-q', '-w', '-F', name, ref, '--', '.', ':!docs');
      exists.set(name, true);
    } catch { exists.set(name, false); }
  }
  return exists.get(name);
}
const out = [];
for (const f of files) {
  const text = git('show', `${ref}:docs/areas/${f}`);
  for (const m of text.matchAll(/`([^`\s]+)`/g)) {
    const span = m[1];
    if (!IDENT.test(span)) continue;
    const name = span.replace(/\(\)$/, '').split('.').pop();
    if (name.length < 4 || !looksLikeCode(name)) continue;
    out.push({ note: f, span, name, found: found(name) });
  }
}
const uniq = new Map(out.map((o) => [`${o.note}|${o.name}`, o]));
const all = [...uniq.values()];
process.stdout.write(JSON.stringify({ repo, ref: git('rev-parse', ref).trim(), cited: all.length,
  missing: all.filter((o) => !o.found) }, null, 1));
