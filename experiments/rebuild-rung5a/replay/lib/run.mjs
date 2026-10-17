// Run one input (a sequence of export calls) against one side and return its
// full observation: per call the settle mode, return value or thrown error,
// every recorded dependency call in order, console output, env reads, input
// mutation, randomness consumed, timers left behind, unhandled rejections.
import { ser, canon, firstDiff } from './observe.mjs';
import { decode, newCtx } from './world.mjs';
import { reseed, randomSnapshot, networkAttempts } from './hermetic.mjs';

const WATCHDOG_MS = Number(process.env.REPLAY_WATCHDOG_MS || 1500);
const REAL_ENV = process.env;
const ENV_KEY = /^[A-Z_][A-Z0-9_]*$/;

let unhandled = [];
process.on('unhandledRejection', (reason) => { unhandled.push(ser(reason, { depth: 3 })); });

const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise(r => setImmediate(r));
};
const timerCount = () => process.getActiveResourcesInfo().filter(x => x === 'Timeout').length;

function captureConsole(lines) {
  const saved = {};
  for (const m of ['log', 'warn', 'error', 'info', 'debug']) {
    saved[m] = console[m];
    console[m] = (...a) => { lines.push({ m, text: a.map(x => (typeof x === 'string' ? x : JSON.stringify(ser(x, { depth: 4 })))).join(' ') }); };
  }
  return () => { Object.assign(console, saved); };
}

function envProxy(base, reads) {
  const target = { ...base };
  return new Proxy(target, {
    get(t, k, r) { if (typeof k === 'string' && ENV_KEY.test(k)) reads.push(k); return Reflect.get(t, k, r); },
    has(t, k) { if (typeof k === 'string' && ENV_KEY.test(k)) reads.push(k); return Reflect.has(t, k); }
  });
}

/**
 * @param {Object} mods - { factory, validation } module namespaces of one side
 * @param {Object} input - { id, seed, env, shared, calls:[{mod, fn, args:[spec]}] }
 * @param {Object} support - { createTaskDoneCache, clearPrFilesCache, strCache, baseEnv }
 */
export async function runInput(mods, input, support) {
  reseed(input.seed >>> 0);
  support.clearPrFilesCache?.();
  const ctx = newCtx({ shared: input.shared || {}, createTaskDoneCache: support.createTaskDoneCache, strCache: support.strCache });
  const out = [];
  for (const call of input.calls) {
    const mod = mods[call.mod];
    const target = mod?.[call.fn];
    const fn = call.method ? (typeof target?.[call.method] === 'function' ? target[call.method].bind(target) : undefined) : target;
    const obs = { fn: `${call.mod}.${call.fn}${call.method ? '.' + call.method : ''}` };
    if (typeof fn !== 'function') {
      obs.settle = 'missing-export';
      obs.outcome = { type: 'missing', what: typeof fn };
      out.push(obs);
      continue;
    }
    ctx.rec = [];
    ctx.reads = [];
    unhandled = [];
    const envReads = [];
    const consoleLines = [];
    const netBefore = networkAttempts.length;
    const args = decode(call.args, ctx, 'args');
    const before = ser(args, { depth: 8 });
    const timersBefore = timerCount();
    ctx.reads = [];
    ctx.lastEcho = undefined;
    process.env = envProxy({ ...support.baseEnv, ...(input.env || {}) }, envReads);
    const restoreConsole = captureConsole(consoleLines);
    let settle; let outcome; let returned;
    try {
      let ret;
      try {
        ret = fn(...args);
      } catch (e) {
        settle = 'sync-throw';
        outcome = { type: 'throw', error: ser(e, { depth: 5 }) };
      }
      if (!settle) {
        if (ret && typeof ret.then === 'function') {
          let timer;
          const res = await Promise.race([
            Promise.resolve(ret).then(v => ({ ok: true, v }), e => ({ ok: false, e })),
            new Promise(r => { timer = setTimeout(() => r({ pending: true }), WATCHDOG_MS); })
          ]);
          clearTimeout(timer);
          if (res.pending) { settle = 'pending'; outcome = { type: 'pending', afterMs: WATCHDOG_MS }; }
          else if (res.ok) { settle = 'promise-resolve'; returned = res.v; outcome = { type: 'return', value: ser(res.v, { depth: 7 }) }; }
          else { settle = 'promise-reject'; outcome = { type: 'throw', error: ser(res.e, { depth: 5 }) }; }
        } else {
          settle = 'sync-return';
          returned = ret;
          outcome = { type: 'return', value: ser(ret, { depth: 7 }) };
        }
      }
      if (input.waitMs) await new Promise(r => setTimeout(r, input.waitMs));
      await flush();
    } finally {
      restoreConsole();
      process.env = REAL_ENV;
    }
    const reads = ctx.reads.slice();
    const after = ser(args, { depth: 8 });
    obs.settle = settle;
    obs.outcome = outcome;
    obs.deps = ctx.rec;
    obs.console = consoleLines;
    obs.envReads = [...new Set(envReads)].sort();
    obs.propReads = reads.length ? reads : undefined;
    obs.mutation = canon(before) === canon(after) ? null : firstDiff(before, after);
    obs.random = randomSnapshot();
    obs.leakedTimers = Math.max(0, timerCount() - timersBefore);
    obs.unhandled = unhandled;
    obs.network = networkAttempts.slice(netBefore);
    // Identity of the returned object vs. the object the store's addItem resolved
    // (the factory returns the store's own item, mutated with budgetPosition).
    if (ctx.lastEcho !== undefined) obs.returnedIsStoreItem = returned === ctx.lastEcho;
    out.push(obs);
  }
  return out;
}
