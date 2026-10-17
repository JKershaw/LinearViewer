// Router-replay plumbing (replay-kit/lib/router; from rung5c/replay/lib/common.mjs):
// seeded PRNG, canonical snapshots of recorded arguments, scenario
// materialization (pure data -> fresh objects/errors per request), and the
// recording fakes a router's deps are built from (stores, closures).
// `libs` is the per-side bag a target's loadSideLibs() returns; error kinds
// that need a lib class (team/refResolution/partialWrite/descEdit) read it
// from there (TeamNotFoundError, RefResolutionError, PartialWriteError,
// DescriptionEditError).
import crypto from 'node:crypto';

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

export const FIXED_NOW = Date.UTC(2026, 9, 1, 12, 0, 0); // 2026-10-01T12:00:00Z

export class G {
  constructor(seed) { this.r = mulberry32(seed); }
  f() { return this.r(); }
  chance(p) { return this.r() < p; }
  int(a, b) { return a + Math.floor(this.r() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.r() * arr.length)]; }
  weighted(pairs) {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let x = this.r() * total;
    for (const [v, w] of pairs) { if ((x -= w) < 0) return v; }
    return pairs[pairs.length - 1][0];
  }
  hex(n) { let s = ''; for (let i = 0; i < n; i++) s += '0123456789abcdef'[this.int(0, 15)]; return s; }
  uuid() { return `${this.hex(8)}-${this.hex(4)}-4${this.hex(3)}-a${this.hex(3)}-${this.hex(12)}`; }
}

export const STORE_TAG = Symbol.for('replay.storeName');

// ---------------------------------------------------------------------------
// Snapshotting (recorded call args) — canonical, cycle-safe, JSON-able.
// ---------------------------------------------------------------------------
export function snap(v, depth = 0, seen = new WeakSet()) {
  if (v === undefined) return { __undefined: true };
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : { __number: String(v) };
  if (typeof v === 'bigint') return { __bigint: String(v) };
  if (typeof v === 'function') return { __fn: v.name || 'anonymous' };
  if (typeof v === 'symbol') return { __symbol: String(v) };
  try { if (v[STORE_TAG]) return { __store: v[STORE_TAG] }; } catch { /* ignore */ }
  if (depth > 12) return { __deep: true };
  if (seen.has(v)) return { __cycle: true };
  seen.add(v);
  if (v instanceof Date) return { __date: Number.isFinite(v.getTime()) ? v.toISOString() : 'Invalid Date' };
  if (v instanceof Error) return { __error: v.name, message: v.message };
  if (typeof AbortSignal !== 'undefined' && v instanceof AbortSignal) return { __abortSignal: true };
  if (v && typeof v === 'object' && typeof v.pipe === 'function' && 'headers' in v && 'method' in v) return { __request: `${v.method} ${v.originalUrl || v.url}` };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) {
    return { __buffer: v.length, sha1: crypto.createHash('sha1').update(v).digest('hex').slice(0, 16) };
  }
  if (Array.isArray(v)) {
    const out = v.map(x => snap(x, depth + 1, seen));
    const extra = Object.keys(v).filter(k => !/^\d+$/.test(k));
    if (extra.length) return { __array: out, __props: Object.fromEntries(extra.map(k => [k, snap(v[k], depth + 1, seen)])) };
    return out;
  }
  if (v instanceof Map) return { __map: [...v.entries()].map(([k, x]) => [snap(k, depth + 1, seen), snap(x, depth + 1, seen)]) };
  if (v instanceof Set) return { __set: [...v].map(x => snap(x, depth + 1, seen)) };
  const out = {};
  for (const k of Object.keys(v)) out[k] = snap(v[k], depth + 1, seen);
  return out;
}

export function errSummary(err) {
  if (err === null || err === undefined || typeof err !== 'object') return { thrown: snap(err) };
  return { name: err.name, message: err.message, responseStatus: err.response?.status, status: err.status };
}

