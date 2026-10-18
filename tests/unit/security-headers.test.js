/**
 * LIN-3420 — the app-wide CSP / frame-ancestors middleware.
 *
 * Real `securityHeaders()` in front of the real renderers and routers: every
 * HTML response carries the policy, while JSON, static-style and the own-CSP
 * route (Library) are left alone. The email confirm pages set `APP_CSP` themselves
 * (LIN-3627); that is asserted in email-auth-csrf.test.js.
 *
 * Run with: node --test tests/unit/security-headers.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { securityHeaders, APP_CSP, INLINE_SCRIPT_HASHES } from '../../lib/security-headers.js';
import { renderPage, scriptBodyHash } from '../../lib/components/page.js';
import { renderErrorPage } from '../../lib/render-pages.js';
import { createLibraryRouter, LIBRARY_CSP } from '../../routes/library.js';
import { createTaskShareRoutes } from '../../routes/task-share.js';

const docsRoot = fileURLToPath(new URL('../fixtures/library-docs', import.meta.url));
const TOKEN = 'A'.repeat(43);

function scriptSrc(csp) {
  return csp.split(';').map(d => d.trim()).find(d => d.startsWith('script-src'));
}

async function build() {
  const app = express();
  app.use(securityHeaders());
  app.get('/dashboard', (req, res) => res.send(renderPage({
    title: 'Dash', content: '<main>hi</main>', embeddedData: { globalVar: '__X__', value: { a: 1 } },
  })));
  app.get('/error', (req, res) => res.status(500).send(renderErrorPage('Oops', 'Broken')));
  // Mirrors server.js: verbatim docs/archive/*.html via sendFile (text/html).
  app.get('/archive/:n(\\d+)', (req, res) => {
    res.sendFile(`${req.params.n}.html`, { root: fileURLToPath(new URL('../../docs/archive', import.meta.url)) });
  });
  app.get('/api/thing', (req, res) => res.json({ ok: true }));
  app.get('/plain', (req, res) => res.type('text/plain').send('hello'));
  app.use(createLibraryRouter({ docsRoot }));
  const shareStore = {
    async getByToken() { return null; },
    async listForTask() { return []; },
  };
  app.use(createTaskShareRoutes({
    taskShareStore: shareStore,
    loader: { async loadTaskPage() { return { model: null }; }, async loadTaskState() { return { model: null }; } },
    workspaceFromUrl: (req, res, next) => next(),
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
    guestAccess: async () => ({ provider: {}, callScope: 'tok' }),
    getDeployInfo: () => ({}),
    now: () => new Date('2026-10-08T12:00:00.000Z'),
  }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise(r => server.close(r)) };
}

function assertAppPolicy(res) {
  const csp = res.headers.get('content-security-policy');
  assert.equal(csp, APP_CSP);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const src = scriptSrc(csp);
  assert.ok(!src.includes('unsafe-inline'), 'script-src has no unsafe-inline');
  assert.ok(!/nonce-/.test(csp), 'no nonce');
  for (const hash of INLINE_SCRIPT_HASHES) assert.ok(src.includes(`'${hash}'`), `script-src pins ${hash}`);
}

describe('securityHeaders()', () => {
  test('HTML app pages and the error page carry the enforced policy', async () => {
    const { base, close } = await build();
    try {
      for (const path of ['/dashboard', '/error']) {
        assertAppPolicy(await fetch(`${base}${path}`));
      }
    } finally { await close(); }
  });

  test('/t/ responses (404 for a malformed and an unknown token, 503 when unavailable) carry it', async () => {
    const { base, close } = await build();
    try {
      for (const path of ['/t/not-a-token', `/t/${TOKEN}`]) {
        const res = await fetch(`${base}${path}`);
        assert.equal(res.status, 404);
        assertAppPolicy(res);
        // The route's own headers survive alongside the policy.
        assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
      }
    } finally { await close(); }
  });

  test('a /t/ 200 and 503 carry it too', async () => {
    const app = express();
    app.use(securityHeaders());
    const model = { identifier: 'LIN-1', title: 't', issueId: 'i', tracker: null, status: 'running', sentence: 's', live: true, sessions: [], guesses: [], brief: null, recap: null, evidence: null, details: null };
    const record = { _id: 's', tokenHash: 'h', urlKey: 'acme', workspaceId: 'w', ownerAccountId: 'a', issueIdentifier: 'LIN-1', issueId: 'i', source: 'linear', createdAt: new Date(), revokedAt: null };
    let available = true;
    app.use(createTaskShareRoutes({
      taskShareStore: { async getByToken() { return record; }, async listForTask() { return []; } },
      loader: { async loadTaskPage() { return { model }; }, async loadTaskState() { return { model }; } },
      workspaceFromUrl: (req, res, next) => next(),
      workspaceOwnerCheck: async () => ({ status: 'owner' }),
      guestAccess: async () => { if (!available) throw new Error('down'); return { provider: {}, callScope: 'tok' }; },
      getDeployInfo: () => ({}),
      now: () => new Date('2026-10-08T12:00:00.000Z'),
    }));
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const ok = await fetch(`${base}/t/${TOKEN}`);
      assert.equal(ok.status, 200);
      assertAppPolicy(ok);
      available = false;
      const down = await fetch(`${base}/t/${TOKEN}`);
      assert.equal(down.status, 503);
      assertAppPolicy(down);
    } finally { await new Promise(r => server.close(r)); }
  });

  test('/archive/:n (sendFile of verbatim HTML) carries the policy, with its inline scripts pinned', async () => {
    const { base, close } = await build();
    try {
      for (const n of [1, 2, 4, 6]) {
        const res = await fetch(`${base}/archive/${n}`);
        assert.equal(res.status, 200);
        assertAppPolicy(res);
        const html = await res.text();
        const src = scriptSrc(res.headers.get('content-security-policy'));
        const bodies = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
        assert.ok(bodies.length > 0, `archive ${n} has an inline script`);
        for (const body of bodies) assert.ok(src.includes(`'${scriptBodyHash(body)}'`), `archive ${n} script pinned`);
      }
    } finally { await close(); }
  });

  test('JSON and plain-text responses are untouched', async () => {
    const { base, close } = await build();
    try {
      for (const path of ['/api/thing', '/plain']) {
        const res = await fetch(`${base}${path}`);
        assert.equal(res.headers.get('content-security-policy'), null);
        assert.equal(res.headers.get('x-frame-options'), null);
      }
    } finally { await close(); }
  });

  test('a route with its own CSP keeps it byte-for-byte (Library)', async () => {
    const { base, close } = await build();
    try {
      const lib = await fetch(`${base}/library/hostile`);
      assert.equal(lib.headers.get('content-security-policy'), LIBRARY_CSP);
      assert.equal(lib.headers.get('x-frame-options'), null, 'Library keeps frame-ancestors self; no DENY added');
    } finally { await close(); }
  });

  test('the policy keeps the decided-as-is choices (LIN-3627): img-src https:, no form-action', () => {
    assert.match(APP_CSP, /img-src 'self' data: https:/);
    assert.ok(!APP_CSP.includes('form-action'));
  });

  test('server.js mounts it once, after express.static and before urlencoded/session', () => {
    const src = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    assert.equal(src.split('securityHeaders()').length - 1, 1);
    const at = src.indexOf('app.use(securityHeaders())');
    assert.ok(src.indexOf("app.use(express.static('public'))") < at);
    assert.ok(at < src.indexOf('app.use(express.urlencoded'));
    assert.ok(at < src.indexOf('session('), 'mounted before the session middleware');
  });
});
