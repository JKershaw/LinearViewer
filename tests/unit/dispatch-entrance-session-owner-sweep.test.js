/**
 * LIN-3601 — the session-owner sweep (replaces the exact sink counts in
 * lin-3383-runner-enqueue-census for routes/dispatch.js).
 *
 * LIN-3383 / LIN-3398 / LIN-3408: only a workspace's owner may reach a
 * runner-state write from a session route. The census proved it by counting
 * `refuseNonOwner(` / `resolveRunnerOwnerRefusal(` before each sink in
 * routes/dispatch.js, keyed to the registration the sink sat in. That keying is
 * what stopped the three dispatch entrances sharing one authority, so the
 * property moves here: every session route is called over HTTP as a non-owner,
 * on a runner target, and may reach no runner-state write unless the table
 * below says why.
 *
 * Routes are enumerated from `router.stack` (listing only; every request is
 * HTTP, LIN-2505), the table must hold exactly one row per enumerated route,
 * and an enumerated route without a row fails. A planted, ungated route
 * therefore fails twice: the route count and the missing row.
 *
 * Verdicts:
 *   owner-gated       a non-owner on a runner target is refused and nothing is written
 *   member-reachable  by design a member reaches the write (dash / local rows;
 *                     lin-3398-session-runner-gates.test.js:146-152)
 *   dispatch-token    token lane: no credential is a 401 and nothing is written
 *   feedback-token    token lane (single-use Harbour OS feedback token or dispatch token)
 *   read-only         no runner-state write at all (caller-scoped preferences and
 *                     preset rows are not runner state)
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { enumerateRoutes, sampleUrl, appAround, request, makeSpy, SAMPLE_UUID } from './lib/entrance-route-sweep.js';

const ROUTE_COUNT = 28;
const COPY = "Only this workspace's owner can act on its runner.";
const OWNER = 'acct-owner';
const MEMBER = 'acct-member';
const ownerCheck = async ({ accountId }) => ({ status: accountId === OWNER ? 'owner' : 'not-owner' });

/** The runner-state writes (LIN-3383 sinks + LIN-3398/LIN-3409 additions) and the legacy dispatch-token mint. */
const RUNNER_WRITES = ['addItem', 'expandCascadeAborts', 'removeItem', 'trimSessionBudget', 'setWorkspaceHalt', 'clearWorkspaceHalt', 'revokeToken', 'addFeedback', 'takeItem', 'createToken'];

