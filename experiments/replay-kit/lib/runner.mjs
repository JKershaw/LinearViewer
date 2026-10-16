// Run one scenario (a short sequence of calls) against ONE fresh module
// instance and return everything an outsider can observe. From
// rung5d/replay/lib/runner.mjs, generalised:
//   - the world (fake stores, injected functions) comes from the target's
//     `createWorld(spec, io)` and lives for the whole scenario (a factory's
//     deps are used by later steps); `io.call()` records each dep call into
//     the CURRENT step, `io.handOut()` registers a value the module received
//     (for store-result-mutation checks);
//   - args are serialisable specs: `{$dep:'name'}` → world[name],
//     `{$step:i}` → step i's result;
//   - `fn` is an export path (`buildTaskPageModel`, `__internal.x`) or a
//     method of an earlier step's result (`$0.loadTaskPage`);
//   - the target's optional `inspect(ctx)` adds per-step findings (e.g. the
//     privacy-leak scan).
import { canon, diffCanon, indexInputs } from './canon.mjs';
import { seedRandom, hash32 } from './hermetic.mjs';

export function resolveFn(mod, fnPath, prior) {
  const parts = fnPath.split('.');
  let obj = mod;
  if (parts[0].startsWith('$')) { obj = prior[Number(parts[0].slice(1))]; parts.shift(); }
  let owner = null;
  for (const p of parts) {
    owner = obj;
    obj = obj == null ? undefined : obj[p];
  }
  return { fn: obj, owner };
}

export function materialize(args, world, prior) {
  const walk = (v) => {
    if (!v || typeof v !== 'object') return v;
    if (Object.prototype.toString.call(v) === '[object Date]') return v;
    if (!Array.isArray(v) && Object.keys(v).length === 1) {
      if ('$dep' in v) { if (!(v.$dep in world)) throw new Error(`world has no dep '${v.$dep}'`); return world[v.$dep]; }
      if ('$step' in v) return prior[v.$step];
    }
    if (v instanceof Map || v instanceof Set) return v;
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = walk(v[i]); return v; }
    for (const k of Object.keys(v)) v[k] = walk(v[k]);
    return v;
  };
  return walk(args);
}

export function captureConsole(rec) {
  const saved = {};
  for (const m of ['log', 'warn', 'error', 'info', 'debug']) {
    saved[m] = console[m];
    console[m] = (...a) => { rec.console.push([m, a.map(x => (typeof x === 'string' ? x : JSON.stringify(canon(x).value))).join(' ')]); };
  }
  return () => Object.assign(console, saved);
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
  await new Promise(r => setTimeout(r, 0));
  for (let i = 0; i < 2; i++) await new Promise(r => setImmediate(r));
};

export function errInfo(e) {
  if (e && typeof e === 'object') return { name: e.name, ctor: e.constructor?.name, message: String(e.message) };
  return { thrown: canon(e).value };
}

export async function runScenario(mod, scenario, unhandled, target) {
  const obs = { steps: [] };
  const prior = [];
  const savedEnv = {};
  for (const [k, v] of Object.entries(scenario.env || {})) {
    savedEnv[k] = process.env[k];
    if (v === null) delete process.env[k]; else process.env[k] = v;
  }
  const io = {
    rec: { calls: [], handed: [] },
    call(dep, method, args, extra = {}) { const e = { dep, method, args: canon(args).value, ...extra }; this.rec.calls.push(e); return e; },
    handOut(v) { this.rec.handed.push(v); return v; },
  };
  io.call = io.call.bind(io); io.handOut = io.handOut.bind(io);
  try {
    seedRandom(hash32(`${scenario.id}#world`));
    const world = scenario.world != null && target.createWorld ? target.createWorld(structuredClone(scenario.world), io) : {};
    for (let si = 0; si < scenario.steps.length; si++) {
      const step = scenario.steps[si];
      const rec = { calls: [], handed: [], console: [] };
      io.rec = rec;
      const handedSnap = [];
      const origPush = rec.handed.push.bind(rec.handed);
      rec.handed.push = (v) => { handedSnap.push(canon(v).value); return origPush(v); };
      const args = materialize(structuredClone(step.args), world, prior);
      const before = canon(args).value;
      const { fn, owner } = resolveFn(mod, step.fn, prior);
      seedRandom(hash32(`${scenario.id}#${si}`));
      unhandled.length = 0;
      const restore = captureConsole(rec);
      const o = { fn: step.fn };
      let result;
      try {
        if (typeof fn !== 'function') {
          o.mode = 'missing-export';
          o.value = canon(fn).value;
        } else {
          result = fn.apply(owner, args);
          const thenable = result && typeof result.then === 'function';
          o.returnsPromise = !!thenable;
          if (thenable) {
            try { result = await result; o.mode = 'resolve'; } catch (e) { o.mode = 'reject'; o.error = errInfo(e); result = undefined; }
          } else o.mode = 'return';
        }
      } catch (e) {
        o.mode = 'throw';
        o.error = errInfo(e);
        result = undefined;
      }
      await flush();
      restore();
      if (o.mode === 'return' || o.mode === 'resolve') {
        const idx = indexInputs(args, '$args');
        for (let h = 0; h < rec.handed.length; h++) indexInputs(rec.handed[h], `$store${h}`, idx);
        prior.forEach((p, i) => indexInputs(p, `$step${i}`, idx));
        const c = canon(result, { inputIndex: idx });
        o.value = c.value; o.order = c.order; o.alias = c.alias;
        if (step.invoke && result) {
          o.invoked = [];
          for (const inv of step.invoke) {
            try { o.invoked.push({ m: inv.method, a: inv.args, r: canon(result[inv.method](...inv.args)).value }); }
            catch (e) { o.invoked.push({ m: inv.method, a: inv.args, err: errInfo(e) }); }
          }
        }
      }
      const after = canon(args).value;
      o.inputMutated = JSON.stringify(before) !== JSON.stringify(after);
      o.inputAfter = o.inputMutated ? after : null;
      o.inputMutation = o.inputMutated ? diffCanon(before, after, 4) : [];
      o.storeResultMutation = [];
      rec.handed.forEach((v, h) => {
        const now = canon(v).value;
        if (JSON.stringify(now) !== JSON.stringify(handedSnap[h])) o.storeResultMutation.push({ h, diff: diffCanon(handedSnap[h], now, 3) });
      });
      o.console = rec.console;
      o.calls = rec.calls.filter(c => !c.pure);
      o.pureCalls = rec.calls.filter(c => c.pure).map(c => ({ dep: c.dep, method: c.method, args: c.args }));
      o.unhandled = unhandled.map(errInfo);
      if (target.inspect) o.findings = target.inspect({ scenario, step, stepIndex: si, obs: o, result, args }) || null;
      obs.steps.push(o);
      prior.push(result);
    }
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  return obs;
}

/** Describe the module's export surface (names, kinds, arity, constants). */
export function describeExports(mod) {
  const d = {};
  const kind = (v) => (typeof v === 'function' ? `function/${v.length}${v.constructor?.name === 'AsyncFunction' ? ' async' : ''}` : `${typeof v}:${safeJSON(v)}`);
  for (const k of Object.keys(mod).sort()) {
    const v = mod[k];
    d[k] = kind(v);
    if (k === '__internal' && v && typeof v === 'object') {
      d[k] = 'object';
      for (const ik of Object.keys(v).sort()) d[`__internal.${ik}`] = kind(v[ik]);
    }
  }
  return d;
}
function safeJSON(v) { try { const s = JSON.stringify(v); return s && s.length > 400 ? s.slice(0, 400) + '…' : s; } catch { return '?'; } }
