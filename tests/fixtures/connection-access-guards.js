/**
 * LIN-3124 PR1 (G) — pure helpers for the D6 connection-access guard suite.
 *
 * This module holds the testable logic only. The guard tests live in
 * tests/unit/connection-access-guard.test.js; they load the real source corpus
 * and assert the checks below are clean. The checks are deliberately pure:
 * every one is `(sources) => offenders`, where `sources` is a Map of
 * `relativePath -> comment-stripped source`, so a synthetic planted offender
 * can be fed in without touching the tree.
 *
 * `stripComments` is STRING-AWARE: it must not treat `//` inside a string
 * literal as a comment. The retired LIN-3127 guard's stripper stripped a line
 * comment after any non-colon character, including inside a string, so it
 * removed the tail of a line like `"a//b"; offender()` and hid an offender on
 * the same line. tests/unit/connection-access-guard.test.js pins that hole.
 *
 * Run the guard: node --test tests/unit/connection-access-guard.test.js
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { createHash } from 'node:crypto';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SOURCE_DIRS = ['lib', 'routes'];
export const SOURCE_FILES = ['server.js'];
export const SKIP_DIRS = new Set([
  'node_modules', '.git', 'tests', 'test-results', 'public', 'docs',
  'plans', 'prototypes', 'content', 'data', '.github',
]);

/** All top-level production source files (lib/, routes/, server.js). */
export function listSourceFiles(root = REPO_ROOT) {
  const out = [];
  const walk = (abs) => {
    for (const entry of readdirSync(abs)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(abs, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (entry.endsWith('.js')) out.push(relative(root, full));
    }
  };
  for (const dir of SOURCE_DIRS) walk(join(root, dir));
  for (const rel of SOURCE_FILES) out.push(rel);
  return [...new Set(out)];
}

/**
 * String-aware comment stripper. Removes `//` and block comments while leaving
 * string/template literals (and the newlines that keep line-based counts
 * honest) intact.
 */
export function stripComments(source) {
  let out = '';
  let state = 'code';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const c2 = source[i + 1];
    if (state === 'code') {
      if (c === '/' && c2 === '/') { state = 'line'; continue; }
      if (c === '/' && c2 === '*') { state = 'block'; continue; }
      if (c === "'") { state = 'squote'; out += c; continue; }
      if (c === '"') { state = 'dquote'; out += c; continue; }
      if (c === '`') { state = 'tpl'; out += c; continue; }
      out += c; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; }
      continue;
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') { state = 'code'; i++; continue; }
      if (c === '\n') out += c;
      continue;
    }
    // string states: keep every char, honour escapes, end on the delimiter
    if (c === '\\') { out += c + (c2 ?? ''); i++; continue; }
    out += c;
    if ((state === 'squote' && c === "'") || (state === 'dquote' && c === '"') || (state === 'tpl' && c === '`')) {
      state = 'code';
    }
  }
  return out;
}

/** Read the real corpus as `Map<rel, rawSource>`. */
export function loadRawSources(root = REPO_ROOT) {
  return new Map(listSourceFiles(root).map(rel => [rel, readFileSync(join(root, rel), 'utf8')]));
}

/** Read the real corpus as `Map<rel, comment-strippedSource>`. */
export function loadStrippedSources(root = REPO_ROOT) {
  return new Map([...loadRawSources(root)].map(([rel, raw]) => [rel, stripComments(raw)]));
}

export function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function countMatches(source, re) {
  return (source.match(re) || []).length;
}

// Import specifiers are relative (e.g. './connection-store.js'), so match the
// module BASENAME, not the corpus-relative path.
const importRe = (target) => new RegExp(`from\\s+['"][^'"]*${escapeRe(target.split('/').pop())}['"]`);
export const ANY_CONNECTION_MODULE_IMPORT =
  /from\s+['"][^'"]*connection-(?:store|credential|lifecycle)\.js['"]/;

/** Files importing `target`. */
export function importers(sources, target) {
  const re = importRe(target);
  return [...sources].filter(([, src]) => re.test(src)).map(([rel]) => rel);
}

