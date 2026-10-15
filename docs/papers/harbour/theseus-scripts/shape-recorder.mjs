// theseus: preload that records the shape of every value a provider surface method returns.
// Usage: SHAPE_OUT=<dir> REPO=<repoDir> node --import ./shape-recorder.mjs --test <files>
// Appends {p, m, s} lines to <dir>/<pid>.jsonl; s is the value's key structure, arrays collapsed
// to the merged shape of their first five elements, depth capped at 7.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = pathToFileURL(process.env.REPO + '/').href;
const OUT = `${process.env.SHAPE_OUT}/${process.pid}.jsonl`;
const merge = (a, b) => {
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const o = { ...a };
    for (const k in b) o[k] = k in o ? merge(o[k], b[k]) : b[k];
    return o;
  }
  return a;
};
const shape = (v, depth = 0) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) {
    const items = v.slice(0, 5).map((x) => shape(x, depth + 1));
    return ['arr', items.length ? items.reduce(merge) : 'empty'];
  }
  if (typeof v === 'object') {
    if (depth > 6) return 'obj';
    const o = {};
    for (const k of Object.keys(v)) o[k] = shape(v[k], depth + 1);
    return o;
  }
  return typeof v;
};
const { PROVIDER_SURFACE } = await import(root + 'lib/providers/interface.js');
const methods = Object.values(PROVIDER_SURFACE).flat();
await import(root + 'lib/providers/index.js');
const { getAllProviders } = await import(root + 'lib/providers/registry.js');
for (const p of getAllProviders()) {
  const proto = Object.getPrototypeOf(p);
  for (const m of methods) {
    const owner = Object.prototype.hasOwnProperty.call(proto, m) ? proto
      : Object.prototype.hasOwnProperty.call(p, m) ? p : null;
    if (!owner || typeof owner[m] !== 'function') continue;
    const orig = owner[m];
    owner[m] = function (...args) {
      const r = orig.apply(this, args);
      const rec = (v) => {
        try { appendFileSync(OUT, JSON.stringify({ p: this?.name ?? p.name, m, s: shape(v) }) + '\n'); } catch {}
        return v;
      };
      return r && typeof r.then === 'function' ? r.then(rec) : rec(r);
    };
  }
}
