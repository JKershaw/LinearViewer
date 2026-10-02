/**
 * LIN-3136 censuses C1 and C4 (acceptance 13, server side; C3 lives in
 * lin-3134-declared-mint-census.test.js, C5 in lin-3136-copy-surface-census).
 *
 *  C1 every `createDispatchItem(` in `routes/proxy-*.js` (the proxy-token
 *     enqueue sinks) sits inside one of the POST handlers that carry
 *     `requireGrant('dispatch')`, so no proxy-token route enqueues ungated.
 *  C4 the Flight Companion turn (`routes/proxy-flight-companion.js`) keeps
 *     `followUpMode: 'propose'`: it proposes a follow-up for the human to
 *     approve and never enqueues one itself.
 *
 * Pure scanners over `{file, src}`; the mutation witnesses plant a change in a
 * synthetic copy and assert the scan fails.
 *
 * ── LIN-3219 A3 (carry-a3 constraint 2) ─────────────────────────────────────
 * The per-file `EXPECTED_SINKS` head-count and both of its table-derived
 * messages are DROPPED. In their place is a TRANSITIVE import/reach-vs-call
 * relation over `tests/unit/lib/import-graph.js`:
 *
 *     REACHING(createDispatchItem)  ==  CALL_SITES ∪ { the C4 reacher }
 *
 * where REACHING is every `routes/proxy-*.js` that reaches `createDispatchItem`
 * through any chain of imports (now including dynamic `import()` and namespace
 * imports — the LIN-3232 extension), and CALL_SITES is every proxy route with a
 * direct `createDispatchItem(` line. An enqueue moved behind a `lib/` wrapper
 * (or an import alias) raises REACHING without raising CALL_SITES, so it FAILS
 * instead of silently dropping out of the scanner's zero-finding set.
 *
 * The ONE known proxy route that reaches without calling is C4:
 * `routes/proxy-flight-companion.js` → `lib/chat-tools.js` →
 * `createDispatchItem` (`lib/dispatch-factory.js`). It is accounted for
 * EXPLICITLY here and asserted, so the relation neither passes vacuously nor
 * fails spuriously on that edge.
 *
 * NAMED RELAXATION: a new sink inside a GATED mount no longer needs a table
 * edit. The gate relation plus this reach-vs-call relation, not a head-count,
 * are the contract.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildImportGraph } from './lib/import-graph.js';
import { loadRawSources } from '../fixtures/connection-access-guards.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');

const PROXY_ROUTE_FILES = readdirSync(join(REPO, 'routes'))
  .filter(name => /^proxy-.*\.js$/.test(name))
  .map(name => ({ file: `routes/${name}`, src: readFileSync(join(REPO, 'routes', name), 'utf8') }));

const GATED = "proxyLimiter, authenticateProxyToken, requireWriteScope, requireGrant('dispatch'),";

// The single known proxy route that reaches createDispatchItem without calling
// it (C4: it proposes a follow-up via lib/chat-tools.js).
const C4_REACHER = 'routes/proxy-flight-companion.js';

/** The real corpus (lib/, routes/, server.js) as Map<rel, src>. */
const CORPUS = loadRawSources();

/** Build a graph from the corpus with optional per-file overrides and extras. */
function graphWith({ overrides = {}, extras = [] } = {}) {
  const m = new Map(CORPUS);
  for (const [k, v] of Object.entries(overrides)) m.set(k, v);
  for (const [k, v] of extras) m.set(k, v);
  return buildImportGraph(m);
}

const PROXY_RE = /^routes\/proxy-.*\.js$/;
const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

