// Decode a pure-data input spec into live arguments: recording fake functions
// and stores whose responses are scripted, tagged scalars, shared objects.
// Specs are plain JSON so they can be generated from a seed, stored in a
// report, and decoded identically (and freshly) for each side.
//
// Value tags:
//   {$u:1} undefined   {$nan:1}  {$inf:1|-1}  {$negz:1}  {$big:'10'}  {$sym:'d'}
//   {$date: iso|ms|'invalid'}   {$set:[..]}  {$map:[[k,v]..]}  {$frozen: spec}
//   {$str:{prefix, ch, n, suffix}}  (big strings without big specs)
//   {$fn:{name, script}}  recording function
//   {$obj:{props:{k:spec}, ctor?, nullProto?, frozen?}}  object (stores)
//   {$ref:'name'}  an entry of input.shared, decoded once per side-run
//   {$realCache:{}}  a real createTaskDoneCache() whose get/peek/clear record
//   {$proxyReads: spec}  object wrapped in a Proxy that records property reads
//   {$throwGetter:'msg'}  (only as an $obj prop) an enumerable getter that throws
// Script (per $fn): a response R, or {seq:[R..], then:R}.
//   R: {k:'res',v} {k:'rej',e} {k:'throw',e} {k:'ret',v} {k:'hang'} {k:'late',ms,then:R}
//      {k:'byArg', index, map:{String(arg): R}, default:R}
//      {k:'echo'|'echoFrozen'|'echoNull'|'echoSame'} (addItem-style, from args[1])
//      {k:'callProducer', bool?} (cache.get-style: awaits args[1]())
//   e: {name, message, props?} | {nonError: spec}
import { ser } from './observe.mjs';

const SKIP = Symbol('skip');

export function makeError(e, ctx) {
  if (e && 'nonError' in e) return decode(e.nonError, ctx, 'nonError');
  const Ctor = { TypeError, RangeError, SyntaxError }[e?.name] || Error;
  const err = new Ctor(e?.message ?? 'scripted failure');
  if (e?.props) Object.assign(err, decode(e.props, ctx, 'errprops'));
  return err;
}

function responder(script, name, ctx) {
  let i = 0;
  return function pick() {
    if (script && Array.isArray(script.seq)) {
      const r = i < script.seq.length ? script.seq[i] : (script.then ?? script.seq[script.seq.length - 1]);
      i++;
      return r;
    }
    i++;
    return script;
  };
}

function makeFn(spec, ctx, path) {
  const name = spec.name || path;
  const pick = responder(spec.script ?? { k: 'res', v: { $u: 1 } }, name, ctx);
  let echoN = 0;
  const respond = (r, args) => {
    switch (r.k) {
      case 'res': return Promise.resolve(decode(r.v, ctx, name));
      case 'ret': return decode(r.v, ctx, name);
      case 'rej': return Promise.reject(makeError(r.e, ctx));
      case 'throw': throw makeError(r.e, ctx);
      case 'hang': return new Promise(() => {});
      case 'late': return new Promise((resolve, reject) => {
        setTimeout(() => { try { resolve(respond(r.then, args)); } catch (e) { reject(e); } }, r.ms);
      });
      case 'byArg': {
        const key = String(args[r.index ?? 0]);
        return respond((r.map && Object.prototype.hasOwnProperty.call(r.map, key)) ? r.map[key] : (r.default ?? { k: 'res', v: null }), args);
      }
      case 'echo': case 'echoFrozen': case 'echoSame': case 'echoNull': {
        echoN++;
        const item = args[1];
        if (r.k === 'echoNull') return Promise.resolve(null);
        if (r.k === 'echoSame') { ctx.lastEcho = item; return Promise.resolve(item); }
        const out = { _id: `item-${echoN}`, id: `item-${echoN}`, ...(item && typeof item === 'object' ? item : {}) };
        ctx.lastEcho = r.k === 'echoFrozen' ? Object.freeze(out) : out;
        return Promise.resolve(ctx.lastEcho);
      }
      case 'callProducer': {
        const producer = args[1];
        return (async () => {
          const v = await producer();
          return r.bool ? !!v : v;
        })();
      }
      default: throw new Error(`world: unknown response kind ${r.k}`);
    }
  };
  const fn = function (...args) {
    const r = pick() || { k: 'ret', v: { $u: 1 } };
    ctx.rec.push({ dep: name, args: ser(args, { depth: 6 }) });
    return respond(r, args);
  };
  Object.defineProperty(fn, 'name', { value: String(name).split('.').pop() });
  return fn;
}

