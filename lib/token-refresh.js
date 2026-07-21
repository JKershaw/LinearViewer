/**
 * Token refresh module for Linear OAuth 2.0
 * Handles access token refresh using refresh tokens
 */

// Constants. Exported so lib/workspace-token-cache.js can derive its
// eviction tombstone window from the real worst-case refresh duration
// instead of a hand-picked estimate that can silently drift from these.
export const TOKEN_REFRESH_TIMEOUT_MS = 10000; // 10 seconds
export const TOKEN_REFRESH_MAX_RETRIES = 2;
export const TOKEN_REFRESH_RETRY_DELAY_MS = 100; // Base delay for exponential backoff

/**
 * Custom error class for token refresh failures
 */
export class TokenRefreshError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'TokenRefreshError';
    this.code = code; // 'EXPIRED', 'NETWORK', 'INVALID', 'UNKNOWN'
  }
}

/**
 * Refreshes an access token using a refresh token.
 * Uses HTTP Basic Authentication with client credentials.
 *
 * @param {string} refreshToken - The refresh token from Linear
 * @param {Object} [options]
 * @param {Function} [options.fetchImpl] - fetch implementation to use instead of
 *   the global `fetch` (LIN-1373). Defaults to global `fetch` when omitted, so
 *   every existing caller is byte-identical; the seam exists solely so a
 *   real-refresh integration test can drive this exact code path against a
 *   controllable token endpoint instead of stubbing the function itself.
 * @param {string} [options.tokenUrl] - token endpoint URL to use instead of
 *   Linear's, for the same reason. Defaults to the real Linear endpoint.
 * @returns {Promise<{access_token: string, refresh_token: string, expires_in: number}>}
 * @throws {TokenRefreshError} If refresh fails
 */
export async function refreshAccessToken(refreshToken, { fetchImpl = fetch, tokenUrl = 'https://api.linear.app/oauth/token' } = {}) {
  // Validate refresh token
  if (!refreshToken || typeof refreshToken !== 'string') {
    throw new TokenRefreshError('Invalid refresh token', 'INVALID');
  }

  // Validate environment variables
  const clientId = process.env.LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new TokenRefreshError(
      'Missing LINEAR_CLIENT_ID or LINEAR_CLIENT_SECRET environment variables',
      'INVALID'
    );
  }

  // Encode credentials for HTTP Basic Auth
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  let lastError;
  const maxRetries = TOKEN_REFRESH_MAX_RETRIES;

  // Retry with exponential backoff for network errors
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TOKEN_REFRESH_TIMEOUT_MS);

    try {
      const response = await fetchImpl(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${credentials}`
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const data = await response.json();

      if (!response.ok) {
        // Handle specific OAuth errors
        if (data.error === 'invalid_grant') {
          throw new TokenRefreshError(
            'Refresh token expired or invalid',
            'EXPIRED'
          );
        }
        throw new TokenRefreshError(
          `Token refresh failed: ${data.error || 'Unknown error'}`,
          'INVALID'
        );
      }

      // Validate response has required fields
      if (!data.access_token || !data.refresh_token || !data.expires_in) {
        throw new TokenRefreshError(
          'Invalid token response: missing required fields',
          'INVALID'
        );
      }

      // Log the scope Linear returned. If a refresh ever issues a token
      // without 'write' the proxy will continue to serve reads but mutations
      // will start failing — surface that loudly so it's easy to spot in logs.
      const scopeStr = Array.isArray(data.scope) ? data.scope.join(' ') : (data.scope || '');
      if (data.scope === undefined) {
        console.warn('Token refresh response missing scope field');
      } else if (!/\bwrite\b/.test(scopeStr)) {
        console.warn(`Token refresh response missing 'write' scope: ${JSON.stringify(data.scope)}`);
      } else {
        console.log(`Token refresh OK; scope=${JSON.stringify(data.scope)}`);
      }

      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in
      };
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;

      // Handle timeout errors
      if (error.name === 'AbortError') {
        lastError = new Error(`Request timeout after ${TOKEN_REFRESH_TIMEOUT_MS}ms`);
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * TOKEN_REFRESH_RETRY_DELAY_MS;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }

      // Don't retry for expired/invalid tokens, only network errors
      if (error instanceof TokenRefreshError) {
        throw error;
      }

      // Retry with exponential backoff for network errors
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * TOKEN_REFRESH_RETRY_DELAY_MS;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }
  }

  // All retries exhausted
  throw new TokenRefreshError(
    `Network error after ${maxRetries + 1} attempts: ${lastError.message}`,
    'NETWORK'
  );
}

/**
 * Calculates the expiration timestamp from expires_in seconds.
 *
 * @param {number} expiresIn - Seconds until token expiration
 * @returns {number} Unix timestamp in milliseconds when token expires
 */
export function calculateExpiresAt(expiresIn) {
  return Date.now() + (expiresIn * 1000);
}
