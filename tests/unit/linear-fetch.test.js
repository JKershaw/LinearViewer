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
 *   - non-network (auth/internal) errors are not retried;
 *   - inside-out diagnostics fire ONLY on a terminal connection drop, with a
 *     secret-free shape (and never on success / abort / non-network errors).
 *
 * Run with: node --test tests/unit/linear-fetch.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  createLinearFetch,
  isTransientNetworkError,
  summarizeError,
  defaultDiagnostics,
} from '../../lib/linear-fetch.js';

const READ_BODY = JSON.stringify({ query: 'query { viewer { id } }' });
const MUTATION_BODY = JSON.stringify({ query: 'mutation { issueCreate { success } }' });
const URL_ = 'https://api.linear.app/graphql';

function prematureClose() {
  const err = new Error('Invalid response body ...: Premature close');
  err.name = 'FetchError';
  return err;
}

// No real delays, no real DNS, no console noise in tests.
const noSleep = () => Promise.resolve();
const silentLogger = { warn() {}, error() {} };
// Default test options: stub the diagnostic so it never touches DNS/console.
const baseOpts = (overrides = {}) => ({
  sleepFn: noSleep,
  logger: silentLogger,
  diagnostics: () => {},
  ...overrides,
});

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
    const fetch = createLinearFetch(baseFetch, baseOpts());
    const res = await fetch(URL_, { method: 'POST', body: READ_BODY });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(calls, 3);
  });

  test('exhausts retries and rethrows the last error', async () => {
    let calls = 0;
    const baseFetch = async () => { calls++; throw prematureClose(); };
    const fetch = createLinearFetch(baseFetch, baseOpts({ maxRetries: 2 }));
    await assert.rejects(
      () => fetch(URL_, { method: 'POST', body: READ_BODY }),
      /Premature close/
    );
    assert.strictEqual(calls, 3); // 1 initial + 2 retries
  });

  test('does NOT retry a mutation (no duplicate write)', async () => {
    let calls = 0;
    const baseFetch = async () => { calls++; throw prematureClose(); };
    const fetch = createLinearFetch(baseFetch, baseOpts());
    await assert.rejects(
      () => fetch(URL_, { method: 'POST', body: MUTATION_BODY }),
      /Premature close/
    );
    assert.strictEqual(calls, 1);
  });

  test('does NOT retry a non-network (internal) error', async () => {
    let calls = 0;
    const baseFetch = async () => { calls++; throw new Error('schema mismatch'); };
    const fetch = createLinearFetch(baseFetch, baseOpts());
    await assert.rejects(
      () => fetch(URL_, { method: 'POST', body: READ_BODY }),
      /schema mismatch/
    );
    assert.strictEqual(calls, 1);
  });

  test('succeeds on the first try without retrying', async () => {
    let calls = 0;
    const baseFetch = async () => { calls++; return { ok: true, status: 200 }; };
    const fetch = createLinearFetch(baseFetch, baseOpts());
    await fetch(URL_, { method: 'POST', body: READ_BODY });
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
      assert.ok(options.signal, 'signal threaded to base fetch');
      throw err;
    };
    const fetch = createLinearFetch(baseFetch, baseOpts());
    await assert.rejects(
      () => fetch(URL_, { method: 'POST', body: READ_BODY, signal: controller.signal }),
      /aborted/
    );
    assert.strictEqual(calls, 1);
  });

  test('a per-attempt timeout is treated as transient and retried', async () => {
    let calls = 0;
    const baseFetch = (_url, options) => new Promise((_resolve, reject) => {
      calls++;
      options.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    });
    const fetch = createLinearFetch(baseFetch, baseOpts({ maxRetries: 1, timeoutMs: 5 }));
    await assert.rejects(
      () => fetch(URL_, { method: 'POST', body: READ_BODY }),
      /aborted/
    );
    assert.strictEqual(calls, 2); // 1 initial + 1 retry, both timed out
  });
});

