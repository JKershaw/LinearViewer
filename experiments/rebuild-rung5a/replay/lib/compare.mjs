// Compare two sides' observations of one input. Returns { diffs, info }.
// Each diff: { kind, sig, path, old, new, call } — kind names the facet that
// differs (outcome / error / deps / console / mutation / env / ...), sig is a
// grouping signature (kind + collapsed path). `info` holds key-order-only
// differences, which never count as behavioural differences.
import { canon, firstDiff, keyOrders, pathSig, brief } from './observe.mjs';

function errSig(e) {
  return e && typeof e === 'object' ? `${e.name}:${e.message}` : String(e);
}

function compareCall(o, n, ci) {
  const diffs = [];
  const info = [];
  const add = (kind, d, extra = {}) => diffs.push({ kind, sig: `${o.fn} ${kind}${d?.path ? ' ' + pathSig(d.path) : ''}`, path: d?.path ?? null, old: d?.old, new: d?.new, call: ci, ...extra });

  if (o.settle !== n.settle) {
    add(`settle:${o.settle}->${n.settle}`, { path: null, old: o.settle, new: n.settle }, {
      oldOutcome: brief(o.outcome), newOutcome: brief(n.outcome)
    });
  }
  const ot = o.outcome?.type; const nt = n.outcome?.type;
  if (ot === nt && ot === 'return') {
    const d = firstDiff(o.outcome.value, n.outcome.value, '$return');
    if (d) add('return', d);
  } else if (ot === nt && ot === 'throw') {
    const eo = o.outcome.error; const en = n.outcome.error;
    if (canon(eo) !== canon(en)) {
      const d = firstDiff(eo, en, '$error');
      const k = eo?.$ === 'error' && en?.$ === 'error'
        ? (eo.message !== en.message ? 'error.message' : eo.name !== en.name || eo.ctor !== en.ctor ? 'error.class' : 'error.props')
        : 'error.value';
      add(k, d, { oldError: errSig(eo), newError: errSig(en) });
    }
  } else if (ot !== nt && o.settle === n.settle) {
    add(`outcome:${ot}->${nt}`, { path: null, old: brief(o.outcome), new: brief(n.outcome) });
  }

  // Dependency calls: names in order first, then arguments.
  const on = (o.deps || []).map(d => d.dep); const nn = (n.deps || []).map(d => d.dep);
  if (on.join('|') !== nn.join('|')) {
    const sameSet = [...on].sort().join('|') === [...nn].sort().join('|');
    let i = 0; while (i < on.length && on[i] === nn[i]) i++;
    add(sameSet ? 'deps.order' : 'deps.calls', { path: `$deps[${i}]`, old: on.slice(i, i + 4).join(', ') || '(end)', new: nn.slice(i, i + 4).join(', ') || '(end)' }, {
      oldDeps: on.join(', '), newDeps: nn.join(', ')
    });
  } else {
    for (let i = 0; i < on.length; i++) {
      const d = firstDiff(o.deps[i].args, n.deps[i].args, `$deps.${on[i]}.args`);
      if (d) { add('deps.args', d); break; }
    }
  }
  if (canon(o.console) !== canon(n.console)) {
    const a = (o.console || []).map(l => `${l.m}: ${l.text}`); const b = (n.console || []).map(l => `${l.m}: ${l.text}`);
    let i = 0; while (i < a.length && a[i] === b[i]) i++;
    add('console', { path: `$console[${i}]`, old: (a[i] ?? '(none)').slice(0, 200), new: (b[i] ?? '(none)').slice(0, 200) });
  }
  if (canon(o.mutation) !== canon(n.mutation)) add('input-mutation', { path: n.mutation?.path || o.mutation?.path || null, old: brief(o.mutation), new: brief(n.mutation) });
  if ((o.envReads || []).join(',') !== (n.envReads || []).join(',')) add('env-reads', { path: null, old: (o.envReads || []).join(',') || '(none)', new: (n.envReads || []).join(',') || '(none)' });
  if (canon(o.propReads ?? null) !== canon(n.propReads ?? null)) add('payload-reads', { path: null, old: (o.propReads || []).join(','), new: (n.propReads || []).join(',') });
  for (const k of ['mathRandom', 'randomUUID', 'randomBytes']) {
    if ((o.random?.[k] || 0) !== (n.random?.[k] || 0)) add(`random.${k}`, { path: null, old: o.random?.[k] || 0, new: n.random?.[k] || 0 });
  }
  if (o.leakedTimers !== n.leakedTimers) add('leaked-timers', { path: null, old: o.leakedTimers, new: n.leakedTimers });
  if (canon(o.unhandled) !== canon(n.unhandled)) add('unhandled-rejection', { path: null, old: brief(o.unhandled), new: brief(n.unhandled) });
  if (canon(o.network) !== canon(n.network)) add('network', { path: null, old: brief(o.network), new: brief(n.network) });
  if (o.returnedIsStoreItem !== n.returnedIsStoreItem) add('returned-identity', { path: null, old: o.returnedIsStoreItem, new: n.returnedIsStoreItem });

  // Info only: key order of every object in the return value / thrown error / dep args.
  const ko = (x) => keyOrders({ outcome: x.outcome, deps: x.deps });
  const ka = ko(o); const kb = ko(n);
  for (const p of new Set([...Object.keys(ka), ...Object.keys(kb)])) {
    if (ka[p] !== undefined && kb[p] !== undefined && ka[p] !== kb[p] && [...ka[p].split('\u0001')].sort().join() === [...kb[p].split('\u0001')].sort().join()) {
      info.push({ kind: 'key-order', sig: `${o.fn} key-order ${pathSig(p)}`, path: p, old: ka[p].split('\u0001').join(','), new: kb[p].split('\u0001').join(','), call: ci });
    }
  }
  return { diffs, info };
}

export function compareObs(oldObs, newObs) {
  const diffs = []; const info = [];
  const n = Math.max(oldObs.length, newObs.length);
  for (let i = 0; i < n; i++) {
    const o = oldObs[i]; const w = newObs[i];
    if (!o || !w) { diffs.push({ kind: 'call-count', sig: 'call-count', call: i, old: oldObs.length, new: newObs.length }); break; }
    const r = compareCall(o, w, i);
    diffs.push(...r.diffs); info.push(...r.info);
  }
  return { diffs, info };
}

/** Group a list of {inputId, tier, diff} by diff.sig, one example each. */
export function group(entries, { exampleOf } = {}) {
  const groups = new Map();
  for (const e of entries) {
    const k = e.diff.sig;
    if (!groups.has(k)) groups.set(k, { sig: k, kind: e.diff.kind, count: 0, byTier: {}, example: { input: e.inputId, ...e.diff, ...(exampleOf ? { inputSpec: exampleOf(e) } : {}) } });
    const g = groups.get(k);
    g.count++;
    g.byTier[e.tier] = (g.byTier[e.tier] || 0) + 1;
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
