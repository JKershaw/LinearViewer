/**
 * LIN-2351 — every proxy provider error was reported as "Linear API request
 * failed", whatever the actual provider. `graphqlErrorDetail()` (routes/proxy.js)
 * was the single producer of that hardcode: its fallback and timeout strings,
 * plus an auth-error `console.error` line inside the same function, always
 * named Linear regardless of which provider the workspace actually resolved
 * to. Two sibling `DOMException('Linear API request timed out', …)` raisers
 * (`withTimeout`/`fetchWithTimeout`) and the attachment SSRF guard's
 * "must be from Linear" message carried the same defect.
 *
 * The naive witness — assert `detail !== "Linear API request failed"` on a
 * GitHub workspace — passes without the fix, because a GitHub-backed call to
 * an ungated read now 422s via `denyIfUnsupported` (LIN-2350/LIN-2355) with no
 * `detail` at all. It would measure the capability gate, not attribution.
 * Every test below therefore uses a real `ProviderInterface` subclass that
 * IMPLEMENTS the read and throws a genuine upstream error from inside it —
 * load-bearing, since implementing the read is what makes the capability gate
 * pass so the route's `catch` (and `graphqlErrorDetail`) is genuinely reached
 * — and conjoins the catch-path status with the `detail` text, since either
 * alone is satisfiable by the wrong path.
 *
 * Fix shape: `resolveProviderAccess` stamps `req.resolvedProvider =
 * {name, displayName}` (both the general path and the `TEST_LOCAL_URL_KEY`
 * early return); `graphqlErrorDetail(err, req)` reads `displayName` and
 * derives both hardcoded strings and the auth-log line from it, falling back
 * to provider-neutral wording (never a guessed "Linear") when nothing is
 * stamped. On a Linear-named provider this is byte-identical to the pre-fix
 * strings — the Linear control tests below pin that.
 *
 * Run with: node --test tests/unit/proxy-provider-error-attribution.test.js
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { ProviderInterface } from '../../lib/providers/interface.js';
import { localProvider } from '../../lib/providers/local/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

before(() => { process.env.NODE_ENV = 'test'; });

const GITHUB_PROVIDER_NAME = 'lin2351-github-stub';
const LINEAR_PROVIDER_NAME = 'lin2351-linear-stub';
// Must match TEST_LOCAL_URL_KEY in routes/proxy.js.
const LOCAL_URL_KEY = 'local-workspace';

/**
 * A real ProviderInterface subclass that IMPLEMENTS `viewer` — so
 * `denyIfUnsupported` passes and the route's `catch` is genuinely reached —
 * then throws whatever `nextError` the test configures, simulating a real
 * upstream failure (5xx, 429, a timeout) from inside the implemented method.
 */
class ThrowingProvider extends ProviderInterface {
  constructor(name, displayName) {
    super();
    this.name = name;
    this._displayName = displayName;
    this.nextError = new Error('upstream boom');
  }
  get ui() {
    return { ...super.ui, displayName: this._displayName };
  }
  async viewer() {
    throw this.nextError;
  }
}

function buildApp(provider, { resolveWorkspaceAccess } = {}) {
  registerProvider(provider);
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1',
      }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: resolveWorkspaceAccess
      || (async () => ({ token: 'ws-token', reason: 'ok', provider: provider.name })),
    getWorkspaceAccessToken: async () => 'ws-token',
    agentStatusStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  }));
  return app;
}

async function call(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { Authorization: 'Bearer anything' },
    });
    let parsed = {};
    try { parsed = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(r => server.close(r));
  }
}

