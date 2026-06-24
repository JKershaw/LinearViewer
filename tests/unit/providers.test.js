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
  AuthExchangeError,
  PROVIDER_SURFACE,
} from '../../lib/providers/interface.js';
import {
  registerProvider,
  getProvider,
  getAllProviders,
  getProviderForWorkspace,
} from '../../lib/providers/registry.js';
import { getStateDisplay, getStateOrder } from '../../lib/providers/state-map.js';
import {
  issueSource,
  DEFAULT_SOURCE,
  SOURCE_LINEAR,
  SOURCE_GITHUB,
  SOURCE_LOCAL,
} from '../../lib/providers/models.js';
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

  test('beginAuth/completeAuth are declared headroom — throw NotImplementedError on the base (LIN-562)', () => {
    const base = new ProviderInterface();
    assert.throws(() => base.beginAuth({ state: 'x' }), NotImplementedError);
    assert.throws(() => base.completeAuth('code'), NotImplementedError);
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
// Canonical issue provenance (LIN-561)
// =============================================================================

describe('issue source provenance (LIN-561)', () => {
  test('source constants are the provider registry names', () => {
    assert.strictEqual(SOURCE_LINEAR, 'linear');
    assert.strictEqual(SOURCE_GITHUB, 'github');
    assert.strictEqual(SOURCE_LOCAL, 'local');
    // The constants equal each provider's registry .name, so the stamp matches
    // the identity downstream getProviderForWorkspace resolves on.
    assert.strictEqual(SOURCE_LINEAR, linearProvider.name);
  });

  test('DEFAULT_SOURCE is the legacy Linear default', () => {
    assert.strictEqual(DEFAULT_SOURCE, SOURCE_LINEAR);
  });

  test('issueSource returns a stamped source verbatim', () => {
    assert.strictEqual(issueSource({ source: 'github' }), 'github');
    assert.strictEqual(issueSource({ source: 'local' }), 'local');
  });

  test('issueSource defaults an un-stamped / missing issue to Linear (back-compat)', () => {
    assert.strictEqual(issueSource({ id: 'x' }), 'linear');
    assert.strictEqual(issueSource({}), 'linear');
    assert.strictEqual(issueSource(undefined), 'linear');
    assert.strictEqual(issueSource(null), 'linear');
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

  describe('getProviderForWorkspace (LIN-177 S3)', () => {
    test('resolves a workspace.provider when registered', () => {
      const stub = { name: 'gpfw-stub', ui: {} };
      registerProvider(stub);
      assert.strictEqual(getProviderForWorkspace({ provider: 'gpfw-stub' }), stub);
    });

    test('falls back to the Linear provider for legacy workspaces (no provider field)', () => {
      assert.strictEqual(getProviderForWorkspace({ urlKey: 'x' }), linearProvider);
    });

    test('falls back to Linear for undefined/null (landing page, no workspace)', () => {
      assert.strictEqual(getProviderForWorkspace(undefined), linearProvider);
      assert.strictEqual(getProviderForWorkspace(null), linearProvider);
    });

    test('falls back to Linear when workspace.provider names an unknown provider', () => {
      assert.strictEqual(getProviderForWorkspace({ provider: 'no-such-provider' }), linearProvider);
    });
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

  test('provider wires the FULL surface: dashboard reads + API reads + writes (LIN-307)', () => {
    // LIN-176 left the headroom reads and writes declared-only; LIN-307 wires
    // them on the Linear provider, so the entire declared surface is now
    // implemented and supported (capability-gated for non-Linear providers).
    const caps = linearProvider.capabilities;
    const all = [...PROVIDER_SURFACE.reads, ...PROVIDER_SURFACE.readsHeadroom, ...PROVIDER_SURFACE.writes];
    for (const m of all) {
      assert.strictEqual(typeof linearProvider[m], 'function', `${m} must be a function`);
      assert.strictEqual(caps[m], true, `${m} must be implemented`);
      assert.strictEqual(linearProvider.supports(m), true, `${m} must report supported`);
    }
  });

  test('LIN-307 additions (deleteRelation, comment edit/delete) are declared writes', () => {
    // The three methods LIN-307 adds beyond LIN-176's declared surface.
    for (const m of ['deleteRelation', 'updateComment', 'deleteComment']) {
      assert.ok(PROVIDER_SURFACE.writes.includes(m), `${m} must be a declared write`);
      assert.strictEqual(linearProvider.supports(m), true, `Linear must implement ${m}`);
      // Non-Linear providers opt out by inheriting the base decline.
      assert.throws(() => new ProviderInterface()[m](), NotImplementedError);
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

  test('beginAuth builds the byte-identical Linear authorize URL (LIN-562)', () => {
    const prev = {
      id: process.env.LINEAR_CLIENT_ID,
      uri: process.env.LINEAR_REDIRECT_URI,
    };
    process.env.LINEAR_CLIENT_ID = 'client-123';
    process.env.LINEAR_REDIRECT_URI = 'https://app.example/auth/callback';
    try {
      const url = linearProvider.beginAuth({ state: 'nonce-xyz' });
      // Exactly the params the /auth/linear route inlined before LIN-562.
      const expected = 'https://linear.app/oauth/authorize?' + new URLSearchParams({
        client_id: 'client-123',
        redirect_uri: 'https://app.example/auth/callback',
        response_type: 'code',
        scope: 'read,write',
        state: 'nonce-xyz',
        prompt: 'consent',
      }).toString();
      assert.strictEqual(url, expected);
    } finally {
      process.env.LINEAR_CLIENT_ID = prev.id;
      process.env.LINEAR_REDIRECT_URI = prev.uri;
    }
  });

  test('completeAuth exchanges the code and returns the token bag (LIN-562)', async () => {
    const realFetch = globalThis.fetch;
    let sentBody;
    globalThis.fetch = async (url, opts) => {
      assert.strictEqual(url, 'https://api.linear.app/oauth/token');
      sentBody = opts.body.toString();
      return { ok: true, json: async () => ({ access_token: 'tok', refresh_token: 'ref', expires_in: 3600 }) };
    };
    try {
      const data = await linearProvider.completeAuth('the-code');
      assert.deepStrictEqual(data, { access_token: 'tok', refresh_token: 'ref', expires_in: 3600 });
      assert.match(sentBody, /grant_type=authorization_code/);
      assert.match(sentBody, /code=the-code/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('completeAuth throws AuthExchangeError on a non-2xx exchange (byte-identical 400 path) (LIN-562)', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, json: async () => ({ error: 'invalid_grant' }) });
    try {
      await assert.rejects(
        () => linearProvider.completeAuth('bad-code'),
        (err) => {
          assert.ok(err instanceof AuthExchangeError);
          assert.strictEqual(err.code, 'AUTH_EXCHANGE_FAILED');
          assert.strictEqual(err.detail, 'invalid_grant');
          assert.strictEqual(err.provider, 'linear');
          return true;
        }
      );
    } finally {
      globalThis.fetch = realFetch;
    }
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
      // fetchRecommendationContext also accepts the LIN-365 noDescend lever after
      // signal; the abort-signal threading contract pinned here is unchanged.
      const re = new RegExp(`export async function ${fn}\\(apiKey, issueId, \\{ signal(?:, [^}]+)? \\} = \\{\\}\\)`);
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
    // The entire reason this surface exists (LIN-332): ui.write derives from
    // getCreateTaskUrl, NOT from supports('createIssue'). LIN-176 demonstrated
    // this when createIssue was unimplemented; LIN-307 now implements it, so the
    // decoupling is proven structurally instead — a provider that overrides ONLY
    // getCreateTaskUrl gets ui.write === true while createIssue stays declined.
    class WriteUrlOnly extends ProviderInterface {
      getCreateTaskUrl() { return 'https://example.test/new'; }
    }
    const p = new WriteUrlOnly();
    assert.strictEqual(p.supports('createIssue'), false); // createIssue NOT overridden
    assert.strictEqual(p.ui.write, true);                  // yet "+ Add task" is on
    // And for Linear (where LIN-307 now wires createIssue) ui.write is still on.
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
