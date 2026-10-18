/**
 * Consumer heartbeat field set and parser (LIN-1952).
 *
 * A dispatch consumer (simple-dispatcher, the runner kit, anything else) may
 * POST one of these every `intervalMs` so one GET /api/proxy/heartbeats says
 * which consumers are reporting, how loaded each host is and how many sessions
 * each runs. Harbour defines the fields here, once; consumers send only what
 * they actually measure. A field a consumer cannot supply is left out, never
 * faked (no guess, no placeholder 0).
 *
 * Privacy: the parser is an ALLOWLIST. Hostnames, usernames, paths and content
 * cannot get in: any key not named below is dropped, and each accepted value is
 * a bounded number, a pattern-checked token or a strict ISO UTC timestamp.
 *
 * `hostMemFreeBytes` is what `os.freemem()` reports. It is NOT "available"
 * memory and reads low on macOS, so it has a different name from LIN-1789's
 * `hostMemAvailableBytes` on purpose.
 *
 * This is the consumer-level channel. It is not the per-item `[working]`
 * marker line, and it does not replace last-poll tracking
 * (lib/consumer-poll-warning.js).
 */

/**
 * The field set, declared once. simple-dispatcher's builder test pins the same
 * list, so a rename on either side fails a test.
 */
export const HEARTBEAT_FIELDS = Object.freeze([
  'schema', 'consumerKind', 'instanceId', 'sentAt', 'intervalMs',
  'uptimeSec', 'platform', 'version', 'lastPollOkAt', 'pollIntervalMs',
  'loadAvg1', 'loadAvg5', 'loadAvg15', 'cpuCount',
  'hostMemFreeBytes', 'hostMemTotalBytes',
  'activeSessionCount', 'heldSessionCount'
]);

export const HEARTBEAT_SCHEMA = 1;

// `stale` is true when ageMs > 3 x intervalMs (the contract clause in
// lib/runner-kit/contract.json).
export const HEARTBEAT_STALE_FACTOR = 3;

// intervalMs bounds: `stale` scales with it, so an absurd value would make a
// beat never stale.
export const MIN_INTERVAL_MS = 1000;
export const MAX_INTERVAL_MS = 3600000;

const CONSUMER_KIND_RE = /^[a-z0-9-]{1,32}$/;
const INSTANCE_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const PRINTABLE_RE = /^[\x20-\x7E]+$/;
// Strict ISO-8601 UTC (what `toISOString()` emits). Date.parse alone is not a
// guard: V8's legacy parser tolerates free text around a date, so a path or a
// name could ride in on a "timestamp". The pattern also bounds the length.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function isIso(value) {
  return typeof value === 'string' && ISO_RE.test(value) && Number.isFinite(Date.parse(value));
}

const isNonNegFinite = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isNonNegInt = (v) => Number.isInteger(v) && v >= 0;
const shortString = (max) => (v) => typeof v === 'string' && v.length > 0 && v.length <= max && PRINTABLE_RE.test(v);

// Optional fields and their validators. A value failing its validator is
// dropped; the rest of the beat is kept.
const OPTIONAL = {
  uptimeSec: isNonNegFinite,
  platform: shortString(16),
  version: shortString(40),
  lastPollOkAt: isIso,
  pollIntervalMs: isNonNegFinite,
  loadAvg1: isNonNegFinite,
  loadAvg5: isNonNegFinite,
  loadAvg15: isNonNegFinite,
  cpuCount: isNonNegInt,
  hostMemFreeBytes: isNonNegFinite,
  hostMemTotalBytes: isNonNegFinite,
  activeSessionCount: isNonNegInt,
  heldSessionCount: isNonNegInt
};

/**
 * Parse a heartbeat body. Never throws.
 *
 * @param {*} body
 * @returns {Object|null} only allowlisted, valid fields, or null when a
 *   required field is missing or invalid.
 */
export function parseHeartbeat(body) {
  try {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
    if (body.schema !== HEARTBEAT_SCHEMA) return null;
    if (typeof body.consumerKind !== 'string' || !CONSUMER_KIND_RE.test(body.consumerKind)) return null;
    if (typeof body.instanceId !== 'string' || !INSTANCE_ID_RE.test(body.instanceId)) return null;
    if (!isIso(body.sentAt)) return null;
    const { intervalMs } = body;
    if (!Number.isInteger(intervalMs) || intervalMs < MIN_INTERVAL_MS || intervalMs > MAX_INTERVAL_MS) return null;

    const parsed = {
      schema: HEARTBEAT_SCHEMA,
      consumerKind: body.consumerKind,
      instanceId: body.instanceId,
      sentAt: body.sentAt,
      intervalMs
    };
    for (const [key, valid] of Object.entries(OPTIONAL)) {
      const value = body[key];
      if (value !== undefined && valid(value)) parsed[key] = value;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * The GET entry for one stored doc.
 *
 * @param {Object} doc - a consumer-heartbeats doc
 * @param {Date} now
 */
export function buildHeartbeatView(doc, now) {
  const receivedAt = new Date(doc.receivedAt);
  const ageMs = Math.max(0, now.getTime() - receivedAt.getTime());
  return {
    consumerKind: doc.consumerKind,
    instanceId: doc.instanceId,
    receivedAt: receivedAt.toISOString(),
    ageMs,
    stale: ageMs > HEARTBEAT_STALE_FACTOR * doc.fields.intervalMs,
    clockSkewMs: doc.clockSkewMs,
    fields: doc.fields
  };
}
