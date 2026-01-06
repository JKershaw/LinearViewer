/**
 * Token refresh module for Linear OAuth 2.0
 * Handles access token refresh using refresh tokens
 */

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
 * @returns {Promise<{access_token: string, refresh_token: string, expires_in: number}>}
 * @throws {TokenRefreshError} If refresh fails
 */
export async function refreshAccessToken(refreshToken) {
  const clientId = process.env.LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;

  // Encode credentials for HTTP Basic Auth
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  let lastError;
  const maxRetries = 2;

  // Retry with exponential backoff for network errors
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch('https://api.linear.app/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${credentials}`
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken
        })
      });

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

      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in
      };
    } catch (error) {
      lastError = error;

      // Don't retry for expired/invalid tokens, only network errors
      if (error instanceof TokenRefreshError) {
        throw error;
      }

      // Retry with exponential backoff for network errors
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 100; // 100ms, 200ms
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
 * Checks if an access token needs to be refreshed.
 * Uses a 5-minute buffer before actual expiration to prevent edge cases.
 *
 * @param {number} expiresAt - Token expiration timestamp in milliseconds
 * @returns {boolean} True if token should be refreshed
 */
export function needsRefresh(expiresAt) {
  if (!expiresAt) {
    return false;
  }

  const now = Date.now();
  const buffer = 5 * 60 * 1000; // 5 minutes in milliseconds

  return now >= (expiresAt - buffer);
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