// ---------------------------------------------------------------------------
// Scenario materialization
// ---------------------------------------------------------------------------
export function buildError(e, libs) {
  let err;
  switch (e.kind) {
    case 'gql':
      err = new Error(e.message || `GraphQL Error (Code: ${e.status})`);
      err.name = 'ClientError';
      err.response = { status: e.status, errors: e.errors, headers: {} };
      return err;
    case 'statusOnly':
      err = new Error(e.message || 'upstream error');
      err.status = e.status;
      return err;
    case 'timeout':
      err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      return err;
    case 'abort':
      err = new Error('This operation was aborted');
      err.name = 'AbortError';
      return err;
    case 'network':
      err = new TypeError(e.message || 'fetch failed');
      err.cause = { code: e.code };
      return err;
    case 'team':
      return new libs.TeamNotFoundError(e.teamId, e.truncated);
    case 'notImpl':
      err = new Error(`${e.method} is not implemented by this provider`);
      err.name = 'NotImplementedError';
      return err;
    case 'refResolution':
      return new libs.RefResolutionError(e.message || 'ref did not resolve', { status: e.status ?? 422, candidates: e.candidates });
    case 'partialWrite':
      return new libs.PartialWriteError(e.message || 'partial write', {
        applied: e.applied || [], failed: e.failed, status: e.status,
        cause: e.causeMessage ? new Error(e.causeMessage) : undefined,
      });
    case 'descEdit':
      return new libs.DescriptionEditError(e.code || 'NOT_FOUND', e.message || 'span not found', e.matchCount ?? 0);
    case 'coded': // tagged store error (mintGrantBootstrap refusal codes)
      err = new Error(e.message || `coded ${e.code}`);
      if (e.code !== undefined) err.code = e.code;
      if (e.status !== undefined) err.status = e.status;
      if (e.retryable !== undefined) err.retryable = e.retryable;
      return err;
    case 'runnerRefusal':
      err = new Error(e.message || "Only this workspace's owner can act on its runner.");
      err.runnerOwnerRefusal = true;
      err.code = e.code ?? 'RUNNER_OWNER_ONLY';
      err.status = e.status ?? 403;
      err.category = e.category ?? 'auth';
      err.retryable = e.retryable ?? false;
      return err;
    case 'cause': // Error with a cause code (fetch redirect / network shapes)
      err = new Error(e.message || 'failed');
      if (e.name) err.name = e.name;
      err.cause = { code: e.code };
      return err;
    case 'tagged': // an Error carrying arbitrary own props (refusal tags, codes)
      err = new Error(e.message || 'tagged failure');
      Object.assign(err, e.props || {});
      return err;
    case 'string':
      return e.value;
    case 'null':
      return null;
    case 'plain':
    default:
      return new Error(e.message || 'boom');
  }
}

let stateGetter = null;
/** Install the per-request state reader `{__fromState: key}` resolves against. */
export function setStateGetter(fn) { stateGetter = fn; }

export function materialize(v, libs) {
  if (v === null || typeof v !== 'object') return v;
  if (v.__fromState !== undefined) return stateGetter?.()?.[v.__fromState];
  if (v.__setOf) return new Set(materialize(v.__setOf, libs));
  if (Array.isArray(v)) return v.map(x => materialize(x, libs));
  if (v.__arrayWithProps) {
    const arr = v.items.map(x => materialize(x, libs));
    Object.assign(arr, materialize(v.props, libs));
    return arr;
  }
  if (v.__err) return buildError(v.__err, libs);
  if (v.__fresh) {
    // withFreshDigests (tests/fixtures/with-fresh-digests.js): stamp each row
    // with the real digestFeedback() so the lean loop build can read it.
    return v.__fresh.map((raw) => {
      const item = materialize(raw, libs);
      if (!item || 'feedbackDigest' in item || 'feedbackVersion' in item) return item;
      const digest = libs.digestFeedback({ feedback: item.feedback, dispatchedAt: item.dispatchedAt }, { now: Date.now() });
      digest.version = 0;
      return { ...item, feedbackVersion: 0, feedbackDigest: digest };
    });
  }
  if (v.__date !== undefined) return new Date(v.__date);
  const out = {};
  for (const k of Object.keys(v)) out[k] = materialize(v[k], libs);
  return out;
}


export function newRecorder() {
  return {
    store: [], deps: [], log: [], registry: [], fetch: [], console: [], unhandled: [],
    expressErrors: [], fs: [], tty: [], timers: [], libConsole: [], serverResponse: null,
    seams: [], session: null,
  };
}

/** Behaviour for call number `n`: {ret}|{throw}|{seq:[...]}|{hang:true}|{delayMs, ret|throw}. */
export function pickBehaviour(b, n) {
  if (!b) return null;
  return Array.isArray(b.seq) ? b.seq[Math.min(n, b.seq.length - 1)] : b;
}

