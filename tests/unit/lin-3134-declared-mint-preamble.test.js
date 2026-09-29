/**
 * LIN-3138 S2 (LIN-3134 T2-i) — preamble declared branch.
 *
 * Witnesses the ticket's S2 acceptance:
 *   - the `[]` default is byte-identical (still createToken + string|null);
 *   - a declared call validates PRE-MINT, mints via `mintGrantBootstrap`, and
 *     returns `{token, grantDeclaration}` with the recorded shape;
 *   - refusal taxonomy: missing workspace/site → INVALID_GRANTS 400, missing
 *     owner → GRANT_OWNERLESS 503, each with the mint spy at 0;
 *   - refusal-shape parity against a REAL `mintGrantBootstrap` refusal;
 *   - NB3: an uncoded mint throw is wrapped by failClosed (proxyAttachFailed) in
 *     prose AND MCP mode, never degrading to grant-less;
 *   - a coded refusal is rethrown unchanged (transient sets proxyAttachFailed);
 *   - the `resume-record-corrupt` log carries no values;
 *   - `attachProxyContext` declared returns `{prompt, bootstrapToken, grantDeclaration}`.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  provisionBootstrapToken,
  attachProxyContext,
  STRUCTURAL_GRANT_REFUSAL_CODES,
  isStructuralGrantRefusal
} from '../../lib/proxy-preamble.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';

const TOKEN = 'declared-tok';
const DECLARED = {
  declaredGrants: ['dispatch'],
  grantOwnerAccountId: 'account-A',
  workspaceId: 'ws-1',
  declaredSite: 'proxy-kickoff'
};

function mintSpy({ result, error } = {}) {
  const calls = [];
  return {
    calls,
    async mintGrantBootstrap(args) {
      calls.push(args);
      if (error) throw error;
      return result || { token: TOKEN, tokenId: 't1', workspaceId: args.workspaceId };
    },
    async createToken(urlKey, opts) {
      return { token: 'plain-tok' };
    }
  };
}

function shapeOf(err) {
  return { code: err.code, status: err.status, retryable: err.retryable };
}

// ── taxonomy exports ─────────────────────────────────────────────────────────

describe('S2 — refusal taxonomy', () => {
  test('STRUCTURAL_GRANT_REFUSAL_CODES is the closed four-code set', () => {
    assert.deepEqual(STRUCTURAL_GRANT_REFUSAL_CODES, [
      'WORKSPACE_OWNER_UNSET', 'GRANT_OWNER_ONLY', 'GRANT_OWNERLESS', 'INVALID_GRANTS'
    ]);
  });

  test('isStructuralGrantRefusal matches only those codes', () => {
    for (const code of STRUCTURAL_GRANT_REFUSAL_CODES) assert.equal(isStructuralGrantRefusal({ code }), true);
    assert.equal(isStructuralGrantRefusal({ code: 'OWNER_CHECK_UNAVAILABLE' }), false);
    assert.equal(isStructuralGrantRefusal({}), false);
    assert.equal(isStructuralGrantRefusal(null), false);
  });
});

// ── empty path unchanged ─────────────────────────────────────────────────────

describe('S2 — empty declaredGrants keeps the existing path', () => {
  test('provisionBootstrapToken still createTokens and returns a string', async () => {
    const calls = [];
    const store = { createToken: async (urlKey, opts) => { calls.push({ urlKey, opts }); return { token: 'plain' }; } };
    const token = await provisionBootstrapToken({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://h', createdBy: 'u1' });
    assert.equal(token, 'plain');
    assert.deepEqual(calls[0].opts, { kind: 'bootstrap', scope: 'readWrite', label: 'dispatch-bootstrap', ttl: 48 * 60 * 60, createdBy: 'u1' });
  });

  test('an explicit empty array and an omitted arg behave identically', async () => {
    const store = mintSpy();
    const a = await provisionBootstrapToken({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://h', createdBy: 'u1' });
    const b = await provisionBootstrapToken({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://h', createdBy: 'u1', declaredGrants: [] });
    assert.equal(a, 'plain-tok');
    assert.equal(b, 'plain-tok');
    assert.equal(store.calls.length, 0, 'no grant mint on the empty path');
  });

  test('attachProxyContext empty path returns exactly {prompt, bootstrapToken}', async () => {
    const store = { createToken: async () => ({ token: 'plain' }) };
    const result = await attachProxyContext({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://h', prompt: 'do', harness: 'opencode', createdBy: 'u1' });
    assert.deepEqual(Object.keys(result).sort(), ['bootstrapToken', 'prompt']);
    assert.equal('grantDeclaration' in result, false);
  });
});

// ── declared mint + shape ────────────────────────────────────────────────────

describe('S2 — declared mint', () => {
  test('mints via mintGrantBootstrap with the exact args and returns {token, grantDeclaration}', async () => {
    const store = mintSpy();
    const result = await provisionBootstrapToken({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://h', label: 'dispatch-bootstrap', harness: 'claude-code', createdBy: 'poster-ignored', ...DECLARED });
    assert.equal(store.calls.length, 1);
    assert.deepEqual(store.calls[0], {
      urlKey: 'acme',
      workspaceId: 'ws-1',
      ownerAccountId: 'account-A',
      grants: ['dispatch'],
      label: 'dispatch-bootstrap',
      profile: 'worker'
    });
    assert.equal(result.token, TOKEN);
    assert.deepEqual(Object.keys(result.grantDeclaration), ['grants', 'ownerAccountId', 'workspaceId', 'profile', 'site', 'declaredAt']);
    assert.deepEqual(result.grantDeclaration.grants, ['dispatch']);
    assert.equal(result.grantDeclaration.ownerAccountId, 'account-A');
    assert.equal(result.grantDeclaration.workspaceId, 'ws-1', 'workspaceId comes from the mint return');
    assert.equal(result.grantDeclaration.profile, 'worker');
    assert.equal(result.grantDeclaration.site, 'proxy-kickoff');
    assert.equal(typeof result.grantDeclaration.declaredAt, 'string');
  });

  test('missing workspaceId -> INVALID_GRANTS 400 pre-mint (spy 0)', async () => {
    const store = mintSpy();
    await assert.rejects(
      () => provisionBootstrapToken({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://h', ...DECLARED, workspaceId: null }),
      (err) => err.code === 'INVALID_GRANTS' && err.status === 400 && err.retryable === false
    );
    assert.equal(store.calls.length, 0);
  });

  test('missing declaredSite -> INVALID_GRANTS 400 pre-mint (spy 0)', async () => {
    const store = mintSpy();
    await assert.rejects(
      () => provisionBootstrapToken({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://h', ...DECLARED, declaredSite: '   ' }),
      (err) => err.code === 'INVALID_GRANTS' && err.status === 400
    );
    assert.equal(store.calls.length, 0);
  });

  test('missing owner -> GRANT_OWNERLESS 503 pre-mint (spy 0)', async () => {
    const store = mintSpy();
    await assert.rejects(
      () => provisionBootstrapToken({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://h', ...DECLARED, grantOwnerAccountId: null }),
      (err) => err.code === 'GRANT_OWNERLESS' && err.status === 503 && err.retryable === false
    );
    assert.equal(store.calls.length, 0);
  });

  test('validation runs BEFORE the store/baseUrl check (spy absent)', async () => {
    await assert.rejects(
      () => provisionBootstrapToken({ proxyTokenStore: null, urlKey: 'acme', baseUrl: null, ...DECLARED, workspaceId: null }),
      (err) => err.code === 'INVALID_GRANTS'
    );
  });

  test('shape parity against a REAL mintGrantBootstrap refusal', async () => {
    // A real refusal: no ownerAccountId -> GRANT_OWNERLESS 503 false.
    const realStore = new ProxyTokenStore({ collection: {} });
    let realErr;
    try {
      await realStore.mintGrantBootstrap({ urlKey: 'acme', workspaceId: 'ws-1', grants: ['dispatch'] });
    } catch (e) { realErr = e; }

    const store = mintSpy();
    let ours;
    try {
      await provisionBootstrapToken({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://h', ...DECLARED, grantOwnerAccountId: null });
    } catch (e) { ours = e; }

    assert.equal(realErr.code, 'GRANT_OWNERLESS');
    assert.deepEqual(shapeOf(ours), shapeOf(realErr), 'the local refusal has the same {code,status,retryable} shape');
  });
});

// ── error plumbing ───────────────────────────────────────────────────────────

describe('S2 — error plumbing', () => {
  test('NB3: an uncoded mint throw is wrapped by failClosed in prose mode', async () => {
    const store = mintSpy({ error: new Error('insert failed') });
    await assert.rejects(
      () => provisionBootstrapToken({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://h', harness: 'opencode', ...DECLARED }),
      (err) => err.proxyAttachFailed === true
    );
  });

  test('NB3: an uncoded mint throw is wrapped by failClosed in MCP mode', async () => {
    const store = mintSpy({ error: new Error('insert failed') });
    await assert.rejects(
      () => provisionBootstrapToken({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://h', harness: 'claude-code', ...DECLARED }),
      (err) => err.proxyAttachFailed === true
    );
  });

  test('a coded structural refusal is rethrown UNCHANGED (not wrapped)', async () => {
    const coded = Object.assign(new Error('Grant bootstrap mint refused: GRANT_OWNER_ONLY'), { code: 'GRANT_OWNER_ONLY', status: 403, retryable: false });
    const store = mintSpy({ error: coded });
    await assert.rejects(
      () => provisionBootstrapToken({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://h', harness: 'claude-code', ...DECLARED }),
      (err) => err === coded && err.proxyAttachFailed === undefined
    );
  });

  test('a coded transient refusal sets proxyAttachFailed and is rethrown unchanged', async () => {
    const coded = Object.assign(new Error('Grant bootstrap mint refused: OWNER_CHECK_UNAVAILABLE'), { code: 'OWNER_CHECK_UNAVAILABLE', status: 503, retryable: true });
    const store = mintSpy({ error: coded });
    await assert.rejects(
      () => provisionBootstrapToken({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://h', ...DECLARED }),
      (err) => err === coded && err.proxyAttachFailed === true
    );
  });

  test('missing store on a declared call fails closed in prose AND MCP mode', async () => {
    for (const harness of ['opencode', 'claude-code']) {
      await assert.rejects(
        () => provisionBootstrapToken({ proxyTokenStore: null, urlKey: 'acme', baseUrl: 'https://h', harness, ...DECLARED }),
        (err) => err.proxyAttachFailed === true
      );
    }
  });

  test('resume-record-corrupt log carries ids/codes only, never values', async () => {
    const logs = [];
    const orig = console.error;
    console.error = (...args) => logs.push(args);
    try {
      await provisionBootstrapToken({ proxyTokenStore: mintSpy(), urlKey: 'acme', baseUrl: 'https://h', ...DECLARED, workspaceId: null }).catch(() => {});
    } finally {
      console.error = orig;
    }
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], '[dispatch] resume-record-corrupt');
    assert.deepEqual(logs[0][1], { urlKey: 'acme', code: 'INVALID_GRANTS' });
  });
});

// ── attachProxyContext declared ──────────────────────────────────────────────

describe('S2 — attachProxyContext declared return shape', () => {
  test('MCP: {prompt, bootstrapToken: token, grantDeclaration}', async () => {
    const store = mintSpy();
    const result = await attachProxyContext({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://h', issueIdentifier: 'LIN-1', prompt: 'do', harness: 'claude-code', ...DECLARED });
    assert.deepEqual(Object.keys(result).sort(), ['bootstrapToken', 'grantDeclaration', 'prompt']);
    assert.equal(result.bootstrapToken, TOKEN);
    assert.ok(!result.prompt.includes(TOKEN), 'MCP strips the token from prose');
    assert.equal(result.grantDeclaration.ownerAccountId, 'account-A');
  });

  test('prose: token embedded, bootstrapToken null, grantDeclaration present', async () => {
    const store = mintSpy();
    const result = await attachProxyContext({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://h', issueIdentifier: 'LIN-1', prompt: 'do', harness: 'opencode', ...DECLARED });
    assert.deepEqual(Object.keys(result).sort(), ['bootstrapToken', 'grantDeclaration', 'prompt']);
    assert.strictEqual(result.bootstrapToken, null);
    assert.ok(result.prompt.includes(TOKEN), 'prose embeds the token');
    assert.equal(result.grantDeclaration.site, 'proxy-kickoff');
  });
});

// ── non-array declaredGrants fail closed (review finding 4) ───────────────────

describe('S2 — non-array declaredGrants is refused, never degrades to grant-less', () => {
  for (const [label, value] of [['string', 'dispatch'], ['null', null], ['object', { 0: 'dispatch' }]]) {
    test(`provisionBootstrapToken(${label}) -> INVALID_GRANTS 400 with no mint and no createToken`, async () => {
      const store = mintSpy();
      await assert.rejects(
        () => provisionBootstrapToken({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://h', harness: 'claude-code', declaredGrants: value }),
        (err) => err.code === 'INVALID_GRANTS' && err.status === 400 && err.retryable === false
      );
      assert.equal(store.calls.length, 0, 'neither mintGrantBootstrap nor createToken may be reached');
    });
  }

  test('attachProxyContext inherits the refusal (no mint)', async () => {
    const store = mintSpy();
    await assert.rejects(
      () => attachProxyContext({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://h', issueIdentifier: 'LIN-1', prompt: 'do', declaredGrants: 'dispatch' }),
      (err) => err.code === 'INVALID_GRANTS' && err.status === 400
    );
    assert.equal(store.calls.length, 0);
  });

  test('undefined and [] still take the plain path', async () => {
    const calls = [];
    const store = {
      async createToken(urlKey, opts) { calls.push({ createToken: true, urlKey, opts }); return { token: 'plain-tok' }; },
      async mintGrantBootstrap(args) { calls.push({ mint: true, args }); return { token: TOKEN, workspaceId: args.workspaceId }; }
    };
    const a = await provisionBootstrapToken({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://h', createdBy: 'u1', declaredGrants: undefined });
    const b = await provisionBootstrapToken({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://h', createdBy: 'u1', declaredGrants: [] });
    assert.equal(a, 'plain-tok');
    assert.equal(b, 'plain-tok');
    assert.equal(calls.length, 2);
    assert.ok(calls.every(c => c.createToken), 'only createToken on the plain path, never a grant mint');
  });
});

