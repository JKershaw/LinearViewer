/**
 * LIN-3846: the one key list, from both token stores, and Agent access rendering it.
 *
 * Run with: node --test tests/unit/settings-keys.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildKeyList, latestRunnerPoll, isLiveKey } from '../../lib/settings-keys.js';
import { agentAccessBody } from '../../lib/render-settings-workspace.js';
import { hasLiveRunnerKey, hasLiveQueueToken } from '../../lib/run-controls.js';

const iso = (ms) => new Date(ms).toISOString();
// A pinned clock, and every call passes it: a key expires 1 day after NOW, and `buildKeyList` / `agentAccessBody`
// default `now` to the wall clock. NOW is pinned in the past on purpose, so a call that misses `now: NOW` fails at
// once instead of on the day the fixtures' expiry passes (LIN-3949).
const NOW = Date.parse('2026-10-24T12:00:00Z');
const proxy = (over) => ({ tokenId: 'p', label: '', scope: 'read', kind: 'standard', consumed: false, hasOwner: true, grants: [], createdAt: iso(NOW - 1e3), lastUsedAt: null, expiresAt: iso(NOW + 864e5), ...over });
const queue = (over) => ({ tokenId: 'd', label: 'legacy', hasOwner: true, createdAt: iso(NOW - 1e3), lastUsedAt: null, expiresAt: iso(NOW + 864e5), ...over });

describe('kinds describe what a key can do, never where it came from', () => {
  const rows = buildKeyList({
    proxyRows: [
      proxy({ tokenId: 'r', scope: 'readWrite', grants: ['take', 'dispatch'] }),
      proxy({ tokenId: 'a', scope: 'readWrite', grants: ['dispatch'], label: 'agent-prompt-dispatch' }),
      proxy({ tokenId: 'd2', scope: 'readWrite', grants: ['dispatch'], label: 'prompt-driver' }),
      proxy({ tokenId: 'rw', scope: 'readWrite' }),
      proxy({ tokenId: 'ro', scope: 'read' })
    ],
    dispatchRows: [queue({ tokenId: 'q' })], isOwner: true, urlKey: 'acme', now: NOW
  });
  const kind =(id) => rows.find(r => r.id === id).kind;

  test('runner key, can start runs, read and update, read, queue token', () => {
    assert.deepEqual(['r', 'a', 'd2', 'rw', 'ro', 'q'].map(kind), ['Runner key', 'Can start runs', 'Can start runs', 'Read and update', 'Read', 'Queue token (legacy)']);
  });

  test('an agent prompt and a driver copy read the same: no field says which, so none is claimed', () => {
    assert.equal(kind('a'), kind('d2'));
    assert.ok(!rows.some(r => /agent prompt|driver|launch/i.test(r.kind)));
  });
});

describe('revoke uses today\'s DELETE routes and their owner rules', () => {
  const proxyRows = [proxy({ tokenId: 'plain' }), proxy({ tokenId: 'grants', grants: ['dispatch'] })];
  const dispatchRows = [queue({ tokenId: 'q' })];

  test('a member may revoke an ordinary key only; grant-bearing keys and every queue token are owner-only', () => {
    const rows = buildKeyList({ proxyRows, dispatchRows, isOwner: false, urlKey: 'acme', now: NOW });
    const allowed = Object.fromEntries(rows.map(r => [r.id, r.revoke.allowed]));
    assert.deepEqual(allowed, { plain: true, grants: false, q: false });
    assert.match(rows.find(r => r.id === 'q').revoke.ownerOnlyNote, /owner/);
  });

  test('the owner may revoke all of them', () => {
    assert.ok(buildKeyList({ proxyRows, dispatchRows, isOwner: true, urlKey: 'acme', now: NOW }).every(r => r.revoke.allowed));
  });

  test('the routes are the existing ones, per store', () => {
    const rows = buildKeyList({ proxyRows, dispatchRows, isOwner: true, urlKey: 'acme', now: NOW });
    assert.equal(rows.find(r => r.id === 'plain').revoke.route, '/workspace/acme/api/proxy/tokens/plain');
    assert.equal(rows.find(r => r.id === 'q').revoke.route, '/workspace/acme/api/dispatch/tokens/q');
  });

  test('a member sees "owner only" in place of the button, an owner the button', () => {
    const member = agentAccessBody({ urlKey: 'acme', keys: buildKeyList({ proxyRows, dispatchRows, isOwner: false, urlKey: 'acme', now: NOW }), now: NOW });
    const owner = agentAccessBody({ urlKey: 'acme', keys: buildKeyList({ proxyRows, dispatchRows, isOwner: true, urlKey: 'acme', now: NOW }), now: NOW });
    assert.equal((member.match(/settings-key-owner-only/g) || []).length, 2);
    assert.equal((member.match(/data-settings-ask-route/g) || []).length, 1);
    assert.equal((owner.match(/data-settings-ask-route/g) || []).length, 3);
    assert.doesNotMatch(owner, /settings-key-owner-only/);
  });
});

describe('the list shows what a person needs', () => {
  test('expiry and last use are relative (LIN-3890), and "no owner · re-issue" for an ownerless key', () => {
    // The clock is injected (LIN-3890): the renderer formats against `now`, not a second read of Date.now().
    const keys = buildKeyList({ proxyRows: [proxy({ tokenId: 'x', hasOwner: false, expiresAt: iso(NOW + 2 * 864e5), lastUsedAt: iso(NOW - 6e4) })], dispatchRows: [], isOwner: true, urlKey: 'acme', now: NOW });
    const html = agentAccessBody({ urlKey: 'acme', keys, now: NOW });
    assert.match(html, /expires in 2d/);
    assert.match(html, /last used 1m ago/);
    assert.match(html, /no owner · re-issue/);
  });

  test('New key is read, or read and update; 90 days; shown once; run keys come from the owner', () => {
    const html = agentAccessBody({ urlKey: 'acme', keys: [], now: NOW });
    assert.match(html, /name="scope" value="read" checked/);
    assert.match(html, /name="scope" value="readWrite"/);
    assert.match(html, /90 days and is shown once/);
    assert.match(html, /minted by the workspace owner only/);
    assert.match(html, /data-newkey-route="\/workspace\/acme\/api\/proxy\/tokens"/);
    assert.match(html, /settings-keys-empty/);
  });

  test('links to the event log and the agent prompt', () => {
    const html = agentAccessBody({ urlKey: 'acme', keys: [], now: NOW });
    assert.match(html, /settings-link-events/);
    assert.match(html, /settings-link-agent-prompt/);
  });
});

describe('"has a runner" is the house predicate, so Settings and Dispatch cannot disagree', () => {
  test('a workspace with only a live queue token has a runner, with the last poll from it', () => {
    const q = [queue({ lastUsedAt: iso(NOW - 6e4) })];
    assert.equal(hasLiveRunnerKey([]) || hasLiveQueueToken(q, NOW), true);
    assert.deepEqual(latestRunnerPoll({ proxyRows: [], dispatchRows: q, now: NOW }), { at: iso(NOW - 6e4), kind: 'queue token' });
  });

  test('the last poll is the latest across both kinds, and an expired key is ignored', () => {
    const poll = latestRunnerPoll({
      proxyRows: [proxy({ grants: ['take'], lastUsedAt: iso(NOW - 3e5) }), proxy({ tokenId: 'old', grants: ['take'], lastUsedAt: iso(NOW - 1e3), expiresAt: iso(NOW - 5) })],
      dispatchRows: [queue({ lastUsedAt: iso(NOW - 6e4) })], now: NOW
    });
    assert.deepEqual(poll, { at: iso(NOW - 6e4), kind: 'queue token' });
    assert.equal(latestRunnerPoll({ proxyRows: [proxy({ grants: ['take'] })], dispatchRows: [], now: NOW }), null, 'never used: no poll, and no liveness claim');
    // The one liveness predicate (LIN-3890) replaces the old isExpired: a past expiry is not live, a null one is.
    assert.equal(isLiveKey({ expiresAt: iso(NOW - 1) }, NOW), false);
    assert.equal(isLiveKey({ expiresAt: null }, NOW), true);
  });
});
