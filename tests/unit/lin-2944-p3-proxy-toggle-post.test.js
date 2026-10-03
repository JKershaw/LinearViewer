/**
 * LIN-2944 P3 (review a6be902a R1 + R2) — the client toggle write and the 429
 * copy fallback, exercised against the SHIPPED `public/common.js` in a vm
 * sandbox.
 *
 *   C2: `setActive()` optimistically flips the body dataset AND POSTs the new
 *       value to the proxy-default route (the mutant that drops the POST is
 *       killed here).
 *   R1: with the toggle on, a 429 from the toggle-path `prompt-proxy` mint makes
 *       `maybeAppend` return the prompt WITHOUT the block (copy/download still
 *       completes) and `takeRateLimitNotice()` reports the skip. Any other mint
 *       failure still throws (surface, don't drop), and the forced path still
 *       throws on 429.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMON_SRC = readFileSync(join(__dirname, '../../public/common.js'), 'utf8');

/** Load common.js in a fresh sandbox; `window.api` is left for the test to set. */
function load({ pathname = '/workspace/acme/swipe', proxyActive = 'false' } = {}) {
  const sandbox = {
    window: { location: { origin: 'https://harbour.test', pathname } },
    document: { addEventListener() {}, dispatchEvent() {}, body: { dataset: { proxyFeature: 'true', proxyActive } } },
    console,
    CustomEvent: function CustomEvent() {},
    fetch() { throw new Error('fetch should not be called'); },
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_SRC, sandbox, { filename: 'common.js' });
  return sandbox;
}

/** A capturing `window.api` that resolves `{}`; returns the captured calls. */
function captureApi(sandbox) {
  const calls = [];
  sandbox.window.api = async (url, opts) => {
    calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers });
    return {};
  };
  return calls;
}

/** A `window.api` that always throws an error carrying the HTTP status. */
function apiThrowing(sandbox, status) {
  sandbox.window.api = async () => {
    const err = new Error(`mint failed ${status}`);
    err.status = status;
    throw err;
  };
}

describe('LIN-2944 P3 — setActive POSTs the preference (C2)', () => {
  test('turning the toggle on flips the dataset and POSTs { proxyDefault: true }', () => {
    const sandbox = load({ proxyActive: 'false' });
    const calls = captureApi(sandbox);
    sandbox.window.ProxyToggle.setActive(true);
    assert.equal(sandbox.window.ProxyToggle.isActive(), true, 'the dataset flips optimistically');
    assert.equal(calls.length, 1, 'C2: a POST is sent');
    assert.equal(calls[0].url, '/workspace/acme/settings/proxy-default');
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(calls[0].body, { proxyDefault: true });
    assert.equal(calls[0].headers['X-Requested-With'], 'XMLHttpRequest');
  });

  test('turning the toggle off POSTs { proxyDefault: false }', () => {
    const sandbox = load({ proxyActive: 'true' });
    const calls = captureApi(sandbox);
    sandbox.window.ProxyToggle.setActive(false);
    assert.equal(sandbox.window.ProxyToggle.isActive(), false);
    assert.deepEqual(calls[0].body, { proxyDefault: false });
  });

  test('a non-workspace path has no route to POST to', () => {
    const sandbox = load({ pathname: '/swipe', proxyActive: 'true' });
    const calls = captureApi(sandbox);
    sandbox.window.ProxyToggle.setActive(false);
    assert.equal(calls.length, 0, 'landing/non-workspace surfaces do not POST');
  });
});

describe('LIN-2944 P3 — the 429 toggle-path append SKIPS, other failures throw (R1)', () => {
  test('a 429 returns the prompt unchanged and records the skip', async () => {
    const sandbox = load({ proxyActive: 'true' });
    apiThrowing(sandbox, 429);
    const out = await sandbox.window.ProxyToggle.maybeAppend('PROMPT', 'acme');
    assert.equal(out, 'PROMPT', 'no block appended, no throw');
    assert.equal(sandbox.window.ProxyToggle.takeRateLimitNotice(), true, 'the skip is reported once');
    assert.equal(sandbox.window.ProxyToggle.takeRateLimitNotice(), false, 'and consumed');
  });

  test("a non-429 failure still throws (surface, don't drop)", async () => {
    const sandbox = load({ proxyActive: 'true' });
    apiThrowing(sandbox, 500);
    await assert.rejects(sandbox.window.ProxyToggle.maybeAppend('PROMPT', 'acme'), /proxy token could not be created/);
    assert.equal(sandbox.window.ProxyToggle.takeRateLimitNotice(), false, 'no skip recorded on a hard failure');
  });

  test('a forced append still throws on 429 (the autopilot path must not drop)', async () => {
    const sandbox = load({ proxyActive: 'false' });
    apiThrowing(sandbox, 429);
    await assert.rejects(sandbox.window.ProxyToggle.maybeAppend('PROMPT', 'acme', { force: true }), /Too many prompt copies/);
  });
});