/** A direct `createDispatchItem(` call line (comments/imports excluded). */
function hasDirectCall(src) {
  return src.split('\n').some(line => !isComment(line) && /\bcreateDispatchItem\(/.test(line));
}

/** The set of proxy route modules with a direct createDispatchItem call. */
function callSites(graph) {
  return graph.paths()
    .filter(p => PROXY_RE.test(p) && hasDirectCall(graph.sourceOf(p) || ''))
    .sort();
}

/** The set of proxy route modules that transitively reach createDispatchItem. */
function reaching(graph) {
  return graph.paths()
    .filter(p => PROXY_RE.test(p) && graph.reaches(p, 'createDispatchItem'))
    .sort();
}

/**
 * The reach-vs-call relation. Empty when clean. Violations:
 *  - a proxy route reaches createDispatchItem (through a wrapper/alias) but has
 *    no direct call site and is not the one known C4 reacher;
 *  - a proxy route calls createDispatchItem but does not reach it in the graph;
 *  - an expected reacher (a call site, or C4) does not reach it.
 */
function sinkRelationOffenders(graph) {
  const calls = callSites(graph);
  const reach = reaching(graph);
  const expected = [...new Set([...calls, C4_REACHER])].sort();
  const v = [];
  for (const f of reach) {
    if (!expected.includes(f)) v.push(`${f}: reaches createDispatchItem through an import wrapper but has no direct gated call site (and is not C4)`);
  }
  for (const f of calls) {
    if (!reach.includes(f)) v.push(`${f}: has a createDispatchItem( call but does not reach it in the import graph`);
  }
  for (const f of expected) {
    if (!reach.includes(f)) v.push(`${f}: expected to reach createDispatchItem but does not`);
  }
  return v;
}

/** Each enqueue sink with the route registration it sits under (gate rule only). */
function scanC1(files) {
  const v = [];
  for (const { file, src } of files) {
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (!/\bcreateDispatchItem\(/.test(line) || /^\s*(\/\/|\*)/.test(line) || /^import\b/.test(line)) return;
      let reg = null;
      for (let j = i; j >= 0; j--) {
        if (/^\s{2}router\.(get|post|put|patch|delete|use)\(/.test(lines[j])) { reg = lines[j]; break; }
      }
      if (!reg || !reg.includes("router.post(") || !reg.includes(GATED)) {
        v.push(`${file}:${i + 1} createDispatchItem( is not under a dispatch-gated POST (${reg ? reg.trim().slice(0, 80) : 'no registration'})`);
      }
    });
  }
  return v;
}

describe('LIN-3136 C1 — every proxy-token enqueue sink is behind the dispatch gate', () => {
  test('the live tree: every createDispatchItem( is under a dispatch-gated POST', () => {
    assert.deepEqual(scanC1(PROXY_ROUTE_FILES), []);
  });

  test('mutation: the gate removed from a mount fails C1', () => {
    const mutated = PROXY_ROUTE_FILES.map(f => (f.file === 'routes/proxy-kickoff.js'
      ? { ...f, src: f.src.replace("requireWriteScope, requireGrant('dispatch'), async", 'requireWriteScope, async') } : f));
    assert.ok(scanC1(mutated).some(m => m.startsWith('routes/proxy-kickoff.js:') && m.includes('not under a dispatch-gated POST')));
  });

  test('mutation: a sink in a new ungated proxy route fails C1', () => {
    const planted = [...PROXY_ROUTE_FILES, {
      file: 'routes/proxy-new.js',
      src: "export function x() {\n  router.post('/api/proxy/new', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {\n      const item = await createDispatchItem({});\n  });\n}\n"
    }];
    const v = scanC1(planted);
    assert.ok(v.some(m => m.startsWith('routes/proxy-new.js:3')));
  });
});

describe('LIN-3136 C1 — transitive import/reach-vs-call relation (LIN-3219 carry-a3 #2)', () => {
  test('the live tree satisfies REACHING == CALL_SITES ∪ C4', () => {
    assert.deepEqual(sinkRelationOffenders(graphWith()), []);
  });

  test('the C4 edge is explicitly accounted for: it reaches createDispatchItem, and has no direct call', () => {
    const g = graphWith();
    assert.ok(reaching(g).includes(C4_REACHER), 'C4 must reach createDispatchItem via lib/chat-tools.js');
    assert.ok(!callSites(g).includes(C4_REACHER), 'C4 must not have a direct createDispatchItem( call');
    // The two direct sinks are exactly the two proxy routes that import it.
    assert.deepEqual(callSites(g), ['routes/proxy-dispatch.js', 'routes/proxy-kickoff.js']);
    assert.deepEqual(reaching(g), ['routes/proxy-dispatch.js', 'routes/proxy-flight-companion.js', 'routes/proxy-kickoff.js']);
  });

  test('mutation (a): moving the enqueue behind a lib/enqueue.js wrapper fails', () => {
    const original = CORPUS.get('routes/proxy-dispatch.js');
    const wrapped = original
      .replace("import { createDispatchItem } from '../lib/dispatch-factory.js';", "import { enqueue } from '../lib/enqueue.js';")
      .replace(/\bcreateDispatchItem\(/g, 'enqueue(');
    assert.ok(wrapped.includes("import { enqueue } from '../lib/enqueue.js';"), 'the wrapper import was planted');
    assert.ok(!/\bcreateDispatchItem\(/.test(wrapped), 'no direct call remains in the route');
    const g = graphWith({ overrides: { 'routes/proxy-dispatch.js': wrapped }, extras: [['lib/enqueue.js', "import { createDispatchItem } from './dispatch-factory.js';\nexport const enqueue = createDispatchItem;\n"]] });
    assert.ok(sinkRelationOffenders(g).some(m => m.startsWith('routes/proxy-dispatch.js: reaches createDispatchItem')));
  });

  test('mutation (b): an alias `const enqueue = createDispatchItem` + `enqueue(` fails', () => {
    const original = CORPUS.get('routes/proxy-dispatch.js');
    const aliased = original
      .replace(/\bcreateDispatchItem\(/g, 'enqueue(')
      .replace("import { createDispatchItem } from '../lib/dispatch-factory.js';", "import { createDispatchItem } from '../lib/dispatch-factory.js';\nconst enqueue = createDispatchItem;");
    assert.ok(aliased.includes('const enqueue = createDispatchItem;'), 'the alias was planted');
    assert.ok(!/\bcreateDispatchItem\(/.test(aliased), 'no direct call remains in the route');
    const g = graphWith({ overrides: { 'routes/proxy-dispatch.js': aliased } });
    assert.ok(sinkRelationOffenders(g).some(m => m.startsWith('routes/proxy-dispatch.js: reaches createDispatchItem')));
  });

  test('mutation (d): an ungated sink in a new route fails the relation too (not vacuous)', () => {
    const g = graphWith({ extras: [['routes/proxy-new.js', "router.post('/api/proxy/new', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {\n  await createDispatchItem({ store });\n});\n"]] });
    assert.ok(sinkRelationOffenders(g).some(m => m.startsWith('routes/proxy-new.js:')));
  });
});

function scanC4(files) {
  const fc = files.find(f => f.file === 'routes/proxy-flight-companion.js');
  if (!fc) return ['routes/proxy-flight-companion.js is missing'];
  const v = [];
  if (!fc.src.includes("followUpMode: 'propose'")) v.push("followUpMode: 'propose' is gone");
  if (/followUpMode:\s*'(?!propose')/.test(fc.src)) v.push('another followUpMode is set');
  if (/\bcreateDispatchItem\(/.test(fc.src)) v.push('the Flight Companion turn enqueues directly');
  return v;
}

describe('LIN-3136 C4 — the Flight Companion turn proposes, never enqueues', () => {
  test("the live tree keeps followUpMode: 'propose'", () => {
    assert.deepEqual(scanC4(PROXY_ROUTE_FILES), []);
  });

  test("mutation: followUpMode switched away from 'propose' fails C4", () => {
    const mutated = PROXY_ROUTE_FILES.map(f => (f.file === 'routes/proxy-flight-companion.js'
      ? { ...f, src: f.src.replace("followUpMode: 'propose'", "followUpMode: 'send'") } : f));
    assert.ok(scanC4(mutated).length > 0);
  });
});
