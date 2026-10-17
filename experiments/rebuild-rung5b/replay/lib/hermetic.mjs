// Hermetic process setup shared by replay.mjs and the capture preload:
// pinned TZ + env, an env-read recorder, frozen clock, seeded Math.random,
// and a network tripwire. Import this BEFORE any LinearViewer module loads.

import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';

export const DEFAULT_NOW = '2026-10-14T12:00:00.000Z'; // a Wednesday

// ---------------------------------------------------------------------------
// Environment pinning. What the cluster (and the components it calls) reads:
//   footer         -> local-time formatting of deployInfo.createdAt (TZ)
//   navbar         -> provider entryCta.isConfigured() (GITHUB_*, JIRA_*, ATLASSIAN_*)
//   settings/nav   -> isEmailSignInAvailable() (EMAIL_*, RESEND_*, NODE_ENV)
//   openrouter     -> OPENROUTER_* (free-tier model name)
// Everything under these prefixes is cleared; individual inputs may set an
// `env` overlay (e.g. EMAIL_TRANSPORT=capture + NODE_ENV=test) which applies
// identically to both versions for that one render.
// ---------------------------------------------------------------------------
export const PINNED_PREFIXES = ['GITHUB_', 'JIRA_', 'ATLASSIAN_', 'EMAIL_', 'RESEND_', 'OPENROUTER_', 'LINEAR_', 'DEPLOY_', 'RAILWAY_', 'FREE_TIER_', 'HARBOUR_'];
export const PINNED_ENV = { TZ: 'UTC', NODE_ENV: 'production' };

export function pinEnv() {
  const cleared = [];
  for (const k of Object.keys(process.env)) {
    if (PINNED_PREFIXES.some(p => k.startsWith(p))) { cleared.push(k); delete process.env[k]; }
  }
  Object.assign(process.env, PINNED_ENV);
  if (new Date(Date.UTC(2026, 0, 1, 0, 30)).getHours() !== 0 || new Date(0).getTimezoneOffset() !== 0) {
    throw new Error('TZ pin to UTC did not take effect; run with TZ=UTC in the environment');
  }
  return { ...PINNED_ENV, clearedPrefixes: PINNED_PREFIXES.map(p => p + '*'), clearedKeys: cleared.length };
}

