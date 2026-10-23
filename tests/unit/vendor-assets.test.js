/**
 * LIN-3787: DOMPurify, marked and Chart.js are npm dependencies served from
 * node_modules at their historical URLs, not files committed under public/.
 *
 * Run with: node --test tests/unit/vendor-assets.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VENDOR_ASSETS, vendorAssetPath, createVendorAssetsRouter } from '../../lib/vendor-assets.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const PACKAGE_OF = { '/purify.min.js': 'dompurify', '/marked.min.js': 'marked', '/chart.umd.min.js': 'chart.js' };
const installed = (name) => JSON.parse(readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;
const semverGte = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return true;
};

describe('vendor asset table', () => {
  test('serves exactly the three historical URLs', () => {
    assert.deepEqual(Object.keys(VENDOR_ASSETS).sort(), ['/chart.umd.min.js', '/marked.min.js', '/purify.min.js']);
  });

  test('each file exists and its banner names the installed package version', () => {
    for (const url of Object.keys(VENDOR_ASSETS)) {
      const head = readFileSync(vendorAssetPath(url), 'utf8').slice(0, 400);
      assert.ok(head.includes(installed(PACKAGE_OF[url])), `${url} banner should mention ${installed(PACKAGE_OF[url])}`);
    }
  });

  test('dompurify and chart.js are exact-pinned runtime dependencies', () => {
    assert.match(pkg.dependencies.dompurify, /^\d+\.\d+\.\d+$/);
    assert.match(pkg.dependencies['chart.js'], /^\d+\.\d+\.\d+$/);
    assert.ok(pkg.dependencies.marked);
  });

  test('DOMPurify is at or above the advisory-fixed floor 3.4.17', () => {
    const sandbox = { console }; sandbox.window = sandbox; sandbox.document = undefined;
    vm.createContext(sandbox);
    vm.runInContext(readFileSync(vendorAssetPath('/purify.min.js'), 'utf8'), sandbox);
    const v = installed('dompurify');
    assert.ok(semverGte(v, '3.4.17'), `installed DOMPurify ${v} < 3.4.17`);
    assert.ok(semverGte(pkg.dependencies.dompurify, '3.4.17'));
  });

  test('server.js mounts the router immediately before express.static, so defaultCacheControl skips it', () => {
    const src = readFileSync(join(ROOT, 'server.js'), 'utf8');
    const mount = src.indexOf('app.use(createVendorAssetsRouter())');
    assert.ok(mount > 0);
    assert.ok(src.slice(mount).startsWith("app.use(createVendorAssetsRouter())\napp.use(express.static('public'))"));
    assert.ok(mount < src.indexOf('app.use(defaultCacheControl())'));
  });

  test('an unknown URL is rejected by the path helper', () => {
    assert.throws(() => vendorAssetPath('/nope.js'), /Unknown vendor asset/);
  });
});

describe('vendor router', () => {
  let server, port;
  before(async () => {
    const app = express();
    app.use(createVendorAssetsRouter());
    server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    port = server.address().port;
  });
  after(() => new Promise((r) => server.close(r)));

  for (const url of Object.keys(VENDOR_ASSETS)) {
    test(`${url}: 200, JS content-type, exact bytes, static-style Cache-Control`, async () => {
      const res = await fetch(`http://127.0.0.1:${port}${url}`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /javascript/);
      assert.equal(res.headers.get('cache-control'), 'public, max-age=0');
      assert.ok(res.headers.get('etag'));
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), readFileSync(vendorAssetPath(url)));
    });
  }
});

describe('public/ stays free of vendored third-party libraries', () => {
  test('no file in public/ carries a third-party library banner or the vendor basenames', () => {
    const offenders = [];
    for (const f of readdirSync(join(ROOT, 'public'), { recursive: true })) {
      if (!/\.js$/.test(f)) continue;
      if (Object.keys(VENDOR_ASSETS).some((u) => u.endsWith('/' + f.split('/').pop()))) offenders.push(f);
      const head = readFileSync(join(ROOT, 'public', f), 'utf8').slice(0, 400);
      if (/@license DOMPurify|marked v\d|Chart\.js v\d/.test(head)) offenders.push(f);
    }
    assert.deepEqual(offenders, [], 'declare it in package.json and add it to lib/vendor-assets.js instead');
  });
});
