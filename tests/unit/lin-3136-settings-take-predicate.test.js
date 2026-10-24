/**
 * LIN-3136 S7 (the LIN-3131 O-d carry) — Settings classifies runner rows by the
 * `take` grant, not by "has any grants".
 *
 * Once declared launches and driver copies mint `['dispatch']` tokens, the old
 * `grants.length > 0` predicate would file every one of them under "Runner
 * credentials" with runner revoke copy. These pins run the SHIPPED
 * `public/proxy.js` in a vm sandbox (the harness of
 * tests/unit/lin-3131-runner-settings-render.test.js) with `['dispatch']`
 * fixtures:
 *  - a `['dispatch']` working token and an unconsumed `['dispatch']` bootstrap
 *    stay in the ordinary list (and its count), marked `+dispatch`;
 *  - a CONSUMED `['dispatch']` bootstrap is hidden from the ordinary list:
 *    revoking it would revoke its whole lineage, including a running
 *    autopilot's live working token (the runner group hides spent bootstraps
 *    for the same reason);
 *  - `['take','dispatch']` rows are still runner rows.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildKeyList } from '../../lib/settings-keys.js';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROXY_SRC = readFileSync(join(__dirname, '../../public/proxy.js'), 'utf8');

function makeEl(extra = {}) {
  return {
    innerHTML: '', textContent: '', hidden: false, open: false, disabled: false,
    dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    _handlers: {},
    addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
    querySelector: () => null,
    querySelectorAll: () => [],
    ...extra
  };
}

const iso = (ms) => new Date(ms).toISOString();
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function fixtures() {
  const now = Date.now();
  const base = { scope: 'readWrite', hasOwner: true, lastUsedAt: null, createdAt: iso(now - 1000) };
  return [
    { ...base, tokenId: 'plain-1', label: 'ordinary', scope: 'read', kind: 'standard', singleUse: false, consumed: false, grants: [], parentTokenId: null, expiresAt: iso(now + 90 * 864e5) },
    // A declared autopilot launch: its spent bootstrap and the live working token.
    { ...base, tokenId: 'decl-boot-spent', label: 'dispatch-bootstrap', kind: 'bootstrap', singleUse: true, consumed: true, grants: ['dispatch'], parentTokenId: null, expiresAt: iso(now + 47 * 3600e3) },
    { ...base, tokenId: 'decl-work', label: 'dispatch-bootstrap', kind: 'standard', singleUse: false, consumed: false, grants: ['dispatch'], parentTokenId: 'decl-boot-spent', expiresAt: iso(now + 47 * 3600e3) },
    // A driver copy nobody has exchanged yet.
    { ...base, tokenId: 'driver-waiting', label: 'prompt-driver', kind: 'bootstrap', singleUse: true, consumed: false, grants: ['dispatch'], parentTokenId: null, expiresAt: iso(now + 47 * 3600e3) },
    // A runner credential.
    { ...base, tokenId: 'runner-work', label: 'default', kind: 'standard', singleUse: false, consumed: false, grants: ['take', 'dispatch'], parentTokenId: null, expiresAt: iso(now + 23 * 3600e3) }
  ];
}

// LIN-3846: the Proxy page's own lists moved into the one key list (lib/settings-keys.js); the
// same rules are pinned against it. Only `take` holders are runner keys.
describe('LIN-3136 S7 (moved by LIN-3846) — runner rows are the take holders only', () => {
  const list = (tokens) => buildKeyList({ proxyRows: tokens, dispatchRows: [], isOwner: true, urlKey: 'acme' });
  const kindOf = (rows, id) => rows.find(r => r.id === id)?.kind;

  test('[dispatch] tokens are not runner keys; [take, dispatch] still are', () => {
    const rows = list(fixtures());
    assert.equal(kindOf(rows, 'runner-work'), 'Runner key');
    for (const id of ['decl-work', 'driver-waiting']) assert.equal(kindOf(rows, id), 'Can start runs');
  });

  test('a dispatch-only working token and an unconsumed driver bootstrap are listed, marked as able to start runs', () => {
    const rows = list(fixtures());
    assert.equal(kindOf(rows, 'plain-1'), 'Read');
    assert.equal(kindOf(rows, 'decl-work'), 'Can start runs');
    assert.equal(kindOf(rows, 'driver-waiting'), 'Can start runs');
  });

  test('LIN-3491: an agent-prompt-dispatch token lists as a key that can start runs', () => {
    const now = Date.now();
    const rows = list([{
      tokenId: 'agent-work', label: 'agent-prompt-dispatch', scope: 'readWrite', kind: 'standard', singleUse: false,
      consumed: false, hasOwner: true, grants: ['dispatch'], parentTokenId: 'agent-boot', createdAt: iso(now - 1000),
      lastUsedAt: null, expiresAt: iso(now + 47 * 3600e3)
    }]);
    assert.equal(kindOf(rows, 'agent-work'), 'Can start runs');
  });

  test('a consumed grant-bearing bootstrap is hidden (its revoke would kill the live lineage)', () => {
    assert.equal(list(fixtures()).some(r => r.id === 'decl-boot-spent'), false);
  });

  test('the count is the list: plain-1, decl-work, driver-waiting and the runner key', () => {
    assert.equal(list(fixtures()).length, 4);
  });

  test('a consumed grant-LESS bootstrap is still listed as before', () => {
    const now = Date.now();
    const rows = list([{
      tokenId: 'plain-boot-spent', label: 'prompt-proxy', scope: 'readWrite', kind: 'bootstrap', singleUse: true,
      consumed: true, hasOwner: true, grants: [], parentTokenId: null, createdAt: iso(now - 1000), lastUsedAt: null,
      expiresAt: iso(now + 47 * 3600e3)
    }]);
    assert.equal(kindOf(rows, 'plain-boot-spent'), 'Read and update');
  });
});

describe('LIN-3136 — the Settings "Generate agent prompt" states that a readWrite token cannot enqueue', () => {
  // `respond` is the mint response (scope/grants come from it, never the picker);
  // `fail` makes the mint reject with that error; `toggle` is window.ProxyToggle.
  function agentPrompt(pick, { respond, fail, toggle } = {}) {
    const generateBtn = makeEl({ closest: () => ({ dataset: { urlKey: 'acme' } }) });
    const scopeSelect = makeEl({ value: pick });
    const promptOutput = makeEl();
    const feedback = makeEl();
    const copied = [];
    const requests = [];
    const defaultRespond = { token: 'BOOT', tokens: [], providerDisplayName: null, scope: pick, grants: [] };
    const win = {
      location: { origin: 'https://harbour.test' },
      relativeTime: () => 'just now',
      api: async (url, opts) => {
        if (!url.includes('/api/proxy/tokens')) return {};
        requests.push(JSON.parse(opts.body));
        if (fail) throw fail;
        return respond || defaultRespond;
      }
    };
    if (toggle) win.ProxyToggle = toggle;
    const sandbox = {
      window: win,
      document: {
        getElementById: (id) => ({
          'proxy-generate-btn': generateBtn, 'proxy-scope-select': scopeSelect,
          'proxy-prompt-output': promptOutput, 'proxy-generate-feedback': feedback
        }[id] || null),
        querySelector: () => null,
        addEventListener() {}
      },
      navigator: { clipboard: { writeText: async (t) => { copied.push(t); } } },
      setTimeout, clearTimeout, console,
      escapeHtml: (v) => String(v),
      confirm: () => false,
      toast: () => {}
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(PROXY_SRC, sandbox, { filename: 'proxy.js' });
    return { generateBtn, copied, requests, feedback };
  }

  const CANNOT = 'It cannot enqueue work: the dispatch routes return 403 `DISPATCH_GRANT_REQUIRED`.';
  const CAN = 'It also holds the dispatch grant, so it can enqueue work (`POST /dispatch`, `/recommend-and-dispatch`, `/autopilot/kickoff`)';
  const click = async (h) => { assert.ok(h.generateBtn._handlers.click, 'the generate button is wired'); await h.generateBtn._handlers.click[0](); await flush(); };

  test('readWrite: the prompt ends with the cannot-enqueue clause; read: unchanged', async () => {
    for (const [scope, expectClause] of [['readWrite', true], ['read', false]]) {
      const h = agentPrompt(scope);
      await click(h);
      const text = h.copied[0] || '';
      assert.ok(text.includes(`Your token scope is: ${scope}.`), `${scope}: ${text.slice(-200)}`);
      assert.equal(text.includes(CANNOT), expectClause, scope);
      assert.ok(!text.includes(CAN), scope);
      assert.deepEqual(h.requests[0], { label: 'agent-prompt', scope, bootstrap: true }, 'the old request is unchanged');
    }
  });

  test('read-write + dispatch: sends exactly { purpose: "agent" } and the prompt says it can enqueue', async () => {
    const h = agentPrompt('readWriteDispatch', {
      respond: { token: 'BOOT', providerDisplayName: 'Linear', scope: 'readWrite', grants: ['dispatch'] }
    });
    await click(h);
    assert.deepEqual(h.requests, [{ purpose: 'agent' }]);
    const text = h.copied[0] || '';
    assert.ok(text.includes('Your token scope is: readWrite.'), text.slice(-300));
    assert.ok(text.includes(CAN), text.slice(-300));
    assert.ok(!text.includes(CANNOT));
    assert.ok(!text.includes('`take`') && !text.includes('/dispatch/take'), 'the prompt never offers the runner routes');
    assert.ok(text.includes('currently backed by Linear'));
  });

  test('the prompt follows the response, not the picker: dispatch picked, no grant returned', async () => {
    const h = agentPrompt('readWriteDispatch', { respond: { token: 'BOOT', scope: 'readWrite', grants: [] } });
    await click(h);
    const text = h.copied[0] || '';
    assert.ok(text.includes(CANNOT));
    assert.ok(!text.includes(CAN));
  });

  describe('refusals', () => {
    const MAPPED = { GRANT_OWNER_ONLY: 'MAPPED owner only', NETWORK: 'MAPPED network', RATE_LIMITED: 'MAPPED rate', UNKNOWN: 'MAPPED unknown' };
    const toggle = { DRIVER_COPY_ERROR_COPY: MAPPED };
    const refusal = (code, status = 403) => Object.assign(new Error('raw server message'), { status, body: { code } });

    test('dispatch pick + GRANT_OWNER_ONLY shows the mapped text and copies nothing', async () => {
      const h = agentPrompt('readWriteDispatch', { fail: refusal('GRANT_OWNER_ONLY'), toggle });
      await click(h);
      assert.equal(h.feedback.textContent, 'MAPPED owner only');
      assert.equal(h.copied.length, 0);
    });

    test('dispatch pick: no status is NETWORK, a code-less 429 is RATE_LIMITED, other is UNKNOWN', async () => {
      const cases = [
        [new TypeError('Failed to fetch'), 'MAPPED network'],
        [Object.assign(new Error('slow down'), { status: 429 }), 'MAPPED rate'],
        [Object.assign(new Error('boom'), { status: 500 }), 'MAPPED unknown']
      ];
      for (const [fail, want] of cases) {
        const h = agentPrompt('readWriteDispatch', { fail, toggle });
        await click(h);
        assert.equal(h.feedback.textContent, want);
      }
    });

    test('dispatch pick without window.ProxyToggle falls back to err.message', async () => {
      const h = agentPrompt('readWriteDispatch', { fail: refusal('GRANT_OWNER_ONLY') });
      await click(h);
      assert.equal(h.feedback.textContent, 'raw server message');
    });

    test('read / readWrite failures keep err.message even when the map is present', async () => {
      for (const pick of ['read', 'readWrite']) {
        const h = agentPrompt(pick, { fail: refusal('GRANT_OWNER_ONLY'), toggle });
        await click(h);
        assert.equal(h.feedback.textContent, 'raw server message', pick);
      }
    });
  });
});
