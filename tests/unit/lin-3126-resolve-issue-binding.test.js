/**
 * LIN-3240 (LIN-3126 slice 1) — the store-free resolver contract, §1.
 *
 * Covers `findBindingBySelector`, the strict `resolveIssueBinding` table and
 * the explicit-default `resolveDefaultBinding`, plus the refusal → HTTP
 * translation. Everything real except the network; no store is imported (the
 * per-request credential side-table is hydrated directly, the same way the
 * D6/PR3 unit suites do).
 *
 * Seed: a connection-backed GitHub workspace bound to two repos on one
 * connection — `octo/repoA` (active marker) and `octo/repoB` — each hydrated
 * with its own installation token. This is the shape the strict resolver
 * exists for: `source=github` alone names NO binding.
 *
 * Run with: node --test tests/unit/lin-3126-resolve-issue-binding.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  linkProvider,
  getBindingsForWorkspace,
  getWorkspaceCallScope,
  resolveIssueBinding,
  resolveDefaultBinding,
  findBindingBySelector,
  bindingRefusalResponse,
} from '../../lib/workspace.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { setBindingCredential, setWorkspaceCredential } from '../../lib/connection-binding.js';

let seq = 0;
/** Register a fake provider under a unique name so tests never contend over one registry slot. */
function fakeProvider(prefix = 'fake-lin3240') {
  const name = `${prefix}-${++seq}`;
  return registerProvider({ name, ui: {}, supports: () => true });
}

const REPO_A = 'octo/repoA';
const REPO_B = 'octo/repoB';

/**
 * A connection-backed two-repo GitHub workspace: one connection (`conn-1`),
 * `repoA` marked active, each binding hydrated with its own token. `source`
 * alone is therefore ambiguous — the exact LIN-3126 shape.
 */
function twoRepoConnectionWorkspace({ activeScope = REPO_A } = {}) {
  const gh = registerProvider({ name: 'github', ui: {}, supports: () => true });
  const bindings = [
    { provider: 'github', scope: REPO_A, connectionId: 'conn-1' },
    { provider: 'github', scope: REPO_B, connectionId: 'conn-1' },
  ];
  setBindingCredential(bindings[0], { installationId: '99', token: 'tok-a' });
  setBindingCredential(bindings[1], { installationId: '99', token: 'tok-b' });
  const ws = {
    id: 'ws-1', urlKey: 'acme', provider: 'github', bindings,
    activeBinding: { provider: 'github', scope: activeScope },
  };
  // A workspace-level credential deliberately DISTINCT from repoA's binding
  // token, so a resolver that shortcuts to `getWorkspaceCallScope` instead of
  // the marker's binding is caught by the token it serves.
  setWorkspaceCredential(ws, { token: 'tok-ws-decoy' });
  return { ws, gh };
}

/** A legacy (connection-less) two-binding GitHub workspace, via the real linkProvider. */
function legacyTwoRepoWorkspace() {
  const gh = registerProvider({ name: 'github', ui: {}, supports: () => true });
  const ws = linkProvider({ id: 'ws-1', urlKey: 'acme' }, 'github', REPO_A, { token: 'tok-a' });
  linkProvider(ws, 'github', REPO_B, { token: 'tok-b' });
  return { ws, gh };
}

