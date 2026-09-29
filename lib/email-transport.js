/**
 * Email transports for the magic-link sign-in door (LIN-1892 S2 item 2).
 *
 * `createEmailTransport({env})` switches on `resolveEmailTransportKind(env)`
 * (lib/email-availability.js), so the transport exists exactly when the
 * availability predicate is true:
 *   - `null`      → `null` (email sign-in is off; routes 503, CTAs hidden);
 *   - `'resend'`  → POST https://api.resend.com/emails through an injected
 *                   `fetch`, with an AbortSignal timeout;
 *   - `'console'` → prints the message to the server log (dev opt-in only; it
 *                   throws if constructed under NODE_ENV=production);
 *   - `'capture'` → keeps messages in `.outbox` (the test harness).
 *
 * Every transport's `send({to, subject, text, html})` resolves
 * `{ok: true}` or `{ok: false, …}` and never throws, so the send route can
 * render the same "check your inbox" page whatever happened (no enumeration).
 * Failure logs carry a status and `sha256(recipient)` only — never the
 * address, the link, the token or the API key.
 *
 * Imports only `node:crypto` and lib/email-availability.js (N6).
 */
import { createHash } from 'node:crypto';
import { resolveEmailTransportKind } from './email-availability.js';

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';
export const DEFAULT_SEND_TIMEOUT_MS = 10 * 1000;

/**
 * The only form in which a recipient address may reach a log line.
 * @param {string} to
 * @returns {string} hex SHA-256 of the trimmed, lowercased address
 */
export function hashEmailRecipient(to) {
  return createHash('sha256').update(String(to).trim().toLowerCase()).digest('hex');
}

/**
 * @param {Object} options
 * @param {string} options.apiKey
 * @param {string} options.from
 * @param {Function} [options.fetchImpl=globalThis.fetch]
 * @param {Object} [options.logger=console]
 * @param {number} [options.timeoutMs]
 */
export function createResendTransport({ apiKey, from, fetchImpl = globalThis.fetch, logger = console, timeoutMs = DEFAULT_SEND_TIMEOUT_MS }) {
  return {
    kind: 'resend',
    async send({ to, subject, text, html }) {
      let response;
      try {
        response = await fetchImpl(RESEND_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ from, to, subject, text, html }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        // The error's name only: a message can quote the request URL or body.
        logger.error(`[email] resend send failed: error=${err?.name || 'Error'} to=${hashEmailRecipient(to)}`);
        return { ok: false, error: err?.name || 'Error' };
      }
      if (!response.ok) {
        logger.error(`[email] resend send failed: status=${response.status} to=${hashEmailRecipient(to)}`);
        return { ok: false, status: response.status };
      }
      return { ok: true, status: response.status };
    },
  };
}

/**
 * Dev-only transport: prints the message (and so the sign-in link) to the
 * server log. Refuses to exist under production even when constructed
 * directly, as defence in depth behind the resolver's own refusal.
 * @param {Object} [options]
 * @param {Object} [options.env=process.env]
 * @param {Object} [options.logger=console]
 */
export function createConsoleTransport({ env = process.env, logger = console } = {}) {
  if (env.NODE_ENV === 'production') {
    throw new Error('The console email transport is refused under NODE_ENV=production: sign-in links would only reach the server log');
  }
  return {
    kind: 'console',
    async send({ to, subject, text }) {
      logger.log(`[email] (console transport, dev only) to=${to} subject=${JSON.stringify(subject)}\n${text}`);
      return { ok: true };
    },
  };
}

/**
 * Test transport: keeps every message in `.outbox`; `lastMessageTo(to)`
 * returns the newest message for an address (case-insensitive), or `null`.
 */
export function createCaptureTransport() {
  const outbox = [];
  return {
    kind: 'capture',
    outbox,
    async send(message) {
      outbox.push({ ...message, sentAt: new Date() });
      return { ok: true };
    },
    lastMessageTo(to) {
      const want = String(to).trim().toLowerCase();
      for (let i = outbox.length - 1; i >= 0; i--) {
        if (String(outbox[i].to).trim().toLowerCase() === want) return outbox[i];
      }
      return null;
    },
  };
}

/**
 * The transport this environment selects, or `null` when email sign-in is
 * off (`isEmailSignInAvailable(env) === false`).
 * @param {Object} [options]
 * @param {Object} [options.env=process.env]
 * @param {Function} [options.fetchImpl=globalThis.fetch]
 * @param {Object} [options.logger=console]
 * @param {number} [options.timeoutMs]
 */
export function createEmailTransport({ env = process.env, fetchImpl = globalThis.fetch, logger = console, timeoutMs } = {}) {
  switch (resolveEmailTransportKind(env)) {
    case 'resend':
      return createResendTransport({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, fetchImpl, logger, timeoutMs });
    case 'console':
      return createConsoleTransport({ env, logger });
    case 'capture':
      return createCaptureTransport();
    default:
      return null;
  }
}
