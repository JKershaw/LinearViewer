/**
 * LIN-3601 — the redaction canary sweep (replaces the per-file verdicts and
 * call counts of lin-3384-redaction-census for routes/dispatch.js,
 * routes/proxy-dispatch.js and routes/proxy-kickoff.js).
 *
 * LIN-3384: a live bootstrap token leaves only on the runner's poll/take. Every
 * fake row below carries a runtime-built canary as its `bootstrapToken` and again
 * in its prompt as `Authorization: Bearer <canary>` (the prose shape
 * `maskBootstrapTokens` masks). Every read route is driven over HTTP:
 *
 *   - as a non-owner session, and as another account's proxy token, the canary
 *     must appear in NO response body;
 *   - as the row's own dispatcher, `bootstrapToken` must still be null or absent
 *     everywhere (lib/dispatch-session-redaction.js:56), and the canary may
 *     appear only in the `prompt` of the explicit exceptions below;
 *   - `GET /api/dispatch/poll`, `POST /api/dispatch/take/:itemId` and the proxy
 *     runner poll/take MUST carry it (runners keep the live token).
 *
 * Exceptions the sweep lists rather than hides (today's behaviour,
 * lin-3384-bootstrap-token-redaction.test.js:158, :266): the owner's own prompt
 * comes back unmasked in the session list and history, in the trim reply, and
 * from `GET /api/proxy/dispatch/:id/prompt` with the dispatcher's own token.
 *
 * The canary is built at run time. A token-shaped literal in a test would trip
 * the `harbour-bootstrap-token` rule of `secret-scan`, which CI requires.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { BASE_DEPS, ACME } from './lib/proxy-fake-deps.js';
import { enumerateRoutes, sampleUrl, appAround, request, makeCanary, spiedProxyTokenStore, makeSpy, SAMPLE_UUID } from './lib/entrance-route-sweep.js';

const OWNER = 'acct-owner';
const OTHER = 'acct-other';
const ownerCheck = async ({ accountId }) => ({ status: accountId === OWNER ? 'owner' : 'not-owner' });

const RUNNER_MOUNT = String.raw`^\/api\/proxy\/runner\/?(?=\/|$)`;
const TOKENS_MOUNT = String.raw`^\/workspace(?:\/([^/]+?))\/api\/proxy\/tokens\/?(?=\/|$)`;
const ALLOWED_LAYERS = [
  { mount: RUNNER_MOUNT, names: ['<anonymous>', 'authenticateProxyToken', 'requireGrantMiddleware'] },
  { mount: TOKENS_MOUNT, names: ['<anonymous>'] }
];

/** A fake queue row that carries the canary in both places a live token can ride. */
function canaryRow(canary, { target = 'cli', dispatchedBy = OWNER } = {}) {
  return {
    id: SAMPLE_UUID,
    _id: SAMPLE_UUID,
    status: 'queued',
    promptName: 'Prompt',
    kind: 'custom',
    target,
    dispatchedBy,
    dispatchedAt: new Date('2026-10-17T00:00:00.000Z'),
    issueIdentifier: 'LIN-1',
    bootstrapToken: canary,
    prompt: `Work the task.\nAuthorization: Bearer ${canary}\n`,
    feedback: []
  };
}

function queueStoreFor(row) {
  return {
    listItems: async () => [{ ...row }],
    listItemsWithPrompt: async () => [{ ...row }],
    countItems: async () => 1,
    listHistory: async () => ({ items: [{ ...row, status: 'taken' }], total: 1 }),
    listHistoryWithBodies: async () => ({ items: [{ ...row, status: 'taken' }], total: 1 }),
    // LIN-3812: the proxy list's history read; the canary row rides it so the allow-list is what is swept.
    listHistoryLineageRows: async () => ({ items: [{ ...row, status: 'taken', lineage: { status: null, completedAt: null, feedbackCount: 0 } }], total: 1 }),
    ensureLineageStatus: async () => {},
    getItemStatus: async () => ({ ...row }),
    getItemFeedback: async () => ({ ...row }),
    getItemPrompt: async () => ({ ...row }),
    pollAvailable: async () => [{ ...row }],
    takeItem: async () => ({ ...row }),
    trimSessionBudget: async () => ({ ok: true, item: { ...row } }),
    removeItem: async () => true,
    getWakeShadowTally: async () => ({ days: [], totals: {} })
  };
}

/** Every `bootstrapToken` value found anywhere in a parsed JSON body. */
function bootstrapTokenValues(value, out = []) {
  if (Array.isArray(value)) value.forEach(v => bootstrapTokenValues(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'bootstrapToken') out.push(v);
      else bootstrapTokenValues(v, out);
    }
  }
  return out;
}

// ── session lane ────────────────────────────────────────────────────────────

