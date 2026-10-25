// LIN-3890 outcome 10: the Agent access count counts keys that can still be used.
// Seeds expired, spent-bootstrap, live person, run-key and copied-prompt rows and
// checks the list, the person/run split, and that the count agrees with run-controls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKeyList, isLiveKey, isRunKey, latestRunnerPoll } from '../../lib/settings-keys.js';
import { hasLiveRunnerKey, hasLiveQueueToken } from '../../lib/run-controls.js';
import { getArea } from '../../lib/settings-areas.js';

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
    row({ tokenId: 'expired', label: 'old', expiresAt: past }),
    row({ tokenId: 'spent-bootstrap', kind: 'bootstrap', consumed: true, grants: ['dispatch'], expiresAt: future }),
    row({ tokenId: 'person', label: 'laptop', scope: 'readWrite', expiresAt: future, lastUsedAt: '2026-10-25T11:00:00.000Z' }),
    row({ tokenId: 'run', label: 'dispatch run', parentTokenId: 'bootstrap-1', expiresAt: future }),
    row({ tokenId: 'copied', label: 'copied prompt', parentTokenId: 'bootstrap-2', expiresAt: future })
  ],
  dispatchRows: [
    row({ tokenId: 'queue-expired', expiresAt: past }),
    row({ tokenId: 'queue-live', expiresAt: future })
  ]
});

test('the list keeps only keys that can still be used', () => {
  const keys = buildKeyList({ ...seeded(), isOwner: true, urlKey: 'w', now: NOW });
  const ids = keys.map(k => k.id).sort();
  assert.deepEqual(ids, ['copied', 'person', 'queue-live', 'run']);
});

test('the person-made count excludes per-run keys, which are split out', () => {
  const keys = buildKeyList({ ...seeded(), isOwner: true, urlKey: 'w', now: NOW });
  const person = keys.filter(k => !k.run);
  const runs = keys.filter(k => k.run);
  assert.deepEqual(person.map(k => k.id).sort(), ['person', 'queue-live']);
  assert.deepEqual(runs.map(k => k.id).sort(), ['copied', 'run']);
});

test('the sidebar label says live keys and counts person-made keys only', () => {
  const keys = buildKeyList({ ...seeded(), isOwner: true, urlKey: 'w', now: NOW });
  const keyCount = keys.filter(k => !k.run).length;
  assert.equal(keyCount, 2);
  assert.equal(getArea('agent-access').state({ keyCount }).text, '2 live keys');
});

test('isLiveKey agrees with run-controls on unparseable, null, past and future expiry', () => {
  const cases = [
    { expiresAt: null }, { expiresAt: undefined }, { expiresAt: past }, { expiresAt: future }, { expiresAt: 'not a date' }
  ];
  for (const c of cases) {
    const r = { tokenId: 't', grants: ['take'], consumed: false, ...c };
    assert.equal(isLiveKey(r, NOW), hasLiveRunnerKey([r], NOW), `runner, expiresAt=${String(c.expiresAt)}`);
    assert.equal(isLiveKey(r, NOW), hasLiveQueueToken([r], NOW), `queue, expiresAt=${String(c.expiresAt)}`);
  }
});

test('a spent bootstrap is not live, and a run key is grant-less lineage', () => {
  assert.equal(isLiveKey({ consumed: true, expiresAt: future }, NOW), false);
  assert.equal(isRunKey({ parentTokenId: 'b', grants: [] }), true);
  assert.equal(isRunKey({ parentTokenId: 'b', grants: ['take'] }), false, 'a runner key is person-made');
  assert.equal(isRunKey({ parentTokenId: null, grants: [] }), false);
});

test('the runner poll ignores an expired key', () => {
  const poll = latestRunnerPoll({
    proxyRows: [
      { tokenId: 'r', grants: ['take'], consumed: false, expiresAt: past, lastUsedAt: '2026-10-25T11:59:00.000Z' }
    ],
    dispatchRows: [],
    now: NOW
  });
  assert.equal(poll, null);
});
