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
function isRetryableError(error) {
  const message = error.message || '';
  return message.includes('TLS') ||
         message.includes('CERTIFICATE_VERIFY_FAILED') ||
         message.includes('ECONNRESET') ||
         message.includes('ETIMEDOUT') ||
         message.includes('socket hang up');
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

/**
 * Create a proxy-aware fetch function if HTTP_PROXY/HTTPS_PROXY is set.
 * Returns the custom fetch, or null if no proxy is configured.
 *
 * @returns {Promise<Function|null>} A fetch-compatible function, or null
 */
export async function createProxyFetch() {
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

      const req = https.request({
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        agent,
        headers: {
          ...options.headers,
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
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

  // Wrap with retry logic for transient proxy/TLS errors
  return async function proxyFetch(url, options = {}) {
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
        if (attempt < MAX_RETRIES && isRetryableError(error)) {
          await sleep(RETRY_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  };
}
