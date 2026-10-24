// Virtual clock + virtual timers.
//
// While a request is in flight (`begin(base)` … `end()`), `Date.now()` /
// `new Date()` read a virtual clock that starts at the scenario's `clockBase`,
// and the GLOBAL `setTimeout`/`setInterval`/`clear*` create virtual timers.
// Nothing fires on its own: `pumpUntil(done)` waits for the event loop to go
// quiet (a few real setImmediate turns, so every microtask and fake store
// settlement has run, then more turns until no setImmediate callback is still
// queued: LIN-3851), then fires the earliest-due virtual timer, advancing the
// clock to its due time. A 1500 ms long-poll re-check, the keepalive's 25 s
// flush and 15 s heartbeats, the poll-halt read timeout and the factory's
// valueWithin fallbacks therefore all run in a deterministic order, in no real
// time, identically on both sides.
//
// Outside a request the real timers are used untouched (express-rate-limit's
// cleanup interval is created at import time and stays real). Node's own
// http/socket timers do not go through the globals and are unaffected.
const RealDate = globalThis.Date;
const real = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  setImmediate: globalThis.setImmediate,
};

const state = { active: false, now: RealDate.now(), seq: 0, timers: new Map(), fired: 0, maxFirings: 2000, log: null };

class VirtualTimer {
  constructor(id) { this.__virtual = true; this.id = id; }
  ref() { return this; }
  unref() { return this; }
  hasRef() { return true; }
  refresh() { const t = state.timers.get(this.id); if (t) t.due = state.now + t.ms; return this; }
  close() { state.timers.delete(this.id); return this; }
  [Symbol.toPrimitive]() { return this.id; }
}

function add(fn, ms, args, interval) {
  const id = ++state.seq;
  const delay = Math.max(1, Number(ms) || 0);
  state.timers.set(id, { id, due: state.now + delay, ms: delay, fn, args, interval });
  state.log?.push({ op: interval ? 'setInterval' : 'setTimeout', ms: Number(ms) || 0, at: state.now });
  return new VirtualTimer(id);
}
function clear(h) {
  if (h && h.__virtual) { if (state.timers.delete(h.id)) state.log?.push({ op: 'clear', at: state.now }); return; }
  if (typeof h === 'number' && state.timers.has(h)) { state.timers.delete(h); return; }
  real.clearTimeout(h);
}

export function install() {
  class VDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(state.now); else super(...a); }
    static now() { return state.now; }
  }
  globalThis.Date = VDate;
  globalThis.setTimeout = function setTimeout(fn, ms, ...args) { return state.active ? add(fn, ms, args, false) : real.setTimeout(fn, ms, ...args); };
  globalThis.setInterval = function setInterval(fn, ms, ...args) { return state.active ? add(fn, ms, args, true) : real.setInterval(fn, ms, ...args); };
  globalThis.clearTimeout = function clearTimeout(h) { return clear(h); };
  globalThis.clearInterval = function clearInterval(h) { return clear(h); };
  // AbortSignal.timeout uses Node's internal timers; on virtual time it is a
  // virtual timer too (same TimeoutError reason), so a 45 s fetch bound fires
  // in due order instead of never (or after the real replay timeout).
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  AbortSignal.timeout = function timeout(ms) {
    if (!state.active) return realTimeout(ms);
    const c = new AbortController();
    add(() => c.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')), ms, [], false);
    return c.signal;
  };
  return { RealDate, real };
}

export function setIdleNow(ms) { if (!state.active) state.now = ms; }

/** Start a request's virtual time at `base`; timer activity is logged into `log`. */
export function begin(base, log) {
  state.active = true;
  state.now = base;
  state.timers = new Map();
  state.fired = 0;
  state.log = log;
}

/** Stop virtual time; returns the timers left pending (never fired). */
export function end() {
  const pending = [...state.timers.values()].map(t => ({ ms: t.ms, interval: t.interval, dueIn: t.due - state.now }));
  state.active = false;
  state.timers = new Map();
  state.log = null;
  return pending;
}

export function now() { return state.now; }

const immediate = () => new Promise(r => real.setImmediate(r));

// LIN-3851: setImmediate is not virtualised, so "quiet" is read from the loop:
// after the minimum turns, keep yielding while a ref'd Immediate is still
// queued (a callback chain that re-queues itself). A chain that never ends is
// cut off at MAX_QUIET_TURNS so the pump cannot spin forever.
const MIN_QUIET_TURNS = 3;
const MAX_QUIET_TURNS = 10_000;
const immediatesQueued = () => process.getActiveResourcesInfo().includes('Immediate');
async function untilQuiet() {
  for (let k = 0; k < MIN_QUIET_TURNS; k++) await immediate();
  for (let k = MIN_QUIET_TURNS; k < MAX_QUIET_TURNS && immediatesQueued(); k++) await immediate();
}

/**
 * Fire virtual timers in due order whenever the loop is quiet, until `done()`.
 * When no timer is pending the pump just yields (real I/O is in flight).
 */
export async function pumpUntil(done, canFire = () => true) {
  for (;;) {
    await untilQuiet();
    if (done()) return;
    if (state.timers.size === 0 || state.fired >= state.maxFirings || !canFire()) {
      await new Promise(r => real.setTimeout(r, 1));
      continue;
    }
    let next = null;
    for (const t of state.timers.values()) if (!next || t.due < next.due || (t.due === next.due && t.id < next.id)) next = t;
    const fireAt = next.due;
    if (next.interval) next.due += next.ms; else state.timers.delete(next.id);
    state.now = Math.max(state.now, fireAt);
    state.fired++;
    state.log?.push({ op: 'fire', ms: next.ms, at: state.now });
    try { next.fn(...(next.args || [])); } catch (e) { process.emit('uncaughtException', e); }
  }
}

/**
 * After the client is gone/answered, let the server-side handler finish on
 * virtual time: keep firing timers due within `horizonMs` of now (a long-poll
 * whose client hung up still runs to its deadline, logs and replies).
 */
export async function drain(horizonMs = 120_000) {
  const limit = state.now + horizonMs;
  for (;;) {
    await untilQuiet();
    let next = null;
    for (const t of state.timers.values()) if (!next || t.due < next.due || (t.due === next.due && t.id < next.id)) next = t;
    if (!next || next.due > limit || state.fired >= state.maxFirings) return;
    const fireAt = next.due;
    if (next.interval) next.due += next.ms; else state.timers.delete(next.id);
    state.now = Math.max(state.now, fireAt);
    state.fired++;
    state.log?.push({ op: 'fire', ms: next.ms, at: state.now, after: true });
    try { next.fn(...(next.args || [])); } catch (e) { process.emit('uncaughtException', e); }
  }
}

export { real, RealDate };
