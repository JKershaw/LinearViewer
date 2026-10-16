// Recording fake stores. Two flavours, both rebuilt fresh for every step on
// every side from the same serialisable spec:
//   - `semantic`: a tiny in-memory model of DispatchQueueStore /
//     AgentStatusStore over a seeded dataset, answering by ARGS (issue filter,
//     `since` window, projection, `_id $in`) the way the real Mongo-backed
//     stores do (lib/dispatch-store.js listItems/listHistory, lib/agent-status-
//     store.js listStatus), so a rebuild that reorders or reshapes its reads
//     still gets truthful answers. `naive: true` ignores opts, like most test
//     doubles. Per-method `modes` inject sync returns, throws, rejections and
//     garbage shapes.
//   - `script`: replays a transcript captured from the existing unit tests
//     (method + canonical args → recorded result, falling back to call order).
// Every call is recorded as {store, method, args}; every value handed out is a
// private structured clone, kept so the step can check whether the module
// mutated what the store returned.
import { canon } from './canon.mjs';
import { toEpochMs } from '/home/user/LinearViewer/lib/utils/time.js';

const clone = (v) => (v === undefined ? undefined : structuredClone(v));

function deliver(mode, value, label) {
  switch (mode) {
    case 'sync': return value;
    case 'throw': throw new Error(`fake ${label} failed (sync)`);
    case 'reject': return Promise.reject(new Error(`fake ${label} failed (async)`));
    case 'rejectBare': return Promise.reject(`fake ${label} failed (bare string)`);
    case 'rejectEmpty': return Promise.reject(new Error(''));
    case 'typeerror': throw new TypeError(`fake ${label}: cannot read properties of undefined`);
    default: return Promise.resolve(value);
  }
}

export function createWorld(spec, rec) {
  if (spec.kind === 'script') return createScriptedWorld(spec, rec);
  const modes = spec.modes || {};
  const record = (store, method, args) => rec.calls.push({ store, method, args: canon(args).value });
  const handOut = (v) => { rec.handed.push(v); return v; };
  const naive = !!spec.naive;
  const sinceOk = (value, since) => {
    if (!since) return true;
    const t = toEpochMs(value);
    const s = toEpochMs(since);
    return t != null && s != null && t >= s;
  };
  const shapes = {
    nonArray: { items: [] }, undefined: undefined, null: null, noItems: { total: 0 }, itemsNotArray: { items: 'oops' }
  };

  const dispatchStore = {
    listItems(urlKey, opts) {
      record('dispatchStore', 'listItems', [urlKey, opts]);
      const m = modes.listItems || 'promise';
      if (m in shapes) return deliver('promise', shapes[m], 'listItems');
      let rows = spec.live || [];
      if (!naive && opts?.issueIdentifier) rows = rows.filter(r => r && r.issueIdentifier === opts.issueIdentifier);
      return deliver(m, handOut(clone(rows)), 'listItems');
    },
    listHistory(urlKey, opts) {
      record('dispatchStore', 'listHistory', [urlKey, opts]);
      const m = modes.listHistory || 'promise';
      if (m in shapes) return deliver('promise', shapes[m], 'listHistory');
      let rows = spec.history || [];
      if (!naive) {
        if (opts?.issueIdentifier) rows = rows.filter(r => r && r.issueIdentifier === opts.issueIdentifier);
        if (opts?.since) rows = rows.filter(r => r && sinceOk(r.dispatchedAt, opts.since));
      }
      rows = clone(rows);
      if (!naive && opts?.projection) {
        for (const r of rows) {
          if (!r) continue;
          for (const [k, v] of Object.entries(opts.projection)) if (v === 0) delete r[k];
        }
      }
      return deliver(m, handOut({ items: rows, total: rows.length }), 'listHistory');
    },
  };
  if (spec.historyCollection) {
    dispatchStore.historyCollection = {
      find(query, opts) {
        record('dispatchStore', 'historyCollection.find', [query, opts]);
        const ids = query?._id?.$in || [];
        return {
          toArray: async () => {
            record('dispatchStore', 'historyCollection.find().toArray', []);
            if (modes.find === 'reject') throw new Error('fake historyCollection.find failed');
            let docs = (spec.raw || []).filter(d => d && ids.includes(d._id));
            if (modes.find === 'drop-one' && docs.length) docs = docs.slice(1);
            docs = clone(docs);
            if (opts?.projection) for (const d of docs) for (const [k, v] of Object.entries(opts.projection)) if (v === 0) delete d[k];
            return handOut(docs);
          }
        };
      },
      updateOne(filter, update) {
        record('dispatchStore', 'historyCollection.updateOne', [filter, update]);
        const m = modes.updateOne || 'promise';
        return deliver(m, { acknowledged: true, matchedCount: 1, modifiedCount: 1 }, 'updateOne');
      }
    };
  }
  const agentStatusStore = {
    listStatus(urlKey, opts) {
      record('agentStatusStore', 'listStatus', [urlKey, opts]);
      const m = modes.listStatus || 'promise';
      if (m in shapes) return deliver('promise', shapes[m], 'listStatus');
      let rows = spec.status || [];
      if (!naive) {
        if (opts?.taskIdentifier) rows = rows.filter(r => r && r.taskIdentifier === opts.taskIdentifier);
        if (opts?.dispatchId) rows = rows.filter(r => r && r.dispatchId === opts.dispatchId);
        if (opts?.since) rows = rows.filter(r => r && sinceOk(r.timestamp, opts.since));
      }
      return deliver(m, handOut({ items: clone(rows), total: rows.length }), 'listStatus');
    }
  };
  return { dispatchStore, agentStatusStore };
}

