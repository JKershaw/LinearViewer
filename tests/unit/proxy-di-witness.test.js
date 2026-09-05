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
import {
  parseFactoryDecl,
  parseMountDeps,
  diffMountAgainstFactory,
  censusMountCompleteness,
} from './lib/proxy-di-witness.js';
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

  // A separate, coarser sanity pin: the corpus is exactly 10 files / 132
  // declared deps today (LIN-2540: group I's routes/proxy-dispatch.js adds
  // 24, all un-defaulted so classifyParams counts every one as required —
  // 87 + 24 = 111; LIN-2444's routes/proxy-rulings.js then adds 6 more —
  // proxyLimiter, authenticateProxyToken, requireWriteScope, logEvent,
  // dispatchQueueStore, agentStatusStore — its other four
  // (taskDecisionsStore, shelvedRulingsStore, dismissalSuggestionsStore,
  // sessionsFeedCache) are defaulted to null and so are not counted as
  // required: 111 + 6 = 117; LIN-2620's routes/proxy-flight-companion.js then
  // adds a 10th file with 15 required deps — proxyLimiter,
  // authenticateProxyToken, resolveProviderAccess, workspaceUnavailable,
  // logEvent, getWorkspaceOpenRouterKey, resolveProxyLLM,
  // chargeFreeTierOrReject, observerStateStore, workspacePreferencesStore,
  // recapCacheStore, briefCacheStore, dispatchQueueStore, agentStatusStore,
  // proxyTokenStore — its two optional deps (taskDecisionsStore,
  // shelvedRulingsStore) are defaulted to null and so are not counted:
  // 117 + 15 = 132). Unlike the test above, THIS one is not blind to a
  // signature+mount drop (removing a dep from a factory's signature shrinks
  // `required`, which this total catches) — that's a different, unrelated
  // invariant catching it, not evidence Half A's own missing/extra detectors
  // saw the gap; keeping the two in separate tests keeps that distinction
  // legible in the mutation-validation record.
  test('the corpus is exactly 10 proxy sub-router files totalling 132 declared deps', () => {
    const rows = censusMountCompleteness({ routesDir: 'routes', proxySourcePath: 'routes/proxy.js' });
    assert.equal(rows.length, 10, `expected 10 proxy sub-router files, found: ${rows.map((r) => r.file).join(', ')}`);
    const totalDeps = rows.reduce((sum, row) => sum + row.required.length, 0);
    assert.equal(totalDeps, 132, `expected 132 total required deps across the 10 factories, found ${totalDeps}`);
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

  // G/agent-status — NO new probe here. tests/unit/lin-2533-agent-status-extraction.test.js:153-206
  // ("LIN-2533 close-out: agentStatusStore is injected into the mounted
  // sub-router") already witnesses agentStatusStore through the real
  // composer, driving both POST and GET /api/proxy/agent/status to a stubbed
  // agentStatusStore and asserting the stub was reached. Reused by citation
  // per this ticket's "one helper, not seven hand-rolled witnesses"
  // acceptance criterion — not re-derived here.
});
