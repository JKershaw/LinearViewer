/**
 * Resilient Linear-fetch tests.
 *
 * lib/linear-fetch.js wraps the Linear GraphQL boundary with a per-attempt
 * timeout and bounded retries so a single dropped keep-alive socket
 * ("Premature close" / ECONNRESET) is retried on a fresh connection instead of
 * surfacing as a LINEAR_UNREACHABLE error page. These tests pin the contract:
 *
 *   - transient connection drops are retried, then succeed;
 *   - retries are exhausted and the last error rethrown;
 *   - MUTATIONS are never replayed after the body is sent (LIN-399);
 *   - a caller-initiated abort is propagated immediately, never retried;
 *   - a per-attempt timeout is treated as transient and retried;
 *   - non-network (auth/internal) errors are not retried.
 *
 * Run with: node --test tests/unit/linear-fetch.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createLinearFetch, isTransientNetworkError } from '../../lib/linear-fetch.js';

const READ_BODY = JSON.stringify({ query: 'query { viewer { id } }' });
const MUTATION_BODY = JSON.stringify({ query: 'mutation { issueCreate { success } }' });

function prematureClose() {
  const err = new Error('Invalid response body ...: Premature close');
  err.name = 'FetchError';
  return err;
}

// No real delays in tests.
const noSleep = () => Promise.resolve();

describe('isTransientNetworkError', () => {
  test('Premature close → transient', () => {
    assert.strictEqual(isTransientNetworkError(prematureClose()), true);
  });

  test('ECONNRESET on cause → transient', () => {
    const err = new Error('fetch failed');
    err.cause = { code: 'ECONNRESET' };
    assert.strictEqual(isTransientNetworkError(err), true);
  });

  test('auth/internal error → not transient', () => {
    assert.strictEqual(isTransientNetworkError(new Error('boom')), false);
  });
});

describe('createLinearFetch retries', () => {
  test('retries a read on a transient drop, then succeeds', async () => {
    let calls = 0;
    const baseFetch = async () => {
      calls++;
      if (calls < 3) throw prematureClose();
      return { ok: true, status: 200 };
    };
    const fetch = createLinearFetch(baseFetch, { sleepFn: noSleep });
    const res = await fetch('https://api.linear.app/graphql', { method: 'POST', body: READ_BODY });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(calls, 3);
  });

  test('exhausts retries and rethrows the last error', async () => {
    let calls = 0;
    const baseFetch = async () => { calls++; throw prematureClose(); };
    const fetch = createLinearFetch(baseFetch, { maxRetries: 2, sleepFn: noSleep });
    await assert.rejects(
      () => fetch('https://api.linear.app/graphql', { method: 'POST', body: READ_BODY }),
      /Premature close/
    );
    assert.strictEqual(calls, 3); // 1 initial + 2 retries
  });

  test('does NOT retry a mutation (no duplicate write)', async () => {
    let calls = 0;
    const baseFetch = async () => { calls++; throw prematureClose(); };
    const fetch = createLinearFetch(baseFetch, { sleepFn: noSleep });
    await assert.rejects(
      () => fetch('https://api.linear.app/graphql', { method: 'POST', body: MUTATION_BODY }),
      /Premature close/
    );
    assert.strictEqual(calls, 1);
  });

  test('does NOT retry a non-network (internal) error', async () => {
    let calls = 0;
    const baseFetch = async () => { calls++; throw new Error('schema mismatch'); };
    const fetch = createLinearFetch(baseFetch, { sleepFn: noSleep });
    await assert.rejects(
      () => fetch('https://api.linear.app/graphql', { method: 'POST', body: READ_BODY }),
      /schema mismatch/
    );
    assert.strictEqual(calls, 1);
  });

  test('succeeds on the first try without retrying', async () => {
    let calls = 0;
    const baseFetch = async () => { calls++; return { ok: true, status: 200 }; };
    const fetch = createLinearFetch(baseFetch, { sleepFn: noSleep });
    await fetch('https://api.linear.app/graphql', { method: 'POST', body: READ_BODY });
    assert.strictEqual(calls, 1);
  });

  test('a caller-initiated abort is propagated, never retried', async () => {
    const controller = new AbortController();
    let calls = 0;
    const baseFetch = async (_url, options) => {
      calls++;
      controller.abort(); // caller cancels mid-flight
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      // reflect the combined signal state the way undici would
      assert.ok(options.signal, 'signal threaded to base fetch');
      throw err;
    };
    const fetch = createLinearFetch(baseFetch, { sleepFn: noSleep });
    await assert.rejects(
      () => fetch('https://api.linear.app/graphql', { method: 'POST', body: READ_BODY, signal: controller.signal }),
      /aborted/
    );
    assert.strictEqual(calls, 1);
  });

  test('a per-attempt timeout is treated as transient and retried', async () => {
    let calls = 0;
    const baseFetch = (_url, options) => new Promise((_resolve, reject) => {
      calls++;
      // Never resolves on its own; rejects only when the timeout aborts it.
      options.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    });
    const fetch = createLinearFetch(baseFetch, { maxRetries: 1, timeoutMs: 5, sleepFn: noSleep });
    await assert.rejects(
      () => fetch('https://api.linear.app/graphql', { method: 'POST', body: READ_BODY }),
      /aborted/
    );
    assert.strictEqual(calls, 2); // 1 initial + 1 retry, both timed out
  });
});
