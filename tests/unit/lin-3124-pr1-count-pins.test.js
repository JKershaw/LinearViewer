/**
 * LIN-3124 PR1 (G) — credential-surface boundary relations (T5).
 *
 * LIN-3219 A3 (LIN-3201 M19), review-fix beat 2: the first A3 attempt used a
 * `reaches(<credential entry>)` module boundary for every surface. The
 * implementation review (LIN-3219 comment `2812bf89`, finding #1) showed that
 * each entry (`linkProvider`, `getWorkspaceCallScope`, `readBindingCredential`,
 * the account set) is reached by 128–132 of 323 production modules, so
 * "the site's module reaches the entry" is not a credential boundary: a fresh
 * site inside any already-reaching module passed. This rewrite makes each
 * surface an OCCURRENCE-level relation that actually separates:
 *
 *   - `boundary`: the occurrence's module must reach the credential entry **and**
 *     the occurrence must sit inside a function body (a module-top-level
 *     occurrence is not a runtime call site — the shape every old +1 plant had).
 *   - `owner`: the occurrence's module must be in an EXPLICITLY DERIVED owner set
 *     — the symbols' defining module(s) plus their direct importers — **and**
 *     the occurrence must sit inside a function body. Used for `binding-writers`,
 *     where the defining module (lib/workspace.js) legitimately holds the
 *     symbols' own call sites but a fresh top-level call must still fail.
 *   - `shape` (per occurrence, applied alongside the module relation):
 *       * `test-token-guards`: the `accessToken === 'test-token'` short-circuit
 *         is only valid when gated by `process.env.NODE_ENV === 'test'`.
 *       * `raw-accesstoken-writers`: a raw `.accessToken =` write is only valid
 *         alongside its `.tokenExpiresAt =` mirror companion.
 *   - `callerImporter`: derived-set equality between the modules that CALL the
 *     symbols and the modules that IMPORT them (`held-marker-emitters`).
 *   - `providerAuth`: a true derived-set equality between the source regex edge
 *     set and the (dynamic-aware) import-graph edge set.
 *
 * Allowed-module-set sizes (vs 323): `binding-writers` owner 9,
 * `test-token-guards` boundary-reach 128, `urlkey-lookups` 128,
 * `off-session-readers` 128, `workspace-edge-writers` 128,
 * `raw-accesstoken-writers` 128, `held-marker-emitters` caller==importer
 * (6 callers / 3 importers). The 128-reach surfaces do NOT separate at module
 * granularity — their separating axis is the per-occurrence function-shape rule;
 * this is stated rather than papered over.
 *
 * Run with: node --test tests/unit/lin-3124-pr1-count-pins.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadRawSources, loadStrippedSources } from '../fixtures/connection-access-guards.js';
import { buildImportGraph } from './lib/import-graph.js';

const RAW = loadRawSources();
const REAL = loadStrippedSources();

function total(sources, re) {
  let n = 0;
  for (const src of sources.values()) n += (src.match(re) || []).length;
  return n;
}

function withLine(sources, rel, line) {
  const m = new Map(sources);
  m.set(rel, `${m.get(rel)}\n${line}\n`);
  return m;
}

/** Remove the first line matching `re` (optionally only from files passing `fileRe`). */
function withoutFirstMatch(sources, re, fileRe = null) {
  const m = new Map(sources);
  for (const [rel, src] of m) {
    if (fileRe && !fileRe.test(rel)) continue;
    const lines = src.split('\n');
    const idx = lines.findIndex(l => re.test(l));
    if (idx !== -1) {
      lines.splice(idx, 1);
      m.set(rel, lines.join('\n'));
      return m;
    }
  }
  throw new Error('plant: pattern not found to remove');
}

// ---------------------------------------------------------------------------
// Count functions (the scanners, kept as auxiliary sensitivity checks)
// ---------------------------------------------------------------------------

const countTestTokenGuards = (s) => total(s, /accessToken === 'test-token'/g);
const countUrlKeyLookups = (s) => total(s, /w\??\.urlKey === urlKey/g);

