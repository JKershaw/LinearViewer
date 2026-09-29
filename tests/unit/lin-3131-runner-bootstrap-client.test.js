/**
 * LIN-3131 S2b.3 — `ProxyToggle.getRunnerBootstrap` and its error-copy map.
 *
 * `public/common.js` is loaded in a vm sandbox (the established seam —
 * tests/unit/lin-2370-browser-copy-prompt-provider-identity.test.js) so the
 * SHIPPED helper runs, not a reimplementation. `window.api` is then stubbed to
 * produce each server refusal shape; the helper must map every code to the
 * plan's copy and must NEVER swallow a failure to null.
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

/** Load public/common.js in a minimal DOM sandbox, then override window.api. */
function loadProxyToggle(apiImpl) {
  const sandbox = {
    window: { location: { origin: 'https://harbour.test' } },
    document: { addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    console,
    fetch() { throw new Error('fetch should not be called'); }
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_SRC, sandbox, { filename: 'common.js' });
  if (apiImpl) sandbox.window.api = apiImpl;
  return sandbox.window.ProxyToggle;
}

/** A window.api rejection carrying the server's error envelope. */
function refusal(status, code) {
  return async () => {
    const err = new Error('refused');
    err.status = status;
    err.body = code ? { code } : {};
    throw err;
  };
}

describe('LIN-3131 S2b.3 — getRunnerBootstrap maps every refusal code to copy', () => {
  test('success returns { token, expiresAt, grants } from the runner:true mint', async () => {
    let seen;
    const toggle = loadProxyToggle(async (url, opts) => {
      seen = { url, opts };
      return { token: 'BOOT', expiresAt: '2026-01-01T01:00:00.000Z', grants: ['take', 'dispatch'] };
    });

    const res = await toggle.getRunnerBootstrap('acme');

    assert.equal(res.token, 'BOOT');
    assert.equal(res.expiresAt, '2026-01-01T01:00:00.000Z');
    assert.deepEqual([...res.grants], ['take', 'dispatch']);
    assert.equal(seen.url, '/workspace/acme/api/proxy/tokens');
    assert.deepEqual(JSON.parse(seen.opts.body), { runner: true }, 'the client sends only the intent');
    assert.equal(seen.opts.on401, false, 'never redirects out from under the caller');
  });

  // The four codes the plan P3(d) names, with its exact copy.
  const EXACT = {
    GRANT_OWNER_ONLY: "Only this workspace's owner can copy a runner prompt. Ask the owner, or sign in as the owner.",
    WORKSPACE_OWNER_UNSET: "This workspace has no recorded owner yet, so a runner prompt can't be created. Workspaces made before ownership tracking need an operator to assign an owner; a workspace created now gets its owner automatically.",
    GRANT_OWNERLESS: "This session isn't linked to an account. Sign in again, then copy.",
    OWNER_CHECK_UNAVAILABLE: "Couldn't verify ownership right now. Try again in a minute."
  };

  test('the plan\'s four copy strings are exactly what the map carries', () => {
    const toggle = loadProxyToggle();
    for (const [code, copy] of Object.entries(EXACT)) {
      assert.equal(toggle.RUNNER_BOOTSTRAP_ERROR_COPY[code], copy, `${code} copy must match the plan`);
    }
  });

  for (const [code, status] of [
    ['GRANT_OWNERLESS', 503],
    ['WORKSPACE_OWNER_UNSET', 409],
    ['GRANT_OWNER_ONLY', 403],
    ['OWNER_CHECK_UNAVAILABLE', 503],
    ['GRANTS_NOT_CLIENT_SETTABLE', 400]
  ]) {
    test(`${code} → { error: { code, message } }, never null`, async () => {
      const toggle = loadProxyToggle(refusal(status, code));
      const res = await toggle.getRunnerBootstrap('acme');
      assert.equal(res.error.code, code);
      assert.equal(res.error.message, toggle.RUNNER_BOOTSTRAP_ERROR_COPY[code]);
      assert.ok(res.error.message && res.error.message.length > 0, 'never swallows the failure');
    });
  }

  test('a network failure (no status) → NETWORK copy', async () => {
    const toggle = loadProxyToggle(async () => { throw new TypeError('Failed to fetch'); });
    const res = await toggle.getRunnerBootstrap('acme');
    assert.equal(res.error.code, 'NETWORK');
    assert.equal(res.error.message, toggle.RUNNER_BOOTSTRAP_ERROR_COPY.NETWORK);
  });

  test('an unmapped 5xx → the retryable UNAVAILABLE copy', async () => {
    const toggle = loadProxyToggle(refusal(500));
    const res = await toggle.getRunnerBootstrap('acme');
    assert.equal(res.error.code, 'OWNER_CHECK_UNAVAILABLE');
    assert.equal(res.error.message, toggle.RUNNER_BOOTSTRAP_ERROR_COPY.OWNER_CHECK_UNAVAILABLE);
  });

  test('an unmapped 4xx → NETWORK copy', async () => {
    const toggle = loadProxyToggle(refusal(429));
    const res = await toggle.getRunnerBootstrap('acme');
    assert.equal(res.error.code, 'NETWORK');
    assert.equal(res.error.message, toggle.RUNNER_BOOTSTRAP_ERROR_COPY.NETWORK);
  });

  test('a successful response with no token is an UNKNOWN error, not a silent null', async () => {
    const toggle = loadProxyToggle(async () => ({}));
    const res = await toggle.getRunnerBootstrap('acme');
    assert.equal(res.error.code, 'UNKNOWN');
    assert.equal(res.error.message, toggle.RUNNER_BOOTSTRAP_ERROR_COPY.UNKNOWN);
  });

  test('no urlKey → an OWNERLESS-shaped error, no request made', async () => {
    let called = false;
    const toggle = loadProxyToggle(async () => { called = true; return {}; });
    const res = await toggle.getRunnerBootstrap('');
    assert.equal(called, false, 'no mint is attempted without a workspace');
    assert.equal(res.error.code, 'GRANT_OWNERLESS');
    assert.equal(res.error.message, toggle.RUNNER_BOOTSTRAP_ERROR_COPY.GRANT_OWNERLESS);
  });
});