function makeWorld({ rowTarget = 'cli', accountId = MEMBER } = {}) {
  const spy = makeSpy();
  const row = { id: SAMPLE_UUID, target: rowTarget, prompt: 'p' };
  const queue = {
    listItems: async () => [],
    listItemsWithPrompt: async () => [],
    countItems: async () => 0,
    listHistory: async () => ({ items: [], total: 0 }),
    listHistoryWithBodies: async () => ({ items: [], total: 0 }),
    getItemStatus: async () => ({ ...row }),
    getItemFeedback: async () => ({ ...row }),
    getItemPrompt: async () => ({ ...row }),
    pollAvailable: async () => [],
    addItem: spy.wrap('addItem', async (_k, fields) => ({ _id: SAMPLE_UUID, ...fields })),
    expandCascadeAborts: spy.wrap('expandCascadeAborts', async () => ({ aborted: 0 })),
    removeItem: spy.wrap('removeItem', async () => true),
    trimSessionBudget: spy.wrap('trimSessionBudget', async (_k, id) => ({ ok: true, item: { id } })),
    takeItem: spy.wrap('takeItem', async () => null),
    addFeedback: spy.wrap('addFeedback', async () => null)
  };
  const halt = {
    getWorkspaceHalt: async () => null,
    setWorkspaceHalt: spy.wrap('setWorkspaceHalt'),
    clearWorkspaceHalt: spy.wrap('clearWorkspaceHalt')
  };
  const tokens = {
    validateToken: async () => null,
    listTokens: async () => [],
    createToken: spy.wrap('createToken', async (_k, label) => ({ tokenId: SAMPLE_UUID, token: 'dispatch-token-fixture', label })),
    revokeToken: spy.wrap('revokeToken', async () => true)
  };
  const userPreferencesStore = {
    getUserPreferences: async () => ({}),
    saveUserPreferences: async () => {},
    getFavoritePrompts: async () => [],
    addFavoritePrompt: async () => [],
    removeFavoritePrompt: async () => []
  };
  const dispatchPresetsStore = {
    list: async () => [],
    get: async () => ({ id: SAMPLE_UUID, name: 'p', config: {} }),
    createCustom: async () => ({ id: SAMPLE_UUID }),
    update: async () => ({ id: SAMPLE_UUID }),
    delete: async () => true
  };
  const harbourFeedbackTokenStore = {
    validateAndConsume: async () => null,
    mintToken: spy.wrap('mintToken', async () => ({ token: 'feedback-token-fixture' }))
  };
  const router = createDispatchRoutes({
    dispatchQueueStore: queue,
    dispatchTokenStore: tokens,
    workspaceHaltStore: halt,
    workspaceOwnerCheck: ownerCheck,
    userPreferencesStore,
    dispatchPresetsStore,
    harbourFeedbackTokenStore,
    workspaceFromUrl: (req, _res, next) => {
      req.workspace = { urlKey: 'alpha', id: 'ws-alpha' };
      req.session = { accountId };
      next();
    }
  });
  return { router, app: appAround(router), spy, writes: () => spy.calls.filter(c => RUNNER_WRITES.includes(c[0])).map(c => c[0]) };
}

const BASE = '/workspace/:urlKey/api/dispatch';

/**
 * One row per enumerated route. `probes` are the requests the sweep makes as a
 * non-owner; `expect` is what each must answer. Every row carries its reason.
 */
