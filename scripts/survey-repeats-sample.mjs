// LIN-3174: a systematic sample of the repeat legs in the census (every k-th by launch time, from the middle of the first interval), with the leg before each, into a git-ignored file.
// Usage: node scripts/survey-repeats-sample.mjs [--n 64] [--census data/survey-repeats/census.json] [--out data/survey-repeats/sample.json]
// k = floor(repeats / n); the start is floor(k / 2), fixed before any ticket was read. Every kind is sampled in proportion to its
// share of repeats, and every week in proportion to its repeats, because the order is launch time across kinds.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const n = +arg('--n', 64);
const census = JSON.parse(readFileSync(arg('--census', 'data/survey-repeats/census.json'), 'utf8'));
const out = arg('--out', 'data/survey-repeats/sample.json');
const repeats = census.legs.filter((l) => l.repeat).sort((a, b) => a.at.localeCompare(b.at));
const k = Math.floor(repeats.length / n); const start = Math.floor(k / 2);
const legs = repeats.filter((_, i) => i >= start && (i - start) % k === 0).slice(0, n);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), repeats: repeats.length, k, start, legs }, null, 1));
const t = (f) => legs.reduce((m, l) => ((m[f(l)] = (m[f(l)] || 0) + 1), m), {});
console.log(`repeats=${repeats.length} k=${k} start=${start} sampled=${legs.length} tickets=${new Set(legs.map((l) => l.issue)).size}`, t((l) => l.kind), t((l) => l.at.slice(0, 7)));
