/**
 * LIN-3124 PR1 (G) — credential-surface boundary relations (T5).
 *
 * LIN-3219 A3 (LIN-3201 M19): the nine hardcoded `expected` baselines are gone.
 * Each surface is guarded by a RELATION that can FAIL, with an in-test planted
 * offender per surface proving it is not vacuous. The scanner-moves checks are
 * kept only as auxiliary sensitivity tests (they are not the witnesses).
 *
 * Relation kinds (plan rev 4 §Strategy option (1)/(2)):
 *   - `boundary`: every site of the surface lies in a module that reaches the
 *     surface's credential entry through the import graph (`reaches`). The entry
 *     symbol is deliberately DIFFERENT from what the scanner matches, so a
 *     planted site in a module that does not import the credential path fails.
 *   - `callerImporter`: derived-set equality between the modules that CALL the
 *     symbols and the modules that IMPORT them (via `directImportersOf`). Used
 *     for `held-marker-emitters`, whose scanner matches its boundary symbol
 *     itself (a `reaches` boundary would be vacuous there).
 *   - `provider-auth-edges` is import-edge-shaped: a true derived-set equality
 *     between the source regex edge set and the (dynamic-aware) import-graph
 *     edge set, with a dynamic `import()` witness.
 *
 * Run with: node --test tests/unit/lin-3124-pr1-count-pins.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadRawSources, loadStrippedSources } from '../fixtures/connection-access-guards.js';
import { buildImportGraph } from './lib/import-graph.js';

const RAW = loadRawSources();
const REAL = loadStrippedSources();
const GRAPH = buildImportGraph(RAW);

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
// Count functions (the scanners)
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
// Relations (each returns the list of offenders; empty when clean)
// ---------------------------------------------------------------------------

/** The set of files in a source map containing a match of `re`. */
function filesMatching(sources, re) {
  const out = new Set();
  const stateless = new RegExp(re.source, re.flags.replace('g', ''));
  for (const [rel, src] of sources) if (stateless.test(src)) out.add(rel);
  return [...out].sort();
}

/**
 * Boundary rule: every site module must reach one of the surface's credential
 * entry symbols. `symbols` are DELIBERATELY not the symbols the scanner matches,
 * so the relation is falsifiable: a planted site in a module that does not
 * import the credential path fails.
 */
function boundaryOffenders(sources, re, symbols, graph = buildImportGraph(sources)) {
  return filesMatching(sources, re)
    .filter((f) => !symbols.some((sym) => graph.reaches(f, sym)))
    .map((f) => `${f}: site outside the ${symbols.join('|')} credential boundary`);
}

