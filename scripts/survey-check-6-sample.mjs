// LIN-3175: a fresh random sample of the why-legs-repeat census's repeat legs for the check's blind double-coding: none of the 64
// the paper coded, half from each month, seeded, into a git-ignored file in survey-repeats-sample.mjs's shape (so the paper's own
// fetch and digest scripts read it unchanged).
// Usage: node scripts/survey-check-6-sample.mjs [--n 80] [--seed 3175] [--census data/survey-repeats/census.json] [--exclude data/survey-repeats/sample.json] [--out data/check6/sample.json]
// Stratified by launch month (n/2 of August's repeats, n/2 of September's), each stratum a seeded shuffle, then put in launch order.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const n = +arg('--n', 80); let seed = +arg('--seed', 3175);
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const census = read(arg('--census', 'data/survey-repeats/census.json'));
const done = new Set(read(arg('--exclude', 'data/survey-repeats/sample.json')).legs.map((l) => l.item));
const out = arg('--out', 'data/check6/sample.json');
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const shuffle = (xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pool = census.legs.filter((l) => l.repeat && !done.has(l.item)).sort((a, b) => a.at.localeCompare(b.at));
const legs = ['2026-08', '2026-09'].flatMap((m) => shuffle(pool.filter((l) => l.at.startsWith(m))).slice(0, n / 2)).sort((a, b) => a.at.localeCompare(b.at));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), repeats: census.legs.filter((l) => l.repeat).length, pool: pool.length, seed: +arg('--seed', 3175), legs }, null, 1));
const t = (f) => legs.reduce((m, l) => ((m[f(l)] = (m[f(l)] || 0) + 1), m), {});
console.log(`pool=${pool.length} sampled=${legs.length} tickets=${new Set(legs.map((l) => l.issue)).size}`, t((l) => l.kind), t((l) => l.at.slice(0, 7)), t((l) => (l.round >= 3 ? '3+' : '2')));
