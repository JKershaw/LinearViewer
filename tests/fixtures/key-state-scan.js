/**
 * The census scan for the per-key reset (LIN-4168). Finds the in-memory containers that could hold per-key state, so
 * tests/unit/key-state-census.test.js can require every one to be classified.
 *
 * Four shapes, all read from source text (no parser; the code style keeps them unambiguous):
 *  (a) module-scope:       `const|let|var NAME = new Map|Set|WeakMap(` at column 0 of lib/, routes/ or server.js.
 *  (b) class field:        `this.NAME = new Map|Set|WeakMap(` at any depth.
 *  (c) factory closure:    `  const|let NAME = new Map|Set|WeakMap(` (two spaces) inside an `export function create*`
 *                          body, the closure every factory instance keeps its state in.
 *  (d) factory instance:   `const NAME = create[A-Z]...(` at column 0. An instance's own state is its own hit under
 *                          (a) to (c), so this shape exists to make each instance a decision, not a hidden default.
 *
 * A hit's key is `file::NAME`. A repeated NAME within one file gets `#2`, `#3`, ... in source order, so a census entry
 * names one container without depending on its line number.
 */

import fs from 'node:fs';
import path from 'node:path';

export const SCAN_ROOTS = ['lib', 'routes'];
export const SCAN_FILES = ['server.js'];

const CTOR = 'new (?:Map|Set|WeakMap)\\(\\)'; // empty constructors only: a populated one is a lookup table
const RE_MODULE = new RegExp(`^(?:export )?(?:const|let|var) ([A-Za-z_$][\\w$]*) = ${CTOR}`);
const RE_FIELD = new RegExp(`this\\.([A-Za-z_$][\\w$]*) \\?\\?= ${CTOR}|this\\.([A-Za-z_$][\\w$]*) = ${CTOR}`);
const RE_CLOSURE = new RegExp(`^  (?:const|let) ([A-Za-z_$][\\w$]*) = ${CTOR}`);
const RE_FACTORY_START = /^(?:export )?function (create\w*)\(/;
const RE_INSTANCE = /^(?:export )?const ([A-Za-z_$][\w$]*) = create[A-Z]\w*\(/;

/** Every .js file under the scan roots plus the scan files, as repo-relative posix paths. */
export function listScanFiles(repoRoot) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.js')) out.push(path.relative(repoRoot, full).split(path.sep).join('/'));
    }
  };
  for (const root of SCAN_ROOTS) walk(path.join(repoRoot, root));
  for (const file of SCAN_FILES) out.push(file);
  return out.sort();
}

/**
 * Scan one file's text.
 * @param {string} file - repo-relative path, used in the key
 * @param {string} text
 * @returns {Array<{key: string, shape: 'a'|'b'|'c'|'d', name: string, line: number}>}
 */
export function scanText(file, text) {
  const lines = text.split('\n');
  const hits = [];
  let factory = null; // the create* factory whose body we are in, or null at module scope
  lines.forEach((line, i) => {
    const start = RE_FACTORY_START.exec(line);
    if (start) factory = start[1];
    else if (line === '}') factory = null;

    let m = RE_INSTANCE.exec(line);
    if (m) { hits.push({ shape: 'd', name: m[1], line: i + 1 }); return; }
    m = RE_MODULE.exec(line);
    if (m) { hits.push({ shape: 'a', name: m[1], line: i + 1, factory: null }); return; }
    if (factory) {
      m = RE_CLOSURE.exec(line);
      if (m) { hits.push({ shape: 'c', name: m[1], line: i + 1, factory }); return; }
    }
    const f = RE_FIELD.exec(line);
    if (f) hits.push({ shape: 'b', name: f[1] || f[2], line: i + 1, factory });
  });
  const seen = new Map();
  return hits.map((h) => {
    const n = (seen.get(h.name) ?? 0) + 1;
    seen.set(h.name, n);
    return { ...h, key: `${file}::${h.name}${n > 1 ? `#${n}` : ''}` };
  });
}

/**
 * Scan the whole repo.
 * @param {string} repoRoot
 * @returns {Array<{key: string, shape: string, name: string, line: number, file: string}>}
 */
export function scanRepo(repoRoot) {
  return listScanFiles(repoRoot).flatMap((file) =>
    scanText(file, fs.readFileSync(path.join(repoRoot, file), 'utf8')).map((h) => ({ ...h, file })),
  );
}
