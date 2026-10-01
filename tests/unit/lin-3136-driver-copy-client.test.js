/**
 * LIN-3136 S6 (acceptance 15, unit half) — the client switch for M5 driver copies.
 *
 * `public/common.js` runs in a vm sandbox (the seam of
 * tests/unit/lin-3131-runner-bootstrap-client.test.js), so the SHIPPED
 * `ProxyToggle` is exercised, with `window.api` stubbed:
 *  - the toggle path's mint body stays byte for byte
 *    `{label:'prompt-proxy', scope:'readWrite', bootstrap:true}` and its failure
 *    still resolves `{token:null}`;
 *  - a FORCED append sends exactly `{purpose:'driver'}`, mints per call (no
 *    cache), and states the dispatch grant in the block;
 *  - every refusal maps to `DRIVER_COPY_ERROR_COPY` and a forced append throws
 *    that text instead of appending anything (no grant-less fallback);
 *  - `buildBlock`'s grant-less (toggle-path) block says it cannot enqueue.
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

const TOGGLE_BODY = { label: 'prompt-proxy', scope: 'readWrite', bootstrap: true };
const GRANT_LINE = 'It also holds the dispatch grant, so it can enqueue work (`POST /dispatch`, `/recommend-and-dispatch`, `/autopilot/kickoff`) that runs on the operator\'s machine.';
const SCOPE_LINE = 'Your token scope is: readWrite.';
const CANNOT_LINE = 'It cannot enqueue work: the dispatch routes return 403 `DISPATCH_GRANT_REQUIRED`.';

/** Load public/common.js in a minimal DOM sandbox; the toggle on/off is `toggleOn`. */
function load(apiImpl, { toggleOn = false } = {}) {
  const calls = [];
  const sandbox = {
    window: { location: { origin: 'https://harbour.test' } },
    document: { addEventListener() {}, body: { dataset: { proxyFeature: 'true' } } },
    localStorage: { getItem: (k) => (k === 'proxy-toggle-active' && toggleOn ? 'true' : null), setItem() {} },
    console,
    fetch() { throw new Error('fetch should not be called'); }
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_SRC, sandbox, { filename: 'common.js' });
  sandbox.window.api = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), on401: opts.on401 });
    return apiImpl(url, opts);
  };
  return { toggle: sandbox.window.ProxyToggle, calls };
}

const ok = (extra = {}) => async () => ({ token: 'BOOT', providerDisplayName: 'Linear', ...extra });

function refusal(status, code) {
  return async () => {
    const err = new Error('refused');
    if (status !== undefined) err.status = status;
    err.body = code ? { code } : null;
    throw err;
  };
}

describe('LIN-3136 S6 — the toggle path is byte-for-byte unchanged', () => {
  test('getOrCreateToken(urlKey) posts the toggle body and returns { token, providerDisplayName }', async () => {
    const { toggle, calls } = load(ok());
    const res = await toggle.getOrCreateToken('acme');
    assert.deepEqual(calls[0].body, TOGGLE_BODY);
    assert.equal(calls[0].url, '/workspace/acme/api/proxy/tokens');
    assert.equal(calls[0].on401, false);
    assert.equal(res.token, 'BOOT');
    assert.equal(res.providerDisplayName, 'Linear');
  });

  test('an unforced append (toggle on) sends the toggle body; its failure keeps the fixed message', async () => {
    const good = load(ok(), { toggleOn: true });
    const out = await good.toggle.maybeAppend('PROMPT', 'acme');
    assert.deepEqual(good.calls[0].body, TOGGLE_BODY);
    assert.ok(out.endsWith(`${SCOPE_LINE} ${CANNOT_LINE}`), 'the grant-less toggle block says it cannot enqueue');

    const bad = load(refusal(403, 'GRANT_OWNER_ONLY'), { toggleOn: true });
    const failed = await bad.toggle.getOrCreateToken('acme');
    assert.equal(failed.token, null);
    assert.equal(failed.providerDisplayName, null);
    assert.equal(Object.prototype.hasOwnProperty.call(failed, 'error'), false, 'the toggle path still swallows to null');
    await assert.rejects(bad.toggle.maybeAppend('PROMPT', 'acme'),
      { message: 'Proxy is enabled but a proxy token could not be created — you may have hit the token rate limit; wait a minute and try again.' });
  });

  test('toggle off and not forced: nothing is minted', async () => {
    const { toggle, calls } = load(ok());
    assert.equal(await toggle.maybeAppend('PROMPT', 'acme'), 'PROMPT');
    assert.equal(calls.length, 0);
  });
});

describe('LIN-3136 S6 — a forced append mints a driver copy', () => {
  test('sends exactly { purpose: "driver" } and states the dispatch grant', async () => {
    const { toggle, calls } = load(ok({ grants: ['dispatch'] }));
    const out = await toggle.maybeAppend('PROMPT', 'acme', { force: true });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, { purpose: 'driver' });
    assert.ok(out.startsWith('PROMPT'));
    assert.ok(out.includes('Bearer BOOT'), 'the minted bootstrap is embedded');
    assert.ok(out.includes('currently backed by Linear'));
    assert.ok(out.endsWith(`${SCOPE_LINE} ${GRANT_LINE}`), 'the block states the grant');
  });

  test('forced even with the toggle on: still the driver body, never the toggle body', async () => {
    const { toggle, calls } = load(ok({ grants: ['dispatch'] }), { toggleOn: true });
    await toggle.maybeAppend('PROMPT', 'acme', { force: true });
    assert.deepEqual(calls[0].body, { purpose: 'driver' });
  });

  test('mints per copy, never cached', async () => {
    let n = 0;
    const { toggle, calls } = load(async () => ({ token: `BOOT-${++n}`, grants: ['dispatch'] }));
    const a = await toggle.maybeAppend('P', 'acme', { force: true });
    const b = await toggle.maybeAppend('P', 'acme', { force: true });
    assert.equal(calls.length, 2);
    assert.ok(a.includes('BOOT-1') && b.includes('BOOT-2'));
  });

  test('getOrCreateToken(urlKey, { purpose: "driver" }) returns the grants', async () => {
    const { toggle } = load(ok({ grants: ['dispatch'] }));
    const res = await toggle.getOrCreateToken('acme', { purpose: 'driver' });
    assert.equal(res.token, 'BOOT');
    assert.deepEqual([...res.grants], ['dispatch']);
  });
});

