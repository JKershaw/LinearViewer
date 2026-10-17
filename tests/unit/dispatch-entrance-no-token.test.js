/**
 * LIN-3601 — no provider token: kickoff and both recommend-and-dispatch arms
 * answer 503 and call nothing further (a gap no behaviour test covered; the
 * `!accessToken` guards at routes/proxy-kickoff.js:246 and
 * routes/proxy-dispatch.js:866 were pinned by source text, LIN-1980).
 *
 * `resolveWorkspaceAccess` answers no token. The routes must reply 503 through
 * `workspaceUnavailable` and make no provider call, no free-tier charge, no
 * OpenRouter-key read, no queue-store call and no mint.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createProxyRoutes } from '../../routes/proxy.js';
import { BASE_DEPS, ACME } from './lib/proxy-fake-deps.js';
import { appAround, request, makeSpy, spiedProxyTokenStore } from './lib/entrance-route-sweep.js';

const UUID = '11111111-2222-4333-8444-555555555555';

/** A world in which every collaborator records a call, and no workspace token resolves. */
function noTokenWorld() {
  const spy = makeSpy();
  const deps = BASE_DEPS();
  deps.resolveWorkspaceAccess = spy.wrap('resolveWorkspaceAccess', async () => ({ token: null, reason: 'no-session' }));
  deps.proxyTokenStore = spiedProxyTokenStore(spy, {
    validateToken: async () => ({ tokenId: 't1', urlKey: ACME, label: 'test', scope: 'readWrite', createdBy: 'u1', grants: ['dispatch'], workspaceId: 'ws-acme' })
  });
  deps.workspacePreferencesStore = { getWorkspacePreferences: spy.wrap('getWorkspacePreferences', async () => ({})) };
  deps.freeTierStore = { tryUse: spy.wrap('tryUse', async () => ({ allowed: true })) };
  deps.getWorkspaceOpenRouterKey = spy.wrap('getWorkspaceOpenRouterKey', async () => null);
  const store = {};
  for (const method of ['addItem', 'expandCascadeAborts', 'listItems', 'listHistory', 'getItemStatus', 'getGrantDeclaration', 'countDistinctTasksForSession', 'findRecentFreshDispatch']) {
    store[method] = spy.wrap(method, async () => (method === 'listHistory' ? { items: [], total: 0 } : method === 'listItems' ? [] : null));
  }
  deps.dispatchQueueStore = store;
  deps.dispatchPresetsStore = { get: spy.wrap('presets.get', async () => null), list: spy.wrap('presets.list', async () => []) };
  for (const method of Object.keys(deps.provider)) {
    if (typeof deps.provider[method] === 'function' && !['supports', 'createFields', 'apiWriteFields'].includes(method)) {
      deps.provider[method] = spy.wrap(`provider.${method}`, deps.provider[method]);
    }
  }
  return { spy, app: appAround(createProxyRoutes(deps)) };
}

const ROWS = [
  { name: 'kickoff (scoped to an issue)', path: '/api/proxy/autopilot/kickoff', body: { issueIdentifier: 'LIN-1' } },
  { name: 'recommend-and-dispatch (fresh)', path: '/api/proxy/recommend-and-dispatch', body: { issueIdentifier: 'LIN-1' } },
  { name: 'recommend-and-dispatch (follow-up)', path: '/api/proxy/recommend-and-dispatch', body: { issueIdentifier: 'LIN-1', followUpTo: UUID, target: 'cli' } }
];

describe('LIN-3601 no provider token — 503 and nothing further (LIN-1980)', () => {
  for (const row of ROWS) {
    test(`${row.name}: 503, and the only call made is the credential resolution`, async () => {
      const { spy, app } = noTokenWorld();
      const res = await request(app, 'POST', row.path, { body: row.body, headers: { Authorization: 'Bearer anything' } });
      assert.equal(res.status, 503, res.text);
      // Every call the world recorded: the credential resolution, and nothing after it.
      assert.deepEqual([...new Set(spy.names())], ['resolveWorkspaceAccess'], `calls after the missing token: ${spy.names().join(', ')}`);
    });
  }
});
