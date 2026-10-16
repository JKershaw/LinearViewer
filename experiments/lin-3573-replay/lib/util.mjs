// Small shared helpers: seeded PRNG, controllable clock, argument sanitiser.
import crypto from 'node:crypto';

/** mulberry32: small seeded PRNG, returns () => [0,1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const START_MS = Date.UTC(2026, 9, 16, 10, 0, 0);

/**
 * Install a Date whose "now" is a settable clock. MUST run before any repo module
 * is imported: `createDedupeCache({ now = Date.now })` captures the function at
 * construction, so the composer's singletons only see the fake clock if it is already
 * installed when routes/proxy.js is evaluated.
 */
export function installClock() {
  const RealDate = Date;
  const clock = { t: START_MS, RealDate };
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(clock.t); else super(...a); }
    static now() { return clock.t; }
  }
  globalThis.Date = FakeDate;
  return clock;
}

/** JSON-safe, order-stable deep copy of call arguments for recording and comparison. */
export function sanitize(v, depth = 0) {
  if (v === undefined) return { __undefined: true };
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'bigint') return String(v);
  if (typeof v === 'function') return '[fn]';
  if (Buffer.isBuffer(v)) return { __buffer: v.length, sha: crypto.createHash('sha256').update(v).digest('hex').slice(0, 16) };
  if (v instanceof Date) return { __date: v.toISOString() };
  if (v instanceof Error) return { __error: v.name, message: v.message };
  if (depth > 8) return '[deep]';
  if (Array.isArray(v)) return v.map(x => sanitize(x, depth + 1));
  const out = {};
  for (const k of Object.keys(v).sort()) out[k] = sanitize(v[k], depth + 1);
  return out;
}

export function stableStringify(v) {
  return JSON.stringify(sanitize(v));
}
