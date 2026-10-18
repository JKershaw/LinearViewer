#!/usr/bin/env node
// Groups that disappeared / appeared between two census runs (LIN-3628, from experiments/consolidate-1-census/diff.mjs).
// Usage: node census-diff.mjs <a.json> <b.json>   → JSON on stdout
// Pure: no acorn, no git. A group's key ignores its statement and copy counts, so a changed count is not gone + born.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const groupKey = (g) => `${g.detector}|${g.decision.replace(/~?\d+ (statements|copies)[^,]*/g, '').replace(/\s+/g, ' ')}`;

const fmt = (g) => `${g.detector} ${g.fileCount}f ${g.decision.slice(0, 110)} | ${g.files.slice(0, 4).join(' ')}`;

export const diffCensus = (a, b) => {
  const ka = new Map(a.groups.map((g) => [groupKey(g), g])), kb = new Map(b.groups.map((g) => [groupKey(g), g]));
  const gone = [...ka.keys()].filter((k) => !kb.has(k)).map((k) => ka.get(k));
  const born = [...kb.keys()].filter((k) => !ka.has(k)).map((k) => kb.get(k));
  return { from: a.commit.slice(0, 8), to: b.commit.slice(0, 8), totals: { from: { groups: a.totals.groups, sites: a.totals.sites }, to: { groups: b.totals.groups, sites: b.totals.sites } }, gone: gone.map(fmt), born: born.map(fmt) };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [pa, pb] = process.argv.slice(2);
  if (!pa || !pb) { console.error('usage: node census-diff.mjs <a.json> <b.json>'); process.exit(2); }
  const [a, b] = [pa, pb].map((p) => JSON.parse(readFileSync(p, 'utf8')));
  process.stdout.write(`${JSON.stringify(diffCensus(a, b), null, 1)}\n`);
}
