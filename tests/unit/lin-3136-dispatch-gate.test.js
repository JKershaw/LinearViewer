/**
 * LIN-3136 S1 / P1 (acceptance 1, 2, 3, 5 and 12) — `requireGrant('dispatch')`
 * on the three enqueue mounts.
 *
 *  1. On each mount: `readWrite` without the grant → 403 DISPATCH_GRANT_REQUIRED,
 *     nothing enqueued; `read` → the scope's own 403 (never the grant code);
 *     `read` + `dispatch` → still the scope 403; `readWrite` + `dispatch` → the
 *     handler runs (201 on POST /dispatch and the kickoff).
 *  2. Un-granted `abort` / `cascade` / `followUpTo` → 403 and the store is never
 *     touched (`expandCascadeAborts` and `addItem` uncalled). The gate runs
 *     before validation: an invalid body from a grant-less token is 403, not 400.
 *  3. The runner token (`take` + `dispatch`) enqueues; the dispatch-only token
 *     enqueues on each mount.
 *  5. The reads (`GET /dispatch`, `/dispatch/:id`) stay open to a `read` token.
 * 12. (a) a source pin per path: exactly one `router.post(` whose middleware is
 *     `proxyLimiter, authenticateProxyToken, requireWriteScope,
 *     requireGrant('dispatch')` then the handler; (b)/(c) with a REAL rate
 *     limiter, `RateLimit-Remaining` drops by exactly 1 per request and
 *     `validateToken` runs once — the sub-routers are built directly, since the
 *     production limiter is module-scope and skips under NODE_ENV=test.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { buildApp, call, BASE_DEPS, ACME } from './lib/proxy-fake-deps.js';
import { requireGrant } from '../../lib/require-grant.js';
import { createDispatchRoutes } from '../../routes/proxy-dispatch.js';
import { createKickoffRoutes } from '../../routes/proxy-kickoff.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');

const MOUNTS = [
  { name: 'POST /api/proxy/dispatch', path: '/api/proxy/dispatch', file: 'routes/proxy-dispatch.js', body: { prompt: 'run me', kind: 'implementation' }, enqueues201: true },
  { name: 'POST /api/proxy/recommend-and-dispatch', path: '/api/proxy/recommend-and-dispatch', file: 'routes/proxy-dispatch.js', body: { issueIdentifier: 'TEST-1', kind: 'implementation' }, enqueues201: true },
  { name: 'POST /api/proxy/autopilot/kickoff', path: '/api/proxy/autopilot/kickoff', file: 'routes/proxy-kickoff.js', body: { goal: 'walk the stack', target: 'cli' }, enqueues201: true }
];

const SCOPE_403 = { error: 'This endpoint requires a read-write token' };

/** The real composer with a stub token of the given scope/grants and a spying store. */
function gatedApp({ scope, grants }) {
  const spy = { added: [], cascade: 0, reads: 0 };
  const base = BASE_DEPS();
  const app = buildApp({
    proxyTokenStore: {
      ...base.proxyTokenStore,
      createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
      mintGrantBootstrap: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({
        tokenId: 't1', urlKey: ACME, label: 'test', scope, createdBy: 'u1', workspaceId: 'ws-acme',
        ...(grants === undefined ? {} : { grants })
      })
    },
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    dispatchQueueStore: {
      ...base.dispatchQueueStore,
      addItem: async (urlKey, item) => {
        spy.added.push(item);
        return { _id: `disp-${spy.added.length}`, dispatchedAt: '2026-10-01T00:00:00.000Z', ...item };
      },
      expandCascadeAborts: async () => { spy.cascade++; return { items: [] }; },
      getItemStatus: async () => { spy.reads++; return { _id: 'disp-1', status: 'queued', urlKey: ACME, kind: 'implementation', feedback: [] }; },
      listItems: async () => { spy.reads++; return []; }
    }
  });
  return { app, spy };
}

