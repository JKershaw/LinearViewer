/**
 * LIN-2543 — shared DI-witness helper for the LIN-679 proxy sub-router
 * corpus (class fix for the gap the LIN-2533/PR #1350 review ledger named:
 * dropping a dep from a `router.use(createXRoutes({...}))` mount is a
 * runtime 500 with green CI, because the pre-existing tests that touch these
 * routes all stop at a 4xx before the injected dep is dereferenced).
 *
 * Two independent detectors for two independent mechanisms (research §5):
 *
 * - Half A (below): a filesystem-derived, source-text mount-completeness
 *   census (tests/unit/lib/proxy-di-witness.js). Total and instant, but
 *   blind to mechanism (ii) — a dep dropped from BOTH the factory signature
 *   and the mount is a free identifier, invisible to a census that only
 *   diffs declared-vs-mounted sets.
 * - Half B (below): reach witnesses through the REAL composer
 *   (`createProxyRoutes`, not a sub-router factory in isolation — the mount
 *   is the thing that can drop a dep), reusing `BASE_DEPS`/`buildApp`/`call`
 *   from tests/unit/lib/proxy-fake-deps.js — the exact harness
 *   tests/unit/proxy-endpoint-inventory-witness.test.js (LIN-679 PR-0)
 *   originated, lifted to a shared (non-`.test.js`) module so both files
 *   import one definition instead of each defining their own. One
 *   representative silent dep per group, for the 4 groups without an
 *   existing reach witness; group G (agent-status) already has one —
 *   tests/unit/lin-2533-agent-status-extraction.test.js:153-206 — reused by
 *   citation rather than re-derived (see the note at the bottom of this
 *   file). The other 23 silent deps' reach probes are explicit, tracked
 *   follow-up work (each remaining LIN-679 stage, using this same helper),
 *   not this ticket's scope.
 *
 * Mutation-validated (LIN-2219 acceptance-witness discipline): both
 * mechanisms were reproduced against this file in a throwaway git worktree
 * before trusting it — see the PR description for the exact commands and
 * before/after `node --test` output. A probe that stays GREEN under a
 * signature+mount drop is a mis-targeted probe (wrong route, wrong
 * sub-router, or an assertion that doesn't actually exercise the
 * dependency), not evidence the dependency was already covered.
 *
 * No production code changes. Half C (a script-lane acceptance check that
 * every declared dep is reached at least once by the whole suite) is
 * explicitly deferred — LIN-2591 — since it needs a new CI step and answers
 * an open brief question this ticket's scope doesn't cover.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseFactoryDecl,
  parseMountDeps,
  diffMountAgainstFactory,
  censusMountCompleteness,
  discoverProxySubRouterFiles,
} from './lib/proxy-di-witness.js';
import { buildImportGraph } from './lib/import-graph.js';
import { ACME, BASE_DEPS, buildApp, call } from './lib/proxy-fake-deps.js';

// ---------------------------------------------------------------------------
// Half A — parser correctness, against inline fixture strings (not the real
// repo), so the parser's edge cases are pinned independent of what any
// future LIN-679 stage does to routes/proxy.js.
// ---------------------------------------------------------------------------

const FIXTURE_FACTORY_SOURCE = `
export function createFixtureRoutes({ requiredDep, anotherRequiredDep, optionalDep = null, alsoOptional = () => {} }) {
  const router = Router();
  return router;
}
`;

describe('Half A: parseFactoryDecl (fixture-based)', () => {
  test('classifies a defaulted destructured param as optional, an undefaulted one as required', () => {
    const { factoryName, required, optional } = parseFactoryDecl(FIXTURE_FACTORY_SOURCE, 'fixture.js');
    assert.equal(factoryName, 'createFixtureRoutes');
    assert.deepEqual(required, ['requiredDep', 'anotherRequiredDep']);
    assert.deepEqual(optional, ['optionalDep', 'alsoOptional']);
  });

  test('throws when no "export function create...Routes({" declaration is found — fails loudly, never vacuous', () => {
    assert.throws(
      () => parseFactoryDecl('export const notAFactory = 1;', 'fixture-no-factory.js'),
      /no "export function create\.\.\.Routes\(\{" factory declaration found in fixture-no-factory\.js/
    );
  });
});

describe('Half A: parseMountDeps (fixture-based)', () => {
  test('throws when no matching "router.use(<factory>({" mount literal is found — fails loudly, never vacuous', () => {
    assert.throws(
      () => parseMountDeps("router.use(createSomeOtherRoutes({ x }));", 'createFixtureRoutes'),
      /no "router\.use\(createFixtureRoutes\(\{" mount literal found/
    );
  });
});

describe('Half A: diffMountAgainstFactory (fixture-based)', () => {
  test('missingFromMount is populated when the mount omits a required key', () => {
    const { factoryName, required, optional } = parseFactoryDecl(FIXTURE_FACTORY_SOURCE, 'fixture.js');
    const mounted = parseMountDeps(
      'router.use(createFixtureRoutes({ requiredDep }));',
      factoryName
    );
    const { missingFromMount, extraInMount } = diffMountAgainstFactory({ required, optional, mounted });
    assert.deepEqual(missingFromMount, ['anotherRequiredDep']);
    assert.deepEqual(extraInMount, []);
  });

  test('extraInMount is populated when the mount carries a key the factory does not declare (required or optional)', () => {
    const { factoryName, required, optional } = parseFactoryDecl(FIXTURE_FACTORY_SOURCE, 'fixture.js');
    const mounted = parseMountDeps(
      'router.use(createFixtureRoutes({ requiredDep, anotherRequiredDep, surpriseDep }));',
      factoryName
    );
    const { missingFromMount, extraInMount } = diffMountAgainstFactory({ required, optional, mounted });
    assert.deepEqual(missingFromMount, []);
    assert.deepEqual(extraInMount, ['surpriseDep']);
  });

  test('an optional (defaulted) dep present in the mount is neither missing nor extra', () => {
    const { factoryName, required, optional } = parseFactoryDecl(FIXTURE_FACTORY_SOURCE, 'fixture.js');
    const mounted = parseMountDeps(
      'router.use(createFixtureRoutes({ requiredDep, anotherRequiredDep, optionalDep }));',
      factoryName
    );
    const { missingFromMount, extraInMount } = diffMountAgainstFactory({ required, optional, mounted });
    assert.deepEqual(missingFromMount, []);
    assert.deepEqual(extraInMount, []);
  });
});

// ---------------------------------------------------------------------------
// Half A — integration test against the real repo. Corpus + deps are
// filesystem-derived, never hand-listed (LIN-2557 records that exact failure
// for a sibling census) — this test's 6/70 expectations are the CURRENT
// measured shape (see the ticket's corpus table), not a hard-coded list fed
// into the parser itself.
// ---------------------------------------------------------------------------

describe('Half A: mount-completeness census against the real repo', () => {
  // Deliberately its own test, separate from the corpus-size sanity check
  // below: this is the one that demonstrates Half A's documented blind spot
  // (mechanism (ii) — see the PR description's mutation-validation section).
  // A dep dropped from BOTH a factory's signature and its mount shrinks
  // `required` and `mounted` together, so missingFromMount/extraInMount stay
  // empty — correctly blind, not a false negative in this test.
  test('every discovered factory has an empty missingFromMount and an empty extraInMount', () => {
    const rows = censusMountCompleteness({ routesDir: 'routes', proxySourcePath: 'routes/proxy.js' });
    for (const row of rows) {
      assert.deepEqual(
        row.missingFromMount, [],
        `${row.file} (${row.factoryName}): missingFromMount should be empty at HEAD, got ${JSON.stringify(row.missingFromMount)}`
      );
      // extraInMount is the LIN-2541 dead-dep class — computed and reported
      // here, but deciding what a nonempty result should DO (fail? warn?) is
      // explicitly LIN-2541's scope. Asserted empty because that is what is
      // true at HEAD today (70/70 declared deps are mounted, none extra); a
      // future nonempty result is LIN-2541's to triage, not this test's to
      // silently accommodate.
      assert.deepEqual(
        row.extraInMount, [],
        `${row.file} (${row.factoryName}): extraInMount should be empty at HEAD, got ${JSON.stringify(row.extraInMount)}`
      );
    }
  });

  // Derived-set equality (LIN-3218 / LIN-3201 A1): the hand-maintained corpus
  // total ("13 files / 151 deps") is gone. Instead the set of `routes/proxy-*.js`
  // modules that export a `create…Routes` factory is derived from source — via
  // tests/unit/lib/import-graph.js, which parses real `export function`
  // declarations rather than trusting this file's own count — and must equal the
  // set of factories imported AND mounted by routes/proxy.js. This catches both
  // directions of drift the old total caught (a new sub-router not mounted; a
  // mount whose factory vanished) without pinning a number that every LIN-679
  // stage has to bump. Unlike the `missingFromMount`/`extraInMount` detector
  // above, an exported-but-not-mounted factory or a mounted-but-not-exported one
  // fails here directly.
  function deriveFactoryMountSets(modules) {
    const graph = buildImportGraph(modules);
    const composerPath = 'routes/proxy.js';
    const composerSource = graph.sourceOf(composerPath) || '';
    const isFactory = (name) => /^create\w+Routes$/.test(name);

    const exportedBy = new Map();
    for (const path of graph.paths()) {
      if (path === composerPath || !/^routes\/proxy-.*\.js$/.test(path)) continue;
      for (const name of graph.exportedNamesOf(path)) {
        if (isFactory(name)) exportedBy.set(name, path);
      }
    }

    const importedBy = new Map();
    for (const rec of graph.importsOf(composerPath)) {
      for (const binding of rec.bindings) {
        if (isFactory(binding.imported)) importedBy.set(binding.imported, rec.resolved);
      }
    }

    const mounted = new Set();
    for (const name of importedBy.keys()) {
      if (new RegExp(`router\\.use\\(\\s*${name}\\(\\{`).test(composerSource)) mounted.add(name);
    }

    return {
      exported: [...exportedBy.keys()].sort(),
      mounted: [...mounted].sort(),
      exportedNotMounted: [...exportedBy.keys()].filter((n) => !mounted.has(n)).sort(),
      mountedNotExported: [...mounted].filter((n) => !exportedBy.has(n)).sort(),
      moduleMismatch: [...mounted].filter((n) => exportedBy.has(n) && exportedBy.get(n) !== importedBy.get(n)).sort(),
    };
  }

  test('the set of proxy sub-router factories exported equals the set imported and mounted by routes/proxy.js', () => {
    const files = ['routes/proxy.js', ...discoverProxySubRouterFiles('routes').map((f) => `routes/${f}`)];
    const modules = files.map((path) => ({ path, source: readFileSync(path, 'utf8') }));
    const sets = deriveFactoryMountSets(modules);
    assert.deepEqual(
      sets.exported, sets.mounted,
      `a factory is exported but not mounted, or mounted but not exported: ${JSON.stringify(sets)}`
    );
    assert.deepEqual(sets.exportedNotMounted, []);
    assert.deepEqual(sets.mountedNotExported, []);
    assert.deepEqual(sets.moduleMismatch, []);
  });

  test('planted witness: an exported-but-not-mounted factory fails the derived-set equality', () => {
    const sets = deriveFactoryMountSets([
      { path: 'routes/proxy.js', source: "import { createFooRoutes } from './proxy-foo.js';\nconst router = { use() {} };\n" },
      { path: 'routes/proxy-foo.js', source: 'export function createFooRoutes({ a }) { return {}; }\n' },
    ]);
    assert.notDeepEqual(sets.exported, sets.mounted);
    assert.deepEqual(sets.exportedNotMounted, ['createFooRoutes']);
  });

  test('planted witness: a mounted-but-not-exported factory fails the derived-set equality', () => {
    const sets = deriveFactoryMountSets([
      { path: 'routes/proxy.js', source: "import { createBarRoutes } from './proxy-bar.js';\nconst router = { use: () => {} };\nrouter.use(createBarRoutes({}));\n" },
      { path: 'routes/proxy-bar.js', source: 'export const nothing = 1;\n' },
    ]);
    assert.notDeepEqual(sets.exported, sets.mounted);
    assert.deepEqual(sets.mountedNotExported, ['createBarRoutes']);
  });
});

// ---------------------------------------------------------------------------
// Half B — reach witnesses through the real composer (createProxyRoutes),
// reusing BASE_DEPS()/buildApp()/call() from
// tests/unit/proxy-endpoint-inventory-witness.test.js. Each probe below
// names the sub-router the request must land in; a probe that stays green
// under a signature+mount drop (see the PR description's mutation-validation
// section) means it never reached that sub-router, not that the dependency
// was "already covered incidentally".
// ---------------------------------------------------------------------------

describe('Half B: reach probes through the real composer', () => {
  test('A/tokens-admin: GET /workspace/:urlKey/api/proxy/tokens must land in createTokensAdminRoutes and dereference proxyTokenStore.listTokens (routes/proxy-tokens-admin.js:166)', async () => {
    const calls = [];
    const app = buildApp({
      // BASE_DEPS()'s default workspaceFromUrl is a no-op that never sets
      // req.workspace, but this route destructures `const { workspace } = req`
      // — override it the same way proxy-endpoint-inventory-witness.test.js's
      // sessionWorkspaceApp() does, or the probe 500s before ever reaching
      // proxyTokenStore.
      workspaceFromUrl: (req, res, next) => {
        req.workspace = { urlKey: ACME };
        next();
      },
      proxyTokenStore: {
        ...BASE_DEPS().proxyTokenStore,
        listTokens: async (urlKey) => {
          calls.push(urlKey);
          return [{ id: 'tok1', label: 'probe' }];
        },
      },
    });

    const { status, body } = await call(app, 'GET', '/workspace/acme/api/proxy/tokens');

    // A 500 here is the exact failure a missing proxyTokenStore in the
    // createTokensAdminRoutes mount produces (TypeError -> the handler's catch).
    assert.equal(status, 200);
    assert.deepEqual(body, { tokens: [{ id: 'tok1', label: 'probe' }] });
    assert.deepEqual(calls, [ACME], 'handler did not reach the injected proxyTokenStore.listTokens');
  });

  test('C/token-exchange: POST /api/proxy/token must land in createTokenExchangeRoutes and dereference proxyTokenStore.exchangeBootstrapToken (routes/proxy-token-exchange.js:48)', async () => {
    const calls = [];
    const app = buildApp({
      proxyTokenStore: {
        ...BASE_DEPS().proxyTokenStore,
        exchangeBootstrapToken: async (bootstrap, opts) => {
          calls.push([bootstrap, opts]);
          return {
            token: 'working-token-1',
            scope: 'readWrite',
            expiresAt: 1893456000,
            urlKey: ACME,
            tokenId: 't2',
            label: 'exchanged',
          };
        },
      },
    });

    const { status, body } = await call(app, 'POST', '/api/proxy/token', {
      headers: { Authorization: 'Bearer bootstrap-abc' },
    });

    // A 500 here is the exact failure a missing proxyTokenStore in the
    // createTokenExchangeRoutes mount produces (TypeError -> the handler's catch).
    assert.equal(status, 200);
    assert.equal(body.token, 'working-token-1');
    assert.equal(body.scope, 'readWrite');
    assert.equal(calls.length, 1, 'handler did not reach the injected proxyTokenStore.exchangeBootstrapToken');
    assert.equal(calls[0][0], 'bootstrap-abc');
  });

  test('D/reads: GET /api/proxy/credential-health must land in createReadRoutes and dereference proxyEventStore.listSelfCredentialHealth (routes/proxy-reads.js:111)', async () => {
    const calls = [];
    const app = buildApp({
      proxyEventStore: {
        ...BASE_DEPS().proxyEventStore,
        listSelfCredentialHealth: async (urlKey, tokenId, opts) => {
          calls.push([urlKey, tokenId, opts]);
          return { occupancy: { rate: 1 }, workspaceAccess: { verdict: 'ok' } };
        },
      },
    });

    const { status, body } = await call(app, 'GET', '/api/proxy/credential-health');

    // A 500 here is the exact failure a missing proxyEventStore in the
    // createReadRoutes mount produces (TypeError -> the handler's catch).
    assert.equal(status, 200);
    assert.deepEqual(body, { rate: 1, workspaceAccess: { verdict: 'ok' } });
    assert.equal(calls.length, 1, 'handler did not reach the injected proxyEventStore.listSelfCredentialHealth');
    assert.equal(calls[0][0], ACME);
    assert.equal(calls[0][1], 't1');
  });

  test('E/writes: POST /api/proxy/issues must land in createProxyWriteRoutes and reach resolveProviderAccess through to provider.createIssue (routes/proxy-writes.js:76-78,186)', async () => {
    const calls = [];
    const app = buildApp({
      provider: {
        ...BASE_DEPS().provider,
        createIssue: async (token, input) => {
          calls.push([token, input]);
          return { issue: { id: 'new-probe-1', identifier: 'LIN-9001' }, success: true };
        },
      },
    });

    const { status, body } = await call(app, 'POST', '/api/proxy/issues', {
      body: { teamId: '11111111-1111-1111-1111-111111111111', title: 'DI witness probe issue' },
    });

    // A 500 here is the exact failure a signature+mount drop of
    // resolveProviderAccess (or any other createProxyWriteRoutes dep)
    // produces (TypeError/ReferenceError -> the handler's catch).
    assert.equal(status, 201);
    assert.equal(body.issue.id, 'new-probe-1');
    assert.equal(
      calls.length, 1,
      'handler did not reach the injected provider.createIssue — resolveProviderAccess or an earlier dep in the chain did not resolve'
    );
    assert.equal(calls[0][1].teamId, '11111111-1111-1111-1111-111111111111');
  });

  test('LIN-3025/halt: GET /api/proxy/dispatch/halt must land in createProxyHaltRoutes and dereference workspaceHaltStore.getWorkspaceHalt (routes/proxy-halt.js)', async () => {
    const calls = [];
    const app = buildApp({
      workspaceHaltStore: {
        ...BASE_DEPS().workspaceHaltStore,
        getWorkspaceHalt: async (urlKey) => {
          calls.push(urlKey);
          return { _id: urlKey, mode: 'pause', setAt: new Date('2026-01-01T00:00:00.000Z'), setBy: 'u1' };
        },
      },
    });

    const { status, body } = await call(app, 'GET', '/api/proxy/dispatch/halt');

    // A 500 here is the exact failure a signature+mount drop of
    // workspaceHaltStore from the createProxyHaltRoutes mount produces
    // (TypeError -> the handler's catch) — or, since workspaceHaltStore is
    // undefaulted in this factory (unlike createProxyRoutes's own `= null`
    // default), a dropped mount key surfaces here even though Half A's own
    // census can't see it (research §5: 136 either way).
    assert.equal(status, 200);
    assert.deepEqual(body, { halt: { mode: 'pause', setAt: '2026-01-01T00:00:00.000Z', setBy: 'u1' } });
    assert.deepEqual(calls, [ACME], 'handler did not reach the injected workspaceHaltStore.getWorkspaceHalt');
  });

  // G/agent-status — NO new probe here. tests/unit/lin-2533-agent-status-extraction.test.js:153-206
  // ("LIN-2533 close-out: agentStatusStore is injected into the mounted
  // sub-router") already witnesses agentStatusStore through the real
  // composer, driving both POST and GET /api/proxy/agent/status to a stubbed
  // agentStatusStore and asserting the stub was reached. Reused by citation
  // per this ticket's "one helper, not seven hand-rolled witnesses"
  // acceptance criterion — not re-derived here.
});
