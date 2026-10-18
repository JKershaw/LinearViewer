// Behaviour-preserving text rewrites of one source file, for the perturbation probe (LIN-3628,
// from experiments/consolidate-4-entrance/4c/probe/perturb.cjs). A test that fails under one of
// these depends on text, not behaviour. Only the three generic rewrites live here; the others in
// experiments/ anchor on one module.
import * as acorn from 'acorn';

const parseOpts = { ecmaVersion: 'latest', allowHashBang: true, allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, allowImportExportEverywhere: true };
const parseWith = (src, extra) => {
  let err;
  for (const sourceType of ['module', 'script']) {
    try { return acorn.parse(src, { ...parseOpts, sourceType, ...extra }); } catch (e) { err = e; }
  }
  throw err;
};

// +2 spaces on every non-empty line. Changes the text of a multi-line template literal, by design.
export const indent = (src) => src.split('\n').map((l) => (l.length ? `  ${l}` : l)).join('\n');

// Comments blanked with spaces (newlines kept, so line numbers hold).
export const nocomment = (src) => {
  const comments = [];
  parseWith(src, { onComment: comments });
  const a = src.split('');
  for (const c of comments) for (let i = c.start; i < c.end; i++) if (a[i] !== '\n') a[i] = ' ';
  return a.join('');
};

// Names and keywords only (not strings, comments or template text), so a word replacement touches code.
const codeMask = (src) => {
  const toks = [];
  parseWith(src, { onToken: toks });
  const keep = new Array(src.length).fill(false);
  for (const t of toks) if (t.type.label === 'name' || t.type.keyword) for (let i = t.start; i < t.end; i++) keep[i] = true;
  return keep;
};

// Rename identifiers by a { from: to } map. The map must hold local names only: every occurrence of
// a name in code is renamed, property names included, so an exported name or an option key would break callers.
export const rename = (map) => (src) => {
  const keep = codeMask(src);
  return src.replace(/[A-Za-z_$][\w$]*/g, (w, off) => (Object.hasOwn(map, w) && keep[off] ? map[w] : w));
};

export const invertMap = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));

// The AST without positions.
const strip = (n) => {
  if (Array.isArray(n)) return n.map(strip);
  if (n && typeof n === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(n)) if (!['start', 'end', 'loc', 'range'].includes(k)) out[k] = strip(v);
    return out;
  }
  return n;
};
export const astEqual = (a, b) => JSON.stringify(strip(parseWith(a))) === JSON.stringify(strip(parseWith(b)));

// A custom rewrites file: default export { name: (text) => text }.
export const loadPerturbModule = async (url) => {
  const mod = await import(url);
  const table = mod.default;
  if (!table || typeof table !== 'object' || Object.values(table).some((f) => typeof f !== 'function')) {
    throw new Error('a perturb module must default-export an object of name → (text) => text');
  }
  return table;
};

// The rewrites to run: indent and nocomment always, rename when a map is given, then any custom ones.
export const buildRewrites = ({ renameMap = null, custom = {} } = {}) => {
  const out = { indent, nocomment };
  if (renameMap) out.rename = rename(renameMap);
  return { ...out, ...custom };
};
