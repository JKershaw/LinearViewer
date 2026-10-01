/**
 * LIN-3216 (LIN-3201 A0) — a zero-dependency static import-graph helper.
 *
 * WHAT IT IS. A pure, in-memory walk of the `import` / `export … from` edges of
 * a supplied ESM file set (`Map<relativePath, source>` or an iterable of
 * `{ path, source }`). It resolves relative specifiers against the importing
 * module's directory and exposes transitive reach as a first-class query, so a
 * caller can ask "does module M reach symbol S through any chain of imports".
 *
 * PRECEDENTS. Plain source-text parsing (regex + brace-aware helpers), not an
 * AST library: the repo has no static-analysis dependency and this matches
 * tests/fixtures/connection-access-guards.js,
 * tests/unit/lib/proxy-di-witness.js and the `lin-3134` scanners.
 *
 * ZERO DEPENDENCIES. Node built-ins only (`node:path`). No filesystem access —
 * the caller supplies the file set, so every check is drivable from synthetic
 * fixtures.
 *
 * ── API IS FIXED HERE ────────────────────────────────────────────────────────
 * This surface is frozen once it lands. A1 and A3 extend it ADDITIVELY ONLY —
 * new functions/methods/options, never a reshaped signature, renamed member or
 * changed return shape. Every export below is exercised by
 * tests/unit/import-graph.test.js.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * EXPORTS
 *
 *   buildImportGraph(modules) -> ImportGraph
 *     modules: Map<path, source> | Iterable<{ path, source }>.
 *
 *   resolveSpecifier(fromPath, specifier) -> string | null
 *     Relative specifiers only (`./`, `../`). Normalized POSIX, repo-relative,
 *     `.js` appended when the specifier carries no extension. Bare and
 *     `node:` specifiers -> null; a path that escapes the root -> null.
 *
 *   parseModule(source) -> { imports, reexports, exportedNames }
 *     Low-level parse of one source string (comments stripped first).
 *       imports:    [{ specifier, form, star, sideEffect, bindings }]
 *       reexports:  [{ specifier, form, star, sideEffect, bindings }]
 *       exportedNames: [string]  (declarations, local lists, explicit
 *                                 re-export names and `export * as ns`)
 *     `bindings`: [{ imported, local }] where `imported` is the source-side
 *     name and `local` the bound/exported name (`*` for namespace imports).
 *     `form`: 'named' | 'default' | 'namespace' | 'side-effect' | 'star'.
 *     Destructured `export const { … } =` names are extracted best-effort.
 *
 * ImportGraph METHODS (all pure, cycle-safe)
 *
 *   paths()                      -> string[]            sorted module paths
 *   has(path)                    -> boolean
 *   sourceOf(path)               -> string | undefined
 *   edges()                      -> [{ from, to, specifier, kind }]
 *                                   kind: 'import' | 're-export'; only edges
 *                                   whose specifier resolved to a path
 *   resolve(fromPath, specifier) -> string | null       (same as the fn above)
 *   importsOf(path)              -> [{ specifier, resolved, kind, form, star,
 *                                      sideEffect, bindings }]
 *   dependenciesOf(path)         -> string[]            sorted resolved deps
 *   exportedNamesOf(path)        -> string[]            star-expanded
 *   directImportersOf(symbol)    -> string[]            sorted
 *   reaches(fromPath, symbol)    -> boolean
 *   reachingModules(symbol, { from = paths() }) -> string[]
 *
 * REACH SEMANTICS (the A0/A1/A3 contract)
 *   `reaches(M, S)` is true iff `M` can reach `S` through 0+ import / re-export
 *   edges to a module whose exported names include the binding `S`. This is
 *   definition-targeted, so it survives aliasing, re-exports and a wrapper hop
 *   (route -> lib/wrapper.js -> defining module). It is deliberately module
 *   reachability, not a binding-chain proof: that is what lets A3 count an
 *   enqueue moved behind a `lib/` wrapper. It is cycle-safe via a visited set.
 */
import { posix } from 'node:path';

const RELATIVE_RE = /^\.{1,2}\//;

/**
 * Resolve a specifier against the importing module's directory. Relative
 * specifiers only; bare and `node:` specifiers return null.
 */
export function resolveSpecifier(fromPath, specifier) {
  if (typeof specifier !== 'string' || !RELATIVE_RE.test(specifier)) return null;
  let resolved = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  if (resolved === '..' || resolved.startsWith('../')) return null;
  if (posix.extname(resolved) === '') resolved += '.js';
  return resolved;
}

