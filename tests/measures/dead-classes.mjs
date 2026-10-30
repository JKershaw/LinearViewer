// Dead-class scan (LIN-4015). Lists the class names a top-level public/*.css selector styles that no non-test source emits.
// Usage: node tests/measures/dead-classes.mjs [repoDir]  → JSON on stdout. Exits 0 whatever it finds: it reports, it does not gate.
//
// Reads the working tree (run it on the commit under test). A class is alive when its name appears as a whole token in
// lib/, routes/, server.js, content/, llms.txt or public/*.js|html, tests excluded. A name in a comment counts as alive, so
// this is a LOWER bound on the dead set: it never reports a live class as dead, it can miss a dead one.
//
// Names a whole-token search cannot see are reported apart as `prefixBuilt`, not dead: a literal that ends in `-` and is
// joined to a variable (`'status-pill--' + tone`, `` `toast-${kind}` ``) builds every name that starts with it. A short
// prefix that is not a dash-ended literal is listed in SHORT_PREFIXES with the reason it is live.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSheets } from '../helpers/css-rules.js';

// Built from a short literal the dash rule above cannot see. Each stays alive; the reason is the grep that proves it.
export const SHORT_PREFIXES = [
  { prefix: 'p', why: "public/swim.js builds `'p' + issue.priority`, so .p3 and .p4 are emitted" },
];

const SCANNED_DIRS = ['lib', 'routes', 'content'];
const SCANNED_FILES = ['server.js', 'llms.txt'];
const PUBLIC_SOURCE = /\.(js|html)$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

// The source files that can emit a class: everything non-test under the scanned roots.
export function sourceFiles(root) {
  const files = [];
  for (const dir of SCANNED_DIRS) files.push(...walk(join(root, dir)));
  for (const file of SCANNED_FILES) files.push(join(root, file));
  for (const name of readdirSync(join(root, 'public'))) {
    if (PUBLIC_SOURCE.test(name)) files.push(join(root, 'public', name));
  }
  return files.filter((f) => !/\.test\.(js|mjs)$/.test(f) && !['.png', '.woff2', '.svg'].includes(extname(f)));
}

// Every whole token in the source (letters, digits, `-`, `_`), so `foo` is not found inside `foo-bar`.
export function sourceTokens(root) {
  const tokens = new Set();
  const prefixes = new Set();
  for (const file of sourceFiles(root)) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const m of text.matchAll(/[A-Za-z_][\w-]*/g)) tokens.add(m[0]);
    // A dash-ended literal joined to a value, or in a template before ${: the family it builds.
    // The literal may sit inside a longer string (`' feedback-status-' + kind`), and a template may hold the prefix mid-string.
    for (const m of text.matchAll(/['"][^'"\n]*?([A-Za-z][\w-]*-)['"]\s*\+/g)) prefixes.add(m[1]);
    for (const m of text.matchAll(/(?<![\w-])([A-Za-z][\w-]*-)\$\{/g)) prefixes.add(m[1]);
  }
  return { tokens, prefixes };
}

// The class names each sheet's selectors style, with the sheets that style them.
export function styledClasses(root) {
  const sheets = readdirSync(join(root, 'public')).filter((f) => f.endsWith('.css')).sort();
  const byClass = new Map();
  for (const sheet of readSheets(sheets.map((f) => `/${f}`), join(root, 'public'))) {
    for (const rule of sheet.rules) {
      for (const sel of rule.selectors) {
        for (const m of sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
          if (!byClass.has(m[1])) byClass.set(m[1], new Set());
          byClass.get(m[1]).add(sheet.name.slice(1));
        }
      }
    }
  }
  return byClass;
}

export function scan(root) {
  const { tokens, prefixes } = sourceTokens(root);
  const byClass = styledClasses(root);
  const dead = [];
  const prefixBuilt = [];
  let alive = 0;
  for (const [name, sheets] of [...byClass].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (tokens.has(name)) {
      alive++;
      continue;
    }
    const shortPrefix = SHORT_PREFIXES.find((p) => name.startsWith(p.prefix) && name.length > p.prefix.length && /\d/.test(name.slice(p.prefix.length)));
    const family = [...prefixes].find((p) => name.startsWith(p) && name.length > p.length);
    if (shortPrefix || family) {
      prefixBuilt.push({ name, by: shortPrefix ? shortPrefix.prefix : family });
      continue;
    }
    dead.push({ name, sheets: [...sheets].sort() });
  }
  return { classes: byClass.size, alive, prefixBuilt, dead };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? '.';
  process.stdout.write(`${JSON.stringify(scan(root), null, 2)}\n`);
}
