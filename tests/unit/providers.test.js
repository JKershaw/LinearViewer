/**
 * Unit tests for the provider contract (LIN-176 Phase 2, Subtask 1 / LIN-330).
 *
 * Covers:
 *   - the interface: NotImplemented decline on declared-but-unwired methods,
 *     capability-descriptor correctness, and mapState delegation to state-map;
 *   - the registry: register/get/getAll + the module-load self-registration
 *     lifecycle;
 *   - the Linear provider THROUGH the shim: lib/linear.js re-exports the exact
 *     same fetchers, the provider wires reads but declines writes/headroom, and
 *     the LIN-300 lean focused-child shape survived the move.
 *
 * Run with: node --test tests/unit/providers.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  ProviderInterface,
  NotImplementedError,
  PROVIDER_SURFACE,
} from '../../lib/providers/interface.js';
import {
  registerProvider,
  getProvider,
  getAllProviders,
} from '../../lib/providers/registry.js';
import { getStateDisplay, getStateOrder } from '../../lib/providers/state-map.js';
import { LinearProvider, linearProvider } from '../../lib/providers/linear/index.js';
import * as shim from '../../lib/linear.js';
import * as provider from '../../lib/providers/linear/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// =============================================================================
// Interface
// =============================================================================

describe('ProviderInterface', () => {
  test('every declared method throws NotImplementedError by default', () => {
    const base = new ProviderInterface();
    const allMethods = [
      ...PROVIDER_SURFACE.reads,
      ...PROVIDER_SURFACE.readsHeadroom,
      ...PROVIDER_SURFACE.writes,
    ];
    for (const method of allMethods) {
      assert.throws(
        () => base[method](),
        (err) => {
          assert.ok(err instanceof NotImplementedError, `${method} should throw NotImplementedError`);
          assert.strictEqual(err.code, 'NOT_IMPLEMENTED');
          assert.strictEqual(err.method, method);
          assert.strictEqual(err.provider, 'base');
          return true;
        },
        `${method} must decline by throwing`
      );
    }
  });

  test('getAuthRouter is declared and throws NotImplementedError on the base', () => {
    const base = new ProviderInterface();
    assert.throws(() => base.getAuthRouter(), NotImplementedError);
  });

  test('getCreateTaskUrl is declared and throws NotImplementedError on the base', () => {
    const base = new ProviderInterface();
    assert.throws(() => base.getCreateTaskUrl(), NotImplementedError);
  });

  test('capability descriptor reports nothing implemented on the bare base', () => {
    const base = new ProviderInterface();
    const caps = base.capabilities;
    for (const v of Object.values(caps)) {
      assert.strictEqual(v, false);
    }
    assert.deepStrictEqual(base.getCapabilities().implemented, []);
    assert.ok(base.getCapabilities().declared.length > 0);
  });

  test('supports() gates without throwing (the "never 500" path)', () => {
    const base = new ProviderInterface();
    assert.strictEqual(base.supports('fetchProjects'), false);
    assert.strictEqual(base.supports('createIssue'), false);
  });

  test('mapState delegates to state-map (display + order)', () => {
    const base = new ProviderInterface();
    for (const type of ['started', 'completed', 'backlog', 'unstarted', undefined, 'bogus']) {
      const expected = { ...getStateDisplay(type), order: getStateOrder(type) };
      assert.deepStrictEqual(base.mapState(type), expected);
    }
  });
});

// =============================================================================
// Registry
// =============================================================================

describe('provider registry', () => {
  test('register / get / getAll round-trip', () => {
    const fake = { name: 'fake-provider-test' };
    registerProvider(fake);
    assert.strictEqual(getProvider('fake-provider-test'), fake);
    assert.ok(getAllProviders().includes(fake));
  });

  test('registerProvider rejects providers without a name', () => {
    assert.throws(() => registerProvider({}), /non-empty string name/);
    assert.throws(() => registerProvider(null), /non-empty string name/);
  });

  test('the Linear provider self-registered on module load (chosen lifecycle)', () => {
    // Importing lib/providers/linear/index.js (transitively via the shim) is
    // what registers it — no explicit startup call.
    const lp = getProvider('linear');
    assert.ok(lp, 'linear provider must be registered');
    assert.strictEqual(lp, linearProvider);
    assert.ok(lp instanceof LinearProvider);
  });
});

// =============================================================================
// Linear provider (through the shim)
// =============================================================================

describe('Linear provider through lib/linear.js shim', () => {
  const FETCHERS = [
    'fetchTeams',
    'fetchOrganization',
    'fetchViewer',
    'fetchProjectsList',
    'fetchProjects',
    'fetchIssueContext',
    'fetchIssueComments',
    'fetchFocusedChild',
    'fetchRecommendationContext',
  ];

  test('shim re-exports exactly the 9 fetchers (and not the relocated helpers)', () => {
    assert.deepStrictEqual(Object.keys(shim).sort(), [...FETCHERS].sort());
    assert.strictEqual(shim.isBlocked, undefined);
    assert.strictEqual(shim.selectFocusSubtask, undefined);
  });

  test('shim re-exports the SAME function references as the provider module', () => {
    for (const name of FETCHERS) {
      assert.strictEqual(typeof shim[name], 'function', `${name} must be a function`);
      assert.strictEqual(shim[name], provider[name], `${name} must be the provider's function`);
    }
  });

  test('provider wires the dashboard reads, declines writes + headroom reads', () => {
    const caps = linearProvider.capabilities;
    for (const m of PROVIDER_SURFACE.reads) {
      assert.strictEqual(caps[m], true, `read ${m} must be implemented`);
    }
    for (const m of [...PROVIDER_SURFACE.readsHeadroom, ...PROVIDER_SURFACE.writes]) {
      assert.strictEqual(caps[m], false, `${m} must remain unimplemented this phase`);
      assert.throws(() => linearProvider[m](), NotImplementedError);
    }
  });

  test('writes are first-class declared methods (present, gated, not 500-prone)', () => {
    for (const w of PROVIDER_SURFACE.writes) {
      assert.strictEqual(typeof linearProvider[w], 'function');
      assert.strictEqual(linearProvider.supports(w), false);
    }
  });

  test('getAuthRouter is implemented (LIN-331): returns the Linear OAuth router', () => {
    const router = linearProvider.getAuthRouter({
      sessionStore: { cleanup: async () => {} },
      userPreferencesStore: null
    });
    // An Express router is a callable function exposing .use/.get.
    assert.strictEqual(typeof router, 'function');
    assert.strictEqual(typeof router.get, 'function');
  });

  test('getCreateTaskUrl is implemented (LIN-331): byte-identical Linear deep link', () => {
    assert.strictEqual(
      linearProvider.getCreateTaskUrl('acme', 'proj_123'),
      'https://linear.app/acme/new?project=proj_123'
    );
    // Components are URL-encoded, matching render.js's prior inline form.
    assert.strictEqual(
      linearProvider.getCreateTaskUrl('a/b', 'p?x'),
      'https://linear.app/a%2Fb/new?project=p%3Fx'
    );
  });

  test('provider inherits mapState delegation', () => {
    assert.deepStrictEqual(
      linearProvider.mapState('started'),
      { ...getStateDisplay('started'), order: getStateOrder('started') }
    );
  });
});

// =============================================================================
// Guardrails survived the move (offline source-shape checks)
// =============================================================================

describe('LIN-330 move preserves prior guardrails', () => {
  const providerSource = readFileSync(
    join(__dirname, '../../lib/providers/linear/index.js'),
    'utf8'
  );

  test('abort signal still threaded through the GraphQL boundary', () => {
    // The three abortable fetchers must still accept { signal } and pass it to
    // client.request (LIN-300 keepalive backstop).
    for (const fn of ['fetchIssueContext', 'fetchFocusedChild', 'fetchRecommendationContext']) {
      const re = new RegExp(`export async function ${fn}\\(apiKey, issueId, \\{ signal \\} = \\{\\}\\)`);
      assert.match(providerSource, re, `${fn} must accept { signal }`);
    }
    assert.match(providerSource, /document: ISSUE_DETAIL_QUERY, variables: \{ id: issueId \}, signal/);
    assert.match(providerSource, /document: FOCUSED_CHILD_QUERY, variables: \{ id: issueId \}, signal/);
  });

  test('LIN-284 sibling/cousin pre-truncation counts still emitted', () => {
    assert.match(providerSource, /siblingsTotal = allSiblings\.length/);
    assert.match(providerSource, /cousinsTotal = flatCousins\.length/);
    assert.match(providerSource, /siblings = allSiblings\.slice\(0, SIBLING_CAP\)/);
    assert.match(providerSource, /cousins = flatCousins\.slice\(0, COUSIN_CAP\)/);
  });

  test('no accidental deep-flatten of {nodes:[...]} (still reads .nodes)', () => {
    // Deferred to LIN-306 — the provider must still consume the nested shape.
    assert.match(providerSource, /issue\.labels\?\.nodes/);
    assert.match(providerSource, /issue\.comments\?\.nodes/);
    assert.match(providerSource, /parent\?\.children\?\.nodes/);
  });
});
