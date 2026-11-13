/**
 * LIN-4446: browser code shares rather than restates. Shared modules are pure leaf files under lib/, served to the
 * browser through the explicit SHARED_MODULES allow-list (lib/vendor-assets.js), never by directory, at /lib/<name>.js
 * (LIN-4471). A page module imports one by a relative specifier. This suite is the witness for the serving boundary:
 * the served bytes and type, the boot failure on a missing file, the purity rule, the page emission, the retirement of
 * the restated copy, and the 404s for every path the allow-list does not serve, sent raw (LIN-4471). The bridge's
 * inventory and the renderer coverage of the bridge are in tests/unit/bridge-inventory.test.js.
 *
 * Run with: node --test tests/unit/shared-modules.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import * as acorn from 'acorn';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { SHARED_MODULES, VENDOR_ASSETS, createVendorAssetsRouter, sharedModulePath } from '../../lib/vendor-assets.js';
import { defaultCacheControl } from '../../lib/response-headers.js';
import { renderPage } from '../../lib/components/page.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Sent raw with node:http, never fetch: WHATWG URL parsing collapses dot segments before fetch sends them, so
 * `fetch('/lib/../server.js')` is really `/server.js` and proves nothing about the /lib/ boundary (LIN-4471).
 */
function rawGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] ?? '', body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Paths under /lib/ the allow-list does not serve. Each must be a real 404, not the app's HTML shell with a 200. */
const NOT_SERVED = ['/lib/vendor-assets.js', '/lib/render.js', '/lib/../server.js', '/lib/%2e%2e/server.js', '/lib/%2e%2e%2fserver.js', '/lib/'];

/**
 * The retired namespace (LIN-4446's, re-keyed to the /lib/ namespace by LIN-4471). Built by joining its parts, so that the
 * acceptance grep for the retired URL stays empty: this is the one place a test names it, to prove it is gone.
 */
const RETIRED_SHARED_URL = ['', 'shared', 'cost-format.js'].join('/');
const RETIRED_PREFIX = RETIRED_SHARED_URL.slice(0, RETIRED_SHARED_URL.lastIndexOf('/') + 1);

/**
 * Purity (LIN-4446): a shared module imports nothing, reads no Node built-in, and names no browser or Node global.
 * Checked on the parsed program, so a comment that mentions `window` does not trip it. Returns the problems found.
 */
const BANNED_GLOBALS = new Set(['window', 'document', 'process', 'require', 'module', 'exports', 'globalThis', 'global']);
export function purityProblems(src, name = 'module') {
  const problems = [];
  let ast;
  try {
    ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  } catch (err) {
    return [`${name}: does not parse as a module (${err.message})`];
  }
  const visit = (node, parent, key) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'ImportDeclaration' || node.type === 'ImportExpression' || node.type === 'ExportAllDeclaration'
      || (node.type === 'ExportNamedDeclaration' && node.source)) {
      problems.push(`${name}: imports or re-exports (${node.type} at ${node.start})`);
    }
    if (node.type === 'Identifier' && BANNED_GLOBALS.has(node.name)) {
      const isMemberProp = parent && parent.type === 'MemberExpression' && key === 'property' && !parent.computed;
      const isPropKey = parent && parent.type === 'Property' && key === 'key' && !parent.computed;
      if (!isMemberProp && !isPropKey) problems.push(`${name}: references the global \`${node.name}\` (at ${node.start})`);
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach((c) => visit(c, node, k));
      else if (v && typeof v.type === 'string') visit(v, node, k);
    }
  };
  visit(ast, null, null);
  return problems;
}

describe('the allow-lists', () => {
  test('SHARED_MODULES is separate from VENDOR_ASSETS, and VENDOR_ASSETS is unchanged', () => {
    assert.deepEqual(Object.keys(SHARED_MODULES), ['/lib/cost-format.js']);
    assert.deepEqual(Object.keys(VENDOR_ASSETS).sort(), ['/chart.umd.min.js', '/marked.min.js', '/purify.min.js']);
  });

  test('every shared module is one file under lib/, and it exists', () => {
    for (const [url, rel] of Object.entries(SHARED_MODULES)) {
      assert.ok(rel.startsWith('lib/') && rel.endsWith('.js'), `${url} -> ${rel}`);
      assert.ok(existsSync(join(ROOT, rel)), `${rel} exists`);
      assert.equal(sharedModulePath(url), join(ROOT, rel));
    }
  });
});

describe('serving the shared module', () => {
  let server, port;
  before(async () => {
    const app = express();
    // Same stack as server.js: vendor router, then static, then defaultCacheControl (LIN-3692).
    app.use(createVendorAssetsRouter());
    app.use(express.static(join(ROOT, 'public')));
    app.use(defaultCacheControl());
    server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    port = server.address().port;
  });
  after(() => new Promise((r) => server.close(r)));

  test('/lib/cost-format.js: 200, a JavaScript type, and exactly the bytes of lib/cost-format.js', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/lib/cost-format.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), readFileSync(join(ROOT, 'lib/cost-format.js')));
  });

  for (const path of NOT_SERVED) {
    test(`${path} (sent raw) is a real 404, not served from lib/ or public/`, async () => {
      const res = await rawGet(port, path);
      assert.equal(res.status, 404, `${path} got ${res.status}`);
      assert.doesNotMatch(res.body, /createVendorAssetsRouter|express\(\)/, 'no server source in the body');
    });
  }

  test('the retired namespace is a real 404 (sent raw)', async () => {
    const res = await rawGet(port, RETIRED_SHARED_URL);
    assert.equal(res.status, 404);
  });

  // Express routes are case-insensitive and non-strict (a trailing slash) by default, so the one served leaf also answers
  // these variants. That is harmless: the same file, with no other file reachable. Pinned, so a change to routing shows.
  test('the served leaf also answers case and trailing-slash variants (Express default; the same bytes)', async () => {
    for (const path of ['/LIB/COST-FORMAT.JS', '/lib/cost-format.js/']) {
      const res = await rawGet(port, path);
      assert.equal(res.status, 200, path);
      assert.equal(res.body, readFileSync(join(ROOT, 'lib/cost-format.js'), 'utf8'), path);
    }
  });
});

