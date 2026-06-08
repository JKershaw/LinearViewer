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
import { makeStubProvider } from '../fixtures/stub-provider.js';

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

// =============================================================================
// UI/prompt capability surface (LIN-332, S0 of LIN-177 Phase 3)
// =============================================================================
//
// `provider.ui` is the single read path for capability-aware render (S3),
// prompt-formatters (S4), and prompt-templates (S5). It is ABSTRACT and additive
// — deliberately decoupled from the method-keyed `capabilities`/`supports()`.

describe('provider.ui surface (LIN-332)', () => {
  test('base ProviderInterface ui: all flags false, displayName falls back to name', () => {
    const base = new ProviderInterface();
    assert.deepStrictEqual(base.ui, {
      write: false,
      comments: false,
      estimates: false,
      subtasks: false,
      displayName: base.name, // 'base' — the machine name, never undefined
    });
    assert.strictEqual(base.ui.displayName, 'base');
  });

  test('linearProvider.ui has the locked shape (write/comments auto-derive)', () => {
    assert.deepStrictEqual(linearProvider.ui, {
      write: true,      // getCreateTaskUrl is overridden
      comments: true,   // fetchIssueComments is implemented
      estimates: true,  // estimate is in ISSUE_FIELDS_FRAGMENT
      subtasks: true,   // children/parent are fetched
      displayName: 'Linear',
    });
  });

  test('displayName (human) is distinct from name (machine)', () => {
    assert.strictEqual(linearProvider.name, 'linear');
    assert.strictEqual(linearProvider.ui.displayName, 'Linear');
    assert.notStrictEqual(linearProvider.ui.displayName, linearProvider.name);
  });

  test('regression guard: ui.write is decoupled from supports("createIssue")', () => {
    // The entire reason this surface exists: supports('createIssue') is
    // intentionally false this phase, yet "+ Add task" (ui.write) must stay on
    // for Linear. Gating ui.write on supports('createIssue') would regress S3.
    assert.strictEqual(linearProvider.supports('createIssue'), false);
    assert.strictEqual(linearProvider.ui.write, true);
  });

  test('makeStubProvider toggles each flag independently', () => {
    // Defaults: everything off, displayName defaults to name.
    assert.deepStrictEqual(makeStubProvider().ui, {
      write: false, comments: false, estimates: false, subtasks: false,
      displayName: 'stub',
    });

    // Each flag flips in isolation without disturbing the others.
    assert.strictEqual(makeStubProvider({ write: true }).ui.write, true);
    assert.strictEqual(makeStubProvider({ write: true }).ui.comments, false);
    assert.strictEqual(makeStubProvider({ comments: true }).ui.comments, true);
    assert.strictEqual(makeStubProvider({ estimates: true }).ui.estimates, true);
    assert.strictEqual(makeStubProvider({ subtasks: true }).ui.subtasks, true);

    // displayName can be set explicitly or defaults to name.
    assert.strictEqual(makeStubProvider({ name: 'jira' }).ui.displayName, 'jira');
    assert.strictEqual(
      makeStubProvider({ name: 'jira', displayName: 'Jira' }).ui.displayName,
      'Jira'
    );

    // A fully-on permutation, proving flags are independent end-to-end.
    assert.deepStrictEqual(
      makeStubProvider({
        name: 'gh', write: true, comments: true, estimates: true,
        subtasks: true, displayName: 'GitHub',
      }).ui,
      { write: true, comments: true, estimates: true, subtasks: true, displayName: 'GitHub' }
    );
  });

  test('stub independence: building stubs never mutates the Linear singleton', () => {
    makeStubProvider({ write: true, displayName: 'Other' });
    // linearProvider.ui is unaffected by stub construction.
    assert.deepStrictEqual(linearProvider.ui, {
      write: true, comments: true, estimates: true, subtasks: true, displayName: 'Linear',
    });
  });
});
