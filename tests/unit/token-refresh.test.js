/**
 * Unit tests for lib/token-refresh.js
 *
 * Run with: node --test tests/unit/token-refresh.test.js
 */
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  refreshAccessToken,
  calculateExpiresAt,
  TokenRefreshError
} from '../../lib/token-refresh.js';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a mock fetch function that returns specified response
 */
function createMockFetch(response, options = {}) {
  const { ok = true, status = 200, delay = 0, shouldAbort = false } = options;

  return mock.fn(async (url, fetchOptions) => {
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Check if request was aborted
    if (shouldAbort || fetchOptions?.signal?.aborted) {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    }

    return {
      ok,
      status,
      json: async () => response
    };
  });
}

/**
 * Store original env vars and fetch for restoration
 */
let originalEnv;
let originalFetch;

// =============================================================================
// calculateExpiresAt Tests
// =============================================================================

describe('calculateExpiresAt', () => {
  test('calculates correct expiry timestamp', () => {
    const before = Date.now();
    const expiresAt = calculateExpiresAt(3600);
    const after = Date.now();

    // Should be within 1 second of expected (3600 * 1000 ms from now)
    assert.ok(expiresAt >= before + 3600 * 1000);
    assert.ok(expiresAt <= after + 3600 * 1000);
  });

  test('handles zero seconds', () => {
    const before = Date.now();
    const expiresAt = calculateExpiresAt(0);
    const after = Date.now();

    assert.ok(expiresAt >= before);
    assert.ok(expiresAt <= after);
  });

  test('handles large values', () => {
    const days30 = 86400 * 30;
    const before = Date.now();
    const expiresAt = calculateExpiresAt(days30);

    assert.ok(expiresAt >= before + days30 * 1000);
  });
});

// =============================================================================
// TokenRefreshError Tests
// =============================================================================

describe('TokenRefreshError', () => {
  test('creates error with message and code', () => {
    const error = new TokenRefreshError('Test message', 'TEST_CODE');

    assert.strictEqual(error.message, 'Test message');
    assert.strictEqual(error.code, 'TEST_CODE');
    assert.strictEqual(error.name, 'TokenRefreshError');
  });

  test('is instance of Error', () => {
    const error = new TokenRefreshError('Test', 'CODE');
    assert.ok(error instanceof Error);
  });
});

// =============================================================================
// refreshAccessToken Tests
// =============================================================================

