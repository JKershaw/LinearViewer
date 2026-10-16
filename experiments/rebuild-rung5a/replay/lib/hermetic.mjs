// Hermetic process setup shared by replay.mjs (in-process tiers) and the
// test-tier preload: pinned TZ + env, frozen clock, seeded Math.random /
// crypto.randomUUID / crypto.randomBytes, and a network tripwire.
// Import this BEFORE any LinearViewer module is loaded.

import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { createRequire, syncBuiltinESMExports } from 'node:module';

const require = createRequire(import.meta.url);
const cryptoCjs = require('node:crypto');

export const DEFAULT_NOW = '2026-10-02T12:00:00.000Z';

// Env vars the targets (or their imports) read, cleared so the host cannot leak in.
const CLEARED_PREFIXES = ['HARBOUR_', 'GITHUB_', 'DISPATCH_', 'OPENROUTER_', 'FREE_TIER_'];
export const PINNED_ENV = { TZ: 'UTC' };

export function pinEnv() {
  for (const k of Object.keys(process.env)) {
    if (CLEARED_PREFIXES.some(p => k.startsWith(p))) delete process.env[k];
  }
  Object.assign(process.env, PINNED_ENV);
  if (new Date(Date.UTC(2026, 0, 1, 0, 30)).getHours() !== 0) {
    throw new Error('TZ pin to UTC did not take effect; run with TZ=UTC');
  }
  return { ...PINNED_ENV, cleared: CLEARED_PREFIXES.map(p => p + '*') };
}

// ---------------------------------------------------------------------------
// Network tripwire. `allowLoopback` (test tier only) lets 127.0.0.1/::1/localhost
// through because route tests bind loopback servers; everything else throws.
// ---------------------------------------------------------------------------
export const networkAttempts = [];
const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|localhost|::ffff:127\.0\.0\.1)$/i;
function hostOf(args) {
  for (const a of args) {
    if (typeof a === 'string' && !/^\d+$/.test(a)) return a;
    if (a && typeof a === 'object' && (a.host || a.hostname || a.path)) return a.host || a.hostname || (a.path ? 'unix:' + a.path : null);
  }
  for (const a of args) if (Array.isArray(a) && a[0]) return hostOf(a);
  return 'localhost'; // net default
}
export function installNetworkGuard({ allowLoopback = false } = {}) {
  const realConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const h = hostOf(args);
    if (allowLoopback && (LOOPBACK.test(String(h)) || String(h).startsWith('unix:'))) return realConnect.apply(this, args);
    networkAttempts.push({ what: 'net.Socket.connect', target: String(h) });
    throw new Error(`replay network guard: connect to ${h} blocked`);
  };
  const block = (what) => function (...a) {
    networkAttempts.push({ what, target: String(hostOf(a)) });
    throw new Error(`replay network guard: ${what} blocked`);
  };
  tls.connect = block('tls.connect');
  dns.lookup = function (host, ...rest) {
    if (allowLoopback && LOOPBACK.test(String(host))) {
      const cb = rest.find(r => typeof r === 'function');
      const opts = rest.find(r => r && typeof r === 'object') || {};
      const addr = String(host).includes(':') ? '::1' : '127.0.0.1';
      const fam = addr === '::1' ? 6 : 4;
      if (opts.all) return process.nextTick(cb, null, [{ address: addr, family: fam }]);
      return process.nextTick(cb, null, addr, fam);
    }
    return block('dns.lookup')(host);
  };
  dns.resolve = block('dns.resolve');
  if (!allowLoopback) {
    http.request = http.get = block('http.request');
    https.request = https.get = block('https.request');
  } else {
    https.request = https.get = block('https.request');
  }
  const realFetch = globalThis.fetch;
  globalThis.fetch = async function guardedFetch(input, init) {
    let host = null;
    try { host = new URL(typeof input === 'string' ? input : input?.url ?? String(input)).hostname; } catch { host = String(input); }
    if (allowLoopback && LOOPBACK.test(String(host).replace(/^\[|\]$/g, ''))) return realFetch(input, init);
    networkAttempts.push({ what: 'fetch', target: String(host) });
    throw new Error(`replay network guard: fetch to ${host} blocked`);
  };
}

// ---------------------------------------------------------------------------
// Frozen clock: globalThis.Date becomes a subclass whose no-arg constructor
// and Date.now() return a fixed instant. setTimeout stays real.
// ---------------------------------------------------------------------------
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
  }
  const Wrapped = new Proxy(FrozenDate, { apply() { return new RealDate(fixed).toString(); } });
  globalThis.Date = Wrapped;
  return fixed;
}
export { RealDate };

// ---------------------------------------------------------------------------
// Seeded randomness. Math.random, crypto.randomUUID (CJS + ESM named export via
// syncBuiltinESMExports + globalThis.crypto) and sync crypto.randomBytes are
// replaced by one seeded mulberry32 stream; reseed() before each input.
// ---------------------------------------------------------------------------
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
let rng = mulberry32(1);
export const randomUse = { mathRandom: 0, randomUUID: 0, randomBytes: 0 };
const realRandomBytes = cryptoCjs.randomBytes;
function seededBytes(n) {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = Math.floor(rng() * 256);
  return b;
}
function seededUUID() {
  randomUse.randomUUID++;
  const b = seededBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function installSeededRandom(seed = 1) {
  rng = mulberry32(seed);
  Math.random = () => { randomUse.mathRandom++; return rng(); };
  cryptoCjs.randomUUID = seededUUID;
  cryptoCjs.randomBytes = function (n, cb) {
    randomUse.randomBytes++;
    if (typeof cb === 'function') return realRandomBytes(n, cb);
    return seededBytes(n);
  };
  syncBuiltinESMExports();
  if (globalThis.crypto) {
    try { Object.defineProperty(globalThis.crypto, 'randomUUID', { value: seededUUID, configurable: true, writable: true }); } catch { /* ignore */ }
  }
}
export function reseed(seed) {
  rng = mulberry32(seed);
  randomUse.mathRandom = 0; randomUse.randomUUID = 0; randomUse.randomBytes = 0;
}
export function randomSnapshot() { return { ...randomUse }; }