/**
 * Evaluate one behaviour. Async ops: `hang` never settles (only a virtual
 * timeout or the client going away ends the request), `delayMs` settles after
 * that much VIRTUAL time (lib/vclock.mjs).
 */
export function runBehaviour(b, libs, { sync = false, signal = null } = {}) {
  if (b.syncThrow) throw buildError(b.syncThrow, libs); // throws before any promise exists
  if (b.hang && !sync) {
    // never settles on its own; an AbortSignal handed to the fake (options.signal)
    // rejects it with the signal's reason, as a real fetch would
    return new Promise((_, reject) => {
      if (!signal) return;
      if (signal.aborted) return reject(signal.reason ?? abortError());
      signal.addEventListener('abort', () => reject(signal.reason ?? abortError()), { once: true });
    });
  }
  const settle = () => {
    if (b.throw) throw buildError(b.throw, libs);
    return materialize(b.ret, libs);
  };
  if (sync) return settle();
  if (b.delayMs) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { try { resolve(settle()); } catch (e) { reject(e); } }, b.delayMs);
      if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason ?? abortError()); }, { once: true });
    });
  }
  return (async () => settle())();
}

/**
 * A recording store. Every call is recorded as {store, op, args}; the answer
 * comes from the scenario (`ctx().sc.stores[name][op]`) or, failing that, from
 * `defaults[op](args, ctx())` (a plausible default computed from the
 * arguments; may itself return a behaviour via {__behaviour}). Unknown ops
 * resolve to undefined. Never thenable. `syncOps` answer synchronously.
 */
export function makeRecordingStore(name, ctx, libs, { defaults = {}, syncOps = [], hiddenProps = [] } = {}) {
  const sync = new Set(syncOps);
  const hidden = new Set(hiddenProps);
  return new Proxy({}, {
    get(_t, prop) {
      if (prop === STORE_TAG) return name;
      if (typeof prop !== 'string' || prop === 'then' || prop === 'toJSON' || hidden.has(prop)) return undefined;
      if (ctx()?.sc?.storeMissingOps?.[name]?.includes(prop)) return undefined;
      const call = (...args) => {
        const c = ctx();
        c.rec.store.push({ store: name, op: prop, args: args.map(a => snap(a)) });
        const key = `${name}.${prop}`;
        const n = c.callCounts.get(key) || 0;
        c.callCounts.set(key, n + 1);
        let b = pickBehaviour(c.sc.stores?.[name]?.[prop], n);
        if (!b && defaults[prop]) {
          const d = defaults[prop](args, c, n);
          if (d && d.__behaviour) b = d.__behaviour;
          else return sync.has(prop) ? d : Promise.resolve(d);
        }
        if (!b) return sync.has(prop) ? undefined : Promise.resolve(undefined);
        if (b.callProvisioner && typeof args[4] === 'function') {
          // addFeedback's wake-credential seam: the real store calls the
          // provisioner between building the wake and its CAS update.
          return (async () => {
            const r = await args[4](...materialize(b.callProvisioner, libs));
            c.rec.deps.push({ fn: `${name}.${prop}:provisioner`, result: snap(r) });
            return materialize(b.ret, libs);
          })();
        }
        return runBehaviour(b, libs, { sync: sync.has(prop) });
      };
      return call;
    },
    has(_t, prop) { return typeof prop === 'string' && !hidden.has(prop); },
  });
}


/** A recorded dependency function driven by `ctx.sc[key]` (behaviour) or `dflt`. */
export function recFn(getCtx, libs, fnName, key, dflt, describe = (args) => args.map(a => snap(a))) {
  return function recorded(...args) {
    const c = getCtx();
    c.rec.deps.push({ fn: fnName, args: describe(args) });
    const n = (c.callCounts.get(fnName) || 0);
    c.callCounts.set(fnName, n + 1);
    const b = pickBehaviour(c.sc[key], n) || dflt;
    return runBehaviour(b, libs);
  };
}

function abortError() { const e = new Error('This operation was aborted'); e.name = 'AbortError'; return e; }

/** The first AbortSignal among call args (directly or as `.signal` of an options object). */
export function signalIn(args) {
  for (const a of args || []) {
    if (typeof AbortSignal !== 'undefined' && a instanceof AbortSignal) return a;
    if (a && typeof a === 'object' && typeof AbortSignal !== 'undefined' && a.signal instanceof AbortSignal) return a.signal;
  }
  return null;
}