describe('LIN-3136 criterion 1 — the dispatch grant on each enqueue mount', () => {
  for (const mount of MOUNTS) {
    test(`${mount.name}: readWrite with no grants → 403 DISPATCH_GRANT_REQUIRED, nothing enqueued`, async () => {
      for (const grants of [undefined, [], ['take']]) {
        const { app, spy } = gatedApp({ scope: 'readWrite', grants });
        const { status, body } = await call(app, 'post', mount.path, { body: mount.body });
        assert.equal(status, 403, `grants=${JSON.stringify(grants)}: ${JSON.stringify(body)}`);
        assert.equal(body.code, 'DISPATCH_GRANT_REQUIRED');
        assert.equal(body.category, 'auth');
        assert.equal(body.retryable, false);
        assert.match(body.error, /cannot enqueue work \(no dispatch grant\)/);
        assert.equal(spy.added.length, 0);
      }
    });

    test(`${mount.name}: read (with or without dispatch) → the scope 403, never the grant code`, async () => {
      for (const grants of [undefined, ['dispatch'], ['take', 'dispatch']]) {
        const { app, spy } = gatedApp({ scope: 'read', grants });
        const { status, body } = await call(app, 'post', mount.path, { body: mount.body });
        assert.equal(status, 403);
        assert.deepEqual(body, SCOPE_403, `grants=${JSON.stringify(grants)}`);
        assert.equal(spy.added.length, 0);
      }
    });

    test(`${mount.name}: readWrite + dispatch → 201, enqueued`, async () => {
      const { app, spy } = gatedApp({ scope: 'readWrite', grants: ['dispatch'] });
      const { status, body } = await call(app, 'post', mount.path, { body: mount.body });
      assert.equal(status, 201, JSON.stringify(body));
      assert.equal(spy.added.length, 1);
    });

    test(`${mount.name}: the gate runs before validation — a grant-less invalid body is 403, not 400`, async () => {
      const { app, spy } = gatedApp({ scope: 'readWrite' });
      const { status, body } = await call(app, 'post', mount.path, { body: { target: 'not-a-target', maxTasks: -1 } });
      assert.equal(status, 403, JSON.stringify(body));
      assert.equal(body.code, 'DISPATCH_GRANT_REQUIRED');
      assert.equal(spy.added.length, 0);
    });
  }
});

describe('LIN-3136 criterion 2 — un-granted abort, cascade and follow-up never reach the store', () => {
  for (const [desc, body] of [
    ['abort', { abort: true, abortTo: '11111111-2222-3333-4444-555555555555' }],
    ['cascade', { abort: true, abortTo: '11111111-2222-3333-4444-555555555555', cascade: true }],
    ['followUpTo', { prompt: 'next beat', followUpTo: '11111111-2222-3333-4444-555555555555', force: true }]
  ]) {
    test(`${desc} → 403, expandCascadeAborts and addItem never called`, async () => {
      const { app, spy } = gatedApp({ scope: 'readWrite' });
      const res = await call(app, 'post', '/api/proxy/dispatch', { body });
      assert.equal(res.status, 403, JSON.stringify(res.body));
      assert.equal(res.body.code, 'DISPATCH_GRANT_REQUIRED');
      assert.equal(spy.cascade, 0, 'expandCascadeAborts never called');
      assert.equal(spy.added.length, 0);
      assert.equal(spy.reads, 0, 'the store is not read either');
    });
  }

  test('the same cascade from a dispatch holder does reach expandCascadeAborts (the spy is live)', async () => {
    const { app, spy } = gatedApp({ scope: 'readWrite', grants: ['dispatch'] });
    await call(app, 'post', '/api/proxy/dispatch', { body: { abort: true, abortTo: '11111111-2222-3333-4444-555555555555', cascade: true } });
    assert.equal(spy.cascade, 1);
  });
});

describe('LIN-3136 criterion 3 — the runner token still enqueues', () => {
  for (const mount of MOUNTS) {
    test(`${mount.name}: readWrite + [take, dispatch] → 201`, async () => {
      const { app, spy } = gatedApp({ scope: 'readWrite', grants: ['take', 'dispatch'] });
      const { status, body } = await call(app, 'post', mount.path, { body: mount.body });
      assert.equal(status, 201, JSON.stringify(body));
      assert.equal(spy.added.length, 1);
    });
  }
});

describe('LIN-3136 criterion 5 — the reads stay ungated', () => {
  test('a read token, no grants: GET /dispatch and GET /dispatch/:id → 200', async () => {
    const { app } = gatedApp({ scope: 'read' });
    const list = await call(app, 'get', '/api/proxy/dispatch');
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const one = await call(app, 'get', '/api/proxy/dispatch/disp-1');
    assert.equal(one.status, 200, JSON.stringify(one.body));
  });
});

// ── criterion 12 ────────────────────────────────────────────────────────────

