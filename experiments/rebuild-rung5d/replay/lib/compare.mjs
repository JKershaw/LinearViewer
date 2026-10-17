// Compare the observations of one scenario on two sides.
// Difference kinds (outsider-visible): outcome, async-shape, error, return,
// console, storeCalls, input-mutation, store-result-mutation,
// unhandled-rejection, steps, import-side-effects.
// Info kinds (reported, not counted as behaviour differences unless asked):
// key-order (object key / Map / Set order), alias (an output object that is
// an input object, or that appears twice in the output), storeCalls:order
// (same calls, different order).
import { diffCanon, sigPath } from './canon.mjs';

const J = (x) => JSON.stringify(x);
const short = (x, n = 300) => { const s = typeof x === 'string' ? x : J(x); return s && s.length > n ? s.slice(0, n) + '…' : s; };
// Normalise volatile tokens in console text so one cause groups.
const normText = (s) => String(s).replace(/disp-[0-9a-f]{6}|[0-9a-f]{24}|bad[h]?-[0-9a-f]{3}|w-[0-9a-f]{3}|x-[0-9a-f]{3}|[A-Z]{3}-\d+/g, '<id>').replace(/\d+/g, 'N').slice(0, 120);

export function compareObs(a, b) {
  const diffs = [];
  const info = [];
  const add = (list, kind, step, fn, sig, detail) => list.push({ kind, step, fn, sig: `${kind} ${fn} ${sig}`.trim(), ...detail });
  if (J(a.importConsole) !== J(b.importConsole)) add(diffs, 'import-side-effects', -1, '(import)', '', { old: short(a.importConsole), new: short(b.importConsole) });
  const n = Math.max(a.steps.length, b.steps.length);
  for (let i = 0; i < n; i++) {
    const x = a.steps[i]; const y = b.steps[i];
    if (!x || !y) { add(diffs, 'steps', i, (x || y).fn, 'missing step', {}); continue; }
    const fn = x.fn;
    if (x.mode !== y.mode) {
      add(diffs, 'outcome', i, fn, `${x.mode}→${y.mode}`, { old: short(x.error || x.value), new: short(y.error || y.value) });
    } else {
      if (!!x.returnsPromise !== !!y.returnsPromise) add(diffs, 'async-shape', i, fn, `promise ${!!x.returnsPromise}→${!!y.returnsPromise}`, {});
      if (x.error || y.error) {
        if (J(x.error) !== J(y.error)) add(diffs, 'error', i, fn, `${x.error?.name}→${y.error?.name}`, { old: short(x.error), new: short(y.error) });
      }
      if (J(x.value) !== J(y.value) || J(x.invoked) !== J(y.invoked)) {
        const d = J(x.value) !== J(y.value) ? diffCanon(x.value, y.value, 6) : diffCanon(x.invoked, y.invoked, 6).map(p => ({ ...p, path: `invoked${p.path.slice(1)}` }));
        add(diffs, 'return', i, fn, sigPath(d[0]?.path || '$'), { paths: d });
      } else {
        if (J(x.order) !== J(y.order)) {
          const oi = (x.order || []).findIndex((o, k) => o !== (y.order || [])[k]);
          add(info, 'key-order', i, fn, sigPath(String((x.order || [])[oi] || (y.order || [])[oi] || '').split(':')[0]), { old: short((x.order || [])[oi]), new: short((y.order || [])[oi]) });
        }
        if (J(x.alias) !== J(y.alias)) {
          const sx = new Set(x.alias || []); const sy = new Set(y.alias || []);
          const onlyOld = [...sx].filter(s => !sy.has(s)); const onlyNew = [...sy].filter(s => !sx.has(s));
          const ex = onlyOld[0] || onlyNew[0] || '';
          add(info, 'alias', i, fn, sigPath(ex.split(' = ')[0]) + (onlyOld.length ? ' (old shares)' : ' (new shares)'), { onlyOld: onlyOld.slice(0, 4), onlyNew: onlyNew.slice(0, 4) });
        }
      }
    }
    if (J(x.console) !== J(y.console)) {
      const k = (x.console.length > y.console.length ? x.console : y.console).findIndex((c, idx) => J(c) !== J((x.console.length > y.console.length ? y.console : x.console)[idx]));
      const ex = x.console[k] || y.console[k] || [];
      add(diffs, 'console', i, fn, `${ex[0] || ''} ${normText(ex[1] || '')}`, { old: short(x.console.slice(k, k + 3)), new: short(y.console.slice(k, k + 3)), counts: `${x.console.length}→${y.console.length}` });
    }
    if (J(x.calls) !== J(y.calls)) {
      const ms = (c) => c.map(J).sort();
      if (J(ms(x.calls)) === J(ms(y.calls))) add(info, 'storeCalls:order', i, fn, '', { old: short(x.calls.map(c => c.method)), new: short(y.calls.map(c => c.method)) });
      else {
        const k = Math.max(0, x.calls.findIndex((c, idx) => J(c) !== J(y.calls[idx])));
        const c = x.calls[k] || y.calls[k];
        add(diffs, 'storeCalls', i, fn, `${c?.store}.${c?.method}`, { old: short(x.calls.slice(k, k + 2)), new: short(y.calls.slice(k, k + 2)), counts: `${x.calls.length}→${y.calls.length}` });
      }
    }
    if (x.inputMutated !== y.inputMutated || J(x.inputAfter) !== J(y.inputAfter)) {
      const p = (x.inputMutation[0] || y.inputMutation[0] || {}).path || '$';
      add(diffs, 'input-mutation', i, fn, `${x.inputMutated}→${y.inputMutated} ${sigPath(p)}`, { old: short(x.inputMutation), new: short(y.inputMutation) });
    }
    if (J(x.storeResultMutation) !== J(y.storeResultMutation)) add(diffs, 'store-result-mutation', i, fn, '', { old: short(x.storeResultMutation), new: short(y.storeResultMutation) });
    if (J(x.unhandled) !== J(y.unhandled)) add(diffs, 'unhandled-rejection', i, fn, '', { old: short(x.unhandled), new: short(y.unhandled) });
  }
  return { diffs, info };
}