const TABLE = {
  [`POST ${BASE}`]: {
    verdict: 'owner-gated', reason: 'LIN-3383: every browser launcher lands here; fresh, followUpTo, abort and cascade all write runner rows for cli/web',
    probes: [
      { body: { prompt: 'p', target: 'cli' } },
      { body: { prompt: 'p', target: 'web' } },
      { body: { prompt: 'p' } },
      { body: { prompt: 'p', followUpTo: SAMPLE_UUID, target: 'cli' } },
      { body: { abort: true, abortTo: SAMPLE_UUID, target: 'cli' } },
      { body: { abort: true, cascade: true, abortTo: SAMPLE_UUID, target: 'cli' } }
    ],
    refused: true
  },
  [`GET ${BASE}`]: { verdict: 'read-only', reason: 'queue list (LIN-3384 redacts the row); reads only', probes: [{}] },
  [`GET ${BASE}/count`]: { verdict: 'read-only', reason: 'queue count badge; reads only', probes: [{}] },
  [`GET ${BASE}/preview`]: { verdict: 'read-only', reason: 'LIN-3833: the run control\'s routing answer, owner-only (PREVIEW_OWNER_ONLY); resolves, writes nothing', probes: [{}] },
  [`GET ${BASE}/quota`]: { verdict: 'read-only', reason: 'LIN-3238 Q6: the caller\'s own free-tier usage; reads only', probes: [{}] },
  [`GET ${BASE}/history`]: { verdict: 'read-only', reason: 'history list (LIN-3384 redacts the row); reads only', probes: [{}] },
  [`GET ${BASE}/recent-prompts`]: { verdict: 'read-only', reason: 'the caller\'s own recent prompts', probes: [{}] },
  [`POST ${BASE}/recent-prompts`]: { verdict: 'read-only', reason: 'writes the caller\'s own preferences, not runner state', probes: [{ body: { prompt: 'p' } }] },
  [`GET ${BASE}/favorite-prompts`]: { verdict: 'read-only', reason: 'the caller\'s own favourites (LIN-1011)', probes: [{}] },
  [`POST ${BASE}/favorite-prompts`]: { verdict: 'read-only', reason: 'writes the caller\'s own favourites, not runner state (LIN-1011)', probes: [{ body: { prompt: 'p' } }] },
  [`DELETE ${BASE}/favorite-prompts`]: { verdict: 'read-only', reason: 'removes from the caller\'s own favourites (LIN-1011)', probes: [{ body: { prompt: 'p' } }] },
  [`GET ${BASE}/halt`]: { verdict: 'read-only', reason: 'reads the halt request (LIN-2994 Surface 4)', probes: [{}] },
  [`POST ${BASE}/halt`]: { verdict: 'owner-gated', reason: 'LIN-3408: a halt is a request the runner honours; gate after mode validation, before the write', probes: [{ body: { mode: 'stop' } }], refused: true },
  [`DELETE ${BASE}/halt`]: { verdict: 'owner-gated', reason: 'LIN-3408: resume clears the halt request', probes: [{}], refused: true },
  [`DELETE ${BASE}/:itemId`]: { verdict: 'owner-gated', reason: 'LIN-3398: queue-item delete for runner targets; dash/local rows stay member-reachable', probes: [{}], refused: true, memberTargets: ['dash', 'local'] },
  [`PATCH ${BASE}/:sessionId/trim`]: { verdict: 'owner-gated', reason: 'LIN-3398: trim amends a live runner session; dash/local rows stay member-reachable', probes: [{ body: { maxTasks: 1 } }], refused: true, memberTargets: ['dash', 'local'] },
  [`POST ${BASE}/tokens`]: { verdict: 'owner-gated', reason: 'LIN-3137 J5: a legacy dispatch token is a take path, so only the owner mints one (GRANT_OWNER_ONLY, not RUNNER_OWNER_ONLY)', probes: [{ body: { label: 'x' } }], refused: true, code: 'GRANT_OWNER_ONLY' },
  [`GET ${BASE}/tokens`]: { verdict: 'read-only', reason: 'token metadata, no secrets', probes: [{}] },
  [`DELETE ${BASE}/tokens/:tokenId`]: { verdict: 'owner-gated', reason: 'LIN-3398: dispatch-token revoke (the token store has no owner seam)', probes: [{}], refused: true },
  [`GET ${BASE}/presets`]: { verdict: 'read-only', reason: 'preset list (LIN-1391)', probes: [{}] },
  [`POST ${BASE}/presets`]: { verdict: 'read-only', reason: 'preset rows are routing config, not runner state (LIN-1391)', probes: [{ body: { name: 'n' } }] },
  [`PATCH ${BASE}/presets/:presetId`]: { verdict: 'read-only', reason: 'preset rows are routing config, not runner state (LIN-1391)', probes: [{ body: { name: 'n' } }] },
  [`DELETE ${BASE}/presets/:presetId`]: { verdict: 'read-only', reason: 'preset rows are routing config, not runner state (LIN-1391)', probes: [{}] },
  'GET /api/dispatch/poll': { verdict: 'dispatch-token', reason: 'runner poll: dispatch token only; no credential is a 401', probes: [{}] },
  'POST /api/dispatch/broker-token': { verdict: 'dispatch-token', reason: 'LIN-3135 refire broker: dispatch token only; no credential is a 401', probes: [{ body: {} }] },
  'POST /api/dispatch/take/:itemId': { verdict: 'dispatch-token', reason: 'runner take: dispatch token only; no credential is a 401', probes: [{ body: {} }] },
  'POST /api/dispatch/heartbeat': { verdict: 'dispatch-token', reason: 'LIN-1952 consumer heartbeat: no credential is a 401 and nothing is written; the handler writes only to the new consumer-heartbeats store, never to runner or session state', probes: [{ body: {} }] },
  'POST /api/dispatch/feedback/:itemId': { verdict: 'feedback-token', reason: 'runner feedback: single-use Harbour OS feedback token or dispatch token; no credential is a 401', probes: [{ body: { message: 'm' } }] }
};