// ---------------------------------------------------------------------------
// The core defect: fallback + timeout hardcodes now name the resolved
// provider, conjoined with the catch-path status.
// ---------------------------------------------------------------------------
describe('graphqlErrorDetail attributes the resolved provider, not a hardcoded Linear', () => {
  test('a plain upstream error: 500 + detail names the provider, no "Linear"', async () => {
    const provider = new ThrowingProvider(GITHUB_PROVIDER_NAME, 'GitHub Issues');
    provider.nextError = new Error('some upstream failure');
    const { status, body } = await call(buildApp(provider), '/api/proxy/me');
    assert.equal(status, 500, JSON.stringify(body));
    assert.equal(body.detail, 'GitHub Issues API request failed');
    assert.doesNotMatch(body.detail, /Linear/);
  });

  // Shaped as err.response.status, not err.status: graphqlErrorStatus only
  // reads the former (the graphql-request shape) — real non-Linear clients
  // set err.status instead, which would silently map to 500 and assert the
  // wrong branch (the plan-review's own finding on this exact point).
  test('a 429-shaped upstream error (err.response.status): 429 + detail names the provider', async () => {
    const provider = new ThrowingProvider(GITHUB_PROVIDER_NAME, 'GitHub Issues');
    const err = new Error('rate limited');
    err.response = { status: 429 };
    provider.nextError = err;
    const { status, body } = await call(buildApp(provider), '/api/proxy/me');
    assert.equal(status, 429, JSON.stringify(body));
    assert.equal(body.detail, 'GitHub Issues API request failed');
  });

  test('a TimeoutError: 504 + timeout detail names the provider, no "Linear"', async () => {
    const provider = new ThrowingProvider(GITHUB_PROVIDER_NAME, 'GitHub Issues');
    const err = new Error('timed out');
    err.name = 'TimeoutError';
    provider.nextError = err;
    const { status, body } = await call(buildApp(provider), '/api/proxy/me');
    assert.equal(status, 504, JSON.stringify(body));
    assert.equal(
      body.detail,
      'GitHub Issues API request timed out — the response may be too large or GitHub Issues is slow. Try a more specific query.'
    );
    assert.doesNotMatch(body.detail, /Linear/);
  });

  // The Linear control: proves the dominant (Linear) path did not move —
  // byte-identical to the pre-fix hardcoded strings.
  test('Linear control: fallback detail is byte-identical to the pre-fix string', async () => {
    const provider = new ThrowingProvider(LINEAR_PROVIDER_NAME, 'Linear');
    provider.nextError = new Error('boom');
    const { status, body } = await call(buildApp(provider), '/api/proxy/me');
    assert.equal(status, 500, JSON.stringify(body));
    assert.equal(body.detail, 'Linear API request failed');
  });

  test('Linear control: timeout detail is byte-identical to the pre-fix string', async () => {
    const provider = new ThrowingProvider(LINEAR_PROVIDER_NAME, 'Linear');
    const err = new Error('timed out');
    err.name = 'TimeoutError';
    provider.nextError = err;
    const { status, body } = await call(buildApp(provider), '/api/proxy/me');
    assert.equal(status, 504, JSON.stringify(body));
    assert.equal(
      body.detail,
      'Linear API request timed out — the response may be too large or Linear is slow. Try a more specific query.'
    );
  });

  // gqlMessage passthrough is untouched — already provider-correct.
  test('a genuine graphql-request-shaped error still passes through the upstream message verbatim', async () => {
    const provider = new ThrowingProvider(GITHUB_PROVIDER_NAME, 'GitHub Issues');
    const err = new Error('graphql wrapper');
    err.response = { status: 400, errors: [{ message: 'that field does not exist' }] };
    provider.nextError = err;
    const { body } = await call(buildApp(provider), '/api/proxy/me');
    assert.equal(body.detail, 'that field does not exist');
  });
});

// ---------------------------------------------------------------------------
// No-stamp case: an error thrown before resolveProviderAccess ever resolves a
// provider (e.g. the workspace-credential lookup itself throws) must emit
// provider-neutral wording — never a guessed "Linear". graphqlErrorDetail is
// not exported, so this is exercised the only way a route shape can reach it
// with req.resolvedProvider unstamped: make resolveWorkspaceAccess itself
// throw, before resolveProviderAccess ever reaches the stamp line.
// ---------------------------------------------------------------------------
describe('no-stamp fallback: a failure before the provider resolves gets neutral wording', () => {
  test('resolveWorkspaceAccess throwing yields provider-neutral detail, never "Linear"', async () => {
    const provider = new ThrowingProvider(GITHUB_PROVIDER_NAME, 'GitHub Issues');
    const app = buildApp(provider, {
      resolveWorkspaceAccess: async () => { throw new Error('credential resolution exploded'); },
    });
    const { status, body } = await call(app, '/api/proxy/me');
    assert.equal(status, 500, JSON.stringify(body));
    assert.equal(body.detail, 'The upstream provider request failed');
    assert.doesNotMatch(body.detail, /Linear/);
  });
});

