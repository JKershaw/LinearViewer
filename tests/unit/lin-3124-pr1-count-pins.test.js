/**
 * LIN-3124 PR1 (G) — credential-surface boundary relations (T5).
 *
 * LIN-3219 A3 (LIN-3201 M19): the nine hardcoded `expected` baselines are gone.
 * Each credential surface is now guarded by a RELATION over source, not a
 * literal that every bump has to repair:
 *   - every site of the surface lies in a module that reaches the surface's
 *     credential entry through the import graph (`reaches`), and
 *   - the surface's scanner finds at least one site (`> 0`, so it never passes
 *     on a zero surface), and
 *   - the +1 / −1 planted offenders are kept as sensitivity witnesses: they
 *     must still move the scanner.
 * `provider-auth-edges` is import-edge-shaped, so it is guarded by a true
 * derived-set equality between the source regex edge set and the import-graph
 * edge set (which is dynamic-`import()`-aware), with a dynamic witness.
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
// Count functions
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
// The surfaces: scanner + +1/−1 plants + the credential boundary (a symbol the
// site module must reach, derived from the import graph — never a file list).
// ---------------------------------------------------------------------------

const PINS = [
  {
    id: 'test-token-guards',
    label: "accessToken === 'test-token' guards",
    sources: RAW,
    re: /accessToken === 'test-token'/g,
    surface: ['linkProvider'],
    count: countTestTokenGuards,
    plus: (s) => countTestTokenGuards(withLine(s, 'lib/workspace.js', "const g = ws.accessToken === 'test-token';")),
    minus: (s) => countTestTokenGuards(withoutFirstMatch(s, /accessToken === 'test-token'/)),
  },
  {
    id: 'urlkey-lookups',
    label: 'hand-rolled `w.urlKey === urlKey` lookups',
    sources: REAL,
    re: /w\??\.urlKey === urlKey/g,
    surface: ['getWorkspaceCallScope'],
    count: countUrlKeyLookups,
    plus: (s) => countUrlKeyLookups(withLine(s, 'lib/workspace.js', 'if (w.urlKey === urlKey) {}')),
    minus: (s) => countUrlKeyLookups(withoutFirstMatch(s, /w\??\.urlKey === urlKey/)),
  },
  {
    id: 'provider-auth-edges',
    label: 'upward provider index.js -> routes/*-auth import edges (LIN-675)',
    sources: REAL,
    re: /^import .*routes\/[a-z-]*auth/gm,
    surface: null, // guarded by the derived-set equality below
    count: countProviderAuthEdges,
    plus: (s) => countProviderAuthEdges(withLine(s, 'lib/providers/local/index.js', "import '../routes/auth.js';")),
    minus: (s) => countProviderAuthEdges(withoutFirstMatch(s, /^import .*routes\/[a-z-]*auth/, /^lib\/providers\/[^/]+\/index\.js$/)),
  },
  {
    id: 'off-session-readers',
    label: 'off-session raw-session credential readers',
    sources: REAL,
    re: /(selectOwnerWorkspaceToken|selectOwnerWorkspaceRow|selectExpiredOwnerRow|selectOwnerSessionRow|selectAllOwnerSessionRows)\(/g,
    surface: ['linkProvider'],
    count: countOffSessionReaders,
    plus: (s) => countOffSessionReaders(withLine(s, 'lib/workspace.js', 'const r = selectOwnerSessionRow(s, u, o);')),
    minus: (s) => countOffSessionReaders(withoutFirstMatch(s, /select(OwnerSessionRow|OwnerWorkspaceRow|ExpiredOwnerRow|OwnerWorkspaceToken|AllOwnerSessionRows)\(/, /^(?!lib\/workspace-token-resolver\.js).*/)),
  },
  {
    id: 'binding-writers',
    label: 'binding writers (linkProvider + upsertWorkspace)',
    sources: REAL,
    re: /(^|[^a-zA-Z])(linkProvider|upsertWorkspace)\(/g,
    surface: ['linkProvider'],
    count: countBindingWriters,
    plus: (s) => countBindingWriters(withLine(withLine(s, 'lib/workspace.js', "linkProvider(ws, 'x', 'y', {});"), 'lib/workspace.js', 'upsertWorkspace(sess, w);')),
    minus: (s) => countBindingWriters(withoutFirstMatch(s, /(^|[^a-zA-Z])linkProvider\(/, /^(?!lib\/workspace\.js).*/)),
  },
  {
    id: 'workspace-edge-writers',
    label: 'account<->workspace edge writers (bindAccountToWorkspace)',
    sources: REAL,
    re: /(^|[^a-zA-Z])bindAccountToWorkspace\(/g,
    surface: ['AccountStore', 'AccountWorkspaceStore', 'establishAccount', 'linkProvider', 'upsertWorkspace', 'getWorkspaceCallScope'],
    count: countWorkspaceEdgeWriters,
    plus: (s) => countWorkspaceEdgeWriters(withLine(s, 'lib/workspace.js', "await accountWorkspaceStore.bindAccountToWorkspace('a', 'w');")),
    minus: (s) => countWorkspaceEdgeWriters(withoutFirstMatch(s, /(^|[^a-zA-Z])bindAccountToWorkspace\(/, /^(?!lib\/account-workspace-store\.js).*/)),
  },
  {
    id: 'raw-accesstoken-writers',
    label: 'raw .accessToken assignments',
    sources: REAL,
    re: /\.accessToken *=[^=]/g,
    surface: ['getWorkspaceCallScope'],
    count: countRawAccessTokenWriters,
    plus: (s) => countRawAccessTokenWriters(withLine(s, 'lib/workspace.js', "ws.accessToken = 'x';")),
    minus: (s) => countRawAccessTokenWriters(withoutFirstMatch(s, /\.accessToken *=[^=]/)),
  },
  {
    id: 'held-marker-emitters',
    label: 'explicit held-entry marker emitters (LIN-3125 F1)',
    sources: REAL,
    re: /(^|[^.\w])withHeldMarker\(/g,
    surface: ['withHeldMarker'],
    count: countHeldMarkerEmitters,
    plus: (s) => countHeldMarkerEmitters(withLine(s, 'lib/workspace.js', "const u = withHeldMarker('/auth/github', p);")),
    minus: (s) => countHeldMarkerEmitters(withoutFirstMatch(s, /(^|[^.\w])withHeldMarker\(/, /^(?!lib\/held-connection-entry\.js).*/)),
  },
];

/** The set of files in a source map containing a match of `re`. */
function filesMatching(sources, re) {
  const out = new Set();
  const stateless = new RegExp(re.source, re.flags.replace('g', ''));
  for (const [rel, src] of sources) if (stateless.test(src)) out.add(rel);
  return [...out].sort();
}

describe('LIN-3124 PR1 T5 — credential-surface boundary relations (LIN-3219 A3)', () => {
  for (const pin of PINS) {
    test(`pin ${pin.id}: every ${pin.label} site lies in the credential surface`, () => {
      const files = filesMatching(pin.sources, pin.re);
      assert.ok(files.length > 0, `${pin.id}: a zero-finding scan would be vacuous`);
      const base = pin.count(pin.sources);
      const n = typeof base === 'number' ? base : base.total;
      assert.ok(n > 0, `${pin.id}: the scanner must find at least one site`);
      if (pin.surface) {
        // Boundary rule: each site module must reach the surface's credential
        // entry (a symbol derived from the import graph — no file allow-list).
        const outside = files.filter((f) => !pin.surface.some((sym) => GRAPH.reaches(f, sym)));
        assert.deepEqual(outside, [], `${pin.id}: sites outside the ${pin.surface.join('|')} credential boundary: ${outside.join(', ')}`);
      }
    });

    test(`pin ${pin.id}: the scanner moves on a planted +1 site (kept sensitivity witness)`, () => {
      assert.notDeepEqual(pin.plus(pin.sources), pin.count(pin.sources), `${pin.id} +1 plant did not move the scanner`);
    });

    test(`pin ${pin.id}: the scanner moves on a planted −1 site (kept sensitivity witness)`, () => {
      assert.notDeepEqual(pin.minus(pin.sources), pin.count(pin.sources), `${pin.id} −1 plant did not move the scanner`);
    });
  }
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

  test('witness: a DYNAMIC provider -> routes/*-auth import is caught by the graph and missed by the regex', () => {
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