describe('LIN-3601 session-owner sweep — routes/dispatch.js', () => {
  const routes = enumerateRoutes(makeWorld().router);
  const keyOf = (r) => `${r.method} ${r.path}`;

  test(`enumerates exactly ${ROUTE_COUNT} routes and the table has one row for each`, () => {
    assert.equal(routes.length, ROUTE_COUNT, `the router registers ${routes.length} routes, the sweep was written for ${ROUTE_COUNT}: a planted or dropped route fails here, and needs a table row below`);
    const keys = routes.map(keyOf);
    assert.deepEqual(keys.filter(k => !TABLE[k]), [], 'an enumerated route without a row');
    assert.deepEqual(Object.keys(TABLE).filter(k => !keys.includes(k)), [], 'a row for a route that is not enumerated');
    for (const [key, row] of Object.entries(TABLE)) {
      assert.ok(row.reason && row.reason.length > 20, `${key}: a row needs a recorded reason`);
      assert.ok(['owner-gated', 'member-reachable', 'dispatch-token', 'feedback-token', 'read-only'].includes(row.verdict), key);
    }
  });

  for (const route of routes) {
    const key = keyOf(route);
    const row = TABLE[key];
    if (!row) continue;
    test(`${key} — ${row.verdict}`, async () => {
      for (const probe of row.probes) {
        const world = makeWorld({ accountId: MEMBER });
        const res = await request(world.app, route.method, sampleUrl(route.path), { body: probe.body });
        const where = `${key} ${JSON.stringify(probe.body ?? null)} -> ${res.status} ${res.text}`;
        if (row.verdict === 'owner-gated') {
          assert.equal(res.status, 403, where);
          assert.equal(res.body.code, row.code || 'RUNNER_OWNER_ONLY', where);
          if (!row.code) assert.equal(res.body.error, COPY, where);
          assert.deepEqual(world.writes(), [], `${where}: a refused non-owner reaches no runner-state write`);
        } else if (row.verdict === 'dispatch-token' || row.verdict === 'feedback-token') {
          assert.equal(res.status, 401, where);
          assert.deepEqual(world.writes(), [], `${where}: no credential reaches no write`);
        } else {
          assert.ok(res.status < 500, where);
          assert.notEqual(res.status, 401, where);
          assert.deepEqual(world.writes(), [], `${where}: a read-only row reaches no runner-state write`);
        }
      }
      // The owner is never refused by the gate (the gate is the only difference).
      if (row.verdict === 'owner-gated') {
        const world = makeWorld({ accountId: OWNER });
        const probe = row.probes[0];
        const res = await request(world.app, route.method, sampleUrl(route.path), { body: probe.body });
        assert.notEqual(res.status, 403, `${key}: owner -> ${res.status} ${res.text}`);
        assert.ok(world.writes().length > 0, `${key}: the owner reaches the write (${res.status} ${res.text})`);
      }
      for (const target of row.memberTargets || []) {
        const world = makeWorld({ accountId: MEMBER, rowTarget: target });
        const probe = row.probes[0];
        const res = await request(world.app, route.method, sampleUrl(route.path), { body: probe.body });
        assert.equal(res.status, 200, `${key} on a ${target} row: ${res.text}`);
        assert.equal(world.writes().length, 1, `${key} on a ${target} row stays member-reachable`);
      }
    });
  }

  test('the member-reachable dash POST: a non-owner reaches the write on a dash target by design', async () => {
    const world = makeWorld({ accountId: MEMBER });
    const res = await request(world.app, 'POST', sampleUrl(`${BASE}`), { body: { prompt: 'p', target: 'dash' } });
    assert.equal(res.status, 201, res.text);
    assert.deepEqual(world.writes(), ['addItem']);
  });
});
