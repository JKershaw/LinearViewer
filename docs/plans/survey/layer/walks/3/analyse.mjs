// Walk 3 numbers per replay: brief sizes vs the child ticket snapshot, queries, final open records.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
const here = (p) => new URL(p, import.meta.url).pathname;
const runs = { 'replay-4450': ['../1/material/LIN-4450-snapshots.json', 'task-60'], 'replay-4472': ['../2/material/LIN-4472-snapshots.json', 'task-28'], 'replay-4455': ['../2/material/LIN-4455-snapshots.json', 'task-60'] };
for (const [rd, [snapF, task]] of Object.entries(runs)) {
  const sj = JSON.parse(readFileSync(here(snapF))); const snaps = (sj.snapshots || sj).slice().sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const size = (x) => (x.snapshot.description || '').length + (x.snapshot.comments || []).reduce((m, c) => m + (c.body || '').length, 0);
  const st = JSON.parse(readFileSync(here(`${rd}/store.json`)));
  console.log(`== ${rd}`);
  for (const d of readdirSync(here(`${rd}/steps`)).sort((a, b) => parseInt(a) - parseInt(b))) {
    const bf = here(`${rd}/steps/${d}/brief.json`); if (!existsSync(bf)) { console.log(d.padEnd(18), '(no brief)'); continue; }
    const b = JSON.parse(readFileSync(bf)); const t = b.asOf; const snap = snaps.filter((x) => x.capturedAt <= new Date(Date.parse(t) + 60000).toISOString()).at(-1);
    const stage = d.replace(/^\d+-/, ''); const q = st.queries.filter((x) => x.by === stage).length;
    console.log(d.padEnd(18), 'ticket', String(snap ? size(snap) : '-').padStart(6), 'brief', String(b.size.textBytes).padStart(6), 'queries', String(q).padStart(3), JSON.stringify(b.carries));
  }
  const V = Object.values(st.records).map((r) => ({ id: r.id, kind: r.kind, cur: r.versions.at(-1) }));
  const open = V.filter((r) => r.cur.state === 'open' && (r.cur.in === task || r.cur.to === task));
  console.log('open at end (in or to task):', open.map((r) => `${r.id}->${r.cur.to ?? '-'}`).join(' '));
  console.log('records', V.length, 'queries total', st.queries.length);
}