function countProviderAuthEdges(sources) {
  let n = 0;
  for (const [rel, src] of sources) {
    if (!/^lib\/providers\/[^/]+\/index\.js$/.test(rel)) continue;
    n += (src.match(/^import .*routes\/[a-z-]*auth/gm) || []).length;
  }
  return n;
}

function countOffSessionReaders(sources) {
  const m = new Map(sources);
  m.delete('lib/workspace-token-resolver.js');
  return total(m, /(selectOwnerWorkspaceToken|selectOwnerWorkspaceRow|selectExpiredOwnerRow|selectOwnerSessionRow|selectAllOwnerSessionRows)\(/g);
}

function countBindingWriters(sources) {
  let link = 0;
  let upsert = 0;
  for (const src of sources.values()) {
    for (const line of src.split('\n')) {
      if (!/function\s+linkProvider/.test(line) && /(^|[^a-zA-Z])linkProvider\(/.test(line)) link++;
      if (!/function\s+upsertWorkspace/.test(line) && /(^|[^a-zA-Z])upsertWorkspace\(/.test(line)) upsert++;
    }
  }
  return { link, upsert, total: link + upsert };
}

const countRawAccessTokenWriters = (s) => total(s, /\.accessToken *=[^=]/g);

function countWorkspaceEdgeWriters(sources) {
  let n = 0;
  for (const src of sources.values()) {
    for (const line of src.split('\n')) {
      if (!/function\s+bindAccountToWorkspace/.test(line) && !/async\s+bindAccountToWorkspace/.test(line) && /(^|[^a-zA-Z])bindAccountToWorkspace\(/.test(line)) n++;
    }
  }
  return n;
}

function countHeldMarkerEmitters(sources) {
  let n = 0;
  for (const src of sources.values()) {
    for (const line of src.split('\n')) {
      if (!/function\s+withHeldMarker/.test(line) && /(^|[^.\w])withHeldMarker\(/.test(line)) n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Occurrence helpers
// ---------------------------------------------------------------------------

/** The set of files in a source map containing a match of `re`. */
function filesMatching(sources, re) {
  const out = new Set();
  const stateless = new RegExp(re.source, re.flags.replace('g', ''));
  for (const [rel, src] of sources) if (stateless.test(src)) out.add(rel);
  return [...out].sort();
}

/** Brace nesting depth at `offset`, ignoring comments and string/template literals. */
function braceDepthAt(source, offset) {
  let depth = 0;
  let i = 0;
  while (i < offset) {
    const c = source[i];
    if (c === '\n') { i++; continue; }
    if (c === '/' && source[i + 1] === '/') { while (i < offset && source[i] !== '\n') i++; continue; }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < offset && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < offset && source[i] !== q) { if (source[i] === '\\') i++; i++; }
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return depth;
}

/**
 * Every match of `re`, as `{ rel, index, line, lineIndex, depth, src }`.
 * Comment lines and `excludeLine`/`excludeFiles` matches are skipped, so the
 * shape checks see call sites, not prose or the symbol's own definition.
 */
function scanSites(sources, re, { excludeFiles = [], excludeLine = null } = {}) {
  const out = [];
  for (const [rel, src] of sources) {
    if (excludeFiles.includes(rel)) continue;
    const st = new RegExp(re.source, 'g');
    let m;
    while ((m = st.exec(src))) {
      const lineStart = src.lastIndexOf('\n', m.index - 1) + 1;
      let lineEnd = src.indexOf('\n', m.index);
      if (lineEnd === -1) lineEnd = src.length;
      const line = src.slice(lineStart, lineEnd);
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      if (excludeLine && excludeLine.test(line)) continue;
      out.push({
        rel,
        index: m.index,
        line,
        lineIndex: src.slice(0, lineStart).split('\n').length - 1,
        depth: braceDepthAt(src, m.index),
        src,
      });
    }
  }
  return out;
}

/** The test-token short-circuit is only legitimate gated by NODE_ENV === 'test'. */
function nodeEnvGated(site) {
  const lines = site.src.split('\n');
  const cur = lines[site.lineIndex] || '';
  const prev = lines[site.lineIndex - 1] || '';
  return /process\.env\.NODE_ENV === 'test'/.test(cur) || /process\.env\.NODE_ENV === 'test'/.test(prev);
}

/** A raw `.accessToken =` write must be accompanied by its `.tokenExpiresAt =`. */
function expiryPaired(site) {
  const lines = site.src.split('\n');
  const win = lines.slice(site.lineIndex, site.lineIndex + 8).join('\n');
  return /\.tokenExpiresAt\s*=/.test(win);
}

/**
 * EXPLICITLY DERIVED owner set: the defining module(s) of `symbols` plus the
 * modules that directly import any of them. No hand-listed allowlist.
 */
function derivedOwnerSet(graph, symbols) {
  const owner = new Set();
  for (const sym of symbols) {
    for (const imp of graph.directImportersOf(sym)) owner.add(imp);
    for (const p of graph.paths()) if (graph.exportedNamesOf(p).includes(sym)) owner.add(p);
  }
  return owner;
}

// ---------------------------------------------------------------------------
// Relations (each returns the list of offenders; empty when clean)
// ---------------------------------------------------------------------------

/**
 * Derived-set equality: the modules that CALL the surface symbols equal the
 * modules that IMPORT them. Used where the scanner matches the boundary symbol
 * itself (a `reaches` boundary would be vacuous). `definers` are excluded from
 * the caller set (a defining module legitimately holds the symbol without
 * importing it). Both directions offend.
 */
function callerImporterOffenders(sources, re, symbols, definers = [], graph = buildImportGraph(sources)) {
  const callers = filesMatching(sources, re).filter((f) => !definers.includes(f)).sort();
  const importers = [...new Set(symbols.flatMap((sym) => graph.directImportersOf(sym)))].sort();
  const v = [];
  for (const f of callers) if (!importers.includes(f)) v.push(`${f}: calls ${symbols.join('|')} but does not import it`);
  for (const f of importers) if (!callers.includes(f)) v.push(`${f}: imports ${symbols.join('|')} but does not call it`);
  return v;
}

// ---------------------------------------------------------------------------
// The surfaces
// ---------------------------------------------------------------------------

const ACCOUNT_SURFACE = ['AccountStore', 'AccountWorkspaceStore', 'establishAccount', 'linkProvider', 'upsertWorkspace', 'getWorkspaceCallScope'];

const PINS = [
  {
    id: 'test-token-guards',
    label: "accessToken === 'test-token' guards",
    sources: RAW,
    re: /accessToken === 'test-token'/g,
    relation: 'boundary',
    surface: ['linkProvider'],
    shape: 'nodeEnv',
    plant: "const g = w.accessToken === 'test-token';\n",
    count: countTestTokenGuards,
    plus: (s) => countTestTokenGuards(withLine(s, 'lib/workspace.js', "const g = ws.accessToken === 'test-token';")),
    minus: (s) => countTestTokenGuards(withoutFirstMatch(s, /accessToken === 'test-token'/)),
  },
  {
    id: 'urlkey-lookups',
    label: 'hand-rolled `w.urlKey === urlKey` lookups',
    sources: REAL,
    re: /w\??\.urlKey === urlKey/g,
    relation: 'boundary',
    surface: ['getWorkspaceCallScope'],
    plant: 'if (w.urlKey === urlKey) {}\n',
    count: countUrlKeyLookups,
    plus: (s) => countUrlKeyLookups(withLine(s, 'lib/workspace.js', 'if (w.urlKey === urlKey) {}')),
    minus: (s) => countUrlKeyLookups(withoutFirstMatch(s, /w\??\.urlKey === urlKey/)),
  },
  {
    id: 'provider-auth-edges',
    label: 'upward provider index.js -> routes/*-auth import edges (LIN-675)',
    sources: REAL,
    re: /^import .*routes\/[a-z-]*auth/gm,
    relation: 'providerAuth', // derived-set equality, handled in its own describe
    surface: null,
    count: countProviderAuthEdges,
    plus: (s) => countProviderAuthEdges(withLine(s, 'lib/providers/local/index.js', "import '../routes/auth.js';")),
    minus: (s) => countProviderAuthEdges(withoutFirstMatch(s, /^import .*routes\/[a-z-]*auth/, /^lib\/providers\/[^/]+\/index\.js$/)),
  },
  {
    id: 'off-session-readers',
    // scanner matches owner-session selector CALLS; the definer file is excluded
    // (its own definitions are not readers). Occurrence-level relation: the
    // module must reach the credential entry AND the call must be inside a body.
    label: 'off-session raw-session credential readers',
    sources: REAL,
    re: /(selectOwnerWorkspaceToken|selectOwnerWorkspaceRow|selectExpiredOwnerRow|selectOwnerSessionRow|selectAllOwnerSessionRows)\(/g,
    relation: 'boundary',
    surface: ['linkProvider'],
    excludeFiles: ['lib/workspace-token-resolver.js'],
    plant: 'const r = selectOwnerSessionRow(s, u, o);\n',
    count: countOffSessionReaders,
    plus: (s) => countOffSessionReaders(withLine(s, 'lib/workspace.js', 'const r = selectOwnerSessionRow(s, u, o);')),
    minus: (s) => countOffSessionReaders(withoutFirstMatch(s, /select(OwnerSessionRow|OwnerWorkspaceRow|ExpiredOwnerRow|OwnerWorkspaceToken|AllOwnerSessionRows)\(/, /^(?!lib\/workspace-token-resolver\.js).*/)),
  },
  {
    id: 'binding-writers',
    // scanner matches linkProvider/upsertWorkspace CALLS. Owner set = the
    // defining module (lib/workspace.js) plus direct importers; the definer's
    // own legitimate calls are the reason the occurrence also has to sit in a
    // function body (a fresh top-level call there must still fail).
    label: 'binding writers (linkProvider + upsertWorkspace)',
    sources: REAL,
    re: /(^|[^a-zA-Z])(linkProvider|upsertWorkspace)\(/g,
    relation: 'owner',
    ownerSymbols: ['linkProvider', 'upsertWorkspace'],
    excludeLine: /function\s+(linkProvider|upsertWorkspace)/,
    plant: "linkProvider(ws, 'x', 'y', {});\n",
    count: countBindingWriters,
    plus: (s) => countBindingWriters(withLine(withLine(s, 'lib/workspace.js', "linkProvider(ws, 'x', 'y', {});"), 'lib/workspace.js', 'upsertWorkspace(sess, w);')),
    minus: (s) => countBindingWriters(withoutFirstMatch(s, /(^|[^a-zA-Z])linkProvider\(/, /^(?!lib\/workspace\.js).*/)),
  },
  {
    id: 'workspace-edge-writers',
    // scanner matches bindAccountToWorkspace CALLS; the method definition is
    // excluded. Occurrence-level relation: the module must reach the account
    // set AND the call must be inside a body.
    label: 'account<->workspace edge writers (bindAccountToWorkspace)',
    sources: REAL,
    re: /(^|[^a-zA-Z])bindAccountToWorkspace\(/g,
    relation: 'boundary',
    surface: ACCOUNT_SURFACE,
    excludeLine: /(function|async)\s+bindAccountToWorkspace/,
    plant: "await accountWorkspaceStore.bindAccountToWorkspace('a', 'w');\n",
    count: countWorkspaceEdgeWriters,
    plus: (s) => countWorkspaceEdgeWriters(withLine(s, 'lib/workspace.js', "await accountWorkspaceStore.bindAccountToWorkspace('a', 'w');")),
    minus: (s) => countWorkspaceEdgeWriters(withoutFirstMatch(s, /(^|[^a-zA-Z])bindAccountToWorkspace\(/, /^(?!lib\/account-workspace-store\.js).*/)),
  },
  {
    id: 'raw-accesstoken-writers',
    // scanner matches raw `.accessToken =` writes. Occurrence-level relation:
    // the module must reach the credential entry, the write must be inside a
    // body, AND it must carry its `.tokenExpiresAt =` mirror companion.
    label: 'raw .accessToken assignments',
    sources: REAL,
    re: /\.accessToken *=[^=]/g,
    relation: 'boundary',
    surface: ['getWorkspaceCallScope'],
    shape: 'expiryPair',
    plant: "ws.accessToken = 'x';\n",
    count: countRawAccessTokenWriters,
    plus: (s) => countRawAccessTokenWriters(withLine(s, 'lib/workspace.js', "ws.accessToken = 'x';")),
    minus: (s) => countRawAccessTokenWriters(withoutFirstMatch(s, /\.accessToken *=[^=]/)),
  },
  {
    id: 'held-marker-emitters',
    // scanner matches withHeldMarker CALLS (the boundary symbol itself), so a
    // `reaches` boundary would be vacuous; use caller==importer equality instead.
    label: 'explicit held-entry marker emitters (LIN-3125 F1)',
    sources: REAL,
    re: /(^|[^.\w])withHeldMarker\(/g,
    relation: 'callerImporter',
    surface: ['withHeldMarker'],
    definers: ['lib/held-connection-entry.js'],
    plant: "const u = withHeldMarker('/auth/github', p);\n",
    count: countHeldMarkerEmitters,
    plus: (s) => countHeldMarkerEmitters(withLine(s, 'lib/workspace.js', "const u = withHeldMarker('/auth/github', p);")),
    minus: (s) => countHeldMarkerEmitters(withoutFirstMatch(s, /(^|[^.\w])withHeldMarker\(/, /^(?!lib\/held-connection-entry\.js).*/)),
  },
];

/** Run a pin's relation over a source map (the thing the live test + witnesses assert on). */
function relationOffenders(pin, sources) {
  const graph = buildImportGraph(sources);
  if (pin.relation === 'providerAuth') return [];
  if (pin.relation === 'callerImporter') return callerImporterOffenders(sources, pin.re, pin.surface, pin.definers || [], graph);
  const owner = pin.relation === 'owner' ? derivedOwnerSet(graph, pin.ownerSymbols) : null;
  const out = [];
  for (const s of scanSites(sources, pin.re, pin)) {
    if (pin.relation === 'owner') {
      if (!owner.has(s.rel)) out.push(`${s.rel}: module outside the ${pin.ownerSymbols.join('|')} derived owner set`);
    } else if (pin.surface) {
      if (!pin.surface.some((sym) => graph.reaches(s.rel, sym))) out.push(`${s.rel}: site outside the ${pin.surface.join('|')} credential boundary`);
    }
    if (s.depth === 0) out.push(`${s.rel}: occurrence at module top level (not inside a function body)`);
    if (pin.shape === 'nodeEnv' && !nodeEnvGated(s)) out.push(`${s.rel}: test-token guard not gated by process.env.NODE_ENV === 'test'`);
    if (pin.shape === 'expiryPair' && !expiryPaired(s)) out.push(`${s.rel}: .accessToken write without its .tokenExpiresAt companion`);
  }
  return out;
}

describe('LIN-3124 PR1 T5 — credential-surface boundary relations (LIN-3219 A3)', () => {
  for (const pin of PINS) {
    test(`pin ${pin.id}: every ${pin.label} site satisfies the ${pin.relation} relation`, () => {
      const files = filesMatching(pin.sources, pin.re);
      assert.ok(files.length > 0, `${pin.id}: a zero-finding scan would be vacuous`);
      const base = pin.count(pin.sources);
      assert.ok((typeof base === 'number' ? base : base.total) > 0, `${pin.id}: the scanner must find at least one site`);
      assert.deepEqual(relationOffenders(pin, pin.sources), [], `${pin.id}: relation offenders`);
    });

    if (pin.relation !== 'providerAuth') {
      test(`pin ${pin.id}: WITNESS — a planted new ${pin.label} site inside an already-reached module fails it`, () => {
        // Planted INSIDE a module that reaches the credential entry (the old
        // module-level rule's weak point) and at module top level, exactly the
        // reviewer's +1 shapes. The live assertion function must report it.
        const planted = withLine(pin.sources, 'lib/workspace.js', pin.plant);
        const off = relationOffenders(pin, planted);
        assert.ok(
          off.some((m) => m.startsWith('lib/workspace.js')),
          `${pin.id}: the planted top-level site in an already-reached module must fail, got ${JSON.stringify(off)}`
        );
      });
    }

    test(`pin ${pin.id}: the scanner moves on a planted +1 site (auxiliary sensitivity)`, () => {
      assert.notDeepEqual(pin.plus(pin.sources), pin.count(pin.sources), `${pin.id} +1 plant did not move the scanner`);
    });

    test(`pin ${pin.id}: the scanner moves on a planted −1 site (auxiliary sensitivity)`, () => {
      assert.notDeepEqual(pin.minus(pin.sources), pin.count(pin.sources), `${pin.id} −1 plant did not move the scanner`);
    });
  }

  // The −1 relation witness exists where the relation is caller==importer
  // (removing a call while its import remains MUST fail). For the boundary
  // surfaces a removed site is not relation-expressible without a count: the
  // relation guards which occurrences are allowed, not how many a module holds.
  // What covers removal there: the auxiliary sensitivity test above (the
  // scanner moves) plus the `> 0` floor (emptying the class fails).
  test('pin binding-writers: WITNESS — the upsertWorkspace baseline half also fails the relation', () => {
    // The plan's "9 baselines" counts this row as TWO baselines (linkProvider,
    // upsertWorkspace; `total` is derived). The generic witness plants a
    // linkProvider site; this one plants the upsertWorkspace half.
    const pin = PINS.find((p) => p.id === 'binding-writers');
    const planted = withLine(pin.sources, 'lib/workspace.js', 'upsertWorkspace(sess, w);\n');
    const off = relationOffenders(pin, planted);
    assert.ok(off.some((m) => m.startsWith('lib/workspace.js')), `expected the upsert plant, got ${JSON.stringify(off)}`);
  });

  test('pin held-marker-emitters: WITNESS — a removed call with its import left behind fails', () => {
    const pin = PINS.find((p) => p.id === 'held-marker-emitters');
    const rel = 'lib/render-settings.js';
    const planted = new Map(pin.sources);
    planted.set(rel, planted.get(rel).replaceAll('withHeldMarker(', 'notHeldMarker('));
    const off = callerImporterOffenders(planted, pin.re, pin.surface, pin.definers, buildImportGraph(planted));
    assert.ok(off.some((m) => m.includes(rel) && m.includes('imports')), `expected an import-without-call offender for ${rel}, got ${JSON.stringify(off)}`);
  });
});

describe('LIN-3124 PR1 T5 — provider-auth edges: derived-set equality (regex vs import-graph)', () => {
  const providerFiles = () => [...RAW.keys()].filter((f) => /^lib\/providers\/[^/]+\/index\.js$/.test(f)).sort();
  const regexEdge = (src) => /^import .*routes\/[a-z-]*auth/m.test(src);
  const graphEdge = (g, f) => g.importsOf(f).some((r) => r.resolved && /^routes\/[a-z-]*auth\.js$/.test(r.resolved));

  test('the set of provider index.js files with a routes/*-auth edge is the same textually and via the import graph', () => {
    const textual = providerFiles().filter((f) => regexEdge(RAW.get(f))).sort();
    const derived = providerFiles().filter((f) => graphEdge(buildImportGraph(RAW), f)).sort();
    assert.ok(derived.length > 0, 'a zero-edge derivation would be vacuous');
    assert.deepEqual(textual, derived, 'the textual and import-graph provider->auth edge sets must agree');
  });

  test('WITNESS: a DYNAMIC provider -> routes/*-auth import is caught by the graph and missed by the regex', () => {
    // The reviewer's LIN-3232 failure mode: `await import('../routes/x-auth.js')`
    // in a provider index.js. The source regex requires a static `^import `, so
    // it misses the edge; the (extended) import graph sees it — the derived-set
    // equality therefore fails, which is the catch.
    const fake = 'lib/providers/fake/index.js';
    const modules = new Map([...RAW, [fake, "export async function build() { return (await import('../../../routes/fake-auth.js')).x; }\n"]]);
    const g = buildImportGraph(modules);
    assert.equal(regexEdge(modules.get(fake)), false, 'the static regex must not see a dynamic import');
    assert.equal(graphEdge(g, fake), true, 'the import graph must see the dynamic provider->auth edge');
    const textual = [fake].filter((f) => regexEdge(modules.get(f))).sort();
    const derived = [fake].filter((f) => graphEdge(g, f)).sort();
    assert.notDeepEqual(textual, derived, 'the derived-set equality must fail on the dynamic edge');
  });
});
