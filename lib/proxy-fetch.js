/**
 * Proxy-aware fetch for environments behind an HTTP proxy.
 *
 * graphql-request's default fetch doesn't respect HTTP_PROXY/HTTPS_PROXY
 * env vars. This module detects proxy configuration and returns a
 * fetch-compatible function that routes requests through the proxy.
 *
 * Includes retry logic for transient TLS/connection errors that are
 * common when routing through corporate proxies.
 */
import https from 'https';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable (transient TLS/connection issues through proxy)
 */
export function isRetryableError(error) {
  const message = error.message || '';
  return message.includes('TLS') ||
         message.includes('CERTIFICATE_VERIFY_FAILED') ||
         message.includes('ECONNRESET') ||
         message.includes('ETIMEDOUT') ||
         message.includes('socket hang up');
}

/**
 * Detect whether a request body carries a GraphQL mutation.
 *
 * graphql-request POSTs both queries and mutations, so the HTTP method alone
 * can't tell them apart — we inspect the serialized `{ query, variables }`
 * body. A mutation is NOT safe to replay on a post-send transport error
 * (ECONNRESET / socket hang up): the write may have already committed
 * upstream, so a blind retry mints a duplicate (LIN-399). Reads are
 * idempotent and stay retryable. On any parse ambiguity we return false
 * (treat as retryable) so read resilience is preserved.
 */
export function isGraphQLMutation(options = {}) {
  try {
    const body = options.body;
    if (!body || typeof body !== 'string') return false;
    const query = JSON.parse(body).query;
    return typeof query === 'string' && /^\s*mutation\b/.test(query);
  } catch {
    return false;
  }
}

/**
 * Build a Headers-like object from Node's http.IncomingMessage headers.
 * graphql-request expects .get(name) and .forEach(callback).
 */
function buildHeaders(rawHeaders) {
  return {
    get(name) {
      return rawHeaders[name.toLowerCase()];
    },
    forEach(callback) {
      for (const [key, value] of Object.entries(rawHeaders)) {
        callback(value, key);
      }
    }
  };
}

// Transport override hook (LIN-1848). Same decoupling-via-module-hook pattern as
// lib/openrouter.js's setFetchImpl/resolveOpenRouterFetch: tests can substitute
// the transport at its source so every consumer (routes/proxy.js's attachment
// relay, lib/yap-client.js) inherits it without duplicating selection logic. A
// truthy return here already means "use this" to both existing consumers, so no
// call-site change is needed. Default is null, so production behavior (proxy
// detection from HTTP(S)_PROXY, or null when unset) is unchanged when no
// override is set.
let _fetchImplOverride = null;

/**
 * Register a function to use as the proxy-fetch transport, overriding the
 * proxy-detection logic below. Pass null to clear.
 * @param {Function|null} fn
 */
export function setProxyFetchImpl(fn) {
  _fetchImplOverride = typeof fn === 'function' ? fn : null;
}

/**
 * Create a proxy-aware fetch function if HTTP_PROXY/HTTPS_PROXY is set.
 * Returns the custom fetch, or null if no proxy is configured.
 *
 * @returns {Promise<Function|null>} A fetch-compatible function, or null
 */
export async function createProxyFetch() {
  if (_fetchImplOverride) return _fetchImplOverride;

  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
    || process.env.https_proxy || process.env.http_proxy;

  if (!proxyUrl) return null;

  const { HttpsProxyAgent } = await import('https-proxy-agent');
  const agent = new HttpsProxyAgent(proxyUrl);

  // Single request attempt using Node's https module with the proxy agent
  function singleFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const postData = options.body || '';

      const reqOptions = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        agent,
        headers: {
          ...options.headers,
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      // Forward AbortSignal so callers can enforce request timeouts.
      // Node's https.request supports `signal` since v15.
      if (options.signal) {
        reqOptions.signal = options.signal;
      }

      const req = https.request(reqOptions, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: buildHeaders(res.headers),
            json: () => Promise.resolve(JSON.parse(buffer.toString('utf8'))),
            text: () => Promise.resolve(buffer.toString('utf8')),
            arrayBuffer: () => Promise.resolve(buffer.buffer.slice(
              buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
          });
        });
      });

      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });
  }

  // Wrap with retry logic for transient proxy/TLS errors.
  //
  // Mutations are never replayed on a *post-send* error (the generic catch
  // below): once the request body has been written, an ECONNRESET / socket
  // hang up can mean the write committed upstream but the response was lost,
  // and replaying it mints a duplicate (LIN-399). The 503-with-TLS branch is
  // different — that is the egress proxy reporting it could not complete the
  // TLS handshake to Linear, so the request never reached the API and no write
  // occurred; retrying there is safe even for mutations.
  return async function proxyFetch(url, options = {}) {
    const mutation = isGraphQLMutation(options);
    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await singleFetch(url, options);

        // Check for 503 responses that contain TLS errors (proxy returns these as HTTP responses)
        if (response.status === 503) {
          const body = await response.text();
          if (body.includes('TLS') || body.includes('CERTIFICATE_VERIFY_FAILED')) {
            if (attempt < MAX_RETRIES) {
              await sleep(RETRY_DELAY_MS * Math.pow(2, attempt));
              continue;
            }
            return {
              ok: false,
              status: 503,
              headers: response.headers,
              json: () => Promise.resolve(JSON.parse(body)),
              text: () => Promise.resolve(body)
            };
          }
        }

        return response;
      } catch (error) {
        lastError = error;
        if (attempt < MAX_RETRIES && isRetryableError(error) && !mutation) {
          await sleep(RETRY_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  };
}