describe('terminal-drop diagnostics', () => {
  test('fire once on a terminal transient drop, with a secret-free context', async () => {
    const seen = [];
    const baseFetch = async () => { throw prematureClose(); };
    const fetch = createLinearFetch(baseFetch, baseOpts({
      maxRetries: 1,
      diagnostics: (ctx) => { seen.push(ctx); },
    }));
    await assert.rejects(
      () => fetch(URL_, { method: 'POST', body: READ_BODY, headers: { Authorization: 'lin_secret' } }),
      /Premature close/
    );
    assert.strictEqual(seen.length, 1);
    const ctx = seen[0];
    assert.strictEqual(ctx.url, URL_);
    assert.strictEqual(ctx.attempts, 2);
    assert.strictEqual(ctx.mutation, false);
    assert.strictEqual(typeof ctx.elapsedMs, 'number');
    // The diagnostic context must not carry the Authorization token anywhere.
    assert.ok(!JSON.stringify({ url: ctx.url, attempts: ctx.attempts }).includes('lin_secret'));
  });

  test('do NOT fire on success', async () => {
    let fired = 0;
    const baseFetch = async () => ({ ok: true, status: 200 });
    const fetch = createLinearFetch(baseFetch, baseOpts({ diagnostics: () => { fired++; } }));
    await fetch(URL_, { method: 'POST', body: READ_BODY });
    assert.strictEqual(fired, 0);
  });

  test('do NOT fire on a non-network error', async () => {
    let fired = 0;
    const baseFetch = async () => { throw new Error('schema mismatch'); };
    const fetch = createLinearFetch(baseFetch, baseOpts({ diagnostics: () => { fired++; } }));
    await assert.rejects(() => fetch(URL_, { method: 'POST', body: READ_BODY }), /schema mismatch/);
    assert.strictEqual(fired, 0);
  });

  test('do NOT fire on a caller-initiated abort', async () => {
    let fired = 0;
    const controller = new AbortController();
    const baseFetch = async () => {
      controller.abort();
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    };
    const fetch = createLinearFetch(baseFetch, baseOpts({ diagnostics: () => { fired++; } }));
    await assert.rejects(
      () => fetch(URL_, { method: 'POST', body: READ_BODY, signal: controller.signal }),
      /aborted/
    );
    assert.strictEqual(fired, 0);
  });

  test('fire on a terminal mutation drop (write not retried, but diagnosed)', async () => {
    let fired = 0;
    const baseFetch = async () => { throw prematureClose(); };
    const fetch = createLinearFetch(baseFetch, baseOpts({
      diagnostics: (ctx) => { fired++; assert.strictEqual(ctx.mutation, true); },
    }));
    await assert.rejects(() => fetch(URL_, { method: 'POST', body: MUTATION_BODY }), /Premature close/);
    assert.strictEqual(fired, 1);
  });

  test('diagnostics failure never masks the original error', async () => {
    const baseFetch = async () => { throw prematureClose(); };
    const fetch = createLinearFetch(baseFetch, baseOpts({
      diagnostics: () => { throw new Error('diagnostic blew up'); },
    }));
    await assert.rejects(() => fetch(URL_, { method: 'POST', body: READ_BODY }), /Premature close/);
  });
});

describe('summarizeError', () => {
  test('flattens undici nested cause, no headers/body', () => {
    const err = new Error('fetch failed');
    err.cause = { code: 'ECONNRESET', message: 'socket hang up' };
    const s = summarizeError(err, { timedOut: false });
    assert.strictEqual(s.message, 'fetch failed');
    assert.strictEqual(s.causeCode, 'ECONNRESET');
    assert.strictEqual(s.causeMessage, 'socket hang up');
    assert.strictEqual(s.timedOut, false);
  });
});

describe('defaultDiagnostics', () => {
  test('emits one structured, secret-free log line with dns + runtime', async () => {
    const lines = [];
    const logger = { error: (...args) => lines.push(args) };
    const err = prematureClose();
    await defaultDiagnostics({
      url: 'https://api.linear.app/graphql',
      error: err,
      timedOut: false,
      mutation: false,
      attempts: 3,
      elapsedMs: 1234,
      logger,
    });
    assert.strictEqual(lines.length, 1);
    const [msg, ctx] = lines[0];
    assert.match(msg, /connection diagnostics/);
    assert.strictEqual(ctx.host, 'api.linear.app');
    assert.strictEqual(ctx.attempts, 3);
    assert.ok(Array.isArray(ctx.dns));
    assert.ok(ctx.runtime.node.startsWith('v'));
    assert.ok('dnsResultOrder' in ctx.runtime);
  });
});
