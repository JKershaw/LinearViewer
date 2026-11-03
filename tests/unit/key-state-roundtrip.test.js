/**
 * LIN-4168 round trip: every registered holder, built from its real factory, is filled under a test key through its own
 * public API, reset with the one call, and must hold nothing under that key afterwards. Task facts is refilled from the
 * new seed instead, and the refill must show the new seed's task and not the old one (LIN-4110). A second key is filled
 * too and must come through untouched: a reset touches its own key only.
 *
 * A holder that has no fill helper here fails the test, so a holder added to the registry cannot skip the round trip.
 *
 * Run with: node --test tests/unit/key-state-roundtrip.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildKeyStateInstances, buildRegistry } from '../fixtures/key-state-instances.js';
import { workspaceTokenCacheKey } from '../../lib/workspace-token-cache.js';

const OWNER = 'owner-acct-1';
const OTHER_KEY = 'other-key-w1';

/** The workspace a seam would put in the session for a key: the memo is keyed by its id, so probes need it too. */
const wsOf = (urlKey, accessToken = 'live-token') => ({ id: `ws-${urlKey}`, urlKey, accessToken });

/** Issue shape the task-facts holder indexes (`identifier` is what it validates). */
function issue(identifier) {
  return { id: `id-${identifier}`, identifier, title: identifier, state: { name: 'Todo', type: 'unstarted' }, parent: null, children: [] };
}

/**
 * One fill helper per registered holder name. Each fills the holder under `urlKey` through its public API and returns
 * nothing; the probe that follows is what tells whether it held anything.
 */
function fillers(instances, now) {
  const { taskFacts, workspaceIssuesMemo, sessionsFeedCache, taskDoneCaches, workspaceTokenCache, rejectedCredentialRegistry, refreshOnResolveGate } = instances;
  return {
    'task-facts': (urlKey) => taskFacts.holder.write(urlKey, { stateIssues: [issue('LIN-OLD')] }),
    'workspace-issues-memo': (urlKey) => workspaceIssuesMemo.set({ id: `ws-${urlKey}`, urlKey }, [issue('LIN-1')]),
    'sessions-feed': async (urlKey) => { await sessionsFeedCache.get(sessionsFeedCache.keyFor([{ urlKey }]), async () => ({ rows: [] })); },
    'task-done:dashboard': async (urlKey) => { await taskDoneCaches.dashboard.get(`${urlKey}::LIN-1`, async () => true); },
    'task-done:dispatch-guard': async (urlKey) => { await taskDoneCaches.dispatchGuard.get(`${urlKey}::LIN-1`, async () => false); },
    'workspace-token': (urlKey) => workspaceTokenCache.set(workspaceTokenCacheKey(urlKey, OWNER), { token: 't', expiresAt: now() + 3600_000 }),
    'rejected-credentials:scope-attempts': (urlKey) => {
      rejectedCredentialRegistry.markSuspect('fp-1', { now: now() });
      rejectedCredentialRegistry.shouldAttemptRefresh('fp-1', `${OWNER}:${urlKey}`, now());
    },
    'refresh-on-resolve:cooldown': (urlKey) => refreshOnResolveGate.shouldAttempt(`${OWNER}:${urlKey}`, 'fp-1', now()),
  };
}

describe('every registered holder: fill, reset, empty', () => {
  test('each holder has a fill helper, and each fill is seen by its probe before the reset', async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const instances = buildKeyStateInstances({ now });
    const keyState = buildRegistry(instances);
    const fill = fillers(instances, now);
    assert.deepEqual(keyState.holderNames().filter((n) => !fill[n]), [], 'every registered holder needs a fill helper here');

    const urlKey = 'rt-key-w0';
    for (const name of keyState.holderNames()) await fill[name](urlKey);
    const before = keyState.probeAll({ urlKey, workspace: wsOf(urlKey) });
    for (const name of keyState.holderNames()) assert.ok(before[name] > 0, `${name} holds something once filled (probe ${before[name]})`);
  });

  test('a reset leaves every holder empty for the key, and a second key is untouched', async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const instances = buildKeyStateInstances({ now });
    const keyState = buildRegistry(instances);
    const fill = fillers(instances, now);
    const urlKey = 'rt-key-w1';

    // Mock-token workspace: nothing to refill, so the reset must leave task facts empty.
    for (const name of keyState.holderNames()) await fill[name](urlKey);
    for (const name of keyState.holderNames()) await fill[name](OTHER_KEY);
    const otherBefore = keyState.probeAll({ urlKey: OTHER_KEY, workspace: wsOf(OTHER_KEY) });

    await keyState.resetKey({ urlKey, workspace: wsOf(urlKey, 'test-token'), accountId: null });

    const after = keyState.probeAll({ urlKey, workspace: wsOf(urlKey) });
    for (const name of keyState.holderNames()) {
      if (name === 'task-facts') continue; // refilled from the seed; checked below
      assert.equal(after[name], 0, `${name} is empty for ${urlKey} after the reset`);
    }
    assert.equal(after['task-facts'], 0, 'a mock workspace is never refilled (LIN-4168 D5)');

    const otherAfter = keyState.probeAll({ urlKey: OTHER_KEY, workspace: wsOf(OTHER_KEY) });
    assert.deepEqual(otherAfter, otherBefore, 'the other key keeps everything it held');
  });
});

describe('task facts are refilled from the new seed, not cleared (LIN-4110)', () => {
  test('after a reset with a live workspace, /state sees the new seed’s task and not the old one', async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const newSeed = [issue('LIN-NEW')];
    const fetched = [];
    const instances = buildKeyStateInstances({
      now,
      fetchAndPrepareProjects: async (workspace, a, b, urlKey, opts) => {
        fetched.push({ urlKey, workspace, opts });
        return { stateIssues: newSeed };
      },
    });
    const keyState = buildRegistry(instances);
    const { taskFacts } = instances;
    const urlKey = 'rt-refill-w0';

    // The previous spec left the old seed held, and its refresh floor is in use.
    taskFacts.holder.write(urlKey, { stateIssues: [issue('LIN-OLD')] });
    assert.equal(taskFacts.holder.read(urlKey, { identifier: 'LIN-OLD' }).complete, true);

    const workspace = wsOf(urlKey);
    await keyState.resetKey({ urlKey, workspace, accountId: OWNER });

    assert.equal(fetched.length, 1, 'one urgent refresh from the new seed');
    assert.equal(fetched[0].workspace, workspace, 'the refill is given the session workspace');
    assert.equal(taskFacts.holder.read(urlKey, { identifier: 'LIN-NEW' }).complete, true, 'the new seed’s task is held');
    assert.equal(taskFacts.holder.read(urlKey, { identifier: 'LIN-OLD' }).reason, 'task-missing', 'the old seed is gone');
  });

  test('a refill that fails leaves task facts cold and does not fail the reset', async () => {
    const instances = buildKeyStateInstances({
      fetchAndPrepareProjects: async () => { throw new Error('provider down'); },
    });
    const keyState = buildRegistry(instances);
    const urlKey = 'rt-refill-w1';
    await keyState.resetKey({ urlKey, workspace: wsOf(urlKey), accountId: null });
    assert.equal(instances.taskFacts.holder.read(urlKey).reason, 'cold');
  });
});