describe('LIN-3240 findBindingBySelector', () => {
  test('returns the exact (provider, scope) binding', () => {
    const { ws, gh } = twoRepoConnectionWorkspace();
    const found = findBindingBySelector(ws, { source: 'github', bindingScope: REPO_B });
    assert.equal(found.error, undefined);
    assert.equal(found.binding.provider, gh.name);
    assert.equal(found.binding.scope, REPO_B);
  });

  test('trims both selector fields before matching', () => {
    const { ws } = twoRepoConnectionWorkspace();
    const found = findBindingBySelector(ws, { source: '  github ', bindingScope: `  ${REPO_B}  ` });
    assert.equal(found.error, undefined);
    assert.equal(found.binding.scope, REPO_B);
  });

  test('matching is case-sensitive', () => {
    const { ws } = twoRepoConnectionWorkspace();
    const found = findBindingBySelector(ws, { source: 'GitHub', bindingScope: REPO_B });
    assert.equal(found.error?.code, 'UNKNOWN_BINDING');
  });

  test('an unknown scope refuses UNKNOWN_BINDING and lists the provider scopes', () => {
    const { ws } = twoRepoConnectionWorkspace();
    const found = findBindingBySelector(ws, { source: 'github', bindingScope: 'octo/nope' });
    assert.deepEqual(found.error, {
      code: 'UNKNOWN_BINDING', provider: 'github', bindings: [REPO_A, REPO_B],
    });
  });

  test('array or object selector fields refuse UNKNOWN_BINDING', () => {
    const { ws } = twoRepoConnectionWorkspace();
    assert.equal(findBindingBySelector(ws, { source: ['github'], bindingScope: REPO_B }).error.code, 'UNKNOWN_BINDING');
    assert.equal(findBindingBySelector(ws, { source: 'github', bindingScope: { repo: REPO_B } }).error.code, 'UNKNOWN_BINDING');
    assert.equal(findBindingBySelector(ws, { source: {}, bindingScope: REPO_B }).error.code, 'UNKNOWN_BINDING');
  });

  test('a blank or absent field refuses UNKNOWN_BINDING (never the active binding)', () => {
    const { ws } = twoRepoConnectionWorkspace();
    assert.equal(findBindingBySelector(ws, { source: 'github', bindingScope: '   ' }).error.code, 'UNKNOWN_BINDING');
    assert.equal(findBindingBySelector(ws, { bindingScope: REPO_B }).error.code, 'UNKNOWN_BINDING');
    assert.equal(findBindingBySelector(ws, {}).error.code, 'UNKNOWN_BINDING');
  });

  test('a selector field longer than 200 chars refuses UNKNOWN_BINDING', () => {
    const { ws } = twoRepoConnectionWorkspace();
    const long = 'x'.repeat(201);
    assert.equal(findBindingBySelector(ws, { source: long, bindingScope: REPO_B }).error.code, 'UNKNOWN_BINDING');
    assert.equal(findBindingBySelector(ws, { source: 'github', bindingScope: long }).error.code, 'UNKNOWN_BINDING');
  });
});

