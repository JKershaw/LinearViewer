/**
 * LIN-650 (parent LIN-612, slice 2/4) — Consumer image byte-relay.
 *
 * GET /api/proxy/attachments/:id is a Bearer-authed, provider-backed,
 * SSRF-guarded relay that turns the opaque attachment handle (LIN-649) back into
 * image bytes server-side. This slice covers the `md:` markdown-image path only;
 * `att:` formal attachments are explicitly deferred with a 422.
 *
 * These tests drive the real handler over HTTP (mirroring proxy-route-aliases)
 * and stub the *upstream* Linear fetch by URL-discriminating globalThis.fetch:
 * calls to the test server's loopback address delegate to the real fetch, while
 * calls to the Linear asset host return a controllable fake response. That keeps
 * the decode → SSRF-guard → fetch → stream path fully offline and deterministic.
 */

process.env.NODE_ENV = 'test';

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { encodeAttachmentHandle } from '../../lib/proxy-wire.js';

function buildApp({ token = 'ws-linear-token', reason = 'ok' } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'read', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token, reason }),
    getWorkspaceAccessToken: async () => token,
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    taskSnapshotStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

// Call the relay over HTTP. Returns { status, contentType, bodyText, bodyBuf }.
async function getAttachment(app, handle) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/proxy/attachments/${encodeURIComponent(handle)}`,
      { headers: { Authorization: 'Bearer anything' } }
    );
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      contentType: res.headers.get('content-type') || '',
      bodyBuf: buf,
      bodyText: buf.toString('utf8')
    };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

// Like getAttachment but stubs the upstream in-line and returns the full set of
// response headers (lower-cased) so header-level assertions are possible.
async function fetchRaw(app, handle, upstreamHandler) {
  stubUpstream(upstreamHandler);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/proxy/attachments/${encodeURIComponent(handle)}`,
      { headers: { Authorization: 'Bearer anything' } }
    );
    const buf = Buffer.from(await res.arrayBuffer());
    const headers = {};
    for (const [k, v] of res.headers.entries()) headers[k] = v;
    return { status: res.status, headers, bodyText: buf.toString('utf8') };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

// A minimal fetch Response stand-in for the upstream image fetch.
function fakeResponse({ ok = true, status = 200, contentType = 'image/png', contentLength, bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]) } = {}) {
  const headers = new Map();
  if (contentType !== null) headers.set('content-type', contentType);
  if (contentLength !== undefined) headers.set('content-length', String(contentLength));
  return {
    ok,
    status,
    headers: { get: (n) => (headers.has(n.toLowerCase()) ? headers.get(n.toLowerCase()) : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
}

const LINEAR_HOST = 'https://uploads.linear.app';
const realFetch = globalThis.fetch;

// Install a URL-discriminating fetch: only the Linear asset host is intercepted;
// everything else (the loopback call to the test server) hits the real fetch.
function stubUpstream(handler) {
  globalThis.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.startsWith(LINEAR_HOST)) return handler(url, opts);
    return realFetch(url, opts);
  };
}

afterEach(() => { globalThis.fetch = realFetch; });

const md = (url) => encodeAttachmentHandle('md', url);

describe('GET /api/proxy/attachments/:id — relay (md: path)', () => {
  test('streams image bytes with upstream content-type on a valid md: handle', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    let sawAuth = null;
    stubUpstream((url, opts) => {
      sawAuth = opts.headers.Authorization;
      return fakeResponse({ contentType: 'image/png', bytes: png });
    });
    const res = await getAttachment(buildApp(), md(`${LINEAR_HOST}/abc/screenshot.png`));
    assert.equal(res.status, 200);
    assert.match(res.contentType, /^image\/png/);
    assert.deepEqual(res.bodyBuf, png, 'streams the upstream bytes verbatim');
    assert.equal(sawAuth, 'Bearer ws-linear-token', 'fetches with the workspace access token');
  });

  test('rejects an upstream non-image content-type on an image (no name hint) handle', async () => {
    stubUpstream(() => fakeResponse({ contentType: 'text/html', bytes: Buffer.from('<html>') }));
    const res = await getAttachment(buildApp(), md(`${LINEAR_HOST}/x.png`));
    assert.equal(res.status, 400);
    assert.match(res.bodyText, /unsupported content-type/i);
  });

  test('rejects an oversized attachment by content-length header', async () => {
    stubUpstream(() => fakeResponse({ contentType: 'image/png', contentLength: 11 * 1024 * 1024 }));
    const res = await getAttachment(buildApp(), md(`${LINEAR_HOST}/big.png`));
    assert.equal(res.status, 413);
  });

  test('passes an upstream failure status through', async () => {
    stubUpstream(() => fakeResponse({ ok: false, status: 404 }));
    const res = await getAttachment(buildApp(), md(`${LINEAR_HOST}/gone.png`));
    assert.equal(res.status, 404);
  });

  test('maps a thrown redirect error to 400', async () => {
    stubUpstream(() => { throw new Error('redirect not allowed'); });
    const res = await getAttachment(buildApp(), md(`${LINEAR_HOST}/redir.png`));
    assert.equal(res.status, 400);
    assert.match(res.bodyText, /redirect/i);
  });
});