function sessionWorld({ canary, accountId, target }) {
  const row = canaryRow(canary, { target });
  const router = createDispatchRoutes({
    dispatchQueueStore: queueStoreFor(row),
    dispatchTokenStore: {
      validateToken: async (t) => (t === 'dispatch-token' ? { urlKey: 'alpha', label: 'runner', createdBy: OWNER } : null),
      listTokens: async () => [],
      createToken: async () => ({ tokenId: SAMPLE_UUID, token: 'dispatch-token-fixture', label: 'x' }),
      revokeToken: async () => true
    },
    workspaceHaltStore: { getWorkspaceHalt: async () => null, setWorkspaceHalt: async () => {}, clearWorkspaceHalt: async () => {} },
    workspaceOwnerCheck: ownerCheck,
    userPreferencesStore: { getUserPreferences: async () => ({}), saveUserPreferences: async () => {}, getFavoritePrompts: async () => [], addFavoritePrompt: async () => [], removeFavoritePrompt: async () => [] },
    dispatchPresetsStore: { list: async () => [], get: async () => null, createCustom: async () => ({}), update: async () => ({}), delete: async () => true },
    workspaceFromUrl: (req, _res, next) => {
      req.workspace = { urlKey: 'alpha', id: 'ws-alpha' };
      req.session = { accountId };
      next();
    }
  });
  return { router, app: appAround(router) };
}

// Runner routes: they authenticate with a dispatch token, not a session, and
// MUST carry the live token.
// LIN-1952: the heartbeat route is a dispatch-token consumer route too (no session, no prompt, no mint).
const SESSION_RUNNER = { 'GET /api/dispatch/poll': true, 'POST /api/dispatch/take/:itemId': true, 'POST /api/dispatch/heartbeat': true };
// Routes whose reply may carry the owner's own prompt (and only that).
const SESSION_OWNER_PROMPT = new Set([
  'GET /workspace/:urlKey/api/dispatch',
  'GET /workspace/:urlKey/api/dispatch/history',
  'PATCH /workspace/:urlKey/api/dispatch/:sessionId/trim'
]);

describe('LIN-3601 redaction canary sweep — session routes (routes/dispatch.js)', () => {
  const canary = makeCanary();
  const routes = enumerateRoutes(sessionWorld({ canary, accountId: OWNER, target: 'cli' }).router);
  const keyOf = (r) => `${r.method} ${r.path}`;

  test('the canary is the prefixed 47-character shape the mask recognises, built at run time', () => {
    assert.equal(canary.length, 47);
    assert.match(canary, /^hbp_[A-Za-z0-9_-]{43}$/);
  });

  test('enumerates exactly 29 session routes (LIN-3833 added the read-only preview; LIN-3962 the decision panel)', () => {
    assert.equal(routes.length, 29);
  });

  for (const route of routes) {
    const key = keyOf(route);
    if (SESSION_RUNNER[key]) continue;
    const body = (() => {
      if (route.method === 'GET') return undefined;
      if (route.method === 'PATCH' && route.path.endsWith('/trim')) return { maxTasks: 1 };
      if (route.method === 'POST' && route.path.endsWith('/halt')) return { mode: 'stop' };
      if (route.path.endsWith('/prompts')) return { prompt: 'p' };
      if (route.path.endsWith('/dispatch') && route.method === 'POST') return { prompt: 'p', target: 'dash' };
      return {};
    })();

    test(`${key} — a non-owner session never receives the canary`, async () => {
      for (const target of ['cli', 'dash']) {
        const world = sessionWorld({ canary, accountId: OTHER, target });
        const res = await request(world.app, route.method, sampleUrl(route.path), { body });
        assert.ok(!res.text.includes(canary), `${key} on a ${target} row leaked the canary: ${res.text.slice(0, 300)}`);
        assert.deepEqual(bootstrapTokenValues(res.body).filter(v => v !== null && v !== undefined), [], `${key} returned a bootstrapToken`);
      }
    });

    test(`${key} — the row's own dispatcher never receives bootstrapToken${SESSION_OWNER_PROMPT.has(key) ? ' (the prompt is an explicit exception)' : ''}`, async () => {
      const world = sessionWorld({ canary, accountId: OWNER, target: 'cli' });
      const res = await request(world.app, route.method, sampleUrl(route.path), { body });
      assert.deepEqual(bootstrapTokenValues(res.body).filter(v => v !== null && v !== undefined), [], `${key} returned a bootstrapToken to the owner`);
      if (!SESSION_OWNER_PROMPT.has(key)) {
        assert.ok(!res.text.includes(canary), `${key}: ${res.text.slice(0, 300)}`);
      }
    });
  }

  test('the explicit owner-prompt exceptions really are today\'s behaviour (the list is not a loophole)', async () => {
    for (const key of SESSION_OWNER_PROMPT) {
      const route = routes.find(r => keyOf(r) === key);
      const world = sessionWorld({ canary, accountId: OWNER, target: 'cli' });
      const res = await request(world.app, route.method, sampleUrl(route.path), { body: route.method === 'PATCH' ? { maxTasks: 1 } : undefined });
      assert.ok(res.text.includes(canary), `${key}: the owner's own prompt comes back unmasked today; if that changed, delete the exception`);
    }
  });

  test('runner poll and take MUST carry the live token', async () => {
    const world = sessionWorld({ canary, accountId: OTHER, target: 'cli' });
    const poll = await request(world.app, 'GET', '/api/dispatch/poll', { headers: { Authorization: 'Bearer dispatch-token' } });
    assert.equal(poll.status, 200, poll.text);
    assert.ok(poll.text.includes(canary), 'poll carries the bootstrapToken');
    const take = await request(world.app, 'POST', `/api/dispatch/take/${SAMPLE_UUID}`, { headers: { Authorization: 'Bearer dispatch-token' } });
    assert.equal(take.status, 200, take.text);
    assert.ok(take.text.includes(canary), 'take carries the bootstrapToken');
  });
});

