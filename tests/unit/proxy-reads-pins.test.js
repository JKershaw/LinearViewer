// LIN-3569: pins for the four places the rebuilt read router (routes/proxy-reads.js)
// deliberately answers differently from the one it replaced. All four are on
// GET /api/proxy/attachments/:id:
//   a1. a resolveProviderAccess rejection (att: and md:) fell to the global error
//       handler: a bare 500 and no logged event. It is now mapped and logged, like
//       every other read route. A rejection that already carries a client 4xx keeps
//       that status.
//   a2. att: with an unavailable workspace and a provider without fetchAttachment
//       answered 422 CAPABILITY_NOT_SUPPORTED. LIN-677: a down workspace is a
//       wait, so it answers the 503 workspace envelope.
//   a3. a native-fetch redirect (`TypeError('fetch failed')` whose cause says
//       'unexpected redirect') answered 502 instead of 400 `Redirects not allowed`.
//   a4. the proxy transport (lib/proxy-fetch.js) never follows a redirect but
//       resolves it as `{ ok: false, status: 3xx }`, which was passed through as a
//       bodiless 3xx. It is now the same 400 `Redirects not allowed`.
// Each runs through the real createProxyRoutes composer, as production does.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp, call, BASE_DEPS, makeFakeProvider } from './lib/proxy-fake-deps.js';
import { setProxyFetchImpl } from '../../lib/proxy-fetch.js';
import { encodeAttachmentHandle } from '../../lib/proxy-wire.js';

const ATT = encodeAttachmentHandle('att', 'att-1');
const MD_LINEAR = encodeAttachmentHandle('md', 'https://uploads.linear.app/ws/abc/def#name=pic.png');
const MD_GITHUB = encodeAttachmentHandle('md', 'https://user-images.githubusercontent.com/1/a.png');
const ENDPOINT = '/api/proxy/attachments/:id';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setProxyFetchImpl(null);
});

// Stubs the relay's egress on both transports (native fetch, and the proxy override
// that createProxyFetch() prefers when HTTPS_PROXY is set, as in the hermetic:proxy
// run); the test's own loopback requests reach the real fetch.
const stubEgress = (fn) => {
  globalThis.fetch = (url, ...rest) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, ...rest) : fn(url, ...rest));
  setProxyFetchImpl(fn);
};

function relayApp({ provider = {}, resolveWorkspaceAccess } = {}) {
  const events = [];
  const app = buildApp({
    provider: { ...makeFakeProvider(), name: 'linear', fetchAttachment: async () => ({ url: 'https://uploads.linear.app/ws/abc/def', title: 'pic.png' }), ...provider },
    proxyEventStore: { ...BASE_DEPS().proxyEventStore, recordEvent: async (row) => { events.push(row); } },
    ...(resolveWorkspaceAccess && { resolveWorkspaceAccess }),
  });
  return { app, events };
}
const relayRows = (events) => events.filter((e) => e.endpoint === ENDPOINT).map((e) => e.status);

for (const [label, handle] of [['att:', ATT], ['md: (Linear host)', MD_LINEAR], ['md: (GitHub host, no token needed)', MD_GITHUB]]) {
  test(`a1: ${label} — a resolve rejection is a mapped, logged failure, not a bare 500`, async () => {
    const upstream = Object.assign(new Error('Linear says no'), { response: { status: 401 } });
    const { app, events } = relayApp({ resolveWorkspaceAccess: async () => { throw upstream; } });
    const res = await call(app, 'GET', `/api/proxy/attachments/${encodeURIComponent(handle)}`);
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Failed to resolve attachment');
    assert.ok(res.body.detail, 'carries the same detail the other read routes give');
    assert.deepEqual(relayRows(events), [401], 'the failure is logged against the relay endpoint');
  });
}

test('a1: a resolve rejection with no upstream status is a logged 500 with a body', async () => {
  const { app, events } = relayApp({ resolveWorkspaceAccess: async () => { throw new Error('store down'); } });
  const res = await call(app, 'GET', `/api/proxy/attachments/${encodeURIComponent(ATT)}`);
  assert.equal(res.status, 500);
  assert.equal(res.body.error, 'Failed to resolve attachment');
  assert.deepEqual(relayRows(events), [500]);
});

test('a1: a resolve rejection that already carries a client 4xx keeps that status', async () => {
  const { app, events } = relayApp({ resolveWorkspaceAccess: async () => { throw Object.assign(new Error('bad'), { status: 400 }); } });
  const res = await call(app, 'GET', `/api/proxy/attachments/${encodeURIComponent(ATT)}`);
  assert.equal(res.status, 400);
  assert.deepEqual(relayRows(events), [400]);
});

test('a2: att: with an unavailable workspace and no fetchAttachment capability is the 503 envelope, not 422', async () => {
  const { app, events } = relayApp({
    provider: { supports: (m) => m !== 'fetchAttachment' },
    resolveWorkspaceAccess: async () => ({ token: null, reason: 'store_unreachable' }),
  });
  const res = await call(app, 'GET', `/api/proxy/attachments/${encodeURIComponent(ATT)}`);
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'WORKSPACE_STORE_UNAVAILABLE');
  assert.deepEqual(relayRows(events), [503]);
});

test('a2 companion: an available workspace with no fetchAttachment capability still answers 422', async () => {
  const { app } = relayApp({ provider: { supports: (m) => m !== 'fetchAttachment' } });
  const res = await call(app, 'GET', `/api/proxy/attachments/${encodeURIComponent(ATT)}`);
  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'CAPABILITY_NOT_SUPPORTED');
});

test("a3: native fetch's real redirect error (TypeError 'fetch failed', cause 'unexpected redirect') is 400 Redirects not allowed", async () => {
  const { app, events } = relayApp();
  stubEgress(async () => { throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') }); });
  const res = await call(app, 'GET', `/api/proxy/attachments/${encodeURIComponent(MD_LINEAR)}`);
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Redirects not allowed');
  assert.deepEqual(relayRows(events), [400]);
});

test('a3 companion: any other egress failure is still a logged 502', async () => {
  const { app, events } = relayApp();
  stubEgress(async () => { throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND') }); });
  const res = await call(app, 'GET', `/api/proxy/attachments/${encodeURIComponent(MD_LINEAR)}`);
  assert.equal(res.status, 502);
  assert.deepEqual(relayRows(events), [502]);
});

for (const status of [301, 302, 307, 308]) {
  test(`a4: the proxy transport resolving a ${status} is 400 Redirects not allowed, logged 400`, async () => {
    const { app, events } = relayApp();
    setProxyFetchImpl(async () => ({ ok: false, status, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) }));
    const res = await call(app, 'GET', `/api/proxy/attachments/${encodeURIComponent(MD_GITHUB)}`);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Redirects not allowed');
    assert.deepEqual(relayRows(events), [400]);
  });
}

test('a4 companion: the proxy transport resolving a non-redirect failure is still passed through', async () => {
  const { app, events } = relayApp();
  setProxyFetchImpl(async () => ({ ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) }));
  const res = await call(app, 'GET', `/api/proxy/attachments/${encodeURIComponent(MD_LINEAR)}`);
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'Failed to fetch attachment');
  assert.deepEqual(relayRows(events), [404]);
});