describe('LIN-3240 resolveIssueBinding — §1 table', () => {
  test('source + bindingScope resolves the issue\'s OWN binding, and the call scope is its hydrated credential', () => {
    const { ws, gh } = twoRepoConnectionWorkspace();
    const resolved = resolveIssueBinding(ws, { source: 'github', bindingScope: REPO_B });
    assert.equal(resolved.provider, gh);
    assert.deepEqual(resolved.callScope, { token: 'tok-b', repo: REPO_B });
    // The B1 guard at the resolver: bindingScope selected, it never became the token.
    assert.notEqual(resolved.callScope.token, REPO_B);
  });

  test('source + bindingScope with no match refuses UNKNOWN_BINDING — never the active binding', () => {
    const { ws } = twoRepoConnectionWorkspace();
    const resolved = resolveIssueBinding(ws, { source: 'github', bindingScope: 'octo/ghost' });
    assert.equal(resolved.error?.code, 'UNKNOWN_BINDING');
    assert.equal(resolved.callScope, undefined);
    assert.equal(resolved.provider, undefined);
  });

  test('a token-looking bindingScope is selection-only, never a credential', () => {
    const { ws } = twoRepoConnectionWorkspace();
    const resolved = resolveIssueBinding(ws, { source: 'github', bindingScope: 'tok-b' });
    assert.equal(resolved.error?.code, 'UNKNOWN_BINDING');
    assert.equal(resolved.callScope, undefined);
  });

  test('a bare `source` string stays accepted (existing caller convention)', () => {
    const sole = fakeProvider('fake-lin3240-sole');
    const ws = linkProvider({ id: 'ws-1' }, sole.name, 'sole-scope', { token: 'sole-token' });
    const resolved = resolveIssueBinding(ws, sole.name);
    assert.equal(resolved.provider, sole);
    assert.equal(resolved.callScope, 'sole-token');
  });

  test('source only, exactly one binding for that provider: that binding (unambiguous)', () => {
    const active = fakeProvider('fake-lin3240-active');
    const secondary = fakeProvider('fake-lin3240-secondary');
    const ws = {
      id: 'ws-1', provider: active.name, accessToken: 'active-token',
      bindings: [
        { provider: active.name, scope: 'active-scope', credentials: { token: 'active-token' } },
        { provider: secondary.name, scope: 'secondary-scope', credentials: { token: 'secondary-token' } },
      ],
    };
    const resolved = resolveIssueBinding(ws, secondary.name);
    assert.equal(resolved.provider, secondary);
    assert.equal(resolved.callScope, 'secondary-token');
  });

  test('source only, >1 CONNECTION-BACKED bindings: BINDING_REQUIRED with the scopes', () => {
    const { ws } = twoRepoConnectionWorkspace();
    const resolved = resolveIssueBinding(ws, 'github');
    assert.deepEqual(resolved.error, {
      code: 'BINDING_REQUIRED', provider: 'github', bindings: [REPO_A, REPO_B],
    });
    assert.equal(resolved.callScope, undefined);
  });

  test('source only, >1 LEGACY connection-less bindings: today\'s active-preference, unchanged', () => {
    const { ws } = legacyTwoRepoWorkspace();
    // linkProvider mirrors the LAST same-provider link, so tok-b/repoB is active.
    const resolved = resolveIssueBinding(ws, 'github');
    assert.equal(resolved.error, undefined);
    assert.deepEqual(resolved.callScope, { token: 'tok-b', repo: REPO_B });
  });

  test('there is no matches[0] path for a connection-backed pair', () => {
    const { ws } = twoRepoConnectionWorkspace();
    const resolved = resolveIssueBinding(ws, 'github');
    // If matches[0] had won, this would be repoA.
    assert.equal(resolved.callScope, undefined);
    assert.equal(resolved.error?.code, 'BINDING_REQUIRED');
  });

  test('neither, single-binding: the active pair, as today', () => {
    const sole = fakeProvider('fake-lin3240-single');
    const ws = linkProvider({ id: 'ws-1' }, sole.name, 'sole-scope', { token: 'sole-token' });
    const resolved = resolveIssueBinding(ws, null);
    assert.equal(resolved.provider, sole);
    assert.equal(resolved.callScope, 'sole-token');
  });

  test('neither, legacy: the active pair, as today', () => {
    const active = fakeProvider('fake-lin3240-legacy-active');
    const secondary = fakeProvider('fake-lin3240-legacy-secondary');
    const ws = {
      id: 'ws-1', provider: active.name, accessToken: 'active-token',
      bindings: [
        { provider: active.name, scope: 'active-scope', credentials: { token: 'active-token' } },
        { provider: secondary.name, scope: 'secondary-scope', credentials: { token: 'secondary-token' } },
      ],
    };
    const resolved = resolveIssueBinding(ws, null);
    assert.equal(resolved.provider, active);
    assert.equal(resolved.callScope, 'active-token');
  });

  test('neither, multi-binding connection-backed mixed providers, active provider has ONE binding: active pair', () => {
    const lin = registerProvider({ name: 'linear', ui: {}, supports: () => true });
    const bindings = [
      { provider: 'linear', scope: 'org-1', connectionId: 'conn-l' },
      { provider: 'github', scope: REPO_A, connectionId: 'conn-g' },
      { provider: 'github', scope: REPO_B, connectionId: 'conn-g' },
    ];
    setBindingCredential(bindings[0], { token: 'lin-tok' });
    setBindingCredential(bindings[1], { installationId: '99', token: 'tok-a' });
    setBindingCredential(bindings[2], { installationId: '99', token: 'tok-b' });
    const ws = {
      id: 'ws-1', provider: 'linear', bindings,
      activeBinding: { provider: 'linear', scope: 'org-1' },
    };
    setWorkspaceCredential(ws, { token: 'lin-tok' });
    const resolved = resolveIssueBinding(ws, null);
    assert.equal(resolved.provider, lin);
    assert.equal(resolved.callScope, 'lin-tok');
  });

  test('neither, multi-binding connection-backed, active provider has >1 bindings: BINDING_REQUIRED', () => {
    const { ws } = twoRepoConnectionWorkspace();
    const resolved = resolveIssueBinding(ws, null);
    assert.deepEqual(resolved.error, {
      code: 'BINDING_REQUIRED', provider: 'github', bindings: [REPO_A, REPO_B],
    });
    assert.equal(resolved.callScope, undefined);
  });

  test('an unmatched source falls through to the active pair, unchanged', () => {
    const active = fakeProvider('fake-lin3240-unmatched-active');
    const ws = {
      id: 'ws-1', provider: active.name, accessToken: 'active-token',
      bindings: [{ provider: active.name, scope: 'active-scope', credentials: { token: 'active-token' } }],
    };
    const resolved = resolveIssueBinding(ws, 'some-unrelated-provider-name');
    assert.equal(resolved.provider, active);
    assert.equal(resolved.callScope, 'active-token');
  });
});

