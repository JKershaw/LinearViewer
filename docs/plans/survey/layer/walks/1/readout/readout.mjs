// Walk 1 read-out: each stage's brief as of its start, beside what it could read on the tracker.
// Usage: node readout.mjs <task-record-id>   (writes briefs/<stage>.txt and prints a table)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const here = (p) => new URL(p, import.meta.url).pathname;
const task = process.argv[2];
if (!task) { console.error('usage: node readout.mjs <task-record-id>'); process.exit(2); }
const baseline = JSON.parse(execFileSync('node', [here('baseline.mjs')], { encoding: 'utf8' }));
const store = here('../fill/store.json'), layer = here('../model/layer.mjs');
mkdirSync(here('briefs'), { recursive: true });
const rows = [];
for (const b of baseline) {
  const raw = execFileSync('node', [layer, 'brief', b.stage, '--task', task, '--as-of', b.at, '--store', store], { encoding: 'utf8' });
  const r = JSON.parse(raw);
  writeFileSync(here(`briefs/${b.stage}.txt`), r.text + '\n');
  rows.push({ stage: b.stage, at: b.at, trackerChars: b.chars, briefChars: r.size.chars,
    open: r.carries.open, instructions: r.carries.instructions, records: r.size.records });
}
writeFileSync(here('readout.json'), JSON.stringify(rows, null, 1) + '\n');
for (const r of rows) console.log(r.stage.padEnd(15), 'tracker', String(r.trackerChars).padStart(6), 'brief', String(r.briefChars).padStart(6),
  'open', r.open, 'instr', r.instructions, JSON.stringify(r.records));
const s = JSON.parse(readFileSync(store, 'utf8'));
const byKind = {}; for (const rec of Object.values(s.records)) byKind[rec.kind] = (byKind[rec.kind] || 0) + 1;
console.log('records by kind', JSON.stringify(byKind), 'hits', s.hits.length,
  'by rule', JSON.stringify(s.hits.reduce((m, h) => ((m[h.rule] = (m[h.rule] || 0) + 1), m), {})));
