/**
 * LIN-3604 replay comparer: `node compare.mjs old.jsonl new.jsonl`.
 *
 * Reports every input on which the two runs differ (any channel), the vacuity check on the
 * multi-fault pairs (the OLD run must answer a pair exactly as it answers its earlier step's
 * single fault), and a per-tag summary. Exit status is 1 on any difference or vacuous pair.
 */
import { readFileSync } from 'node:fs';
const [oldPath, newPath] = process.argv.slice(2);
const load = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const oldRun = load(oldPath);
const newRun = load(newPath);
if (oldRun.length !== newRun.length) { console.log(`COUNT MISMATCH: old ${oldRun.length} vs new ${newRun.length}`); process.exit(1); }

const CHANNELS = ['status', 'headers', 'flushed', 'body', 'calls', 'console', 'harnessError'];
let diffs = 0;
const byTag = new Map();
for (let i = 0; i < oldRun.length; i += 1) {
  const a = oldRun[i]; const b = newRun[i];
  const tag = (a.tag || '').split(':').slice(0, 2).join(':');
  const row = byTag.get(tag) || { n: 0, diff: 0 };
  row.n += 1;
  if (a.id !== b.id) { console.log(`ID MISMATCH at ${i}: ${a.id} vs ${b.id}`); process.exit(1); }
  const changed = CHANNELS.filter((c) => JSON.stringify(a[c]) !== JSON.stringify(b[c]));
  if (changed.length) {
    diffs += 1; row.diff += 1;
    if (diffs <= 25) {
      console.log(`DIFF ${a.id} [${a.tag}] channels: ${changed.join(', ')}`);
      for (const c of changed.slice(0, 2)) console.log(`   old ${c}: ${JSON.stringify(a[c]).slice(0, 400)}\n   new ${c}: ${JSON.stringify(b[c]).slice(0, 400)}`);
    }
  }
  byTag.set(tag, row);
}

// Vacuity guard: pair i<j must answer (in the OLD run) exactly as single i does.
const singles = new Map();
for (const r of oldRun) {
  const m = /^single:(\w+):(\d+):/.exec(r.tag || '');
  if (m) singles.set(`${m[1]}:${m[2]}`, r);
}
let vacuous = 0; let pairs = 0;
for (const r of oldRun) {
  const m = /^pair:(\w+):(\d+):(\d+):/.exec(r.tag || '');
  if (!m) continue;
  pairs += 1;
  const s = singles.get(`${m[1]}:${m[2]}`);
  if (!s || s.status !== r.status || s.body !== r.body) {
    vacuous += 1;
    if (vacuous <= 40) console.log(`VACUOUS ${r.tag}: pair answered ${r.status} ${r.body.slice(0, 120)} but earlier step answered ${s && s.status} ${s && s.body.slice(0, 120)}`);
  }
}
const harnessErrors = oldRun.filter((r) => r.harnessError).length + newRun.filter((r) => r.harnessError).length;

console.log('\nper class (inputs / differences):');
for (const [tag, row] of [...byTag].sort()) console.log(`  ${tag.padEnd(24)} ${String(row.n).padStart(5)} ${String(row.diff).padStart(5)}`);
console.log(`\ninputs ${oldRun.length}; differences ${diffs}; multi-fault pairs ${pairs}, vacuous ${vacuous}; harness errors ${harnessErrors}`);
process.exit(diffs || vacuous || harnessErrors ? 1 : 0);
