/**
 * LIN-3131 S2b.3, moved by LIN-3846 — runner keys in the one key list.
 *
 * The Proxy page used to ship a "Runner credentials" section and a client that derived one
 * row per credential lineage. LIN-3846 put every key in one list on Settings › Agent access,
 * built server-side (`lib/settings-keys.js`), so the same rules are pinned there:
 *  - one row per credential lineage: a waiting bootstrap and the active working token are
 *    rows, a spent grant-bearing bootstrap is HIDDEN (its working token is the live row);
 *  - revoke names the live row's own tokenId, through today's DELETE route;
 *  - the Proxy page links to the list instead of carrying its own.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderProxyPage } from '../../lib/render-proxy.js';
import { buildKeyList } from '../../lib/settings-keys.js';
import { agentAccessBody } from '../../lib/render-settings-workspace.js';

describe('LIN-3846 — the Proxy page links to the key list instead of carrying its own', () => {
  const html = renderProxyPage('Acme', { urlKey: 'acme', workspaces: [], featureFlags: {} });

  test('no runner credentials section and no token list container', () => {
    assert.doesNotMatch(html, /id="proxy-runner-credentials"/);
    assert.doesNotMatch(html, /data-testid="settings-key-/);
  });

  test('a link row points at Settings › Agent access', () => {
    assert.match(html, /data-testid="proxy-keys-link"/);
    assert.match(html, /href="\/workspace\/acme\/settings\/agent-access"/);
  });
});

const iso = (ms) => new Date(ms).toISOString();

function tokenFixture() {
  const now = Date.now();
  return [
    { tokenId: 'plain-1', label: 'ordinary', scope: 'read', kind: 'standard', singleUse: false, consumed: false, hasOwner: true, grants: [], parentTokenId: null, createdAt: iso(now - 5000), lastUsedAt: null, expiresAt: iso(now + 90 * 864e5) },
    { tokenId: 'boot-waiting', label: 'default', scope: 'readWrite', kind: 'bootstrap', singleUse: true, consumed: false, hasOwner: true, grants: ['take', 'dispatch'], parentTokenId: null, createdAt: iso(now - 4000), lastUsedAt: null, expiresAt: iso(now + 59 * 60000) },
    { tokenId: 'boot-spent', label: 'spent-runner', scope: 'readWrite', kind: 'bootstrap', singleUse: true, consumed: true, hasOwner: true, grants: ['take', 'dispatch'], parentTokenId: null, createdAt: iso(now - 3000), lastUsedAt: null, expiresAt: iso(now + 30 * 60000) },
    { tokenId: 'work-active', label: 'default', scope: 'readWrite', kind: 'standard', singleUse: false, consumed: false, hasOwner: true, grants: ['take', 'dispatch'], parentTokenId: 'boot-spent', createdAt: iso(now - 2000), lastUsedAt: null, expiresAt: iso(now + 23 * 3600e3 + 30 * 60000) }
  ];
}

describe('LIN-3846 — one row per runner lineage in the key list', () => {
  const rows = buildKeyList({ proxyRows: tokenFixture(), dispatchRows: [], isOwner: true, urlKey: 'acme' });

  test('shows the waiting bootstrap and the active working token, hides the spent bootstrap', () => {
    const ids = rows.map(r => r.id);
    assert.deepEqual(ids.sort(), ['boot-waiting', 'plain-1', 'work-active']);
    assert.equal(rows.find(r => r.id === 'boot-waiting').waiting, true);
    assert.equal(rows.find(r => r.id === 'work-active').waiting, false);
  });

  test('revoke names the live row\'s own tokenId through the existing DELETE route', () => {
    const active = rows.find(r => r.id === 'work-active');
    assert.equal(active.revoke.route, '/workspace/acme/api/proxy/tokens/work-active');
    assert.ok(!rows.some(r => r.revoke.route.endsWith('/boot-spent')));
  });

  test('a runner key is labelled by what it does, and an ordinary one is not a runner key', () => {
    assert.equal(rows.find(r => r.id === 'work-active').kind, 'Runner key');
    assert.equal(rows.find(r => r.id === 'plain-1').kind, 'Read');
  });

  test('the page renders a row per key and no spent bootstrap', () => {
    const html = agentAccessBody({ urlKey: 'acme', keys: rows });
    assert.match(html, /waiting to be used/);
    assert.doesNotMatch(html, /boot-spent/);
  });
});
