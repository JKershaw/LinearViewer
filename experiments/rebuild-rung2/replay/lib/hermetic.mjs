// Hermetic process setup shared by replay.mjs and the capture preload:
// pinned TZ + env, frozen clock, seeded Math.random, and a network tripwire.
// Import this BEFORE any LinearViewer module is loaded.

import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';

export const DEFAULT_NOW = '2026-10-14T12:00:00.000Z'; // a Wednesday, mid-ISO-week

// ---------------------------------------------------------------------------
// Environment pinning. components/footer.js formats deployInfo.createdAt in
// local time; components/navbar.js reads isEmailSignInAvailable() (EMAIL_*,
// RESEND_*, NODE_ENV) and the GitHub/Jira entryCta.isConfigured() predicates
// (GITHUB_*, JIRA_*). Pin them all so a run is reproducible on any host.
// ---------------------------------------------------------------------------
const PINNED_PREFIXES = ['GITHUB_', 'JIRA_', 'EMAIL_', 'RESEND_'];
export const PINNED_ENV = { TZ: 'UTC', NODE_ENV: 'production' };

export function pinEnv() {
  for (const k of Object.keys(process.env)) {
    if (PINNED_PREFIXES.some(p => k.startsWith(p))) delete process.env[k];
  }
  Object.assign(process.env, PINNED_ENV);
  // Node re-reads TZ when process.env.TZ is assigned; verify it took.
  if (new Date(Date.UTC(2026, 0, 1, 0, 30)).getHours() !== 0 || new Date(0).getTimezoneOffset() !== 0) {
    throw new Error('TZ pin to UTC did not take effect; run with TZ=UTC in the environment');
  }
  return { ...PINNED_ENV, cleared: PINNED_PREFIXES.map(p => p + '*') };
}

// ---------------------------------------------------------------------------
// Network tripwire: any outbound attempt throws and is counted.
// ---------------------------------------------------------------------------
export const networkAttempts = [];
export function installNetworkGuard() {
  const trip = (what) => function () {
    const arg = [...arguments].find(a => typeof a === 'string' || (a && typeof a === 'object' && (a.host || a.hostname || a.port))) ;
    networkAttempts.push({ what, target: typeof arg === 'string' ? arg : JSON.stringify({ host: arg?.host || arg?.hostname, port: arg?.port }) });
    throw new Error(`replay network guard: ${what} blocked`);
  };
  net.Socket.prototype.connect = trip('net.Socket.connect');
  net.connect = net.createConnection = trip('net.connect');
  tls.connect = trip('tls.connect');
  dns.lookup = trip('dns.lookup');
  dns.resolve = trip('dns.resolve');
  http.request = http.get = trip('http.request');
  https.request = https.get = trip('https.request');
  globalThis.fetch = async (...a) => { trip('fetch')(...a); };
}

// ---------------------------------------------------------------------------
// Frozen clock: swap globalThis.Date for a subclass whose no-arg constructor
// and Date.now() return a fixed instant. Restorable.
// ---------------------------------------------------------------------------
const RealDate = globalThis.Date;
let frozenDepth = 0;
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
  // A call without `new` (Date()) returns a string in real JS; keep that shape.
  const Wrapped = new Proxy(FrozenDate, {
    apply() { return new RealDate(fixed).toString(); }
  });
  globalThis.Date = Wrapped;
  frozenDepth++;
  return fixed;
}
export function restoreClock() {
  globalThis.Date = RealDate;
  frozenDepth = 0;
}
export function clockIsFrozen() { return frozenDepth > 0; }
export { RealDate };

// ---------------------------------------------------------------------------
// Seeded Math.random, reset before each render so both versions see the same
// sequence (nothing in the current renderer uses it; a rewrite might).
// ---------------------------------------------------------------------------
const realRandom = Math.random;
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
export function restoreMathRandom() { Math.random = realRandom; }
