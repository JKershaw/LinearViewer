/**
 * LIN-3601 — the dispatch-token mint chain's ORDER (a gap no behaviour test
 * covered; it was held by source position in routes/dispatch.js).
 *
 * `POST /workspace/:urlKey/api/dispatch/tokens` is registered as
 * `tokenCreationLimiter, workspaceFromUrl, handler`: the limiter answers before
 * the workspace is resolved, and the owner gate (LIN-3137 J5) sits inside the
 * handler, before `createToken`. Proved here over HTTP:
 *   - five POSTs by a non-owner are each refused and mint nothing;
 *   - the sixth is a 429 from the limiter, and `workspaceFromUrl` never ran for it.
 *
 * Its OWN file, on purpose. `tokenCreationLimiter` is module-scope
 * (routes/dispatch.js), so its memory store is shared by everything in one test
 * process; its `skip` reads NODE_ENV per request, and every other test runs under
 * 'test', which skips it. `node --test` gives each file a fresh process, so this
 * file starts with an empty limiter: exactly five prior POSTs, all made with
 * NODE_ENV=production, and NODE_ENV restored in a `finally`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { appAround, request, makeSpy } from './lib/entrance-route-sweep.js';

const PATH = '/workspace/alpha/api/dispatch/tokens';

test('the mint chain: limiter before workspaceFromUrl, owner gate before createToken', async () => {
  const spy = makeSpy();
  const router = createDispatchRoutes({
    dispatchQueueStore: {},
    dispatchTokenStore: { createToken: spy.wrap('createToken', async () => ({ tokenId: 't', token: 'x', label: 'l' })) },
    workspaceOwnerCheck: async () => ({ status: 'not-owner' }),
    userPreferencesStore: {},
    workspaceFromUrl: (req, _res, next) => {
      spy.calls.push(['workspaceFromUrl']);
      req.workspace = { urlKey: 'alpha', id: 'ws-alpha' };
      req.session = { accountId: 'acct-member' };
      next();
    }
  });
  const app = appAround(router);

  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    for (let i = 1; i <= 5; i++) {
      const res = await request(app, 'POST', PATH, { body: { label: `try-${i}` } });
      assert.equal(res.status, 403, `POST ${i}: ${res.text}`);
      assert.equal(res.body.code, 'GRANT_OWNER_ONLY', `POST ${i}: a non-owner is refused by the gate`);
    }
    assert.equal(spy.count('workspaceFromUrl'), 5, 'the first five requests reached workspace resolution');
    assert.equal(spy.count('createToken'), 0, 'a non-owner never reaches dispatchTokenStore.createToken');

    const sixth = await request(app, 'POST', PATH, { body: { label: 'try-6' } });
    assert.equal(sixth.status, 429, sixth.text);
    assert.equal(spy.count('workspaceFromUrl'), 5, 'the limiter answers before workspaceFromUrl runs');
    assert.equal(spy.count('createToken'), 0);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
