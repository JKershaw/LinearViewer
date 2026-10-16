// Recording stand-in for lib/pipeline-loops.js (capture phase only). Every
// module that imports pipeline-loops — test files AND the lib/routes modules
// under test — gets this shim, which records each boundary call: its args
// (stores replaced by {$store:name} placeholders), the env it ran under, and
// a full transcript of every store call (args + sync/async result or error),
// then delegates to the real module with recording store proxies.
import fs from 'node:fs';
import v8 from 'node:v8';
import { canon } from './canon.mjs';

const REAL_URL = process.env.REPLAY_REAL_URL;
const real = await import(REAL_URL);
const OUT = process.env.REPLAY_CAPTURE_OUT;
const MAX_PER_SITE = Number(process.env.REPLAY_MAX_PER_SITE || 40);
const perSite = new Map();

function callsite() {
  const stack = new Error().stack.split('\n').slice(1);
  const frame = stack.find(l => !l.includes('capture-shim') && !l.includes('pipeline-loops.js') && !l.includes('node:internal') && /\/(tests|lib|routes|server)/.test(l));
  const m = frame && frame.match(/LinearViewer\/((?:tests|lib|routes)\/[^\s):]+|server\.js):(\d+):\d+/);
  return m ? `${m[1]}:${m[2]}` : 'unknown';
}

const isStoreLike = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) !== null &&
  (['listItems', 'listHistory', 'listStatus', 'find', 'getItemStatus'].some(k => typeof v[k] === 'function') || v.historyCollection);

function methodNames(o) {
  const names = new Set();
  for (let p = o; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const k of Object.getOwnPropertyNames(p)) { if (k === 'constructor') continue; try { if (typeof o[k] === 'function') names.add(k); } catch { /* getter */ } }
  }
  return [...names].sort();
}

const cloneOut = (v) => { try { return v8.deserialize(v8.serialize(v)); } catch { return { $unserializable: String(v) }; } };

function wrapStore(name, store, calls) {
  const rec = (method, args, outcome, value, error) => calls.push({ store: name, method, argsKey: JSON.stringify(canon(args).value), outcome, value: outcome === 'sync' || outcome === 'resolve' ? cloneOut(value) : undefined, error: error ? { name: error.name, message: String(error.message) } : undefined });
  const wrapMethod = (target, method, label) => (...args) => {
    const argsSnap = cloneOut(args);
    let r;
    try { r = target[method](...args); } catch (e) { rec(label, argsSnap, 'throw', undefined, e); throw e; }
    if (r && typeof r.then === 'function') {
      return r.then(v => { rec(label, argsSnap, 'resolve', v); return v; }, e => { rec(label, argsSnap, 'reject', undefined, e); throw e; });
    }
    rec(label, argsSnap, 'sync', r);
    return r;
  };
  const proxy = new Proxy(store, {
    get(t, k) {
      if (k === 'historyCollection' && t.historyCollection) {
        const hc = t.historyCollection;
        return {
          find: (query, opts) => {
            const argsSnap = cloneOut([query, opts]);
            const cursor = hc.find(query, opts);
            return { toArray: async () => { try { const v = await cursor.toArray(); rec('historyCollection.find', argsSnap, 'resolve', v); return v; } catch (e) { rec('historyCollection.find', argsSnap, 'reject', undefined, e); throw e; } } };
          },
          updateOne: wrapMethod(hc, 'updateOne', 'historyCollection.updateOne'),
        };
      }
      const v = t[k];
      if (typeof v === 'function' && typeof k === 'string') return wrapMethod(t, k, k);
      return v;
    }
  });
  return proxy;
}

function prepareArgs(args) {
  const stores = {};
  const calls = [];
  const replaced = args.map((a, i) => {
    if (isStoreLike(a)) { const n = i === 1 ? 'dispatchStore' : `arg${i}`; stores[n] = { methods: methodNames(a), historyCollection: !!a.historyCollection }; return { live: wrapStore(n, a, calls), ph: { $store: n } }; }
    if (a && typeof a === 'object' && !Array.isArray(a) && Object.getPrototypeOf(a) === Object.prototype) {
      let touched = false;
      const live = { ...a }; const ph = { ...a };
      for (const [k, v] of Object.entries(a)) {
        if (isStoreLike(v)) { touched = true; stores[k] = { methods: methodNames(v), historyCollection: !!v.historyCollection }; live[k] = wrapStore(k, v, calls); ph[k] = { $store: k }; }
      }
      if (touched) return { live, ph };
    }
    return { live: a, ph: a };
  });
  return { liveArgs: replaced.map(r => r.live), phArgs: replaced.map(r => r.ph), stores, calls };
}

function write(recObj) {
  let buf;
  try { buf = v8.serialize(recObj); } catch (e) { buf = v8.serialize({ site: recObj.site, fn: recObj.fn, error: `not serializable: ${e.message}` }); }
  const len = Buffer.alloc(4); len.writeUInt32LE(buf.length);
  fs.appendFileSync(OUT, Buffer.concat([len, buf]));
}

function wrap(fnName, fn) {
  return function (...args) {
    const site = callsite();
    const count = (perSite.get(site) || 0) + 1;
    perSite.set(site, count);
    if (count > MAX_PER_SITE) return fn.apply(this, args);
    const { liveArgs, phArgs, stores, calls } = prepareArgs(args);
    let argsSnap;
    try { argsSnap = v8.serialize(phArgs); } catch { return fn.apply(this, args); }
    const env = { OBSERVATION_FEED_TIMING: process.env.OBSERVATION_FEED_TIMING ?? null };
    // `expected`: what the real call produced in the test, to measure how
    // faithfully the scripted replay reproduces it (capture fidelity).
    const done = (expected) => write({ site, fn: fnName, args: argsSnap, stores, calls, env, expected });
    const enc = (v) => { try { return JSON.stringify(canon(v).value); } catch { return null; } };
    let r;
    try { r = fn.apply(this, liveArgs); } catch (e) { done({ mode: 'throw', error: { name: e?.name, message: String(e?.message) } }); throw e; }
    if (r && typeof r.then === 'function') {
      return r.then(v => { done({ mode: 'resolve', value: enc(v) }); return v; }, e => { done({ mode: 'reject', error: { name: e?.name, message: String(e?.message) } }); throw e; });
    }
    done({ mode: 'return', value: fnName === '__internal._hierarchyHelpers' ? null : enc(r) });
    return r;
  };
}

const wrapped = {};
for (const [k, v] of Object.entries(real)) {
  if (k === '__internal') continue;
  wrapped[k] = typeof v === 'function' ? wrap(k, v) : v;
}
export const isDecisionAnswerEntry = wrapped.isDecisionAnswerEntry;
export const isDecisionLifecycleStampEntry = wrapped.isDecisionLifecycleStampEntry;
export const resolvedDecisionEvents = wrapped.resolvedDecisionEvents;
export const firstRaisedAt = wrapped.firstRaisedAt;
export const redigestHistoryRows = wrapped.redigestHistoryRows;
export const getLoopsForIssue = wrapped.getLoopsForIssue;
export const getLoopsForWorkspace = wrapped.getLoopsForWorkspace;
export const deriveIssueGraph = wrapped.deriveIssueGraph;
export const getSessionsForWorkspace = wrapped.getSessionsForWorkspace;
export const getSessionsForIssues = wrapped.getSessionsForIssues;
export const __internal = Object.fromEntries(Object.entries(real.__internal).map(([k, v]) => [k, typeof v === 'function' ? wrap(`__internal.${k}`, v) : v]));