/**
 * String-aware comment stripper: removes `//` and block comments without
 * touching string / template literals or the newlines that keep line anchors
 * honest. Ported from tests/fixtures/connection-access-guards.js.
 */
function stripComments(source) {
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
    if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } continue; }
    if (state === 'block') { if (c === '*' && c2 === '/') { state = 'code'; i++; continue; } if (c === '\n') out += c; continue; }
    if (c === '\\') { out += c + (c2 ?? ''); i++; continue; }
    out += c;
    if ((state === 'squote' && c === "'") || (state === 'dquote' && c === '"') || (state === 'tpl' && c === '`')) state = 'code';
  }
  return out;
}

/** Parse `{ a, b as c }` inner text into `{ imported, local }` bindings. */
function parseNameList(inner) {
  const out = [];
  for (const part of inner.split(',')) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
    if (m) out.push({ imported: m[1], local: m[2] || m[1] });
  }
  return out;
}

/** Index of the first top-level `,` in `text`, or -1. */
function indexOfTopLevel(text, char) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ('{[('.includes(c)) depth++;
    else if ('}])'.includes(c)) depth--;
    else if (c === char && depth === 0) return i;
  }
  return -1;
}

/** Split on top-level `,` only (depth-aware). */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if ('{[('.includes(ch)) depth++;
    else if ('}])'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { parts.push(current); current = ''; } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Coarse binding names from an `export const|let|var` declarator list. */
function declaredNames(text) {
  const names = [];
  for (const decl of splitTopLevel(text)) {
    const noEq = decl.split('=')[0].trim();
    const first = noEq.match(/^([A-Za-z_$][\w$]*)/);
    if (first) { names.push(first[1]); continue; }
    for (const m of noEq.matchAll(/([A-Za-z_$][\w$]*)/g)) names.push(m[1]);
  }
  return names;
}

/**
 * Parse one ESM module's static `import` / `export … from` edges. Comments are
 * stripped first; statement regexes are line-anchored so string literals that
 * merely contain the word `import` are not mistaken for edges.
 */
export function parseModule(source) {
  const clean = stripComments(source);
  const imports = [];
  const reexports = [];
  const exportedNames = [];
  let m;

  const importFrom = /^[ \t]*import\s+([^'"]*?)\s+from\s*(['"])([^'"]+)\2/gm;
  while ((m = importFrom.exec(clean))) {
    imports.push({ specifier: m[3], ...parseImportClause(m[1]) });
  }
  const importBare = /^[ \t]*import\s*(['"])([^'"]+)\1/gm;
  while ((m = importBare.exec(clean))) {
    imports.push({ specifier: m[2], form: 'side-effect', star: false, sideEffect: true, bindings: [] });
  }

  const exportNamedFrom = /^[ \t]*export\s*\{([\s\S]*?)\}\s*from\s*(['"])([^'"]+)\2/gm;
  while ((m = exportNamedFrom.exec(clean))) {
    const bindings = parseNameList(m[1]);
    reexports.push({ specifier: m[3], form: 'named', star: false, sideEffect: false, bindings });
    for (const b of bindings) exportedNames.push(b.local);
  }
  const exportStarFrom = /^[ \t]*export\s*\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s*)?from\s*(['"])([^'"]+)\2/gm;
  while ((m = exportStarFrom.exec(clean))) {
    if (m[1]) {
      reexports.push({ specifier: m[3], form: 'namespace', star: true, sideEffect: false, bindings: [{ imported: '*', local: m[1] }] });
      exportedNames.push(m[1]);
    } else {
      reexports.push({ specifier: m[3], form: 'star', star: true, sideEffect: false, bindings: [] });
    }
  }

  const exportLocal = /^[ \t]*export\s*\{([\s\S]*?)\}\s*(?!from\b)/gm;
  while ((m = exportLocal.exec(clean))) {
    for (const b of parseNameList(m[1])) exportedNames.push(b.local);
  }

  const exportFunc = /^[ \t]*export\s+(?:default\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/gm;
  while ((m = exportFunc.exec(clean))) exportedNames.push(m[1]);
  const exportVar = /^[ \t]*export\s+(?:const|let|var)\s+([\s\S]*?);/gm;
  while ((m = exportVar.exec(clean))) exportedNames.push(...declaredNames(m[1]));
  if (/^[ \t]*export\s+default\b/m.test(clean)) exportedNames.push('default');

  return { imports, reexports, exportedNames: [...new Set(exportedNames)] };
}

/** Parse an import clause (the text between `import` and `from`). */
function parseImportClause(clause) {
  let rest = clause.trim();
  const bindings = [];
  let form = 'named';
  let star = false;
  if (rest && !rest.startsWith('{') && !rest.startsWith('*')) {
    const comma = indexOfTopLevel(rest, ',');
    const name = (comma === -1 ? rest : rest.slice(0, comma)).trim();
    if (name) bindings.push({ imported: 'default', local: name.split(/\s+/).pop() });
    form = 'default';
    rest = comma === -1 ? '' : rest.slice(comma + 1).trim();
  }
  if (rest.startsWith('{')) {
    bindings.push(...parseNameList(rest.slice(1, rest.lastIndexOf('}'))));
    if (form === 'default') form = 'named';
  } else if (rest.startsWith('*')) {
    const mm = rest.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (mm) bindings.push({ imported: '*', local: mm[1] });
    form = 'namespace';
    star = true;
  }
  if (bindings.length === 0 && form === 'named') form = 'side-effect';
  return { form, star, sideEffect: false, bindings };
}

/** Build the adjacency + lookup tables once. */
function compile(sources) {
  const parsed = new Map();
  for (const [path, source] of sources) parsed.set(path, parseModule(source));
  const importsByPath = new Map();
  const edges = [];
  const adjacency = new Map();
  for (const path of sources.keys()) adjacency.set(path, new Set());
  for (const [path, mod] of parsed) {
    const records = [
      ...mod.imports.map((r) => ({ ...r, kind: 'import' })),
      ...mod.reexports.map((r) => ({ ...r, kind: 're-export' })),
    ].map((r) => ({ ...r, resolved: resolveSpecifier(path, r.specifier) }));
    importsByPath.set(path, records);
    for (const r of records) {
      if (r.resolved === null) continue;
      edges.push({ from: path, to: r.resolved, specifier: r.specifier, kind: r.kind });
      adjacency.get(path).add(r.resolved);
    }
  }
  return { parsed, importsByPath, edges, adjacency };
}

class ImportGraph {
  constructor(sources) {
    this._sources = sources;
    const c = compile(sources);
    this._parsed = c.parsed;
    this._importsByPath = c.importsByPath;
    this._edges = c.edges;
    this._adjacency = c.adjacency;
  }

  paths() { return [...this._sources.keys()].sort(); }

  has(path) { return this._sources.has(path); }

  sourceOf(path) { return this._sources.get(path); }

  edges() { return this._edges.map((e) => ({ ...e })); }

  resolve(fromPath, specifier) { return resolveSpecifier(fromPath, specifier); }

  importsOf(path) {
    const records = this._importsByPath.get(path) || [];
    return records.map((r) => ({ ...r, bindings: r.bindings.map((b) => ({ ...b })) }));
  }

  dependenciesOf(path) {
    return [...new Set((this._importsByPath.get(path) || []).map((r) => r.resolved).filter((p) => p !== null))].sort();
  }

  exportedNamesOf(path) {
    const out = new Set();
    const visit = (p, seen) => {
      if (seen.has(p)) return;
      seen.add(p);
      const mod = this._parsed.get(p);
      if (!mod) return;
      for (const name of mod.exportedNames) out.add(name);
      for (const r of mod.reexports) {
        if (r.form !== 'star') continue;
        const to = resolveSpecifier(p, r.specifier);
        if (to !== null && this._sources.has(to)) visit(to, seen);
      }
    };
    visit(path, new Set());
    return [...out].sort();
  }

  directImportersOf(symbol) {
    const out = [];
    for (const path of this.paths()) {
      const hit = (this._importsByPath.get(path) || []).some((r) => r.bindings.some((b) => b.imported === symbol));
      if (hit) out.push(path);
    }
    return out;
  }

  reaches(fromPath, symbol) {
    const seen = new Set();
    const stack = [fromPath];
    while (stack.length) {
      const p = stack.pop();
      if (seen.has(p)) continue;
      seen.add(p);
      if (this.exportedNamesOf(p).includes(symbol)) return true;
      for (const to of this._adjacency.get(p) || []) stack.push(to);
    }
    return false;
  }

  reachingModules(symbol, { from = this.paths() } = {}) {
    return [...from].filter((p) => this._sources.has(p) && this.reaches(p, symbol)).sort();
  }
}

/**
 * Build an ImportGraph over a supplied file set. Accepts a `Map<path, source>`
 * or an iterable of `{ path, source }`. The file set is never mutated.
 */
export function buildImportGraph(modules) {
  const sources = new Map();
  if (modules instanceof Map) {
    for (const [path, source] of modules) sources.set(path, String(source));
  } else {
    for (const { path, source } of modules) sources.set(path, String(source));
  }
  return new ImportGraph(sources);
}