/**
 * Arm (a): the exact importer allow-list (symmetric difference — a dropped
 * importer and an added one both offend) when `exact`, otherwise the importers
 * outside the allow-list (an allow-list subset check for modules not yet in
 * the tree).
 */
export function importerOffenders(sources, target, allowed, { exact = false } = {}) {
  const actual = importers(sources, target);
  if (!exact) return actual.filter(rel => !allowed.includes(rel));
  const a = new Set(actual);
  const b = new Set(allowed);
  return [...new Set([...allowed.filter(x => !a.has(x)), ...actual.filter(x => !b.has(x))])];
}

/**
 * Arm (b′): any `readConnection*` identifier (calls, imports, destructuring —
 * identifier-level, so aliases are caught) or a legacy `connectionStore.get(`
 * call must live only in the allowed modules.
 *
 * D6's naming law is "every ConnectionStore read is `readConnection*`". LIN-3124
 * PR2 adds one D10-named read, `readReferencedConnections`, that does not share
 * the literal prefix; it is included explicitly here so the identifier-level
 * scan stays sound (a call to it from a protected module is still caught).
 */
export const CONNECTION_READ_TOKEN = /\breadConnection[A-Za-z0-9_]*\b|\breadReferencedConnections\b/;
export const CONNECTION_READ_NAME = /^(?:readConnection[A-Za-z0-9_]*|readReferencedConnections)$/;
export const LEGACY_CONNECTION_GET = /\bconnectionStore\s*\??\.\s*get\s*\(/;

export function readUsageOffenders(sources, allowedModules) {
  return [...sources]
    .filter(([rel, src]) => (CONNECTION_READ_TOKEN.test(src) || LEGACY_CONNECTION_GET.test(src))
      && !allowedModules.includes(rel))
    .map(([rel]) => rel);
}

/** Arm (c): the protected modules import none of the three modules. */
export function protectedImportOffenders(sources, protectedModules) {
  return protectedModules.filter(rel => sources.has(rel) && ANY_CONNECTION_MODULE_IMPORT.test(sources.get(rel)));
}

/** Arm (d): no provider `index.js` imports any of the three modules. */
export function providerIndexImportOffenders(sources) {
  const providers = [...sources.keys()].filter(rel => /^lib\/providers\/[^/]+\/index\.js$/.test(rel));
  return providers.filter(rel => ANY_CONNECTION_MODULE_IMPORT.test(sources.get(rel)));
}

/** Arm (e): connection wiring only in server.js, at the expected shape. */
export function wiringOffenders(sources) {
  const offenders = [];
  for (const [rel, src] of sources) {
    const wired = /\bconnectionsCollection\b/.test(src) || /collection\(\s*['"]connections['"]\s*\)/.test(src);
    if (wired && rel !== 'server.js') offenders.push(`${rel}: connection wiring outside server.js`);
  }
  const server = sources.get('server.js') || '';
  const coll = countMatches(server, /\bconnectionsCollection\b/g);
  const collCall = countMatches(server, /collection\(\s*['"]connections['"]\s*\)/g);
  const ctor = countMatches(server, /new ConnectionStore\(/g);
  if (coll !== 2) offenders.push(`server.js: connectionsCollection count ${coll} !== 2`);
  if (collCall !== 1) offenders.push(`server.js: collection('connections') count ${collCall} !== 1`);
  if (ctor !== 1) offenders.push(`server.js: new ConnectionStore( count ${ctor} !== 1`);
  return offenders;
}

/** Arm (f): OwnerCredentialStore sibling callers must be the named modules. */
export function siblingCallOffenders(sources, methods, allowedCallers) {
  const offenders = [];
  for (const [rel, src] of sources) {
    for (const m of methods) {
      if (new RegExp(`\\.${escapeRe(m)}\\s*\\(`).test(src) && !allowedCallers.includes(rel)) {
        offenders.push(`${rel}: .${m}( outside [${allowedCallers.join(', ')}]`);
      }
    }
  }
  return offenders;
}

/**
 * A function-name caller pin for EXPORTED functions called bare (not as a
 * method). Matches `\bNAME(` but not the `function NAME(` definition. Every
 * caller must be in `allowedCallers`.
 */
export function namedCallOffenders(sources, names, allowedCallers) {
  const offenders = [];
  for (const [rel, src] of sources) {
    if (allowedCallers.includes(rel)) continue;
    for (const name of names) {
      const re = new RegExp(`(?<!function\\s)\\b${escapeRe(name)}\\s*\\(`, 'g');
      if (re.test(src)) offenders.push(`${rel}: ${name}( outside [${allowedCallers.join(', ')}]`);
    }
  }
  return offenders;
}

/**
 * Arm (f3) wildcard: every `<receiver>.<name>ByConnection(` write must live only
 * in `allowedCallers` (D6(f)). The receiver is intentionally NOT captured — the
 * method is flagged wherever a `.` **or `?.`** precedes it, whatever the call
 * shape (`getStore().putByConnection(`, `stores[0].rotateByConnection(`,
 * `ownerCredentialStore?.putByConnection(`). Exemptions:
 *   - `this.<name>ByConnection(` — a self-call, exempt ONLY in the defining
 *     module `lib/owner-credential-store.js`;
 *   - `getByConnection(` — the READ, pinned separately by the caller pin;
 *   - `deleteByConnection(` — lifecycle-only, pinned by arm f2.
 */
export function byConnectionWriteOffenders(sources, allowedCallers) {
  const re = /(\bthis\s*)?\??\.\s*(\w+ByConnection)\s*\(/g;
  const offenders = [];
  for (const [rel, src] of sources) {
    if (allowedCallers.includes(rel)) continue;
    for (const m of src.matchAll(re)) {
      const selfCall = m[1];
      const method = m[2];
      if (selfCall && rel === 'lib/owner-credential-store.js') continue;
      if (method === 'getByConnection') continue;
      if (method === 'deleteByConnection') continue;
      offenders.push(`${rel}: .${method}( outside [${allowedCallers.join(', ')}]`);
    }
  }
  return offenders;
}

/**
 * Prototype-reflection registry: every own method name must be classified, and
 * the naming law must hold (READ names start with `readConnection`, WRITE names
 * do not start with `read`). Returns unclassified/misnamed methods.
 */
export function registryOffenders(methodNames, classification) {
  const offenders = [];
  for (const name of methodNames) {
    const cls = classification[name];
    if (!cls) { offenders.push(`${name}: unclassified`); continue; }
    if (cls === 'READ' && !CONNECTION_READ_NAME.test(name)) offenders.push(`${name}: READ but not readConnection*`);
    if (cls === 'WRITE' && /^read/.test(name)) offenders.push(`${name}: WRITE but read*`);
  }
  return offenders;
}

/**
 * G3b (PR2 verdict `b39d8121`): exactly ONE production `createConnectionRefresher(`
 * instance. Counts call sites (excluding the `function createConnectionRefresher(`
 * definition) across the corpus; the single instance must live in `server.js` so
 * the `conn:${connectionId}` single-flight has exactly one registration layer.
 */
export function refresherInstanceOffenders(sources) {
  const DEF = /function\s+createConnectionRefresher\s*\(/g;
  const CALL = /\bcreateConnectionRefresher\s*\(/g;
  const offenders = [];
  let total = 0;
  for (const [rel, src] of sources) {
    const calls = (src.match(CALL) || []).length - (src.match(DEF) || []).length;
    if (calls > 0) {
      total += calls;
      if (rel !== 'server.js') offenders.push(`${rel}: createConnectionRefresher( outside server.js`);
    }
  }
  if (total !== 1) offenders.push(`createConnectionRefresher( count ${total} !== 1`);
  return offenders;
}

/** Extract a top-level `function NAME(...) {...}` body (brace-matched). */
export function extractFunction(source, name) {
  const re = new RegExp(`(?:export\\s+)?function\\s+${escapeRe(name)}\\s*\\(`);
  const m = re.exec(source);
  if (!m) return null;
  const open = source.indexOf('{', m.index);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return source.slice(m.index, i + 1);
    }
  }
  return null;
}

export function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}
