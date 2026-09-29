/**
 * LIN-3124 PR2 — legacy inertness proof.
 *
 * Run with: node --test tests/unit/lin-3124-pr2-inertness.test.js
 *
 * Every PR2 surface is keyed on `connectionId`, which no legacy binding has, so
 * a legacy session's request path, persisted row, removal and merge are
 * byte-identical with the middleware / sanitizer / lifecycle wired in. Each case
 * here fails loudly if a legacy shape ever starts being touched.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  createConnectionRowLoader,
  createHydrationMiddleware,
  sanitizeSessionForPersist,
  collectSessionConnectionIds,
} from '../../lib/connection-credential.js';
import { MongoSessionStore } from '../../lib/session-store.js';

const LEGACY_SESSION = () => ({
  accountId: 'acct-legacy',
  workspaces: [
    {
      id: 'lin-1', urlKey: 'acme', provider: 'linear',
      accessToken: 'legacy-access', tokenExpiresAt: 111,
      credentials: { token: 'legacy-cred', refreshToken: 'legacy-refresh' },
      bindings: [{ provider: 'linear', scope: 'org-1', credentials: { token: 'legacy-cred', refreshToken: 'legacy-refresh' } }],
    },
    {
      id: 'gh-1', urlKey: 'acme-repo', provider: 'github',
      accessToken: 'gh-access', tokenExpiresAt: 222,
      bindings: [{ provider: 'github', scope: 'acme/repo', credentials: { token: 'gh-access', installationId: '99' } }],
    },
  ],
});

function throwingStore() {
  let reads = 0;
  return {
    get reads() { return reads; },
    async readConnectionsByIds() { reads++; throw new Error('legacy path read the connections collection'); },
  };
}

describe('LIN-3124 PR2 — legacy inertness', () => {
  test('hydration middleware is a no-op (zero reads) for a legacy-only session', async () => {
    const connectionStore = throwingStore();
    const middleware = createHydrationMiddleware({ connectionStore });
    const req = { session: LEGACY_SESSION() };
    let nextCalled = false;
    await middleware(req, {}, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true, 'the middleware must always call next()');
    assert.strictEqual(connectionStore.reads, 0);
    assert.deepStrictEqual(collectSessionConnectionIds(req.session), []);
  });

  test('the row loader does zero reads for a legacy-only session', async () => {
    const connectionStore = throwingStore();
    const load = createConnectionRowLoader({ connectionStore });
    const rows = await load(LEGACY_SESSION());
    assert.ok(rows instanceof Map);
    assert.strictEqual(rows.size, 0);
    assert.strictEqual(connectionStore.reads, 0);
  });

  test('sanitizer is byte-identity on a legacy session', () => {
    const session = LEGACY_SESSION();
    const before = JSON.stringify(session);
    sanitizeSessionForPersist(session);
    assert.strictEqual(JSON.stringify(session), before);
  });

  test('MongoSessionStore.set persists a legacy session byte-identically', async () => {
    const session = LEGACY_SESSION();
    const before = JSON.parse(JSON.stringify(session));
    let written;
    const store = new MongoSessionStore({ collection: { async updateOne(_f, update) { written = update.$set.session; } } });
    await new Promise((resolve, reject) => store.set('sid', session, (err) => err ? reject(err) : resolve()));
    assert.deepStrictEqual(written, before);
  });

  test('the hydration middleware is wired AFTER the session middleware (static pin)', () => {
    const src = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    const sessionIdx = src.indexOf('app.use(session(createSessionOptions(');
    const hydrateIdx = src.indexOf('app.use(createHydrationMiddleware(');
    assert.ok(sessionIdx >= 0, 'session middleware present');
    assert.ok(hydrateIdx >= 0, 'hydration middleware wired');
    assert.ok(sessionIdx < hydrateIdx, 'hydration must run after the session is established');
  });
});
