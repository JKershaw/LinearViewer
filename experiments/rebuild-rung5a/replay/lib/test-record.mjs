// Test tier, inside a test child process: wrap each target export so every
// call made by the existing unit tests (directly, or through routes/lib that
// import the targets) is recorded — arguments, dependency calls made through
// the arguments (attributed with AsyncLocalStorage, so overlapping calls stay
// separate), console output, settle mode, outcome and input mutation.
// Records are written as JSON at process exit to $REPLAY_REC_OUT.
import fs from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ser, canon, firstDiff } from './observe.mjs';

const als = new AsyncLocalStorage();
const records = [];
let seq = 0;
// Loopback servers bind ephemeral ports that leak into prompts/URLs: normalise.
const PORT_RE = /(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}/g;
const mapString = (s) => (s.includes(':') ? s.replace(PORT_RE, '$1:PORT') : s);
const SER = { depth: 6, shallowInstances: true, mapString };

function caller() {
  const lines = String(new Error().stack).split('\n').slice(2);
  for (const l of lines) {
    if (l.includes('/replay/lib/') || l.includes('/work/run-') || l.includes('node:')) continue;
    const m = l.match(/\/home\/user\/LinearViewer\/((?:tests|routes|lib|server)[^\s):]*):(\d+)/);
    if (m) return `${m[1]}:${m[2]}`;
  }
  return 'unknown';
}

function wrapDep(fn, name) {
  if (fn.__replayWrapped) return fn;
  const w = function (...args) {
    const rec = als.getStore();
    if (rec) rec.deps.push({ dep: name, args: ser(args, { depth: 4, shallowInstances: true, mapString }) });
    return fn.apply(this, args);
  };
  Object.defineProperty(w, '__replayWrapped', { value: true });
  Object.defineProperty(w, 'name', { value: fn.name });
  return w;
}

function proxyObject(target, name) {
  return new Proxy(target, {
    get(t, k) {
      const v = Reflect.get(t, k, t);
      if (typeof v === 'function' && typeof k === 'string' && k !== 'constructor') {
        const bound = v.bind(t);
        return wrapDep(bound, `${name}.${k}`);
      }
      return v;
    }
  });
}

const hasFnMember = (o) => {
  for (let p = o, d = 0; p && p !== Object.prototype && d < 4; p = Object.getPrototypeOf(p), d++) {
    for (const k of Object.getOwnPropertyNames(p)) {
      if (k === 'constructor') continue;
      const desc = Object.getOwnPropertyDescriptor(p, k);
      if (desc && typeof desc.value === 'function') return true;
    }
  }
  return false;
};

function instrumentParams(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params;
  const out = {};
  for (const k of Object.keys(params)) {
    const v = params[k];
    if (typeof v === 'function') out[k] = wrapDep(v, k);
    else if (v && typeof v === 'object' && !Array.isArray(v) && k !== 'fields' && hasFnMember(v)) out[k] = proxyObject(v, k);
    else out[k] = v;
  }
  return out;
}

// One global pass-through console wrapper; lines go to the call whose async
// context is active (AsyncLocalStorage), so overlapping calls stay separate.
for (const m of ['log', 'warn', 'error', 'info']) {
  const prev = console[m];
  console[m] = function (...a) {
    const rec = als.getStore();
    if (rec) rec.console.push({ m, text: mapString(a.map(x => (typeof x === 'string' ? x : JSON.stringify(ser(x, { depth: 3, mapString })))).join(' ')) });
    return prev.apply(this, a);
  };
}

export function wrapExport(mod, name, real) {
  if (typeof real !== 'function') return real;
  const wrapped = function (...args) {
    const rec = { seq: seq++, fn: `${mod}.${name}`, caller: caller(), deps: [], console: [] };
    records.push(rec);
    const callArgs = name === 'createDispatchItem' ? [instrumentParams(args[0]), ...args.slice(1)] : args;
    if (name === 'createDispatchItem' && args.length === 0) callArgs.length = 0;
    rec.args = ser(args, SER);
    const before = canon(rec.args);
    const done = () => {
      const after = ser(args, SER);
      rec.mutation = canon(after) === before ? null : firstDiff(rec.args, after);
    };
    let ret;
    try {
      ret = als.run(rec, () => real.apply(this, callArgs));
    } catch (e) {
      rec.settle = 'sync-throw';
      rec.outcome = { type: 'throw', error: ser(e, { depth: 4, shallowInstances: true, mapString }) };
      done();
      throw e;
    }
    if (ret && typeof ret.then === 'function') {
      return ret.then(
        (v) => { rec.settle = 'promise-resolve'; rec.outcome = { type: 'return', value: ser(v, SER) }; done(); return v; },
        (e) => { rec.settle = 'promise-reject'; rec.outcome = { type: 'throw', error: ser(e, { depth: 4, shallowInstances: true, mapString }) }; done(); throw e; }
      );
    }
    rec.settle = 'sync-return';
    rec.outcome = { type: 'return', value: ser(ret, SER) };
    done();
    return ret;
  };
  Object.defineProperty(wrapped, 'name', { value: real.name });
  Object.defineProperty(wrapped, 'length', { value: real.length });
  return wrapped;
}

process.on('exit', () => {
  for (const r of records) if (!r.settle) { r.settle = 'pending'; r.outcome = { type: 'pending' }; }
  if (process.env.REPLAY_REC_OUT) fs.writeFileSync(process.env.REPLAY_REC_OUT, JSON.stringify(records));
});
