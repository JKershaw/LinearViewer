/**
 * Yap client — a thin server-side HTTP wrapper over Yap's plain JSON API
 * (LIN-450, V1).
 *
 * Yap (https://github.com/jkershaw/yap) is an IRC-style, ephemeral chat server:
 * a 200-message ring buffer per channel, unauthenticated nicks, optional server
 * password. LinearViewer needs no Yap-specific backend — this wrapper lets the
 * Collective routes render a channel (`poll`/`history`) and inject human input
 * (`say`) over the same shape the pipeline poll loop already uses.
 *
 * Intentionally minimal: it owns the base URL, the optional Bearer password, and
 * the JSON request plumbing, and nothing else. It is also the seam the deferred
 * recap summariser will later consume to read the buffer server-side.
 *
 * No persistence, no caching — Yap is the source of truth and the buffer is
 * ephemeral by design.
 */

const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Create a Yap client bound to one server.
 *
 * @param {Object} options
 * @param {string} options.baseUrl - Yap server base URL (e.g.
 *   "https://yap-yap.up.railway.app"). Trailing slashes are trimmed.
 * @param {string} [options.password] - Optional server password; sent as
 *   `Authorization: Bearer <password>` on every request when set.
 * @param {Function} [options.fetchImpl] - fetch implementation (injectable for
 *   tests). Defaults to the global `fetch`.
 * @param {number} [options.timeoutMs] - Per-request timeout. Defaults to 10s.
 * @returns {Object} client with join/say/poll/history methods and a `baseUrl`.
 */
export function createYapClient({ baseUrl, password = null, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!baseUrl || typeof baseUrl !== 'string') {
    throw new Error('createYapClient requires a baseUrl');
  }
  const root = baseUrl.replace(/\/+$/, '');
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new Error('createYapClient requires a fetch implementation');
  }

  /**
   * POST a JSON body to a Yap endpoint and return the parsed JSON.
   * @param {string} path - e.g. "/api/poll"
   * @param {Object} body - JSON-serialisable request body
   * @returns {Promise<Object>}
   */
  async function post(path, body) {
    const headers = { 'content-type': 'application/json' };
    if (password) headers.authorization = `Bearer ${password}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await doFetch(`${root}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body || {}),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const detail = await safeText(res);
      const err = new Error(`Yap ${path} failed: ${res.status}`);
      err.status = res.status;
      err.detail = detail;
      throw err;
    }
    return res.json();
  }

  return {
    baseUrl: root,

    /**
     * Join a channel. Returns `{ recent: Message[], cursor: number }`.
     * @param {string} channel
     * @param {string} nick
     */
    join(channel, nick) {
      return post('/api/join', { channel, nick });
    },

    /**
     * Post a message to a channel. Returns `{ id, timestamp }`.
     * @param {string} channel
     * @param {string} nick
     * @param {string} message
     * @param {string} [type] - "action" for /me-style messages
     */
    say(channel, nick, message, type) {
      const body = { channel, nick, message };
      if (type) body.type = type;
      return post('/api/say', body);
    },

    /**
     * Poll for new messages since a cursor. Returns
     * `{ messages, mentions, cursor, truncated }`.
     * @param {string} channel
     * @param {string} nick
     * @param {number} [sinceId=0]
     */
    poll(channel, nick, sinceId = 0) {
      return post('/api/poll', { channel, nick, since_id: sinceId });
    },

    /**
     * Fetch recent history for a channel. Returns `{ messages }`.
     * @param {string} channel
     * @param {string} nick
     * @param {number} [limit]
     */
    history(channel, nick, limit) {
      const body = { channel, nick };
      if (limit != null) body.limit = limit;
      return post('/api/history', body);
    },
  };
}

/**
 * Build a Yap client from environment configuration, or null when YAP_BASE_URL
 * is unset (the Collective feature then reports "not configured" rather than
 * crashing). Reads YAP_BASE_URL and the optional YAP_PASSWORD.
 *
 * @param {Object} [env=process.env]
 * @returns {Object|null} A Yap client, or null when no base URL is configured.
 */
export function yapClientFromEnv(env = process.env) {
  const baseUrl = env.YAP_BASE_URL;
  if (!baseUrl) return null;
  return createYapClient({ baseUrl, password: env.YAP_PASSWORD || null });
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/**
 * Normalise a Yap channel name to the single shared contract used across the
 * Collective page, the dispatch fan-out (participant prompt), and the
 * poll/say proxy endpoints — so all three agree on the exact join key.
 *
 * Yap channels start with `#` or `&` and otherwise allow word characters and
 * hyphens. We coerce to a leading `#`, strip disallowed characters, and cap the
 * length. Returns null for empty/unsalvageable input so callers can reject it.
 *
 * @param {string} raw
 * @returns {string|null} e.g. "#Collective", or null when nothing usable remains
 */
export function normalizeYapChannel(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const prefix = trimmed[0] === '&' ? '&' : '#';
  const body = trimmed.replace(/^[#&]+/, '').replace(/[^\w-]/g, '').slice(0, 50);
  if (!body) return null;
  return `${prefix}${body}`;
}

/**
 * Derive a valid Yap nick (1–32 word characters and hyphens) from a workspace
 * name, so each participant posts under a legible, distinct identity. Falls back
 * to a stable default when the name yields nothing usable.
 *
 * @param {string} name - Workspace name
 * @param {string} [fallback='agent'] - Used when the slug is empty
 * @returns {string}
 */
export function nickFromWorkspaceName(name, fallback = 'agent') {
  const slug = String(name || '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\w-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug || fallback;
}