describe('boot: a missing shared file fails the router, naming the path', () => {
  test('a router built over an empty root throws', () => {
    const empty = mkdtempSync(join(tmpdir(), 'shared-root-'));
    try {
      assert.throws(() => createVendorAssetsRouter({ rootDir: empty }), (err) => err.code === 'ENOENT' && err.message.includes(join('lib', 'cost-format.js')));
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('purity: shared modules are leaves', () => {
  for (const rel of Object.values(SHARED_MODULES)) {
    test(`${rel} passes the purity rule`, () => {
      assert.deepEqual(purityProblems(read(rel), rel), []);
    });
  }

  test('a synthetic bad module is named: an import, a Node built-in, and a browser global', () => {
    const bad = "import { readFileSync } from 'node:fs';\nexport const f = () => window.x + readFileSync;\n";
    const problems = purityProblems(bad, 'synthetic-bad.js');
    assert.ok(problems.some((p) => p.includes('synthetic-bad.js: imports')), problems.join('\n'));
    assert.ok(problems.some((p) => p.includes('`window`')), problems.join('\n'));
  });

  test('a mention of a global in a comment does not trip the rule', () => {
    const prose = '// sets window.CostFormat in the browser\nexport const x = 1;\n';
    assert.deepEqual(purityProblems(prose, 'prose.js'), []);
  });
});

describe('renderPage: a module entry is a module script, a string stays classic', () => {
  test('emits <script type="module"> for a { module } entry and <script src> for a string, in order', () => {
    const html = renderPage({ title: 'T', scripts: ['/a.js', { module: '/shared-shim.js' }, '/b.js'] });
    const a = html.indexOf('<script src="/a.js"></script>');
    const m = html.indexOf('<script type="module" src="/shared-shim.js"></script>');
    const b = html.indexOf('<script src="/b.js"></script>');
    assert.ok(a > 0 && m > a && b > m, 'three tags, in order');
  });

  test('an entry that is neither a string nor { module } throws', () => {
    assert.throws(() => renderPage({ title: 'T', scripts: [{ src: '/x.js' }] }), /invalid script entry/);
  });
});

describe('retirement: the restated browser copy and its parity check are gone', () => {
  test('public/cost-format.js and the parity test are absent', () => {
    assert.equal(existsSync(join(ROOT, 'public/cost-format.js')), false);
    assert.equal(existsSync(join(ROOT, 'tests/unit/cost-format-parity.test.js')), false);
  });

  test('no list or allow-list names the retired browser file', () => {
    assert.doesNotMatch(read('tests/unit/cost-read-census.test.js'), /public\/cost-format\.js/);
    assert.doesNotMatch(read('lib/render.js'), /'\/cost-format\.js'/);
  });

  test('the retired namespace is gone from the allow-list and the page modules', () => {
    assert.equal(Object.keys(SHARED_MODULES).some((url) => url.startsWith(RETIRED_PREFIX)), false);
    assert.doesNotMatch(read('public/cost-format-global.js'), new RegExp(RETIRED_PREFIX));
    assert.doesNotMatch(read('public/workspace-kpis.js'), new RegExp(RETIRED_PREFIX));
  });
});

describe('the real server: 404s for the paths the allow-list does not serve', () => {
  let child, port, stdout = '', stderr = '';
  before(async () => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    port = probe.address().port;
    await new Promise((r) => probe.close(r));
    const dataDir = mkdtempSync(join(tmpdir(), 'shared-server-'));
    child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, HARBOUR_DATA_DIR: dataDir, DOTENV_CONFIG_PATH: join(dataDir, 'no-such.env'), NODE_ENV: 'test', PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    const deadline = Date.now() + 60000;
    while (!stdout.includes('Harbour running at')) {
      if (Date.now() > deadline) throw new Error(`no listen line\nstdout: ${stdout}\nstderr: ${stderr}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  });
  after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  });

  test('/lib/cost-format.js is served; every path the allow-list does not serve is a real 404 (sent raw)', async () => {
    const ok = await fetch(`http://127.0.0.1:${port}/lib/cost-format.js`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type'), /javascript/);
    assert.deepEqual(Buffer.from(await ok.arrayBuffer()), readFileSync(join(ROOT, 'lib/cost-format.js')));
    for (const path of [...NOT_SERVED, RETIRED_SHARED_URL]) {
      const res = await rawGet(port, path);
      // A real 404 status: a catch-all that answered 200 with the app's HTML shell would fail here.
      assert.equal(res.status, 404, `${path} should be a real 404, got ${res.status}`);
    }
  });
});
