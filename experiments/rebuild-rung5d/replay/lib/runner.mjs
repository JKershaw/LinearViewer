// Run one scenario (a short sequence of calls) against ONE fresh module
// instance and return everything an outsider can observe.
import { canon, diffCanon, indexInputs } from './canon.mjs';
import { createWorld, captureConsole } from './fakes.mjs';
import { seedMathRandom } from './hermetic.mjs';

function hash32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

function resolveFn(mod, path) {
  const parts = path.split('.');
  let obj = mod;
  let owner = null;
  for (const p of parts) {
    owner = obj;
    obj = obj == null ? undefined : obj[p];
  }
  return { fn: obj, owner };
}

function materialize(args, world, prior) {
  const walk = (v) => {
    if (!v || typeof v !== 'object') return v;
    if (Object.prototype.toString.call(v) === '[object Date]') return v;
    if (!Array.isArray(v) && Object.keys(v).length === 1) {
      if ('$store' in v) return world[v.$store];
      if ('$step' in v) return prior[v.$step];
    }
    if (v instanceof Map || v instanceof Set) return v;
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = walk(v[i]); return v; }
    for (const k of Object.keys(v)) v[k] = walk(v[k]);
    return v;
  };
  return walk(args);
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
  await new Promise(r => setTimeout(r, 0));
  for (let i = 0; i < 2; i++) await new Promise(r => setImmediate(r));
};

export async function runScenario(mod, scenario, unhandled) {
  const obs = { steps: [] };
  const prior = [];
  const savedEnv = {};
  for (const [k, v] of Object.entries(scenario.env || {})) {
    savedEnv[k] = process.env[k];
    if (v === null) delete process.env[k]; else process.env[k] = v;
  }
  try {
    for (let si = 0; si < scenario.steps.length; si++) {
      const step = scenario.steps[si];
      const rec = { calls: [], handed: [], console: [] };
      const world = scenario.world ? createWorld(structuredClone(scenario.world), rec) : {};
      // Wrap handed-out values: snapshot at hand-out for mutation detection.
      const handedSnap = [];
      const origPush = rec.handed.push.bind(rec.handed);
      rec.handed.push = (v) => { handedSnap.push(canon(v).value); return origPush(v); };
      const args = materialize(structuredClone(step.args), world, prior);
      const view = args;
      const before = canon(view).value;
      const { fn, owner } = resolveFn(mod, step.fn);
      seedMathRandom(hash32(`${scenario.id}#${si}`));
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
        const idx = indexInputs(view, '$args');
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
      const after = canon(view).value;
      o.inputMutated = JSON.stringify(before) !== JSON.stringify(after);
      o.inputAfter = o.inputMutated ? after : null;
      o.inputMutation = o.inputMutated ? diffCanon(before, after, 4) : [];
      o.storeResultMutation = [];
      rec.handed.forEach((v, h) => {
        const now = canon(v).value;
        if (JSON.stringify(now) !== JSON.stringify(handedSnap[h])) o.storeResultMutation.push({ h, diff: diffCanon(handedSnap[h], now, 3) });
      });
      o.console = rec.console;
      o.calls = rec.calls;
      o.unhandled = unhandled.map(errInfo);
      obs.steps.push(o);
      prior.push(result);
    }
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  return obs;
}

export function errInfo(e) {
  if (e && typeof e === 'object') return { name: e.name, ctor: e.constructor?.name, message: String(e.message) };
  return { thrown: canon(e).value };
}

/** Describe the module's export surface (names, kinds, arity, constants). */
export function describeExports(mod, refs = {}) {
  const d = {};
  for (const k of Object.keys(mod).sort()) {
    const v = mod[k];
    d[k] = typeof v === 'function' ? `function/${v.length}${v.constructor?.name === 'AsyncFunction' ? ' async' : ''}` : typeof v;
    if (k === '__internal' && v && typeof v === 'object') {
      for (const ik of Object.keys(v).sort()) {
        const iv = v[ik];
        d[`__internal.${ik}`] = typeof iv === 'function' ? `function/${iv.length}${iv.constructor?.name === 'AsyncFunction' ? ' async' : ''}` : `${typeof iv}:${JSON.stringify(iv)}`;
      }
    }
  }
  for (const [name, ref] of Object.entries(refs)) {
    const [path, refFn] = ref;
    const { fn } = resolveFn(mod, path);
    d[`identity:${path}`] = fn === refFn ? `=== ${name}` : 'own function';
  }
  return d;
}
