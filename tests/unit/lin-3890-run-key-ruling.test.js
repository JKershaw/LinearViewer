// LIN-3890 outcome 10, the operator's ruling of 25 Oct: count only keys a person made ("N live keys"),
// and show per-run keys as one "Run keys · N" summary row. This seeds the ruling's own example:
// an expired person key, a consumed bootstrap, a live run working token, a live prompt-proxy token,
// a live New key and a live runner key. The sidebar must read "2 live keys" and the summary "Run keys · 2".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKeyList, isRunKey } from '../../lib/settings-keys.js';
import { getArea } from '../../lib/settings-areas.js';
import { agentAccessBody } from '../../lib/render-settings-workspace.js';

const NOW = Date.parse('2026-10-25T12:00:00.000Z');
const future = '2026-11-20T12:00:00.000Z';
const past = '2026-10-20T12:00:00.000Z';

const row = (over) => ({
  tokenId: over.tokenId, label: '', kind: 'standard', scope: 'read', grants: [],
  expiresAt: future, lastUsedAt: null, consumed: false, parentTokenId: null, hasOwner: true,
  ...over
});

const seeded = () => ({
  proxyRows: [
    row({ tokenId: 'expired-person', label: 'old laptop', expiresAt: past }),
    row({ tokenId: 'spent-bootstrap', kind: 'bootstrap', label: 'dispatch-bootstrap', consumed: true }),
    row({ tokenId: 'run-token', label: 'dispatch-run', parentTokenId: 'spent-bootstrap-2' }),
    row({ tokenId: 'prompt-proxy-token', label: 'prompt-proxy', scope: 'readWrite' }),
    row({ tokenId: 'new-key', label: 'laptop', scope: 'readWrite' }),
    row({ tokenId: 'runner-key', label: 'runner', grants: ['take', 'dispatch'], scope: 'readWrite' })
  ],
  dispatchRows: []
});

test('the ruling example: the sidebar reads "2 live keys" and the summary "Run keys · 2"', () => {
  const keys = buildKeyList({ ...seeded(), isOwner: true, urlKey: 'w', now: NOW });
  const keyCount = keys.filter(k => !k.run).length;
  assert.equal(getArea('agent-access').state({ keyCount }).text, '2 live keys');
  const html = agentAccessBody({ urlKey: 'w', keys, now: NOW });
  assert.match(html, /Run keys · 2/);
  assert.doesNotMatch(html, /expired-person|spent-bootstrap/, 'an expired or spent key is not listed');
});

test('the person-made rows are the New key and the runner key; the run rows are the run token and the prompt-proxy token', () => {
  const keys = buildKeyList({ ...seeded(), isOwner: true, urlKey: 'w', now: NOW });
  assert.deepEqual(keys.filter(k => !k.run).map(k => k.id).sort(), ['new-key', 'runner-key']);
  assert.deepEqual(keys.filter(k => k.run).map(k => k.id).sort(), ['prompt-proxy-token', 'run-token']);
});

test('isRunKey: a live unconsumed bootstrap is a run key; a grant-bearing row never is', () => {
  assert.equal(isRunKey({ kind: 'bootstrap', grants: [] }), true);
  assert.equal(isRunKey({ label: 'prompt-proxy', grants: [] }), true);
  assert.equal(isRunKey({ label: 'prompt-proxy', grants: ['dispatch'] }), false, 'a grant-bearing row is person-made');
  assert.equal(isRunKey({ label: 'laptop', grants: [] }), false);
});