export function decode(spec, ctx, path = '$') {
  if (spec === null || typeof spec !== 'object') return spec;
  if (Array.isArray(spec)) return spec.map((x, i) => decode(x, ctx, `${path}[${i}]`));
  if ('$u' in spec) return undefined;
  if ('$nan' in spec) return NaN;
  if ('$inf' in spec) return spec.$inf > 0 ? Infinity : -Infinity;
  if ('$negz' in spec) return -0;
  if ('$big' in spec) return BigInt(spec.$big);
  if ('$sym' in spec) return Symbol(spec.$sym);
  if ('$date' in spec) return spec.$date === 'invalid' ? new Date(NaN) : new Date(spec.$date);
  if ('$set' in spec) return new Set(decode(spec.$set, ctx, path));
  if ('$map' in spec) return new Map(decode(spec.$map, ctx, path));
  if ('$frozen' in spec) return Object.freeze(decode(spec.$frozen, ctx, path));
  if ('$str' in spec) {
    const s = spec.$str;
    const key = JSON.stringify(s);
    if (!ctx.strCache.has(key)) ctx.strCache.set(key, (s.prefix || '') + String(s.ch ?? 'a').repeat(s.n || 0) + (s.suffix || ''));
    return ctx.strCache.get(key);
  }
  if ('$fn' in spec) return makeFn(spec.$fn, ctx, spec.$fn.name || path);
  if ('$ref' in spec) {
    if (!ctx.sharedLive.has(spec.$ref)) {
      ctx.sharedLive.set(spec.$ref, decode(ctx.shared[spec.$ref], ctx, spec.$ref));
    }
    return ctx.sharedLive.get(spec.$ref);
  }
  if ('$realCache' in spec) {
    const real = ctx.createTaskDoneCache(spec.$realCache || {});
    const name = spec.$realCache.name || path;
    return {
      ttlMs: real.ttlMs,
      peek: (...a) => { ctx.rec.push({ dep: `${name}.peek`, args: ser(a) }); return real.peek(...a); },
      get: (...a) => { ctx.rec.push({ dep: `${name}.get`, args: ser(a) }); return real.get(...a); },
      clear: (...a) => { ctx.rec.push({ dep: `${name}.clear`, args: ser(a) }); return real.clear(...a); }
    };
  }
  if ('$proxyReads' in spec) {
    const target = decode(spec.$proxyReads, ctx, path);
    return new Proxy(target, {
      get(t, k, r) { if (typeof k === 'string') ctx.reads.push(k); return Reflect.get(t, k, r); }
    });
  }
  if ('$obj' in spec) {
    const o = spec.$obj;
    let out;
    if (o.nullProto) out = Object.create(null);
    else if (o.ctor) { const C = ({ [o.ctor]: class {} })[o.ctor]; out = new C(); }
    else out = {};
    for (const [k, v] of Object.entries(o.props || {})) {
      if (v && typeof v === 'object' && '$throwGetter' in v) {
        Object.defineProperty(out, k, { enumerable: true, configurable: true, get() { throw new Error(v.$throwGetter); } });
        continue;
      }
      const val = decode(v, ctx, `${o.name || path}.${k}`);
      if (val !== SKIP) out[k] = val;
    }
    return o.frozen ? Object.freeze(out) : out;
  }
  const out = {};
  for (const [k, v] of Object.entries(spec)) out[k] = decode(v, ctx, `${path}.${k}`);
  return out;
}

export function newCtx({ shared = {}, createTaskDoneCache, strCache }) {
  return { rec: [], reads: [], shared, sharedLive: new Map(), createTaskDoneCache, strCache };
}
