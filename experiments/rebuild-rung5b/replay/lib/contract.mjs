// The DOM contract: what outsiders select on.
//   - every data-* attribute (name AND value) — data-id/status/section/parent
//     are documented in public/llms.txt; data-testid is the e2e seam
//     (tests/helpers.js SELECTORS); the rest are read by public/*.js
//   - every id attribute
//   - every class token that a consumer names: public/*.js (minified vendor
//     files excluded), public/*.css, public/llms.txt, tests/{unit,e2e}/*.js,
//     tests/helpers.js, tests/fixtures/*.js
// plus the keyed nesting of those tokens (".node > .line" in llms.txt).
// The consumer index is rebuilt from the repo at run time (read-only).
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './load.mjs';
import { walkElements } from './html.mjs';

const TOKEN_RE = /[A-Za-z_][A-Za-z0-9_-]*/g;

function filesIn(dir, pred) {
  const abs = path.join(REPO, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).filter(pred).map(f => path.join(abs, f));
}

export function buildConsumerIndex() {
  const cats = {
    'public-js': filesIn('public', f => f.endsWith('.js') && !f.endsWith('.min.js')),
    'public-css': filesIn('public', f => f.endsWith('.css')),
    'llms.txt': [path.join(REPO, 'public/llms.txt')],
    'tests-e2e': filesIn('tests/e2e', f => f.endsWith('.js')),
    'tests-unit': filesIn('tests/unit', f => f.endsWith('.js')),
    'tests-helpers': [path.join(REPO, 'tests/helpers.js'), ...filesIn('tests/fixtures', f => f.endsWith('.js'))]
  };
  const index = {};
  for (const [cat, files] of Object.entries(cats)) {
    const set = new Set();
    for (const f of files) { let s = ''; try { s = fs.readFileSync(f, 'utf8'); } catch { continue; } for (const m of s.matchAll(TOKEN_RE)) set.add(m[0]); }
    index[cat] = set;
  }
  return index;
}

export function makeContract(index) {
  const all = new Set();
  for (const set of Object.values(index)) for (const t of set) all.add(t);
  const classCache = new Map();
  return {
    isAttr: (name) => name === 'id' || name.startsWith('data-'),
    classes: {
      has(c) {
        if (classCache.has(c)) return classCache.get(c);
        const v = all.has(c);
        classCache.set(c, v);
        return v;
      }
    },
    referencedBy(token) { return Object.entries(index).filter(([, s]) => s.has(token)).map(([k]) => k); }
  };
}

/** Accumulates what the OLD side emits, for the requirements inventory. */
export class Inventory {
  constructor() { this.attrs = new Map(); this.testids = new Map(); this.ids = new Map(); this.classes = new Map(); }
  add(module, tree) {
    for (const [el] of walkElements(tree)) {
      for (const [k, v] of el.attrs || []) {
        if (k === 'class') { for (const c of v.split(' ').filter(Boolean)) bump(this.classes, c, module); continue; }
        if (k === 'data-testid') bump(this.testids, v.replace(/\d+/g, 'N').replace(/[a-f0-9]{8}-[a-f0-9-]{27}/g, 'UUID'), module);
        if (k === 'id') bump(this.ids, v, module);
        if (k.startsWith('data-')) bump(this.attrs, k, module);
      }
    }
  }
  toJSON(contract) {
    const fmt = (m, withRefs) => [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([k, mods]) => ({ token: k, modules: [...mods].sort(), ...(withRefs ? { referencedBy: contract.referencedBy(k) } : {}) }));
    return { dataAttributes: fmt(this.attrs, false), testids: fmt(this.testids, false), ids: fmt(this.ids, false), classes: fmt(this.classes, true) };
  }
}
function bump(map, k, module) { if (!map.has(k)) map.set(k, new Set()); map.get(k).add(module); }