// ---------------------------------------------------------------------------
// The TEST_LOCAL_URL_KEY early-return branch in resolveProviderAccess must
// stamp req.resolvedProvider too (not just the general path) — verified
// against the real localProvider singleton, per the proxy-local-target.test.js
// precedent of configuring it directly for a test.
// ---------------------------------------------------------------------------
describe('the TEST_LOCAL_URL_KEY early-return branch stamps the Local provider too', () => {
  test('an upstream error routed through the local branch is attributed to Local, not Linear', async () => {
    localProvider.configure({
      store: { listProjects: async () => { throw new Error('local store exploded'); } },
    });
    const app = express();
    app.use(express.json());
    app.use(createProxyRoutes({
      proxyTokenStore: {
        validateToken: async () => ({
          tokenId: 't1', urlKey: LOCAL_URL_KEY, label: 'test', scope: 'readWrite', createdBy: 'u1',
        }),
      },
      proxyEventStore: { recordEvent: async () => {} },
      // The Linear-session path resolves nothing — proves the
      // TEST_LOCAL_URL_KEY early return, not the general path, is under test.
      resolveWorkspaceAccess: async () => ({ token: null, reason: 'not_connected' }),
      getWorkspaceAccessToken: async () => null,
      agentStatusStore: {},
      recapCacheStore: {},
      briefCacheStore: {},
      dispatchQueueStore: {},
      workspaceFromUrl: (req, res, next) => next(),
      getWorkspaceOpenRouterKey: async () => null,
      workspacePreferencesStore: {},
      freeTierStore: { tryUse: async () => ({ allowed: true }) },
    }));
    const { status, body } = await call(app, '/api/proxy/projects');
    assert.equal(status, 500, JSON.stringify(body));
    assert.equal(body.detail, 'Local API request failed');
  });

  test('a fresh request through a different provider never inherits the local attribution', async () => {
    // Two sequential requests through the SAME router — each Express request
    // gets its own req object, so this proves the stamp is per-request, not
    // leaking from the previous local-branch call above (or vice versa).
    localProvider.configure({
      store: { listProjects: async () => { throw new Error('local store exploded again'); } },
    });
    const githubProvider = new ThrowingProvider(GITHUB_PROVIDER_NAME, 'GitHub Issues');
    githubProvider.nextError = new Error('github upstream boom');
    registerProvider(githubProvider);

    const app = express();
    app.use(express.json());
    app.use(createProxyRoutes({
      proxyTokenStore: {
        validateToken: async (token) => (token === 'local-token'
          ? { tokenId: 't1', urlKey: LOCAL_URL_KEY, label: 'test', scope: 'readWrite', createdBy: 'u1' }
          : { tokenId: 't2', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }),
      },
      proxyEventStore: { recordEvent: async () => {} },
      resolveWorkspaceAccess: async (urlKey) => (urlKey === LOCAL_URL_KEY
        ? { token: null, reason: 'not_connected' }
        : { token: 'ws-token', reason: 'ok', provider: GITHUB_PROVIDER_NAME }),
      getWorkspaceAccessToken: async () => 'ws-token',
      agentStatusStore: {},
      recapCacheStore: {},
      briefCacheStore: {},
      dispatchQueueStore: {},
      workspaceFromUrl: (req, res, next) => next(),
      getWorkspaceOpenRouterKey: async () => null,
      workspacePreferencesStore: {},
      freeTierStore: { tryUse: async () => ({ allowed: true }) },
    }));

    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const { port } = server.address();
    try {
      const first = await fetch(`http://127.0.0.1:${port}/api/proxy/projects`, {
        headers: { Authorization: 'Bearer local-token' },
      });
      const firstBody = await first.json();
      assert.equal(firstBody.detail, 'Local API request failed');

      const second = await fetch(`http://127.0.0.1:${port}/api/proxy/me`, {
        headers: { Authorization: 'Bearer github-token' },
      });
      const secondBody = await second.json();
      assert.equal(secondBody.detail, 'GitHub Issues API request failed');
      assert.doesNotMatch(secondBody.detail, /Local/);
    } finally {
      await new Promise(r => server.close(r));
    }
  });
});

