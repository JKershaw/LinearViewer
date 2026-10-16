// Hermetic process/thread setup: pinned TZ + env, frozen clock, seeded
// Math.random, and a network tripwire. Import BEFORE any LinearViewer module.
// Adapted from ../../rung2/replay/lib/hermetic.mjs; loopback stays allowed
// (the capture phase runs test files that bind 127.0.0.1 servers).
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';

export const DEFAULT_NOW = '2026-10-01T12:00:00.000Z';

// Env the module (or a rebuild) could plausibly read. pipeline-loops reads
// OBSERVATION_FEED_TIMING at call time; scenarios set it per step.
const SCRUB_PREFIXES = ['OBSERVATION_', 'PIPELINE_', 'DISPATCH_', 'LOOPS_', 'READ_HORIZON', 'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy', 'MONGO', 'DEBUG'];
export const PINNED_ENV = { TZ: 'UTC', NODE_ENV: 'test' };

export function pinEnv() {
  for (const k of Object.keys(process.env)) {
    if (SCRUB_PREFIXES.some(p => k.startsWith(p))) delete process.env[k];
  }
  Object.assign(process.env, PINNED_ENV);
  if (new Date(Date.UTC(2026, 0, 1, 0, 30)).getHours() !== 0 || new Date(0).getTimezoneOffset() !== 0) {
    throw new Error('TZ pin to UTC did not take effect; run with TZ=UTC');
  }
  return { ...PINNED_ENV, scrubbed: SCRUB_PREFIXES.map(p => p + '*') };
}

const LOOPBACK = /^(127\.|::1$|localhost$|::ffff:127\.)/;
export const networkAttempts = [];
function hostOf(args) {
  for (const a of args) {
    if (typeof a === 'string' && !/^\d+$/.test(a)) return a;
    if (a && typeof a === 'object' && (a.host || a.hostname)) return a.host || a.hostname;
    if (a && typeof a === 'object' && a.path) return 'unix:' + a.path;
  }
  return null;
}
export function installNetworkGuard() {
  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const flat = Array.isArray(args[0]) ? args[0] : args;
    const host = hostOf(flat) ?? '127.0.0.1';
    if (!LOOPBACK.test(host) && !String(host).startsWith('unix:')) {
      networkAttempts.push({ what: 'net.Socket.connect', host });
      throw new Error(`replay network guard: connect to ${host} blocked`);
    }
    return origConnect.apply(this, args);
  };
  const tripIfRemote = (what, orig) => function (...args) {
    const host = hostOf(args);
    if (host && !LOOPBACK.test(host)) {
      networkAttempts.push({ what, host });
      throw new Error(`replay network guard: ${what} ${host} blocked`);
    }
    return orig.apply(this, args);
  };
  tls.connect = tripIfRemote('tls.connect', tls.connect);
  dns.lookup = tripIfRemote('dns.lookup', dns.lookup);
  dns.resolve = tripIfRemote('dns.resolve', dns.resolve);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url ?? input);
    let host = null;
    try { host = new URL(url).hostname; } catch { /* relative */ }
    if (!host || !LOOPBACK.test(host)) {
      networkAttempts.push({ what: 'fetch', host: host || url });
      throw new Error(`replay network guard: fetch ${url} blocked`);
    }
    return realFetch(input, init);
  };
  void http; void https;
}

const RealDate = globalThis.Date;
export function freezeClock(iso = DEFAULT_NOW) {
  const fixed = RealDate.parse(iso);
  if (Number.isNaN(fixed)) throw new Error(`bad --now: ${iso}`);
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
    static now() { return fixed; }
    // Dates minted by structuredClone / v8.deserialize / pre-freeze code are
    // RealDate instances; `x instanceof Date` (lib/utils/time.js toEpochMs)
    // must still be true for them, as it is in production.
    static [Symbol.hasInstance](x) { return x instanceof RealDate; }
  }
  const Wrapped = new Proxy(FrozenDate, { apply() { return new RealDate(fixed).toString(); } });
  globalThis.Date = Wrapped;
  return fixed;
}
export { RealDate };

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function seedMathRandom(seed) { Math.random = mulberry32(seed); }