/**
 * Derived-set equality: the modules that CALL the surface symbols equal the
 * modules that IMPORT them. Used where the scanner matches the boundary symbol
 * itself (a `reaches` boundary would be vacuous). `definers` are excluded from
 * the caller set (a defining module legitimately holds the symbol without
 * importing it). Both directions offend: a caller without an import, and an
 * import without a caller.
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

const PINS = [
  {
    id: 'test-token-guards',
    label: "accessToken === 'test-token' guards",
    sources: RAW,
    re: /accessToken === 'test-token'/g,
    relation: 'boundary',
    // scanner matches a property comparison; boundary entry is the credential
    // entry symbol — different symbol, so the relation is falsifiable.
    surface: ['linkProvider'],
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
    // scanner matches owner-session selector CALLS; boundary entry is the
    // credential entry (different symbol), so a planted call in a module that
    // does not import the credential path fails.
    label: 'off-session raw-session credential readers',
    sources: REAL,
    re: /(selectOwnerWorkspaceToken|selectOwnerWorkspaceRow|selectExpiredOwnerRow|selectOwnerSessionRow|selectAllOwnerSessionRows)\(/g,
    relation: 'boundary',
    surface: ['linkProvider'],
    plant: 'const r = selectOwnerSessionRow(s, u, o);\n',
    count: countOffSessionReaders,
    plus: (s) => countOffSessionReaders(withLine(s, 'lib/workspace.js', 'const r = selectOwnerSessionRow(s, u, o);')),
    minus: (s) => countOffSessionReaders(withoutFirstMatch(s, /select(OwnerSessionRow|OwnerWorkspaceRow|ExpiredOwnerRow|OwnerWorkspaceToken|AllOwnerSessionRows)\(/, /^(?!lib\/workspace-token-resolver\.js).*/)),
  },
  {
    id: 'binding-writers',
    // scanner matches linkProvider/upsertWorkspace CALLS; boundary entry is the
    // account<->workspace edge writer (a different symbol the files reach), so
    // the relation is not the scanner's own symbol.
    label: 'binding writers (linkProvider + upsertWorkspace)',
    sources: REAL,
    re: /(^|[^a-zA-Z])(linkProvider|upsertWorkspace)\(/g,
    relation: 'boundary',
    surface: ['readBindingCredential'],
    plant: "linkProvider(ws, 'x', 'y', {});\n",
    count: countBindingWriters,
    plus: (s) => countBindingWriters(withLine(withLine(s, 'lib/workspace.js', "linkProvider(ws, 'x', 'y', {});"), 'lib/workspace.js', 'upsertWorkspace(sess, w);')),
    minus: (s) => countBindingWriters(withoutFirstMatch(s, /(^|[^a-zA-Z])linkProvider\(/, /^(?!lib\/workspace\.js).*/)),
  },
  {
    id: 'workspace-edge-writers',
    label: 'account<->workspace edge writers (bindAccountToWorkspace)',
    sources: REAL,
    re: /(^|[^a-zA-Z])bindAccountToWorkspace\(/g,
    relation: 'boundary',
    surface: ['AccountStore', 'AccountWorkspaceStore', 'establishAccount', 'linkProvider', 'upsertWorkspace', 'getWorkspaceCallScope'],
    plant: "await accountWorkspaceStore.bindAccountToWorkspace('a', 'w');\n",
    count: countWorkspaceEdgeWriters,
    plus: (s) => countWorkspaceEdgeWriters(withLine(s, 'lib/workspace.js', "await accountWorkspaceStore.bindAccountToWorkspace('a', 'w');")),
    minus: (s) => countWorkspaceEdgeWriters(withoutFirstMatch(s, /(^|[^a-zA-Z])bindAccountToWorkspace\(/, /^(?!lib\/account-workspace-store\.js).*/)),
  },
  {
    id: 'raw-accesstoken-writers',
    label: 'raw .accessToken assignments',
    sources: REAL,
    re: /\.accessToken *=[^=]/g,
    relation: 'boundary',
    surface: ['getWorkspaceCallScope'],
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

/** Run a pin's relation over a source map (the thing the witnesses assert on). */
function relationOffenders(pin, sources) {
  const graph = buildImportGraph(sources);
  if (pin.relation === 'boundary') return boundaryOffenders(sources, pin.re, pin.surface, graph);
  if (pin.relation === 'callerImporter') return callerImporterOffenders(sources, pin.re, pin.surface, pin.definers || [], graph);
  return [];
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
      test(`pin ${pin.id}: WITNESS — a planted new ${pin.label} site outside the relation fails it`, () => {
        const planted = new Map([...pin.sources, [`lib/zz-plant-${pin.id}.js`, pin.plant]]);
        const off = relationOffenders(pin, planted);
        assert.ok(off.length > 0, `${pin.id}: the planted offender must fail the relation, got none`);
        assert.ok(
          off.some((m) => m.includes(`lib/zz-plant-${pin.id}.js`)),
          `${pin.id}: expected lib/zz-plant-${pin.id}.js in the offenders, got ${JSON.stringify(off)}`
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
  // boundary guards which modules may hold a site, not how many each holds.
  // What covers removal there: the auxiliary sensitivity test above (the
  // scanner moves) plus the `> 0` floor (emptying the class fails). See notes
  // §17; plan rev 4 §Strategy option (3) (deletion only with a cited witness).
  test('pin binding-writers: WITNESS — the upsertWorkspace baseline half also fails the relation', () => {
    // The plan's "9 baselines" counts this row as TWO baselines (linkProvider,
    // upsertWorkspace; `total` is derived). The generic witness plants a
    // linkProvider site; this one plants the upsertWorkspace half.
    const pin = PINS.find((p) => p.id === 'binding-writers');
    const planted = new Map([...pin.sources, ['lib/zz-plant-binding-writers-upsert.js', 'upsertWorkspace(sess, w);\n']]);
    const off = relationOffenders(pin, planted);
    assert.ok(off.some((m) => m.includes('lib/zz-plant-binding-writers-upsert.js')), `expected the upsert plant, got ${JSON.stringify(off)}`);
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
    const derived = providerFiles().filter((f) => graphEdge(GRAPH, f)).sort();
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