// A non-image file handle: the md: value carries a `#name=<filename>` hint the
// discovery layer encodes so the relay can type extension-less upload bytes.
const mdFile = (url, name) => md(`${url}#name=${encodeURIComponent(name)}`);

describe('GET /api/proxy/attachments/:id — non-image file relay (LIN-750)', () => {
  test('serves a text/markdown file typed from the name hint, even when upstream is octet-stream', async () => {
    const body = Buffer.from('# Theme design\n\nbody');
    let fetchedUrl = null;
    stubUpstream((url) => {
      fetchedUrl = url;
      return fakeResponse({ contentType: 'application/octet-stream', bytes: body });
    });
    const res = await getAttachment(
      buildApp(),
      mdFile(`${LINEAR_HOST}/a/b/c`, 'theme-design.md')
    );
    assert.equal(res.status, 200);
    assert.match(res.contentType, /^text\/markdown/, 'typed from filename hint, not upstream octet-stream');
    assert.deepEqual(res.bodyBuf, body, 'streams the bytes verbatim');
    assert.equal(fetchedUrl, `${LINEAR_HOST}/a/b/c`, 'the #name= fragment is stripped before egress');
  });

  test('sets Content-Disposition: attachment + nosniff on a file relay', async () => {
    const res = await fetchRaw(buildApp(), mdFile(`${LINEAR_HOST}/x/y`, 'AgentRuns.jsx'),
      () => fakeResponse({ contentType: 'application/octet-stream', bytes: Buffer.from('export default 1') }));
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'] || '', /^text\/plain/, 'source served as text/plain');
    assert.match(res.headers['content-disposition'] || '', /attachment; filename="AgentRuns\.jsx"/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  });

  test('rejects a file whose extension is not on the allowlist, cleanly (no 500)', async () => {
    stubUpstream(() => fakeResponse({ contentType: 'application/octet-stream', bytes: Buffer.from('PK') }));
    const res = await getAttachment(buildApp(), mdFile(`${LINEAR_HOST}/a/b`, 'archive.zip'));
    assert.equal(res.status, 400);
    assert.match(res.bodyText, /unsupported content-type/i);
  });

  test('enforces the 10 MB cap on file relays too', async () => {
    stubUpstream(() => fakeResponse({ contentType: 'application/octet-stream', contentLength: 11 * 1024 * 1024 }));
    const res = await getAttachment(buildApp(), mdFile(`${LINEAR_HOST}/a/b`, 'huge.md'));
    assert.equal(res.status, 413);
  });

  test('SSRF guard still applies to file handles (non-Linear host rejected)', async () => {
    const res = await getAttachment(buildApp(), mdFile('https://evil.example.com/x', 'spec.md'));
    assert.equal(res.status, 400);
    assert.match(res.bodyText, /from Linear/i);
  });
});

describe('GET /api/proxy/attachments/:id — SSRF guard (md: path)', () => {
  test('rejects a non-HTTPS URL', async () => {
    const res = await getAttachment(buildApp(), md('http://uploads.linear.app/x.png'));
    assert.equal(res.status, 400);
    assert.match(res.bodyText, /HTTPS/i);
  });

  test('rejects a non-Linear host', async () => {
    const res = await getAttachment(buildApp(), md('https://evil.example.com/x.png'));
    assert.equal(res.status, 400);
    assert.match(res.bodyText, /from Linear/i);
  });

  test('rejects a look-alike host (no suffix bypass)', async () => {
    const res = await getAttachment(buildApp(), md('https://uploads.linear.app.evil.com/x.png'));
    assert.equal(res.status, 400);
    assert.match(res.bodyText, /from Linear/i);
  });

  test('rejects a pathname containing path-traversal', async () => {
    const res = await getAttachment(buildApp(), md('https://uploads.linear.app/a/..b.png'));
    assert.equal(res.status, 400);
    assert.match(res.bodyText, /traversal/i);
  });
});

describe('GET /api/proxy/attachments/:id — handle routing', () => {
  test('defers att: handles with a 422 + machine code', async () => {
    const res = await getAttachment(buildApp(), encodeAttachmentHandle('att', 'attachment-uuid'));
    assert.equal(res.status, 422);
    const body = JSON.parse(res.bodyText);
    assert.equal(body.code, 'ATTACHMENT_FETCH_NOT_SUPPORTED');
    assert.equal(body.handleType, 'att');
  });

  test('rejects an unrecognised handle shape with 400', async () => {
    const res = await getAttachment(buildApp(), 'not-a-handle');
    assert.equal(res.status, 400);
    assert.match(res.bodyText, /Invalid attachment handle/i);
  });

  test('returns the structured 503 envelope when the workspace token is unavailable', async () => {
    const res = await getAttachment(buildApp({ token: null, reason: 'reauth' }), md(`${LINEAR_HOST}/x.png`));
    assert.equal(res.status, 503);
  });
});

// LIN-771 — auth is resolved BY PROVIDER/HOST. GitHub user-content is a public
// CDN, so the relay must NOT send the workspace token to it (cross-provider token
// leak), while Linear asset hosts keep their authenticated fetch (covered above).
const GH_HOST = 'https://user-images.githubusercontent.com';
function stubUpstreamHost(hostPrefix, handler) {
  globalThis.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.startsWith(hostPrefix)) return handler(url, opts);
    return realFetch(url, opts);
  };
}