/** Apply an env overlay for the duration of fn (null value = delete). */
export function withEnv(overlay, fn) {
  if (!overlay || !Object.keys(overlay).length) return fn();
  const saved = {};
  for (const [k, v] of Object.entries(overlay)) {
    saved[k] = Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : undefined;
    if (v === null || v === undefined) delete process.env[k]; else process.env[k] = String(v);
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

// ---------------------------------------------------------------------------
// Env-read recorder: process.env is wrapped in a Proxy whose get/has traps
// log the key into the current bucket (set by setEnvBucket). Lets the report
// say which env vars each version read while rendering.
// ---------------------------------------------------------------------------
let envBucket = null;
let envProxied = false;
export function installEnvRecorder() {
  if (envProxied) return;
  const real = process.env;
  const proxy = new Proxy(real, {
    get(t, k, r) { if (envBucket && typeof k === 'string') envBucket.add(k); return Reflect.get(t, k); },
    has(t, k) { if (envBucket && typeof k === 'string') envBucket.add(k); return Reflect.has(t, k); },
    set(t, k, v) { return Reflect.set(t, k, v); },
    deleteProperty(t, k) { return Reflect.deleteProperty(t, k); },
    ownKeys(t) { if (envBucket) envBucket.add('*ownKeys*'); return Reflect.ownKeys(t); },
    getOwnPropertyDescriptor(t, k) { return Reflect.getOwnPropertyDescriptor(t, k); }
  });
  process.env = proxy;
  envProxied = true;
}
export function setEnvBucket(set) { const prev = envBucket; envBucket = set; return prev; }

// ---------------------------------------------------------------------------
// Network tripwire: any outbound attempt throws and is counted. In capture
// mode (allowLoopback) connects to 127.0.0.1/::1/localhost/unix sockets pass,
// because some unit tests stand up an express app on loopback.
// ---------------------------------------------------------------------------
export const networkAttempts = [];
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']);
export function installNetworkGuard({ allowLoopback = false } = {}) {
  const describe = (args) => {
    const a = args[0];
    if (typeof a === 'string') return { host: a, path: a };
    if (typeof a === 'number') return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: a };
    if (Array.isArray(a)) return describe(a);
    if (a && typeof a === 'object') return { host: a.host || a.hostname, port: a.port, path: a.path };
    return {};
  };
  const isLocal = (d) => (d.path && !d.host) || (d.path && d.path.startsWith('/')) || LOOPBACK.has(String(d.host || 'localhost').replace(/^\[|\]$/g, ''));
  const wrap = (what, orig) => function (...args) {
    const d = describe(args);
    if (allowLoopback && isLocal(d)) return orig.apply(this, args);
    networkAttempts.push({ what, target: JSON.stringify(d) });
    throw new Error(`replay network guard: ${what} blocked (${JSON.stringify(d)})`);
  };
  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = wrap('net.Socket.connect', origConnect);
  const oc = net.connect;
  net.connect = net.createConnection = wrap('net.connect', oc);
  tls.connect = wrap('tls.connect', tls.connect);
  const lookup = dns.lookup;
  dns.lookup = function (host, ...rest) {
    if (allowLoopback && LOOPBACK.has(host)) return lookup.call(this, host, ...rest);
    networkAttempts.push({ what: 'dns.lookup', target: host });
    throw new Error(`replay network guard: dns.lookup ${host} blocked`);
  };
  dns.resolve = wrap('dns.resolve', dns.resolve);
  for (const [mod, name] of [[http, 'http'], [https, 'https']]) {
    const req = mod.request; const get = mod.get;
    mod.request = function (...args) {
      const a = args[0]; let host;
      if (typeof a === 'string' || a instanceof URL) host = new URL(String(a)).hostname; else host = a?.hostname || a?.host || 'localhost';
      if (allowLoopback && LOOPBACK.has(String(host).replace(/^\[|\]$/g, ''))) return req.apply(this, args);
      networkAttempts.push({ what: `${name}.request`, target: host });
      throw new Error(`replay network guard: ${name}.request ${host} blocked`);
    };
    mod.get = function (...args) { const r = mod.request(...args); r.end(); return r; };
    void get;
  }
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    let host = 'unknown';
    try { host = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url).hostname; } catch { /* ignore */ }
    if (allowLoopback && LOOPBACK.has(host.replace(/^\[|\]$/g, '')) && realFetch) return realFetch(input, init);
    networkAttempts.push({ what: 'fetch', target: host });
    throw new Error(`replay network guard: fetch ${host} blocked`);
  };
}

// ---------------------------------------------------------------------------
// Frozen clock: globalThis.Date becomes a subclass whose no-arg constructor
// and Date.now() return a fixed instant. setNow() moves it per input.
// ---------------------------------------------------------------------------
const RealDate = globalThis.Date;
let fixed = null;
export function freezeClock(iso = DEFAULT_NOW) {
  fixed = RealDate.parse(iso);
  if (Number.isNaN(fixed)) throw new Error(`bad --now: ${iso}`);
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
    static now() { return fixed; }
  }
  globalThis.Date = new Proxy(FrozenDate, { apply() { return new RealDate(fixed).toString(); } });
  return fixed;
}
export function setNow(ms) { const prev = fixed; fixed = ms; return prev; }
export function restoreClock() { globalThis.Date = RealDate; fixed = null; }
export { RealDate };

// ---------------------------------------------------------------------------
// Seeded Math.random, reset before each render so both versions see the same
// sequence (nothing in the current cluster calls it; a rewrite might).
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
