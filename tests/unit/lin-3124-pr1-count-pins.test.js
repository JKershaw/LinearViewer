/**
 * LIN-3124 PR1 (G) — credential-surface boundary relations (T5).
 *
 * LIN-3219 A3 (LIN-3201 M19), re-review fix (LIN-3219 comment `dfa3e1c3`): the
 * first A3 attempt used a `reaches(<credential entry>)` module boundary
 * (128–132/323 modules). The second attempt replaced it with per-occurrence /
 * owner-set relations, but three of those still admitted a fresh site in a
 * module that is in the derived region yet makes no call today (P2/P3/P4). This
 * version narrows those three surfaces to the reviewer's sanctioned **caller
 * roster**: a derived-set equality between the modules that CONTAIN a call
 * occurrence and the frozen permitted caller set (the live call sites). A new
 * module is rejected; a permitted caller that drops its call is rejected. The
 * only accepted residual is a new call inside a module that ALREADY holds a call
 * (the reviewer's ruling on binding-writers).
 *
 * Relation kinds:
 *   - `roster` (binding-writers, off-session-readers, workspace-edge-writers):
 *     call-site module set == the frozen permitted caller roster. These are the
 *     surfaces whose entry is a class method / a DI-injected function, so there
 *     is no independent import-based signal (the callers receive the symbol by
 *     injection); the count's exact bound is restored as a caller roster.
 *   - `boundary` (urlkey-lookups, raw-accesstoken-writers): module reaches the
 *     credential entry + occurrence inside a function body (+ shape).
 *   - `shape` per occurrence: `test-token-guards` NODE_ENV gate;
 *     `raw-accesstoken-writers` `.tokenExpiresAt` companion; `urlkey-lookups`
 *     lookup shape.
 *   - `callerImporter` (held-marker-emitters): callers == importers.
 *   - `providerAuth`: source regex edge set == dynamic-aware import-graph edge set.
 *
 * Permitted-set sizes (vs 323): binding-writers roster 8, off-session-readers
 * roster 5, workspace-edge-writers roster 4, test-token-guards reach 128,
 * urlkey-lookups reach 128, raw-accesstoken-writers reach 128,
 * held-marker-emitters 6 callers / 3 importers.
 *
 * RESIDUALS (plan rev 4 §Strategy option (3), stated exactly):
 *   - binding-writers: a new linkProvider/upsertWorkspace call inside one of the
 *     8 permitted caller modules (lib/github-install-flow.js, lib/pat-session.js,
 *     lib/workspace.js, routes/account-merge.js, routes/auth.js,
 *     routes/held-connection.js, routes/jira-auth.js, routes/workspace.js) is
 *     permitted. Owner modules with NO current call (server.js, …) are NOT — P4
 *     is red.
 *   - off-session-readers: a new selector call inside one of the 5 permitted
 *     caller modules (lib/connection-access.js, lib/connection-credential.js,
 *     lib/superseded-selection.js, lib/workspace-title-resolver.js,
 *     lib/workspace-token-refresh.js) is permitted.
 *   - workspace-edge-writers: a new bindAccountToWorkspace call inside one of the
 *     4 permitted caller modules (lib/account-session.js, lib/account-store.js,
 *     routes/account-merge.js, routes/held-connection.js) is permitted.
 *   - urlkey-lookups: a fresh `.find/.map/for`-shaped lookup in any module that
 *     reaches `getWorkspaceCallScope` is permitted; a bare comparison is not.
 *   - test-token-guards: a fresh NODE_ENV-gated guard in any reached module is
 *     permitted; an ungated guard is not.
 *   - raw-accesstoken-writers: a fresh `.accessToken =` paired with
 *     `.tokenExpiresAt =` in any reached module is permitted; an unpaired write
 *     is not.
 *   - held-marker-emitters: a fresh call inside an existing importer is permitted;
 *     a call in a non-importer is not.
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

/** Append an in-function offender (a fresh `function zz() { … }`) to `rel`. */
function withFunction(sources, rel, line) {
  const m = new Map(sources);
  m.set(rel, `${m.get(rel)}\nfunction zz() {\n  ${line.trim()}\n}\n`);
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

/** The nearest preceding line at lower indentation that opens a block. */
function enclosingBlockOpener(site) {
  const lines = site.src.split('\n');
  const indentOf = (s) => { const m = s.match(/^[ \t]*/); return m ? m[0].length : 0; };
  const k = indentOf(lines[site.lineIndex] || '');
  for (let j = site.lineIndex - 1; j >= 0; j--) {
    if (indentOf(lines[j]) < k && /[{(]\s*$/.test(lines[j].trim())) return lines[j];
  }
  return null;
}

/**
 * A hand-rolled `w.urlKey === urlKey` comparison is only a workspace *lookup*
 * when it sits in a `.find`/`.findIndex`/`.map`/`.some`/`.filter` callback (on
 * the same statement line) or inside a `for (...)` loop. A bare comparison in
 * an arbitrary function is the class this surface bounds.
 */
function lookupShaped(site) {
  if (/\.(find|findIndex|map|some|filter)\(/.test(site.line)) return true;
  const opener = enclosingBlockOpener(site);
  return opener ? /\.(find|findIndex|map|some|filter)\(|for\s*\(/.test(opener) : false;
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

/**
 * Derived-set equality between the modules that CONTAIN a call occurrence and
 * the frozen permitted caller roster. A new module with a call is an offender;
 * a permitted caller whose call disappeared is an offender. This is the count's
 * exact bound restored as a caller roster (the reviewer's `dfa3e1c3` fix for the
 * surfaces whose entry is a class method / a DI-injected function, where there
 * is no independent import-based signal).
 */
function rosterOffenders(sources, re, permitted, opts = {}) {
  const callers = [...new Set(scanSites(sources, re, opts).map((s) => s.rel))].sort();
  const expected = [...permitted].sort();
  const v = [];
  for (const f of callers) if (!expected.includes(f)) v.push(`${f}: call site outside the permitted caller roster ${JSON.stringify(expected)}`);
  for (const f of expected) if (!callers.includes(f)) v.push(`${f}: permitted caller no longer holds a call`);
  return v;
}

// ---------------------------------------------------------------------------
// The surfaces
// ---------------------------------------------------------------------------

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
    shape: 'lookup',
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
    // (its own definitions are not readers). The callers receive the selectors by
    // injection (connection-access / connection-credential), so there is no
    // import-based signal: the relation is a caller roster derived from the live
    // call sites. A fresh call in ANY other module is rejected (P3: server.js).
    label: 'off-session raw-session credential readers',
    sources: REAL,
    re: /(selectOwnerWorkspaceToken|selectOwnerWorkspaceRow|selectExpiredOwnerRow|selectOwnerSessionRow|selectAllOwnerSessionRows)\(/g,
    relation: 'roster',
    permitted: [
      'lib/connection-access.js',
      'lib/connection-credential.js',
      'lib/superseded-selection.js',
      'lib/workspace-title-resolver.js',
      'lib/workspace-token-refresh.js',
    ],
    excludeFiles: ['lib/workspace-token-resolver.js'],
    witnessModule: 'server.js',
    plant: 'const r = selectOwnerSessionRow(s, u, o);\n',
    count: countOffSessionReaders,
    plus: (s) => countOffSessionReaders(withLine(s, 'lib/workspace.js', 'const r = selectOwnerSessionRow(s, u, o);')),
    minus: (s) => countOffSessionReaders(withoutFirstMatch(s, /select(OwnerSessionRow|OwnerWorkspaceRow|ExpiredOwnerRow|OwnerWorkspaceToken|AllOwnerSessionRows)\(/, /^(?!lib\/workspace-token-resolver\.js).*/)),
  },
  {
    id: 'binding-writers',
    // scanner matches linkProvider/upsertWorkspace CALLS. Caller roster derived
    // from the live call sites. RESIDUAL (reviewer's ruling): a new call inside
    // one of these 8 modules is permitted; a call in any other module — including
    // server.js, an importer/owner with NO call today (P4) — is rejected.
    label: 'binding writers (linkProvider + upsertWorkspace)',
    sources: REAL,
    re: /(^|[^a-zA-Z])(linkProvider|upsertWorkspace)\(/g,
    relation: 'roster',
    permitted: [
      'lib/github-install-flow.js',
      'lib/pat-session.js',
      'lib/workspace.js',
      'routes/account-merge.js',
      'routes/auth.js',
      'routes/held-connection.js',
      'routes/jira-auth.js',
      'routes/workspace.js',
    ],
    excludeLine: /function\s+(linkProvider|upsertWorkspace)/,
    witnessModule: 'server.js',
    plant: "linkProvider(ws, 'x', 'y', {});\n",
    count: countBindingWriters,
    plus: (s) => countBindingWriters(withLine(withLine(s, 'lib/workspace.js', "linkProvider(ws, 'x', 'y', {});"), 'lib/workspace.js', 'upsertWorkspace(sess, w);')),
    minus: (s) => countBindingWriters(withoutFirstMatch(s, /(^|[^a-zA-Z])linkProvider\(/, /^(?!lib\/workspace\.js).*/)),
  },
  {
    id: 'workspace-edge-writers',
    // scanner matches bindAccountToWorkspace CALLS; the method definition is
    // excluded. The callers receive `accountWorkspaceStore` by injection, so the
    // relation is a caller roster derived from the live call sites. A fresh call
    // in any other module is rejected (P2: routes/email-auth.js, routes/test.js).
    label: 'account<->workspace edge writers (bindAccountToWorkspace)',
    sources: REAL,
    re: /(^|[^a-zA-Z])bindAccountToWorkspace\(/g,
    relation: 'roster',
    permitted: [
      'lib/account-session.js',
      'lib/account-store.js',
      'routes/account-merge.js',
      'routes/held-connection.js',
    ],
    excludeLine: /(function|async)\s+bindAccountToWorkspace/,
    witnessModule: 'routes/email-auth.js',
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
  if (pin.relation === 'roster') {
    const out = rosterOffenders(sources, pin.re, pin.permitted, pin);
    for (const s of scanSites(sources, pin.re, pin)) {
      if (s.depth === 0) out.push(`${s.rel}: occurrence at module top level (not inside a function body)`);
    }
    return out;
  }
  const out = [];
  for (const s of scanSites(sources, pin.re, pin)) {
    if (pin.surface && !pin.surface.some((sym) => graph.reaches(s.rel, sym))) {
      out.push(`${s.rel}: site outside the ${pin.surface.join('|')} credential boundary`);
    }
    if (s.depth === 0) out.push(`${s.rel}: occurrence at module top level (not inside a function body)`);
    if (pin.shape === 'nodeEnv' && !nodeEnvGated(s)) out.push(`${s.rel}: test-token guard not gated by process.env.NODE_ENV === 'test'`);
    if (pin.shape === 'expiryPair' && !expiryPaired(s)) out.push(`${s.rel}: .accessToken write without its .tokenExpiresAt companion`);
    if (pin.shape === 'lookup' && !lookupShaped(s)) out.push(`${s.rel}: urlKey comparison is not part of a workspace lookup`);
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
      const witnessModule = pin.witnessModule || 'lib/workspace.js';
      test(`pin ${pin.id}: WITNESS — a planted new ${pin.label} site inside an already-reached module fails it`, () => {
        // Planted INSIDE a module that already holds a credential path (the old
        // module-level rule's weak point) and at module top level. The live
        // assertion function must report it.
        const planted = withLine(pin.sources, witnessModule, pin.plant);
        const off = relationOffenders(pin, planted);
        assert.ok(
          off.some((m) => m.startsWith(witnessModule)),
          `${pin.id}: the planted top-level site in ${witnessModule} must fail, got ${JSON.stringify(off)}`
        );
      });

      test(`pin ${pin.id}: WITNESS — a planted IN-FUNCTION new ${pin.label} site fails it`, () => {
        // The red must not come purely from the plant being at module top level.
        // This plants the same line inside a fresh `function zz() { … }`.
        const planted = withFunction(pin.sources, witnessModule, pin.plant);
        const off = relationOffenders(pin, planted);
        assert.ok(
          off.some((m) => m.startsWith(witnessModule)),
          `${pin.id}: the planted in-function site in ${witnessModule} must fail, got ${JSON.stringify(off)}`
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

  test('pin binding-writers: RESIDUAL (stated bound) — a fresh IN-FUNCTION call inside a permitted caller is permitted', () => {
    // Reviewer ruling (`dfa3e1c3`): a new binding-write inside an owner module
    // that ALREADY holds binding writes is accepted. The permitted roster is the
    // 8 live caller modules; lib/workspace.js is one. An in-function call there
    // is not caught; a top-level one is (the depth check), and a call in any
    // non-roster module — including server.js (owner, no call) — is caught.
    const pin = PINS.find((p) => p.id === 'binding-writers');
    const planted = withFunction(pin.sources, 'lib/workspace.js', "linkProvider(ws, 'x', 'y', {});");
    assert.deepEqual(relationOffenders(pin, planted), [], 'a fresh in-function call inside a permitted caller is not caught (stated residual)');
  });

  test('pin binding-writers: RESIDUAL boundary — a call in server.js (owner, no live call) IS caught', () => {
    const pin = PINS.find((p) => p.id === 'binding-writers');
    const planted = withFunction(pin.sources, 'server.js', "linkProvider(ws, 'x', 'y', {});");
    assert.ok(relationOffenders(pin, planted).some((m) => m.startsWith('server.js')), 'server.js is not a permitted caller');
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
