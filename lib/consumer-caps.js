/**
 * Consumer capability advertisement (LIN-3436, slice H0 of LIN-3358).
 *
 * A poller states what it understands in the `X-Harbour-Consumer-Caps` request
 * header: a comma-separated list of lowercase tokens (today only `if-parked`).
 * An old consumer never sends the header, which IS the contract: absent means
 * "none".
 *
 * Two readers, one vocabulary:
 *  - the DELIVERY gate (`pollAvailable(urlKey, { caps })`) serves a capability-
 *    gated row only to a poller that advertised it, so a consumer swap while a
 *    row is queued cannot hand an `ifParked` abort to a consumer that would run
 *    it as a plain abort;
 *  - the ENQUEUE side asks `workspaceConsumerAdvertises(urlKey, cap)`, which
 *    reads the caps the workspace's most recent poller advertised.
 *
 * The record sits beside `consumerLastSeenAt` (lib/consumer-poll-warning.js) in
 * spirit — last poller wins, per workspace — but is process-local: it is only
 * ever a hint for the enqueue side and fails CLOSED (unknown ⇒ not advertised ⇒
 * today's behaviour). The delivery gate does not read it; it reads the poll's
 * own header, so a restart or a second instance cannot misdeliver.
 */

export const CAP_IF_PARKED = 'if-parked';
export const CONSUMER_CAPS_HEADER = 'x-harbour-consumer-caps';

const MAX_CAPS = 16;
const MAX_CAP_LENGTH = 32;
const CAP_TOKEN = /^[a-z0-9][a-z0-9-]*$/;

const lastAdvertised = new Map();

/**
 * Parse the header value into a de-duplicated array of capability tokens.
 * Unknown tokens are kept (forward compatible); malformed ones are dropped.
 *
 * @param {string|string[]|undefined} headerValue
 * @returns {string[]}
 */
export function parseConsumerCaps(headerValue) {
  const raw = Array.isArray(headerValue) ? headerValue.join(',') : headerValue;
  if (typeof raw !== 'string' || raw === '') return [];
  const caps = [];
  for (const part of raw.split(',')) {
    const token = part.trim().toLowerCase();
    if (!token || token.length > MAX_CAP_LENGTH || !CAP_TOKEN.test(token)) continue;
    if (!caps.includes(token)) caps.push(token);
    if (caps.length >= MAX_CAPS) break;
  }
  return caps;
}

/**
 * Record what a workspace's latest poller advertised (an empty list when it sent
 * none — an old consumer taking over must clear a newer one's claim).
 */
export function recordConsumerCaps(urlKey, caps, now = new Date()) {
  if (!urlKey) return;
  lastAdvertised.set(urlKey, { caps: Array.isArray(caps) ? [...caps] : [], at: now.toISOString() });
}

/** The last advertised record for a workspace, or null if never polled (this process). */
export function getConsumerCaps(urlKey) {
  const rec = lastAdvertised.get(urlKey);
  return rec ? { caps: [...rec.caps], at: rec.at } : null;
}

/**
 * Whether the workspace's most recent poller advertised `cap`. Unknown ⇒ false.
 *
 * @param {string} urlKey
 * @param {string} [cap]
 * @returns {boolean}
 */
export function workspaceConsumerAdvertises(urlKey, cap = CAP_IF_PARKED) {
  const rec = lastAdvertised.get(urlKey);
  return !!rec && rec.caps.includes(cap);
}

/** Test seam. */
export function _resetConsumerCapsForTests() {
  lastAdvertised.clear();
}
