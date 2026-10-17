/**
 * LIN-3601 — the proxy-grant sweep (replaces the exact `createDispatchItem` /
 * `expandCascadeAborts` counts in lin-3136-enqueue-census for the proxy entrances).
 *
 * LIN-3136: enqueue through the proxy needs a `readWrite` token that ALSO holds
 * the `dispatch` grant. The census counted the enqueue sinks in
 * routes/proxy-dispatch.js and routes/proxy-kickoff.js and demanded that each
 * sit under a `requireGrant('dispatch')` registration. That keyed the guard to
 * the file and the line; this sweep keys it to behaviour. Every write route of
 * the real composer (`createProxyRoutes`, which mounts each group with
 * `router.use(createXRoutes(...))`) is called over HTTP with
 *   - a `readWrite` token that lacks `dispatch`, and
 *   - a `read` token,
 * and neither may reach `addItem` or `expandCascadeAborts`. A POST without the
 * grant that calls `createDispatchItem` therefore fails here whichever file the
 * call sits in. The three enqueue mounts must answer 403 DISPATCH_GRANT_REQUIRED
 * to the `readWrite` token.
 *
 * Positive controls (the same three mounts with the grant DO reach the sink)
 * stop the sweep from passing because its fixtures never get past validation.
 *
 * LIN-3604: the `{ issueIdentifier: 'LIN-1' }` fixtures above name an issue the
 * test-mode mock does not know, so recommend-and-dispatch and kickoff answer 404
 * before they reach the enqueue point and their "reaches no sink" checks pass
 * whether or not the grant gate is there. REACHING_BODIES names an issue the mock
 * knows (`TEST-1`, as dispatch-entrance-pins.test.js does), each with a positive
 * control, so a dropped `requireGrant('dispatch')` on either route fails here.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createProxyRoutes } from '../../routes/proxy.js';
import { BASE_DEPS, ACME } from './lib/proxy-fake-deps.js';
import { enumerateRoutes, sampleUrl, appAround, request, makeSpy, spiedProxyTokenStore } from './lib/entrance-route-sweep.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');

// The composer's audited path-scoped layers: routes/proxy-runner.js:76 (the
// runner group's limiter + token + `take` gate) and routes/proxy-tokens-admin.js:138
// (the copy-token creation limiter). Any other layer fails the enumeration.
const RUNNER_MOUNT = String.raw`^\/api\/proxy\/runner\/?(?=\/|$)`;
const TOKENS_MOUNT = String.raw`^\/workspace(?:\/([^/]+?))\/api\/proxy\/tokens\/?(?=\/|$)`;
const ALLOWED_LAYERS = [
  { mount: RUNNER_MOUNT, names: ['<anonymous>', 'authenticateProxyToken', 'requireGrantMiddleware'] },
  { mount: TOKENS_MOUNT, names: ['<anonymous>'] }
];

const SINKS = ['addItem', 'expandCascadeAborts'];
const ENQUEUE_MOUNTS = [
  { path: '/api/proxy/dispatch', body: { prompt: 'p' } },
  { path: '/api/proxy/recommend-and-dispatch', body: { issueIdentifier: 'LIN-1' } },
  { path: '/api/proxy/autopilot/kickoff', body: { issueIdentifier: 'LIN-1' } }
];

// Bodies that reach the enqueue point WITH the dispatch grant (LIN-3604). Both
// recommend-and-dispatch arms: `kind` set (the verb override) and absent (the
// recommendation-derived arm); and kickoff.
const REACHING_BODIES = [
  { path: '/api/proxy/recommend-and-dispatch', body: { issueIdentifier: 'TEST-1', kind: 'implementation' } },
  { path: '/api/proxy/recommend-and-dispatch', body: { issueIdentifier: 'TEST-1' } },
  { path: '/api/proxy/autopilot/kickoff', body: { issueIdentifier: 'TEST-1' } }
];

function makeWorld({ scope, grants }) {
  const spy = makeSpy();
  const deps = BASE_DEPS();
  deps.proxyTokenStore = spiedProxyTokenStore(spy, {
    validateToken: async () => ({ tokenId: 't1', urlKey: ACME, label: 'test', scope, createdBy: 'u1', grants, workspaceId: 'ws-acme' })
  });
  deps.workspacePreferencesStore = { getWorkspacePreferences: async () => ({}) };
  deps.dispatchQueueStore = {
    ...deps.dispatchQueueStore,
    addItem: spy.wrap('addItem', async (_k, fields) => ({ _id: 'item-1', ...fields })),
    expandCascadeAborts: spy.wrap('expandCascadeAborts', async () => ({ aborted: 0 }))
  };
  const router = createProxyRoutes(deps);
  return { router, app: appAround(router), spy, sinks: () => spy.names().filter(n => SINKS.includes(n)) };
}

/** URL forms the proxy witness derives: every `router.<verb>(` registration in the proxy files plus one per array-path alias. */
function derivedUrlForms() {
  const files = ['routes/proxy.js', ...readdirSync(join(REPO, 'routes')).filter(n => /^proxy-.*\.js$/.test(n)).map(n => `routes/${n}`)];
  const registrations = (src) => (src.match(/router\.(get|post|put|patch|delete)\(/g) || []).length;
  const aliases = (src) => (src.match(/router\.(get|post|put|patch|delete)\(\s*\[/g) || []).length;
  let total = 0;
  for (const f of files) {
    const src = readFileSync(join(REPO, f), 'utf8');
    total += registrations(src) + aliases(src);
  }
  return total;
}

describe('LIN-3601 proxy-grant sweep — the composer', () => {
  const routes = enumerateRoutes(makeWorld({ scope: 'readWrite', grants: [] }).router, { allowedLayers: ALLOWED_LAYERS });
  const writes = routes.filter(r => r.method !== 'GET' && r.method !== 'HEAD');

  test('enumerates every URL form the proxy route sources register', () => {
    // Each `router.<verb>(` is one URL form, plus one more per array-path alias
    // (proxy-endpoint-inventory-witness derives the same figure and subtracts
    // the three documented routes/proxy-rulings.js forms; this sweep calls them).
    assert.equal(routes.length, derivedUrlForms(), 'the enumerated route count must equal the count derived from the proxy sources');
    assert.ok(writes.length > 20, `a sweep that finds ${writes.length} write routes is not sweeping the composer`);
    for (const m of ENQUEUE_MOUNTS) {
      assert.ok(writes.some(r => r.path === m.path && r.method === 'POST'), `${m.path} is enumerated`);
    }
  });

  for (const token of [{ scope: 'readWrite', grants: [] }, { scope: 'read', grants: [] }]) {
    test(`no write route reaches addItem or expandCascadeAborts with a ${token.scope} token lacking dispatch`, async () => {
      const failures = [];
      for (const route of writes) {
        const world = makeWorld(token);
        const enqueue = ENQUEUE_MOUNTS.find(m => m.path === route.path);
        const res = await request(world.app, route.method, sampleUrl(route.path), {
          body: enqueue ? enqueue.body : {},
          headers: { Authorization: 'Bearer anything' }
        });
        if (world.sinks().length) failures.push(`${route.method} ${route.path}: reached ${world.sinks().join(',')} (${res.status})`);
      }
      assert.deepEqual(failures, []);
    });
  }

  for (const m of ENQUEUE_MOUNTS) {
    test(`${m.path} answers 403 DISPATCH_GRANT_REQUIRED to a readWrite token, whatever the body`, async () => {
      for (const body of [m.body, {}, { prompt: 'p', abort: true, abortTo: '11111111-2222-4333-8444-555555555555', cascade: true }]) {
        const world = makeWorld({ scope: 'readWrite', grants: [] });
        const res = await request(world.app, 'POST', m.path, { body, headers: { Authorization: 'Bearer anything' } });
        assert.equal(res.status, 403, res.text);
        assert.equal(res.body.code, 'DISPATCH_GRANT_REQUIRED', res.text);
        assert.deepEqual(world.sinks(), []);
      }
    });

    test(`${m.path} answers a read token with a refusal and reaches no sink`, async () => {
      const world = makeWorld({ scope: 'read', grants: [] });
      const res = await request(world.app, 'POST', m.path, { body: m.body, headers: { Authorization: 'Bearer anything' } });
      assert.equal(res.status, 403, res.text);
      assert.deepEqual(world.sinks(), []);
    });
  }

  test('positive control: with the dispatch grant, POST /api/proxy/dispatch reaches addItem and an abort cascade reaches expandCascadeAborts', async () => {
    const fresh = makeWorld({ scope: 'readWrite', grants: ['dispatch'] });
    const res = await request(fresh.app, 'POST', '/api/proxy/dispatch', { body: { prompt: 'p' }, headers: { Authorization: 'Bearer anything' } });
    assert.equal(res.status, 201, res.text);
    assert.deepEqual(fresh.sinks(), ['addItem']);

    const cascade = makeWorld({ scope: 'readWrite', grants: ['dispatch'] });
    const abort = await request(cascade.app, 'POST', '/api/proxy/dispatch', {
      body: { abort: true, cascade: true, abortTo: '11111111-2222-4333-8444-555555555555' },
      headers: { Authorization: 'Bearer anything' }
    });
    assert.equal(abort.status, 201, abort.text);
    assert.deepEqual(cascade.sinks(), ['expandCascadeAborts']);
  });

  // LIN-3604 additions: the same checks with a body that gets past the issue lookup.
  for (const token of [{ scope: 'readWrite', grants: [] }, { scope: 'read', grants: [] }]) {
    test(`recommend-and-dispatch and kickoff with a known issue and a ${token.scope} token lacking dispatch reach no sink`, async () => {
      const failures = [];
      for (const m of REACHING_BODIES) {
        const world = makeWorld(token);
        const res = await request(world.app, 'POST', m.path, { body: m.body, headers: { Authorization: 'Bearer anything' } });
        if (res.status !== 403) failures.push(`${m.path} ${JSON.stringify(m.body)}: answered ${res.status}, not 403`);
        if (world.sinks().length) failures.push(`${m.path} ${JSON.stringify(m.body)}: reached ${world.sinks().join(',')}`);
      }
      assert.deepEqual(failures, []);
    });
  }

  test('a readWrite token lacking dispatch gets 403 DISPATCH_GRANT_REQUIRED from recommend-and-dispatch and kickoff, with a known issue', async () => {
    for (const m of REACHING_BODIES) {
      const world = makeWorld({ scope: 'readWrite', grants: [] });
      const res = await request(world.app, 'POST', m.path, { body: m.body, headers: { Authorization: 'Bearer anything' } });
      assert.equal(res.status, 403, `${m.path}: ${res.text}`);
      assert.equal(res.body.code, 'DISPATCH_GRANT_REQUIRED', res.text);
      assert.deepEqual(world.sinks(), []);
    }
  });

  test('positive control: with the dispatch grant, recommend-and-dispatch (both arms) and kickoff reach addItem', async () => {
    for (const m of REACHING_BODIES) {
      const world = makeWorld({ scope: 'readWrite', grants: ['dispatch'] });
      const res = await request(world.app, 'POST', m.path, { body: m.body, headers: { Authorization: 'Bearer anything' } });
      assert.equal(res.status, 201, `${m.path} ${JSON.stringify(m.body)}: ${res.text}`);
      assert.deepEqual(world.sinks(), ['addItem'], `${m.path} ${JSON.stringify(m.body)}`);
    }
  });
});
