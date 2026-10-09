/**
 * LIN-3383 — the owner-only runner enqueue gate: verdict matrix.
 *
 * lib/runner-owner-gate.js decides, from the one hoisted owner seam, whether a
 * session may enqueue for a runner target (cli/web). dash/local never consult the
 * seam. Every non-owner outcome is a refusal (fail closed).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUNNER_TARGETS,
  isRunnerTarget,
  resolveRunnerOwnerRefusal,
  assertRunnerOwnerAllowed,
  isRunnerOwnerRefusal
} from '../../lib/runner-owner-gate.js';
import { resolveOwnerMintRefusal, ownerMintRefusal } from '../../lib/owner-mint-refusals.js';

const verdict = (status) => async () => ({ status });
const args = (over = {}) => ({ ownerCheck: verdict('owner'), workspaceId: 'ws-1', accountId: 'acct-1', target: 'cli', ...over });

describe('LIN-3383 — runner targets', () => {
  test('cli and web are runner targets; an absent target is cli; dash/local are not', () => {
    assert.deepEqual([...RUNNER_TARGETS], ['cli', 'web']);
    assert.equal(isRunnerTarget('cli'), true);
    assert.equal(isRunnerTarget('web'), true);
    assert.equal(isRunnerTarget(undefined), true);
    assert.equal(isRunnerTarget(null), true);
    assert.equal(isRunnerTarget('dash'), false);
    assert.equal(isRunnerTarget('local'), false);
  });
});

describe('LIN-3383 — verdict matrix', () => {
  test('owner → allowed (null refusal, assert resolves)', async () => {
    assert.equal(await resolveRunnerOwnerRefusal(args()), null);
    await assertRunnerOwnerAllowed(args({ target: 'web' }));
  });

  test('not-owner → RUNNER_OWNER_ONLY 403, the plain message, not GRANT_OWNER_ONLY', async () => {
    const r = await resolveRunnerOwnerRefusal(args({ ownerCheck: verdict('not-owner') }));
    assert.deepEqual(r, {
      code: 'RUNNER_OWNER_ONLY',
      status: 403,
      category: 'auth',
      retryable: false,
      error: "Only this workspace's owner can act on its runner."
    });
  });

  test('absent target is treated as cli (a non-owner is refused)', async () => {
    const r = await resolveRunnerOwnerRefusal(args({ ownerCheck: verdict('not-owner'), target: undefined }));
    assert.equal(r.code, 'RUNNER_OWNER_ONLY');
  });

  test('no-owner workspace → WORKSPACE_OWNER_UNSET 409', async () => {
    const r = await resolveRunnerOwnerRefusal(args({ ownerCheck: verdict('no-owner') }));
    assert.equal(r.code, 'WORKSPACE_OWNER_UNSET');
    assert.equal(r.status, 409);
  });

  test('missing accountId → GRANT_OWNERLESS 503 WITHOUT consulting the seam', async () => {
    let calls = 0;
    const r = await resolveRunnerOwnerRefusal(args({ accountId: undefined, ownerCheck: async () => { calls++; return { status: 'owner' }; } }));
    assert.equal(r.code, 'GRANT_OWNERLESS');
    assert.equal(r.status, 503);
    assert.equal(calls, 0);
  });

  test('absent / non-function seam → OWNER_CHECK_UNAVAILABLE 503 retryable (fail closed)', async () => {
    for (const ownerCheck of [null, undefined, 'owner', {}]) {
      const r = await resolveRunnerOwnerRefusal(args({ ownerCheck }));
      assert.equal(r.code, 'OWNER_CHECK_UNAVAILABLE');
      assert.equal(r.status, 503);
      assert.equal(r.retryable, true);
    }
  });

  test('throwing seam and an unexpected verdict → OWNER_CHECK_UNAVAILABLE', async () => {
    const thrown = await resolveRunnerOwnerRefusal(args({ ownerCheck: async () => { throw new Error('db down'); } }));
    assert.equal(thrown.code, 'OWNER_CHECK_UNAVAILABLE');
    for (const status of [undefined, 'maybe', '', null]) {
      const r = await resolveRunnerOwnerRefusal(args({ ownerCheck: verdict(status) }));
      assert.equal(r.code, 'OWNER_CHECK_UNAVAILABLE', `status ${status}`);
    }
  });

  test('dash and local return before the seam is consulted — even with no seam, no account', async () => {
    let calls = 0;
    const spy = async () => { calls++; return { status: 'not-owner' }; };
    for (const target of ['dash', 'local']) {
      assert.equal(await resolveRunnerOwnerRefusal({ ownerCheck: spy, workspaceId: 'w', accountId: 'a', target }), null);
      assert.equal(await resolveRunnerOwnerRefusal({ target }), null);
    }
    assert.equal(calls, 0);
  });

  test('the throwing form carries code/status/category/retryable and is recognised', async () => {
    await assert.rejects(
      () => assertRunnerOwnerAllowed(args({ ownerCheck: verdict('not-owner') })),
      (err) => {
        assert.equal(isRunnerOwnerRefusal(err), true);
        assert.equal(err.code, 'RUNNER_OWNER_ONLY');
        assert.equal(err.status, 403);
        assert.equal(err.category, 'auth');
        assert.equal(err.retryable, false);
        return true;
      }
    );
    assert.equal(isRunnerOwnerRefusal(new Error('x')), false);
    assert.equal(isRunnerOwnerRefusal(null), false);
  });

  test('the seam is keyed on the given workspaceId and accountId', async () => {
    let seen;
    await resolveRunnerOwnerRefusal(args({ ownerCheck: async (a) => { seen = a; return { status: 'owner' }; } }));
    assert.deepEqual(seen, { workspaceId: 'ws-1', accountId: 'acct-1' });
  });
});

describe('LIN-3383 — the mint callers of resolveOwnerMintRefusal are unchanged', () => {
  test('a not-owner verdict still maps to GRANT_OWNER_ONLY by default, with the subject text', async () => {
    const r = await resolveOwnerMintRefusal({ ownerCheck: verdict('not-owner'), workspaceId: 'w', accountId: 'a', subject: 'a dispatch token' });
    assert.equal(r.code, 'GRANT_OWNER_ONLY');
    assert.equal(r.error, "Only this workspace's owner can mint a dispatch token");
  });

  test('the new code is in the shared vocabulary and ownerMintRefusal resolves it', () => {
    const r = ownerMintRefusal('RUNNER_OWNER_ONLY');
    assert.equal(r.status, 403);
    assert.equal(r.error, "Only this workspace's owner can act on its runner.");
  });
});