describe('LIN-3136 S6 — driver refusals map to copy and a forced append throws it', () => {
  const EXACT = {
    GRANT_OWNER_ONLY: "Only this workspace's owner can copy a prompt that can queue work on their machine. Ask the owner, or sign in as the owner.",
    WORKSPACE_OWNER_UNSET: "This workspace has no recorded owner yet, so a prompt that can queue work can't be created. Workspaces made before ownership tracking need an operator to assign an owner; a workspace created now gets its owner automatically.",
    GRANT_OWNERLESS: "This session isn't linked to an account. Sign in again, then copy.",
    OWNER_CHECK_UNAVAILABLE: "Couldn't verify ownership right now. Try again in a minute.",
    GRANTS_NOT_CLIENT_SETTABLE: 'The copy request was malformed. Reload the page and try again.',
    INVALID_PURPOSE: 'The copy request was malformed. Reload the page and try again.',
    RATE_LIMITED: 'Too many prompt copies in a short time. Wait a minute and try again.',
    NETWORK: "Couldn't reach Harbour to create this prompt's access token. Check your connection and try again.",
    UNKNOWN: "Couldn't create this prompt's access token. Try again in a minute."
  };

  test('the map carries exactly the plan\'s copy, and names no account', () => {
    const { toggle } = load(ok());
    assert.deepEqual({ ...toggle.DRIVER_COPY_ERROR_COPY }, EXACT);
    for (const copy of Object.values(toggle.DRIVER_COPY_ERROR_COPY)) {
      assert.doesNotMatch(copy, /@|account-|acct/i);
    }
  });

  test('the runner map is untouched', () => {
    const { toggle } = load(ok());
    assert.equal(toggle.RUNNER_BOOTSTRAP_ERROR_COPY.GRANT_OWNER_ONLY,
      "Only this workspace's owner can copy a runner prompt. Ask the owner, or sign in as the owner.");
  });

  for (const [desc, impl, code] of [
    ['403 GRANT_OWNER_ONLY', refusal(403, 'GRANT_OWNER_ONLY'), 'GRANT_OWNER_ONLY'],
    ['409 WORKSPACE_OWNER_UNSET', refusal(409, 'WORKSPACE_OWNER_UNSET'), 'WORKSPACE_OWNER_UNSET'],
    ['503 GRANT_OWNERLESS', refusal(503, 'GRANT_OWNERLESS'), 'GRANT_OWNERLESS'],
    ['503 OWNER_CHECK_UNAVAILABLE', refusal(503, 'OWNER_CHECK_UNAVAILABLE'), 'OWNER_CHECK_UNAVAILABLE'],
    ['400 GRANTS_NOT_CLIENT_SETTABLE', refusal(400, 'GRANTS_NOT_CLIENT_SETTABLE'), 'GRANTS_NOT_CLIENT_SETTABLE'],
    ['400 INVALID_PURPOSE', refusal(400, 'INVALID_PURPOSE'), 'INVALID_PURPOSE'],
    ['429 with no code', refusal(429), 'RATE_LIMITED'],
    ['a bare 500', refusal(500), 'UNKNOWN'],
    ['an unmapped 4xx', refusal(418, 'TEAPOT'), 'UNKNOWN'],
    ['no HTTP status (dropped connection)', refusal(undefined), 'NETWORK'],
    ['a 2xx with no token', async () => ({ success: true }), 'UNKNOWN']
  ]) {
    test(`${desc} → error ${code}; a forced append throws its copy`, async () => {
      const { toggle } = load(impl);
      const res = await toggle.getOrCreateToken('acme', { purpose: 'driver' });
      assert.equal(res.token, null);
      assert.equal(res.error.code, code);
      assert.equal(res.error.message, EXACT[code]);
      await assert.rejects(toggle.maybeAppend('PROMPT', 'acme', { force: true }), { message: EXACT[code] });
    });
  }
});

describe('LIN-3136 S6 — buildBlock', () => {
  test('with [dispatch] it states the grant; without, it says the token cannot enqueue', () => {
    const { toggle } = load(ok());
    assert.ok(toggle.buildBlock('BOOT', null, ['dispatch']).endsWith(`${SCOPE_LINE} ${GRANT_LINE}`));
    for (const grants of [undefined, [], ['take']]) {
      const out = toggle.buildBlock('BOOT', null, grants);
      assert.ok(out.endsWith(`${SCOPE_LINE} ${CANNOT_LINE}`), `grants=${JSON.stringify(grants)}`);
      assert.ok(!out.includes('dispatch grant'));
    }
    assert.equal(toggle.buildBlock('BOOT', 'Jira'), toggle.buildBlock('BOOT', 'Jira', undefined),
      'the two-argument call is unchanged');
  });
});
