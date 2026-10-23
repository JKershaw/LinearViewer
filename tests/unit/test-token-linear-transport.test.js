/**
 * LIN-3798 — the e2e server answers the fake `test-token` in-process.
 *
 * Every dispatch naming an issue runs the dangling-referent guard
 * (lib/dispatch-referent-guard.js), whose probe sent the `/test/set-session`
 * workspace's `test-token` to api.linear.app. Linear answered it unauthenticated
 * and the guard failed open, so nothing visibly broke. But the round trip kept a
 * UI test's POST /api/dispatch in flight past the next test's
 * /test/clear-dispatch-queue, and the row landed in the freshly cleared partition
 * (dispatch.spec.js 'Dispatch API': 2 items where 1 was expected).
 *
 * The witness: through the REAL Linear provider and the REAL guard, the probe gets
 * the same auth answer as before (so the guard still allows) and the network is
 * never asked: `passThrough` stands in for the network and counts every call.
 *
 * Run with: node --test tests/unit/test-token-linear-transport.test.js
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { installTestTokenLinearTransport } from '../../routes/test.js';
import { setLinearFetchImpl } from '../../lib/linear-fetch.js';
import { getProvider } from '../../lib/providers/registry.js';
import '../../lib/providers/linear/index.js';
import { isDanglingReferent } from '../../lib/dispatch-referent-guard.js';
import { classifyUpstreamError } from '../../lib/errors.js';

describe('installTestTokenLinearTransport (LIN-3798)', () => {
  const passedThrough = [];
  installTestTokenLinearTransport({
    passThrough: async (url, options) => {
      // Stands in for the network. Answered (not thrown) so linear-fetch does not
      // retry it as a dropped connection.
      passedThrough.push({ url: String(url), authorization: new Headers(options.headers).get('authorization') });
      return new Response(JSON.stringify({ errors: [{ message: 'passed through to the network' }] }), { status: 200 });
    },
  });
  after(() => setLinearFetchImpl(null));

  const linear = getProvider('linear');

  test("the provider's referent probe for test-token is answered 401 without leaving the process", async () => {
    const before = passedThrough.length;
    await assert.rejects(
      () => linear.issueWriteGuard('test-token', 'TEST-11'),
      (err) => {
        assert.equal(err.response?.status, 401);
        assert.equal(classifyUpstreamError(err).category, 'auth');
        return true;
      }
    );
    assert.equal(passedThrough.length, before, 'no request was passed to the network');
  });

  test('the dispatch referent guard still fails open for test-token, as it did on the live 401', async () => {
    const before = passedThrough.length;
    const dangling = await isDanglingReferent({ provider: linear, token: 'test-token', issueIdentifier: 'TEST-11' });
    assert.equal(dangling, false);
    assert.equal(passedThrough.length, before);
  });

  test('any other credential passes through unchanged', async () => {
    await assert.rejects(() => linear.issueWriteGuard('lin_api_real-looking', 'TEST-11'), /passed through to the network/);
    assert.equal(passedThrough.at(-1).authorization, 'lin_api_real-looking');
  });
});
