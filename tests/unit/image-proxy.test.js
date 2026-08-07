// =============================================================================
// GET /workspace/:urlKey/api/image — same-origin image relay (LIN-156 / LIN-682)
// =============================================================================
//
// The proxy fetches a Linear-hosted asset with the workspace token and relays it
// so a browser `<img src>` (feedback render + LIN-652 attachments gallery) can
// display auth-protected images. LIN-682 hardens DELIVERY: it must never relay a
// non-raster body — an `image/svg+xml` served inline same-origin executes its
// embedded script in the operator's session. The guard sniffs the actual bytes,
// serves only PNG/JPEG/GIF/WEBP, sets `X-Content-Type-Options: nosniff`, and
// must NOT use `Content-Disposition: attachment` (that would break inline raster).

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>', 'utf8');

// Build a Response-like stub the route's global fetch() can consume.
function fakeUpstream({ ok = true, status = 200, contentType = 'image/png', body = PNG } = {}) {
  return {
    ok,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    async arrayBuffer() { return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength); },
  };
}

// `provider` is left UNSET by default (LIN-1899): that reproduces a legacy
// pre-binding workspace exactly, which is the positive control the delivery
// tests below have always implicitly been running.
function buildApp({ provider } = {}) {
  const app = express();
  const router = createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey, accessToken: 'ws-token', ...(provider ? { provider } : {}) };
      req.session = { linearUserId: 'user-1' };
      next();
    },
    // Only the factory signature matters here; the image route uses none of these.
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
    workspacePreferencesStore: {}, customPromptsStore: {}, recapCacheStore: {},
    briefCacheStore: {}, reportHistoryStore: {}, dispatchQueueStore: {},
    agentStatusStore: {}, promptTraceStore: {}, proxyTokenStore: {}
  });
  app.use(router);
  return app;
}

async function getImage(app, url) {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const target = `http://127.0.0.1:${port}/workspace/ws/api/image?url=${encodeURIComponent(url)}`;
    const res = await fetch(target);
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, body: buf };
  } finally {
    server.close();
  }
}

describe('GET /api/image proxy (LIN-682 delivery gate)', () => {
  let realFetch;
  let nextUpstream;

  beforeEach(() => {
    realFetch = globalThis.fetch;
    // Route handler fetches the upstream Linear asset over https; the test
    // client's fetch (to our own express server) uses http://127.0.0.1, so the
    // scheme cleanly separates the two — intercept only the https upstream call.
    // (The test-client URL carries the linear.app host in its query string, so a
    // hostname substring match would wrongly hijack it.)
    globalThis.fetch = (input, init) => {
      const u = typeof input === 'string' ? input : input?.url || '';
      if (u.startsWith('https://')) return Promise.resolve(nextUpstream);
      return realFetch(input, init);
    };
  });

  afterEach(() => { globalThis.fetch = realFetch; });

  test('relays a legitimate raster image inline with nosniff and no attachment', async () => {
    nextUpstream = fakeUpstream({ contentType: 'image/png', body: PNG });
    const res = await getImage(buildApp(), 'https://uploads.linear.app/abc/shot.png');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'image/png');
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('content-disposition'), null); // inline preserved
    assert.ok(res.body.equals(PNG));
  });

  test('rejects an SVG body even when upstream labels it image/svg+xml', async () => {
    nextUpstream = fakeUpstream({ contentType: 'image/svg+xml', body: SVG });
    const res = await getImage(buildApp(), 'https://uploads.linear.app/abc/evil.svg');

    assert.strictEqual(res.status, 400);
    assert.ok(!res.body.includes('<script'), 'SVG bytes must not be relayed');
  });

  test('rejects an SVG body even when upstream lies and labels it image/png', async () => {
    // Defeats a content-type allowlist: only byte sniffing catches this.
    nextUpstream = fakeUpstream({ contentType: 'image/png', body: SVG });
    const res = await getImage(buildApp(), 'https://uploads.linear.app/abc/mislabeled.png');

    assert.strictEqual(res.status, 400);
  });

  test('rejects non-Linear hosts (SSRF guard, unchanged)', async () => {
    const res = await getImage(buildApp(), 'https://evil.example.com/x.png');
    assert.strictEqual(res.status, 400);
  });
});

// =============================================================================
// LIN-1899 — provider check on the relay's Authorization header
// =============================================================================
//
// `workspace.accessToken` is the provider-agnostic scalar mirror: for a
// Jira-active workspace it holds the user's raw Jira API token, and this route
// used to template it into `Authorization: Bearer …` on a request to
// uploads.linear.app unconditionally. Same cross-provider credential egress
// LIN-1891 closed on the attachment relay (routes/proxy.js:2477-2479), same
// site class, so this takes that precedent's consequence verbatim: SERVE the
// asset, WITHHOLD the header — asset relays degrade, capability endpoints
// refuse (the audit route's 422, tests/unit/audit-route-provider-guard.test.js).
//
// The witness is the OUTBOUND header, never the response status: a status-keyed
// assertion would pass on the vulnerable code, which also returns 200. The
// stub above already intercepts the upstream call but discards `init`, so these
// cases capture it (idiom from tests/unit/proxy-attachment-relay.test.js:426-430).
describe('GET /api/image proxy — provider guard on the auth header (LIN-1899)', () => {
  let realFetch;
  let sawInit;

  beforeEach(() => {
    realFetch = globalThis.fetch;
    sawInit = null;
    globalThis.fetch = (input, init) => {
      const u = typeof input === 'string' ? input : input?.url || '';
      if (u.startsWith('https://')) {
        sawInit = init;
        return Promise.resolve(fakeUpstream({ contentType: 'image/png', body: PNG }));
      }
      return realFetch(input, init);
    };
  });

  afterEach(() => { globalThis.fetch = realFetch; });

  test('a LEGACY workspace with no `provider` field falls back to linear and KEEPS its Authorization header', async () => {
    // The single most likely regression: a predicate written as
    // `provider === 'linear'` (no `|| 'linear'` fallback) silently strips the
    // credential from every pre-binding workspace and breaks image delivery.
    const res = await getImage(buildApp(), 'https://uploads.linear.app/abc/legacy.png');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(sawInit.headers.Authorization, 'Bearer ws-token');
    assert.ok(res.body.equals(PNG));
  });

  test('an explicitly linear workspace KEEPS its Authorization header', async () => {
    const res = await getImage(buildApp({ provider: 'linear' }), 'https://uploads.linear.app/abc/shot.png');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(sawInit.headers.Authorization, 'Bearer ws-token');
  });

  test('a Jira-active workspace gets NO Authorization header and the asset is still served', async () => {
    const res = await getImage(buildApp({ provider: 'jira' }), 'https://uploads.linear.app/abc/shot.png');

    assert.strictEqual(res.status, 200, 'the relay still serves the asset — only the credential is withheld');
    assert.strictEqual('Authorization' in (sawInit.headers || {}), false,
      'the raw Jira API token must not be sent to Linear\'s CDN');
    assert.ok(res.body.equals(PNG));
  });

  test('a local workspace also gets NO Authorization header (linear-only, never linear-or-local)', async () => {
    // Pins LIN-1891's settled rule: widening the predicate to
    // `linear || local` turns this red.
    const res = await getImage(buildApp({ provider: 'local' }), 'https://uploads.linear.app/abc/shot.png');

    assert.strictEqual(res.status, 200);
    assert.strictEqual('Authorization' in (sawInit.headers || {}), false);
  });
});