describe('GET /api/proxy/attachments/:id — provider/host-aware auth (LIN-771)', () => {
  test('relays a GitHub user-content image WITHOUT an Authorization header', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    let sawAuthHeader = 'UNSET';
    stubUpstreamHost(GH_HOST, (url, opts) => {
      sawAuthHeader = 'Authorization' in (opts.headers || {});
      return fakeResponse({ contentType: 'image/png', bytes: png });
    });
    const res = await getAttachment(buildApp(), md(`${GH_HOST}/1/abc.png`));
    assert.equal(res.status, 200);
    assert.deepEqual(res.bodyBuf, png);
    assert.equal(sawAuthHeader, false, 'workspace token must not be sent to GitHub');
  });

  test('serves a public GitHub asset even when the workspace has no token (no 503)', async () => {
    stubUpstreamHost(GH_HOST, () => fakeResponse({ contentType: 'image/png' }));
    const res = await getAttachment(buildApp({ token: null, reason: 'reauth' }), md(`${GH_HOST}/1/abc.png`));
    assert.equal(res.status, 200, 'public CDN needs no workspace token');
  });

  test('SSRF guard still rejects a GitHub look-alike host', async () => {
    const res = await getAttachment(buildApp(), md('https://user-images.githubusercontent.com.evil.com/x.png'));
    assert.equal(res.status, 400);
  });
});
