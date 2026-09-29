/**
 * LIN-3131 S2b.3 — the Settings "Runner credentials" surface.
 *
 * Two layers:
 *  - the SERVER render (`lib/render-proxy.js`) ships a "Runner credentials"
 *    section with a list container the client fills;
 *  - the CLIENT derivation (`public/proxy.js`, vm-sandboxed so the shipped
 *    functions run) renders ONE row per credential lineage: a waiting bootstrap,
 *    an active working token, a spent bootstrap HIDDEN, hour/minute expiry, and a
 *    revoke that names the live row's own tokenId. The ordinary token list
 *    excludes runner tokens so they aren't double-shown.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderProxyPage } from '../../lib/render-proxy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROXY_SRC = readFileSync(join(__dirname, '../../public/proxy.js'), 'utf8');

// ---------------------------------------------------------------------------
// Server render
// ---------------------------------------------------------------------------

describe('LIN-3131 S2b.3 — renderProxyPage ships the Runner credentials section', () => {
  const html = renderProxyPage('Acme', { urlKey: 'acme', workspaces: [], featureFlags: {} });

  test('renders the section heading', () => {
    assert.match(html, /Runner credentials/);
  });

  test('renders the list container the client fills', () => {
    assert.match(html, /id="proxy-runner-credentials"/);
    assert.match(html, /data-testid="proxy-runner-credentials"/);
    assert.match(html, /class="[^"]*proxy-runner-credentials[^"]*"/);
    assert.match(html, /data-url-key="acme"/);
  });
});

// ---------------------------------------------------------------------------
// Client derivation / render (vm sandbox)
// ---------------------------------------------------------------------------

function makeEl(extra = {}) {
  const el = {
    innerHTML: '',
    textContent: '',
    hidden: false,
    open: false,
    disabled: false,
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    _handlers: {},
    addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
    querySelector: () => null,
    querySelectorAll: () => [],
    ...extra
  };
  return el;
}

const iso = (ms) => new Date(ms).toISOString();

function loadProxyPage(tokens) {
  const tokenListEl = makeEl({ dataset: { urlKey: 'acme' } });
  const runnerEl = makeEl();
  const tokensCollapsible = makeEl();

  const sandbox = {
    window: {
      location: { origin: 'https://harbour.test' },
      relativeTime: () => 'just now',
      api: async (url) => (url.includes('/api/proxy/tokens') ? { tokens } : {})
    },
    document: {
      getElementById: (id) => ({ 'proxy-runner-credentials': runnerEl, 'proxy-tokens-collapsible': tokensCollapsible }[id] || null),
      querySelector: (sel) => (sel === '.proxy-token-list' ? tokenListEl : null),
      addEventListener() {}
    },
    navigator: { clipboard: { writeText: async () => {} } },
    setTimeout, clearTimeout, console,
    escapeHtml: (v) => String(v),
    confirm: () => false,
    toast: () => {}
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(PROXY_SRC, sandbox, { filename: 'proxy.js' });
  return { tokenListEl, runnerEl, tokensCollapsible };
}

/** Let the page's init-time async loads settle. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function tokenFixture() {
  const now = Date.now();
  return [
    // An ordinary grant-less token — belongs in the generic list only.
    {
      tokenId: 'plain-1', label: 'ordinary', scope: 'read', kind: 'standard', singleUse: false,
      consumed: false, hasOwner: true, grants: [], parentTokenId: null,
      createdAt: iso(now - 5000), lastUsedAt: null, expiresAt: iso(now + 90 * 864e5)
    },
    // A waiting runner bootstrap (unconsumed, grant-bearing).
    {
      tokenId: 'boot-waiting', label: 'default', scope: 'readWrite', kind: 'bootstrap', singleUse: true,
      consumed: false, hasOwner: true, grants: ['take', 'dispatch'], parentTokenId: null,
      createdAt: iso(now - 4000), lastUsedAt: null, expiresAt: iso(now + 59 * 60000)
    },
    // A spent runner bootstrap — hidden (its working token is the live row).
    {
      tokenId: 'boot-spent', label: 'spent-runner', scope: 'readWrite', kind: 'bootstrap', singleUse: true,
      consumed: true, hasOwner: true, grants: ['take', 'dispatch'], parentTokenId: null,
      createdAt: iso(now - 3000), lastUsedAt: null, expiresAt: iso(now + 30 * 60000)
    },
    // The active working token exchanged from boot-spent.
    {
      tokenId: 'work-active', label: 'default', scope: 'readWrite', kind: 'standard', singleUse: false,
      consumed: false, hasOwner: true, grants: ['take', 'dispatch'], parentTokenId: 'boot-spent',
      createdAt: iso(now - 2000), lastUsedAt: null, expiresAt: iso(now + 23 * 3600e3 + 30 * 60000)
    }
  ];
}

describe('LIN-3131 S2b.3 — the client derives one row per runner lineage', () => {
  test('shows the waiting bootstrap and the active working token, hides the spent bootstrap', async () => {
    const { runnerEl } = loadProxyPage(tokenFixture());
    await flush();

    const html = runnerEl.innerHTML;
    assert.match(html, /data-token-id="boot-waiting"/, 'the waiting bootstrap is a row');
    assert.match(html, /data-token-id="work-active"/, 'the active working token is a row');
    assert.match(html, /waiting for exchange/);
    assert.match(html, /runner-credential-state--active/);
    assert.doesNotMatch(html, /spent-runner/, 'a spent bootstrap is hidden');
    assert.doesNotMatch(html, /boot-spent/, 'neither is its (hidden) id shown');
  });

  test('revoke names the live row\'s own tokenId (the working token, not its parent)', async () => {
    const { runnerEl } = loadProxyPage(tokenFixture());
    await flush();

    const html = runnerEl.innerHTML;
    // The active row's revoke button carries work-active (the live row), never
    // its parent bootstrap id.
    assert.match(html, /runner-credential-revoke" data-token-id="work-active"/);
    assert.doesNotMatch(html, /runner-credential-revoke" data-token-id="boot-spent"/);
  });

  test('expiry reads in hours/minutes, not days', async () => {
    const { runnerEl } = loadProxyPage(tokenFixture());
    await flush();

    const html = runnerEl.innerHTML;
    assert.match(html, /expires in \d+m/, 'the ~59m bootstrap expiry shows minutes');
    assert.match(html, /expires in 2[0-9]h \d+m/, 'the ~23h working expiry shows hours+minutes');
    assert.doesNotMatch(html, /expires in \d+d/, 'no day-granular badge on runner rows');
  });

  test('the ordinary token list excludes runner tokens (no double-show)', async () => {
    const { tokenListEl, tokensCollapsible } = loadProxyPage(tokenFixture());
    await flush();

    // The generic list lazy-loads on expand; drive the captured toggle handler.
    tokensCollapsible.open = true;
    tokensCollapsible._handlers.toggle[0]();
    await flush();

    const html = tokenListEl.innerHTML;
    assert.match(html, /data-token-id="plain-1"/, 'the ordinary token still lists');
    assert.doesNotMatch(html, /boot-waiting|work-active/, 'runner tokens are not double-shown');
  });

  test('no runner credentials renders the empty state', async () => {
    const onlyPlain = tokenFixture().filter(t => t.grants.length === 0);
    const { runnerEl } = loadProxyPage(onlyPlain);
    await flush();
    assert.match(runnerEl.innerHTML, /No runner credentials yet/);
  });
});