describe('LIN-3136 criterion 12(a) — one registration per path, gate in place', () => {
  const EXPECTED = "proxyLimiter, authenticateProxyToken, requireWriteScope, requireGrant('dispatch'), async (req, res) =>";
  for (const mount of MOUNTS) {
    test(`${mount.name}: exactly one router.post, with the grant after the scope`, () => {
      const src = readFileSync(join(REPO, mount.file), 'utf8');
      const quoted = mount.path.replace(/[/.*+?^${}()|[\]\\]/g, '\\$&');
      const regs = [...src.matchAll(new RegExp(`router\\.post\\('${quoted}',\\s*([^\\n]*)`, 'g'))];
      assert.equal(regs.length, 1, `exactly one POST registration for ${mount.path}`);
      assert.equal(regs[0][1].trim().replace(/\s*\{$/, ''), EXPECTED);
      for (const m of src.matchAll(/router\.use\(\s*['"]([^'"]+)['"]/g)) {
        assert.ok(!mount.path.startsWith(m[1]) && !m[1].startsWith('/api/proxy/dispatch'), `no path-scoped router.use over ${m[1]}`);
      }
    });
  }

  test('the reads carry no grant gate', () => {
    const src = readFileSync(join(REPO, 'routes/proxy-dispatch.js'), 'utf8');
    for (const path of ["'/api/proxy/dispatch'", "'/api/proxy/dispatch/:id'", "'/api/proxy/dispatch/:id/prompt'"]) {
      const line = src.split('\n').find(l => l.includes(`router.get(${path},`));
      assert.ok(line, `GET ${path} registered`);
      assert.doesNotMatch(line, /requireGrant|requireWriteScope/);
    }
  });
});

describe('LIN-3136 criterion 12(b)/(c) — one limiter pass and one token validation per request', () => {
  function realLimiterApp({ grants }) {
    const counts = { validate: 0 };
    const limiter = rateLimit({ windowMs: 60 * 1000, limit: 50, standardHeaders: 'draft-6', legacyHeaders: false, validate: false });
    const authenticateProxyToken = async (req, res, next) => {
      counts.validate++;
      req.proxyUrlKey = ACME;
      req.proxyTokenScope = 'readWrite';
      req.proxyTokenGrants = grants;
      req.proxyCreatedBy = 'u1';
      req.proxyWorkspaceId = 'ws-acme';
      next();
    };
    const requireWriteScope = (req, res, next) => next();
    const shared = {
      proxyLimiter: limiter, authenticateProxyToken, requireWriteScope, requireGrant,
      logEvent: () => {}, dispatchQueueStore: {}, proxyTokenStore: {}, workspacePreferencesStore: {},
      resolveProviderAccess: async () => ({}), workspaceUnavailable: () => {}, denyIfUnsupported: () => false,
      resolvePromptIssueContext: async () => ({}), refuseIfDuplicateDispatch: () => false, refuseIfBudgetExhausted: () => false,
      graphqlErrorStatus: () => 500, VALID_PROXY_DISPATCH_TARGETS: ['cli', 'web', 'dash'], PROXY_ATTACH_FAILED_MESSAGE: 'x'
    };
    const app = express();
    app.use(express.json());
    app.use(createKickoffRoutes({ ...shared, dispatchPresetsStore: {} }));
    app.use(createDispatchRoutes({
      ...shared, chargeFreeTierOrReject: async () => true, computeRecommendation: async () => ({}),
      getWorkspaceOpenRouterKey: async () => null, LINEAGE_QUERY_LIMIT: 100, logOpenRouterCredentialSource: () => {},
      recommendErrorResponse: () => ({ status: 500, body: {} }), RECOMMEND_DESCENT_BUDGET_MS: 1000,
      resolveProxyLLM: async () => ({}), workspaceUnavailable: () => {}
    }));
    return { app, counts };
  }

  async function remaining(app, path, body) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      await res.text();
      return { status: res.status, remaining: Number(res.headers.get('ratelimit-remaining')) };
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }

  for (const mount of MOUNTS) {
    for (const [desc, grants, expectStatus] of [
      ['an accepted request (handler reached, body invalid → 400)', ['dispatch'], 400],
      ['a refused request (403 at the gate)', [], 403]
    ]) {
      test(`${mount.name}: ${desc} costs exactly one limiter hit and one validation`, async () => {
        const { app, counts } = realLimiterApp({ grants });
        const first = await remaining(app, mount.path, { target: 'not-a-target' });
        const second = await remaining(app, mount.path, { target: 'not-a-target' });
        assert.equal(first.status, expectStatus);
        assert.equal(second.status, expectStatus);
        assert.equal(first.remaining, 49, 'one limiter pass on the first request');
        assert.equal(second.remaining, 48, 'exactly one more on the second');
        assert.equal(counts.validate, 2, 'validateToken ran once per request');
      });
    }
  }
});
