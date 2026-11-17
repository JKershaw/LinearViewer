// Walk 4 numbers per replay: brief sizes vs the child ticket snapshot, queries, final open and stale records.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
const here = (p) => new URL(p, import.meta.url).pathname;
const runs = JSON.parse(readFileSync(here('replays.json')));
for (const [rd, { snaps: snapF, task }] of Object.entries(runs)) {
  if (!existsSync(here(`${rd}/store.json`))) continue;
  const sj = JSON.parse(readFileSync(here(snapF))); const snaps = (sj.snapshots || sj).slice().sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const size = (x) => (x.snapshot.description || '').length + (x.snapshot.comments || []).reduce((m, c) => m + (c.body || '').length, 0);
  const st = JSON.parse(readFileSync(here(`${rd}/store.json`)));
  console.log(`== ${rd}`);
  for (const d of readdirSync(here(`${rd}/steps`)).sort((a, b) => parseInt(a) - parseInt(b))) {
    const actor = d.replace(/^\d+-/, ''); const q = st.log.filter((x) => x.by === actor).length;
    const bf = here(`${rd}/steps/${d}/brief.json`); if (!existsSync(bf)) { console.log(d.padEnd(18), '(no brief)', 'queries', q); continue; }
    const b = JSON.parse(readFileSync(bf)); const t = b.asOf; const snap = snaps.filter((x) => x.capturedAt <= new Date(Date.parse(t) + 60000).toISOString()).at(-1);
    console.log(d.padEnd(18), 'ticket', String(snap ? size(snap) : '-').padStart(6), 'brief', String(b.bytes).padStart(6), 'queries', String(q).padStart(3), JSON.stringify(b.carries));
  }
  const cur = Object.values(st.records).map((vs) => vs.at(-1));
  const open = cur.filter((r) => r.state === 'open' && (r.in === task || r.to === task));
  console.log('open at end (in or to task):', open.map((r) => `${r.id}->${r.to ?? '-'}`).join(' '));
  console.log('records', cur.length, 'versions', Object.values(st.records).flat().length, 'queries total', st.log.length);
}