// ── proxy lane ──────────────────────────────────────────────────────────────

function proxyWorld({ canary, createdBy, grants = [] }) {
  const spy = makeSpy();
  const deps = BASE_DEPS();
  deps.proxyTokenStore = spiedProxyTokenStore(spy, {
    validateToken: async () => ({ tokenId: 't1', urlKey: ACME, label: 'test', scope: 'readWrite', createdBy, grants, workspaceId: 'ws-acme' })
  });
  deps.workspacePreferencesStore = { getWorkspacePreferences: async () => ({}) };
  deps.dispatchQueueStore = { ...deps.dispatchQueueStore, ...queueStoreFor(canaryRow(canary)) };
  const router = createProxyRoutes(deps);
  return { router, app: appAround(router) };
}

describe('LIN-3601 redaction canary sweep — proxy routes (routes/proxy-dispatch.js, routes/proxy-kickoff.js)', () => {
  const canary = makeCanary();
  const routes = enumerateRoutes(proxyWorld({ canary, createdBy: OTHER }).router, { allowedLayers: ALLOWED_LAYERS });
  const reads = routes.filter(r => r.method === 'GET');
  const headers = { Authorization: 'Bearer anything' };

  test('enumerates the composer\'s read routes', () => {
    assert.ok(reads.length > 40, `${reads.length} reads`);
    for (const path of ['/api/proxy/dispatch', '/api/proxy/dispatch/:id', '/api/proxy/dispatch/:id/prompt', '/api/proxy/wake-shadow', '/api/proxy/autopilot/kickoff', '/api/proxy/passage-runner/prompt']) {
      assert.ok(reads.some(r => r.path === path), `${path} is enumerated`);
    }
  });

  test("another account's proxy token never receives the canary from any read route", async () => {
    const leaks = [];
    for (const route of reads) {
      const world = proxyWorld({ canary, createdBy: OTHER });
      const res = await request(world.app, 'GET', sampleUrl(route.path), { headers });
      if (res.text.includes(canary)) leaks.push(`${route.path}: ${res.text.slice(0, 200)}`);
      const tokens = bootstrapTokenValues(res.body).filter(v => v !== null && v !== undefined);
      if (tokens.length) leaks.push(`${route.path}: bootstrapToken ${JSON.stringify(tokens)}`);
    }
    assert.deepEqual(leaks, []);
  });

  test("the dispatcher's own proxy token still never receives bootstrapToken; only the prompt route returns its own prompt", async () => {
    const leaks = [];
    for (const route of reads) {
      const world = proxyWorld({ canary, createdBy: OWNER });
      const res = await request(world.app, 'GET', sampleUrl(route.path), { headers });
      const tokens = bootstrapTokenValues(res.body).filter(v => v !== null && v !== undefined);
      if (tokens.length) leaks.push(`${route.path}: bootstrapToken`);
      if (res.text.includes(canary) && route.path !== '/api/proxy/dispatch/:id/prompt') leaks.push(`${route.path}: canary in ${res.text.slice(0, 200)}`);
    }
    assert.deepEqual(leaks, []);
    const world = proxyWorld({ canary, createdBy: OWNER });
    const own = await request(world.app, 'GET', `/api/proxy/dispatch/${SAMPLE_UUID}/prompt`, { headers });
    assert.ok(own.text.includes(canary), 'the exception is today\'s behaviour: the dispatcher reads its own prompt unmasked');
  });

  test("another account's token gets the prompt route's prose masked, not withheld", async () => {
    const world = proxyWorld({ canary, createdBy: OTHER });
    const res = await request(world.app, 'GET', `/api/proxy/dispatch/${SAMPLE_UUID}/prompt`, { headers });
    assert.equal(res.status, 200, res.text);
    assert.ok(res.body.prompt.includes('[REDACTED-BOOTSTRAP-TOKEN]'), res.text);
    assert.ok(!res.text.includes(canary));
  });

  test('the proxy runner poll and take MUST carry the live token (take grant)', async () => {
    const world = proxyWorld({ canary, createdBy: OTHER, grants: ['take'] });
    const poll = await request(world.app, 'GET', '/api/proxy/runner/poll', { headers });
    assert.equal(poll.status, 200, poll.text);
    assert.ok(poll.text.includes(canary), 'proxy runner poll carries the bootstrapToken');
    const take = await request(world.app, 'POST', `/api/proxy/runner/take/${SAMPLE_UUID}`, { headers });
    assert.equal(take.status, 200, take.text);
    assert.ok(take.text.includes(canary), 'proxy runner take carries the bootstrapToken');
  });
});