// ── scripted (captured) stores ────────────────────────────────────────────
function createScriptedWorld(spec, rec) {
  const queues = new Map();
  const byMethod = new Map();
  spec.calls.forEach((c, i) => {
    const k = `${c.store}|${c.method}|${c.argsKey}`;
    if (!queues.has(k)) queues.set(k, []);
    queues.get(k).push(i);
    const mk = `${c.store}|${c.method}`;
    if (!byMethod.has(mk)) byMethod.set(mk, []);
    byMethod.get(mk).push(i);
  });
  const used = new Set();
  const take = (store, method, argsKey) => {
    const q = queues.get(`${store}|${method}|${argsKey}`) || [];
    let i = q.find(x => !used.has(x));
    if (i === undefined) i = (byMethod.get(`${store}|${method}`) || []).find(x => !used.has(x));
    if (i === undefined) return null;
    used.add(i);
    return spec.calls[i];
  };
  const answer = (c, label) => {
    if (!c) return undefined;
    if (c.outcome === 'throw') { const e = new Error(c.error?.message || 'scripted throw'); e.name = c.error?.name || 'Error'; throw e; }
    if (c.outcome === 'reject') { const e = new Error(c.error?.message || 'scripted reject'); e.name = c.error?.name || 'Error'; return Promise.reject(e); }
    const v = clone(c.value);
    rec.handed.push(v);
    return c.outcome === 'sync' ? v : Promise.resolve(v);
    void label;
  };
  const make = (storeName) => {
    const s = spec.stores[storeName] || { methods: [] };
    const obj = {};
    for (const m of s.methods) {
      obj[m] = (...args) => {
        const a = canon(args).value;
        rec.calls.push({ store: storeName, method: m, args: a });
        return answer(take(storeName, m, JSON.stringify(a)), m);
      };
    }
    if (s.historyCollection) {
      obj.historyCollection = {
        find: (query, opts) => {
          const a = canon([query, opts]).value;
          rec.calls.push({ store: storeName, method: 'historyCollection.find', args: a });
          const c = take(storeName, 'historyCollection.find', JSON.stringify(a));
          return {
            toArray: async () => {
              rec.calls.push({ store: storeName, method: 'historyCollection.find().toArray', args: [] });
              return answer(c, 'toArray');
            }
          };
        },
        updateOne: (filter, update) => {
          const a = canon([filter, update]).value;
          rec.calls.push({ store: storeName, method: 'historyCollection.updateOne', args: a });
          const c = take(storeName, 'historyCollection.updateOne', JSON.stringify(a));
          return c ? answer(c, 'updateOne') : Promise.resolve({ acknowledged: true });
        }
      };
    }
    return obj;
  };
  const out = {};
  for (const name of Object.keys(spec.stores)) out[name] = make(name);
  return out;
}

/** Console capture: every console method records [method, ...args-as-text]. */
export function captureConsole(rec) {
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
  const saved = {};
  for (const m of methods) {
    saved[m] = console[m];
    console[m] = (...args) => {
      rec.console.push([m, ...args.map(a => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return `${a.name}: ${a.message}`;
        try { return JSON.stringify(canon(a).value); } catch { return String(a); }
      })]);
    };
  }
  return () => { for (const m of methods) console[m] = saved[m]; };
}