describe('refreshAccessToken', () => {
  beforeEach(() => {
    // Store original env and fetch
    originalEnv = { ...process.env };
    originalFetch = global.fetch;

    // Set required env vars
    process.env.LINEAR_CLIENT_ID = 'test-client-id';
    process.env.LINEAR_CLIENT_SECRET = 'test-client-secret';
  });

  afterEach(() => {
    // Restore original env and fetch
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  test('throws TokenRefreshError for null refresh token', async () => {
    await assert.rejects(
      () => refreshAccessToken(null),
      (error) => {
        assert.ok(error instanceof TokenRefreshError);
        assert.strictEqual(error.code, 'INVALID');
        assert.ok(error.message.includes('Invalid refresh token'));
        return true;
      }
    );
  });

  test('throws TokenRefreshError for undefined refresh token', async () => {
    await assert.rejects(
      () => refreshAccessToken(undefined),
      (error) => {
        assert.ok(error instanceof TokenRefreshError);
        assert.strictEqual(error.code, 'INVALID');
        return true;
      }
    );
  });

  test('throws TokenRefreshError for non-string refresh token', async () => {
    await assert.rejects(
      () => refreshAccessToken(12345),
      (error) => {
        assert.ok(error instanceof TokenRefreshError);
        assert.strictEqual(error.code, 'INVALID');
        return true;
      }
    );
  });

  test('throws TokenRefreshError when LINEAR_CLIENT_ID is missing', async () => {
    delete process.env.LINEAR_CLIENT_ID;

    await assert.rejects(
      () => refreshAccessToken('valid-token'),
      (error) => {
        assert.ok(error instanceof TokenRefreshError);
        assert.strictEqual(error.code, 'INVALID');
        assert.ok(error.message.includes('LINEAR_CLIENT_ID'));
        return true;
      }
    );
  });

  test('throws TokenRefreshError when LINEAR_CLIENT_SECRET is missing', async () => {
    delete process.env.LINEAR_CLIENT_SECRET;

    await assert.rejects(
      () => refreshAccessToken('valid-token'),
      (error) => {
        assert.ok(error instanceof TokenRefreshError);
        assert.strictEqual(error.code, 'INVALID');
        assert.ok(error.message.includes('LINEAR_CLIENT_SECRET'));
        return true;
      }
    );
  });

  test('returns token data on successful refresh', async () => {
    const mockResponse = {
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600
    };

    global.fetch = createMockFetch(mockResponse);

    const result = await refreshAccessToken('valid-refresh-token');

    assert.strictEqual(result.access_token, 'new-access-token');
    assert.strictEqual(result.refresh_token, 'new-refresh-token');
    assert.strictEqual(result.expires_in, 3600);
  });

  test('sends correct request format', async () => {
    const mockResponse = {
      access_token: 'token',
      refresh_token: 'refresh',
      expires_in: 3600
    };

    const mockFetch = createMockFetch(mockResponse);
    global.fetch = mockFetch;

    await refreshAccessToken('my-refresh-token');

    // Verify fetch was called with correct arguments
    assert.strictEqual(mockFetch.mock.calls.length, 1);
    const [url, options] = mockFetch.mock.calls[0].arguments;

    assert.strictEqual(url, 'https://api.linear.app/oauth/token');
    assert.strictEqual(options.method, 'POST');
    assert.strictEqual(options.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.ok(options.headers.Authorization.startsWith('Basic '));

    // Verify body contains correct parameters
    const body = options.body.toString();
    assert.ok(body.includes('grant_type=refresh_token'));
    assert.ok(body.includes('refresh_token=my-refresh-token'));
  });

  test('throws TokenRefreshError with EXPIRED code for invalid_grant', async () => {
    const mockResponse = { error: 'invalid_grant' };
    global.fetch = createMockFetch(mockResponse, { ok: false, status: 400 });

    await assert.rejects(
      () => refreshAccessToken('expired-token'),
      (error) => {
        assert.ok(error instanceof TokenRefreshError);
        assert.strictEqual(error.code, 'EXPIRED');
        assert.ok(error.message.includes('expired or invalid'));
        return true;
      }
    );
  });

  test('throws TokenRefreshError with INVALID code for other OAuth errors', async () => {
    const mockResponse = { error: 'invalid_client' };
    global.fetch = createMockFetch(mockResponse, { ok: false, status: 401 });

    await assert.rejects(
      () => refreshAccessToken('valid-token'),
      (error) => {
        assert.ok(error instanceof TokenRefreshError);
        assert.strictEqual(error.code, 'INVALID');
        assert.ok(error.message.includes('invalid_client'));
        return true;
      }
    );
  });

  test('throws TokenRefreshError for missing access_token in response', async () => {
    const mockResponse = {
      refresh_token: 'token',
      expires_in: 3600
      // missing access_token
    };
    global.fetch = createMockFetch(mockResponse);

    await assert.rejects(
      () => refreshAccessToken('valid-token'),
      (error) => {
        assert.ok(error instanceof TokenRefreshError);
        assert.strictEqual(error.code, 'INVALID');
        assert.ok(error.message.includes('missing required fields'));
        return true;
      }
    );
  });

  test('throws TokenRefreshError for missing refresh_token in response', async () => {
    const mockResponse = {
      access_token: 'token',
      expires_in: 3600
      // missing refresh_token
    };
    global.fetch = createMockFetch(mockResponse);

    await assert.rejects(
      () => refreshAccessToken('valid-token'),
      (error) => {
        assert.ok(error instanceof TokenRefreshError);
        assert.strictEqual(error.code, 'INVALID');
        return true;
      }
    );
  });

  test('throws TokenRefreshError for missing expires_in in response', async () => {
    const mockResponse = {
      access_token: 'token',
      refresh_token: 'refresh'
      // missing expires_in
    };
    global.fetch = createMockFetch(mockResponse);

    await assert.rejects(
      () => refreshAccessToken('valid-token'),
      (error) => {
        assert.ok(error instanceof TokenRefreshError);
        assert.strictEqual(error.code, 'INVALID');
        return true;
      }
    );
  });

  test('retries on network error and succeeds', async () => {
    let attempts = 0;
    const mockResponse = {
      access_token: 'token',
      refresh_token: 'refresh',
      expires_in: 3600
    };

    global.fetch = mock.fn(async () => {
      attempts++;
      if (attempts < 2) {
        throw new Error('Network error');
      }
      return {
        ok: true,
        json: async () => mockResponse
      };
    });

    const result = await refreshAccessToken('valid-token');

    assert.strictEqual(result.access_token, 'token');
    assert.strictEqual(attempts, 2);
  });

  test('throws TokenRefreshError with NETWORK code after max retries', async () => {
    global.fetch = mock.fn(async () => {
      throw new Error('Connection refused');
    });

    await assert.rejects(
      () => refreshAccessToken('valid-token'),
      (error) => {
        assert.ok(error instanceof TokenRefreshError);
        assert.strictEqual(error.code, 'NETWORK');
        assert.ok(error.message.includes('Network error'));
        assert.ok(error.message.includes('Connection refused'));
        return true;
      }
    );

    // Should have tried 3 times (initial + 2 retries)
    assert.strictEqual(global.fetch.mock.calls.length, 3);
  });

  test('does not retry for TokenRefreshError (expired token)', async () => {
    const mockResponse = { error: 'invalid_grant' };
    global.fetch = createMockFetch(mockResponse, { ok: false, status: 400 });

    await assert.rejects(
      () => refreshAccessToken('expired-token'),
      TokenRefreshError
    );

    // Should only have tried once - no retry for auth errors
    assert.strictEqual(global.fetch.mock.calls.length, 1);
  });
});
