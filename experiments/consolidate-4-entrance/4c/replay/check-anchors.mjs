// Prints each self-check mutant's anchor count in a tree (each must be 1).
import { readFileSync } from 'node:fs';
import path from 'node:path';
const base = process.argv[2];
const src = readFileSync(new URL('./selfcheck.mjs', import.meta.url), 'utf8');
const body = src.slice(src.indexOf("const E = 'lib/dispatch-entrance.js';"), src.indexOf('const dir = path.join(TOOL'));
const S = 'S', P = 'P', R = 'R', K = 'K', ANY_KINDS = null;
const MUTANTS = new Function('S', 'P', 'R', 'K', 'ANY_KINDS', body + '\nreturn MUTANTS;')(S, P, R, K, ANY_KINDS);
for (const m of MUTANTS) {
  const t = readFileSync(path.join(base, m.file), 'utf8');
  const occ = m.fromRe ? (t.match(new RegExp(m.fromRe, 'g')) || []).length : t.split(m.from).length - 1;
  console.log(String(occ).padStart(2), m.id);
}