describe('LIN-3240 resolveDefaultBinding', () => {
  test('no selector on a connection-backed workspace: the marker\'s active binding', () => {
    const { ws, gh } = twoRepoConnectionWorkspace();
    const resolved = resolveDefaultBinding(ws);
    assert.equal(resolved.provider, gh);
    assert.deepEqual(resolved.callScope, { token: 'tok-a', repo: REPO_A });
  });

  test('never refuses for ambiguity on a two-repo connection-backed workspace', () => {
    const { ws } = twoRepoConnectionWorkspace();
    const resolved = resolveDefaultBinding(ws);
    assert.equal(resolved.error, undefined);
  });

  test('a legacy/marker-less workspace returns today\'s getProviderForWorkspace + getWorkspaceCallScope pair', () => {
    const sole = fakeProvider('fake-lin3240-default-legacy');
    const ws = linkProvider({ id: 'ws-1', urlKey: 'acme' }, sole.name, 'sole-scope', { token: 'sole-token' });
    const resolved = resolveDefaultBinding(ws);
    assert.deepEqual(resolved, { provider: sole, callScope: 'sole-token' });
    assert.equal(resolved.callScope, getWorkspaceCallScope(ws));
  });

  test('an explicit valid selector is honoured (writing to a non-default binding must be explicit)', () => {
    const { ws, gh } = twoRepoConnectionWorkspace();
    const resolved = resolveDefaultBinding(ws, { source: 'github', bindingScope: REPO_B });
    assert.equal(resolved.provider, gh);
    assert.deepEqual(resolved.callScope, { token: 'tok-b', repo: REPO_B });
  });

  test('an unknown explicit selector refuses UNKNOWN_BINDING, never a silent default pick', () => {
    const { ws } = twoRepoConnectionWorkspace();
    const resolved = resolveDefaultBinding(ws, { source: 'github', bindingScope: 'octo/ghost' });
    assert.deepEqual(resolved.error, {
      code: 'UNKNOWN_BINDING', provider: 'github', bindings: [REPO_A, REPO_B],
    });
    assert.equal(resolved.callScope, undefined);
  });
});

describe('LIN-3240 bindingRefusalResponse', () => {
  test('maps a BINDING_REQUIRED refusal to the one HTTP shape', () => {
    const { ws } = twoRepoConnectionWorkspace();
    const refusal = resolveIssueBinding(ws, 'github');
    assert.deepEqual(bindingRefusalResponse(refusal), {
      status: 422,
      body: { code: 'BINDING_REQUIRED', provider: 'github', bindings: [REPO_A, REPO_B] },
    });
  });

  test('maps an UNKNOWN_BINDING refusal to the same shape', () => {
    const { ws } = twoRepoConnectionWorkspace();
    const refusal = resolveIssueBinding(ws, { source: 'github', bindingScope: 'octo/ghost' });
    assert.deepEqual(bindingRefusalResponse(refusal), {
      status: 422,
      body: { code: 'UNKNOWN_BINDING', provider: 'github', bindings: [REPO_A, REPO_B] },
    });
  });
});

describe('LIN-3240 byte-identity for single-binding and legacy', () => {
  test('resolveIssueBinding with no source equals the literal {getProviderForWorkspace, getWorkspaceCallScope} pair', () => {
    const sole = fakeProvider('fake-lin3240-byte');
    const ws = linkProvider({ id: 'ws-1', urlKey: 'acme' }, sole.name, 'sole-scope', { token: 'sole-token' });
    const resolved = resolveIssueBinding(ws, null);
    assert.deepEqual(resolved, { provider: sole, callScope: getWorkspaceCallScope(ws) });
    assert.deepEqual(Object.keys(resolved).sort(), ['callScope', 'provider']);
    assert.equal(getBindingsForWorkspace(ws).length, 1);
  });

  test('a single-binding workspace resolves identically with or without a source', () => {
    const sole = fakeProvider('fake-lin3240-identical');
    const ws = linkProvider({ id: 'ws-1', urlKey: 'acme' }, sole.name, 'sole-scope', { token: 'sole-token' });
    assert.deepEqual(resolveIssueBinding(ws, undefined), resolveIssueBinding(ws, sole.name));
  });
});
