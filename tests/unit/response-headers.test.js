/**
 * LIN-3692 (for LIN-3643): HSTS and a no-store default for every response
 * that sets no Cache-Control of its own.
 *
 * Run with: node --test tests/unit/response-headers.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { hstsHeader, defaultCacheControl } from '../../lib/response-headers.js';
import { createLibraryRouter } from '../../routes/library.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function serve(setup) {
  const app = express();
  setup(app);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

const get = (port, path, headers = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
    res.resume(); res.on('end', () => resolve(res));
  });
  req.on('error', reject); req.end();
});

describe('hstsHeader', () => {
  const run = async (env, headers) => {
    const s = await serve((app) => { app.use(hstsHeader({ env })); app.get('/', (req, res) => res.send('ok')); });
    try { return (await get(s.port, '/', headers)).headers['strict-transport-security']; } finally { await s.close(); }
  };

  test('production + x-forwarded-proto https: exactly max-age=31536000', async () => {
    assert.strictEqual(await run({ NODE_ENV: 'production' }, { 'x-forwarded-proto': 'https' }), 'max-age=31536000');
  });
  test('production without https, and every other environment: none', async () => {
    assert.strictEqual(await run({ NODE_ENV: 'production' }, {}), undefined);
    assert.strictEqual(await run({ NODE_ENV: 'production' }, { 'x-forwarded-proto': 'http' }), undefined);
    for (const NODE_ENV of ['development', 'test', undefined]) {
      assert.strictEqual(await run({ NODE_ENV }, { 'x-forwarded-proto': 'https' }), undefined, String(NODE_ENV));
    }
  });
  test('reads NODE_ENV per request', async () => {
    const env = { NODE_ENV: 'development' };
    const s = await serve((app) => { app.use(hstsHeader({ env })); app.get('/', (q, r) => r.send('ok')); });
    try {
      assert.strictEqual((await get(s.port, '/', { 'x-forwarded-proto': 'https' })).headers['strict-transport-security'], undefined);
      env.NODE_ENV = 'production';
      assert.strictEqual((await get(s.port, '/', { 'x-forwarded-proto': 'https' })).headers['strict-transport-security'], 'max-age=31536000');
    } finally { await s.close(); }
  });
});

describe('defaultCacheControl', () => {
  let s; let dir;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'lin3692-'));
    writeFileSync(join(dir, 'a.txt'), 'static');
    s = await serve((app) => {
      app.use(express.static(dir));
      app.use(defaultCacheControl());
      app.get('/html', (q, r) => r.send('<p>x</p>'));
      app.get('/json', (q, r) => r.json({ a: 1 }));
      app.get('/redir', (q, r) => r.redirect('/html'));
      app.get('/set', (q, r) => { r.set('Cache-Control', 'public, max-age=3600'); r.send('x'); });
      app.get('/late', (q, r) => { r.setHeader('Cache-Control', 'no-cache'); r.flushHeaders(); r.end('x'); });
      app.get('/flush', (q, r) => { r.flushHeaders(); r.end('x'); });
      app.get('/latebeforewrite', (q, r) => { r.write('a'); r.end('b'); });
      app.get('/writehead', (q, r) => { r.writeHead(200, { 'Cache-Control': 'no-cache' }); r.end('x'); });
      app.get('/file', (q, r) => r.sendFile(join(dir, 'a.txt')));
      app.use('/lib', createLibraryRouter());
    });
  });
  after(async () => { await s.close(); });
  const cc = async (path) => (await get(s.port, path)).headers['cache-control'];

  test('a route that sets nothing gets private, no-store (HTML, JSON, redirect, 404)', async () => {
    for (const p of ['/html', '/json', '/redir', '/nope']) assert.strictEqual(await cc(p), 'private, no-store', p);
  });
  test('flushHeaders() before any end() still gets the default', async () => {
    assert.strictEqual(await cc('/flush'), 'private, no-store');
    assert.strictEqual(await cc('/latebeforewrite'), 'private, no-store');
  });
  test('a route-set Cache-Control survives, however it is set', async () => {
    assert.strictEqual(await cc('/set'), 'public, max-age=3600');
    assert.strictEqual(await cc('/late'), 'no-cache');
    assert.strictEqual(await cc('/writehead'), 'no-cache');
  });
  test('static files and sendFile keep express defaults', async () => {
    assert.strictEqual(await cc('/a.txt'), 'public, max-age=0');
    assert.strictEqual(await cc('/file'), 'public, max-age=0');
  });
  test('the real library router: sitemap and figures keep their own; pages get the default', async () => {
    assert.strictEqual(await cc('/lib/sitemap.xml'), 'public, max-age=3600');
    assert.strictEqual(await cc('/lib/library'), 'private, no-store');
    assert.strictEqual(await cc('/lib/robots.txt'), 'private, no-store');
  });
});

// Source scans, the pattern of security-headers.test.js. Bounds the class so a
// new Host-derived URL builder fails here instead of shipping (LIN-3692).
function listJsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (relative(ROOT, full).split(sep).join('/') === 'lib/runner-kit') continue;
      listJsFiles(full, out);
    } else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('source scans (LIN-3692)', () => {
  const server = readFileSync(join(ROOT, 'server.js'), 'utf8');
  const files = [join(ROOT, 'server.js'), ...listJsFiles(join(ROOT, 'lib')), ...listJsFiles(join(ROOT, 'routes'))];
  const rel = (f) => relative(ROOT, f).split(sep).join('/');
  const HOST_READ = /req\.protocol|req\.hostname|get\(['"]host['"]\)|headers\.host|headers\[['"]host/g;
  // The 7 localhost-only reads (no URL is built from them).
  const LOCAL_ONLY = { 'lib/dispatch-entrance.js': 1, 'routes/next-run.js': 1, 'routes/workspace-api.js': 1, 'server.js': 5 };

  test('only publicOrigin, the redirect and the localhost-only reads touch Host or protocol', () => {
    const found = {};
    for (const f of files) {
      const n = (readFileSync(f, 'utf8').match(HOST_READ) || []).length;
      if (n) found[rel(f)] = n;
    }
    assert.ok(found['lib/public-origin.js'] >= 2, 'the helper reads protocol and host');
    delete found['lib/public-origin.js'];
    // server.js: the redirect's req.hostname + 4 localhost reads; the rest of LOCAL_ONLY as listed.
    for (const [file, n] of Object.entries(found)) assert.strictEqual(n, LOCAL_ONLY[file], `${file}: ${n} host/protocol reads outside publicOrigin`);
    assert.deepStrictEqual(Object.keys(found).sort(), Object.keys(LOCAL_ONLY).sort());
    assert.ok(!/req\.protocol/.test(server), 'server.js builds no URL from req.protocol');
  });

  test('server.js mounts /health < redirect < HSTS < static < cache default < securityHeaders, each once', () => {
    const marks = ["app.get('/health'", "req.headers['x-forwarded-proto'] !== 'https'", 'app.use(hstsHeader())', "app.use(express.static('public'))", 'app.use(defaultCacheControl())', 'app.use(securityHeaders())'];
    let last = -1;
    for (const m of marks) {
      assert.strictEqual(server.split(m).length - 1, 1, `${m} appears once`);
      const at = server.indexOf(m);
      assert.ok(at > last, `${m} is in order`);
      last = at;
    }
  });
});
