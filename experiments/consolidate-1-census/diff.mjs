// diff.mjs <a.json> <b.json> — groups that disappeared / appeared between two census runs.
import { readFileSync } from 'node:fs';
const [a, b] = process.argv.slice(2).map((p) => JSON.parse(readFileSync(p, 'utf8')));
const key = (g) => `${g.detector}|${g.decision.replace(/~?\d+ (statements|copies)[^,]*/g, '').replace(/\s+/g, ' ')}`;
const ka = new Map(a.groups.map((g) => [key(g), g])), kb = new Map(b.groups.map((g) => [key(g), g]));
const gone = [...ka.keys()].filter((k) => !kb.has(k)).map((k) => ka.get(k));
const born = [...kb.keys()].filter((k) => !ka.has(k)).map((k) => kb.get(k));
const fmt = (g) => `${g.detector} ${g.fileCount}f ${g.decision.slice(0, 110)} | ${g.files.slice(0, 4).join(' ')}`;
console.log(JSON.stringify({ from: a.commit.slice(0, 8), to: b.commit.slice(0, 8), totals: { from: { groups: a.totals.groups, sites: a.totals.sites }, to: { groups: b.totals.groups, sites: b.totals.sites } }, gone: gone.map(fmt), born: born.map(fmt) }, null, 1));