// ---------------------------------------------------------------------------
// The auth-log line inside graphqlErrorDetail's gqlMessage-passthrough
// branch also named Linear unconditionally. It is log-only (not part of the
// response envelope), so it is observed by capturing console.error.
// ---------------------------------------------------------------------------
describe('the auth-error console.error line names the resolved provider', () => {
  test('a 401 graphql-request-shaped error on a non-Linear provider logs the provider name, not Linear', async () => {
    const provider = new ThrowingProvider(GITHUB_PROVIDER_NAME, 'GitHub Issues');
    const err = new Error('graphql wrapper');
    err.response = { status: 401, errors: [{ message: 'bad credentials' }] };
    provider.nextError = err;

    const originalError = console.error;
    const logged = [];
    console.error = (...args) => { logged.push(args.join(' ')); };
    try {
      await call(buildApp(provider), '/api/proxy/me');
    } finally {
      console.error = originalError;
    }
    const authLine = logged.find(l => l.includes('auth error (HTTP 401)'));
    assert.ok(authLine, `expected an auth-error log line, got: ${JSON.stringify(logged)}`);
    assert.match(authLine, /^GitHub Issues auth error/);
    assert.doesNotMatch(authLine, /^Linear/);
  });
});

// ---------------------------------------------------------------------------
// The two DOMException('...', 'TimeoutError') raisers in withTimeout /
// fetchWithTimeout have no req/provider context (generic promise-racing
// helpers with 12 call sites, several without a request in closure) — so
// their wording must be provider-NEUTRAL, never a guessed "Linear". Neither
// function is exported and both sit behind hardcoded 45s-180s timeout
// constants, so a live trip is impractical to exercise in a fast unit test;
// this is a source-literal characterization test instead (precedent:
// tests/unit/proxy-credential-fingerprint-stamping.test.js reads
// routes/proxy.js the same way). Mutation-checked: reverting either literal
// back to 'Linear API request timed out' fails this test.
// ---------------------------------------------------------------------------
describe('the withTimeout/fetchWithTimeout raiser wording is provider-neutral', () => {
  const PROXY_SRC = readFileSync(join(__dirname, '../../routes/proxy.js'), 'utf8');

  test('both raisers use the neutral "Upstream API request timed out" message', () => {
    const matches = PROXY_SRC.match(/new DOMException\('([^']*)', 'TimeoutError'\)/g) || [];
    assert.equal(matches.length, 2, `expected exactly 2 DOMException('...', 'TimeoutError') raisers, found ${matches.length}`);
    for (const m of matches) {
      assert.match(m, /'Upstream API request timed out'/, `raiser text drifted: ${m}`);
    }
  });

  test('no raiser names Linear literally', () => {
    assert.doesNotMatch(PROXY_SRC, /DOMException\('Linear API request timed out'/);
  });

  // graphqlErrorStatus/graphqlErrorDetail branch on err.name === 'TimeoutError',
  // never on message text — so the wording change above cannot move the 504
  // mapping. Already exercised end-to-end by the TimeoutError tests above,
  // which set an arbitrary err.message and still observe a 504.
});

// ---------------------------------------------------------------------------
// ssrfGuardUrl's attachment-host message ("must be from Linear") was wrong
// for every workspace — the allowlist it guards already spans providers
// (Linear hosts + GITHUB_UPLOAD_HOSTS). The machine-readable
// reason: 'host-not-allowed' is untouched; only the human-readable message
// moves. Covered end-to-end (md: handle path, where the message reaches the
// response body) in tests/unit/proxy-attachment-relay.test.js, which this
// characterization test complements with a direct source check.
// ---------------------------------------------------------------------------
describe('ssrfGuardUrl attachment-host message is provider-neutral', () => {
  const PROXY_SRC = readFileSync(join(__dirname, '../../routes/proxy.js'), 'utf8');

  test('the host-not-allowed message no longer names Linear', () => {
    assert.match(PROXY_SRC, /reason: 'host-not-allowed', message: 'Invalid attachment URL: host not allowed'/);
    assert.doesNotMatch(PROXY_SRC, /must be from Linear/);
  });
});
