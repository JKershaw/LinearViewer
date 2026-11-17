// prep.mjs <name> <snapshots.json> <parent.json|-> <asOf> <replay-dir> <step-dir> <actor>
// Writes compare/<name>/: ticket.md (child ticket as Harbour captured it then, plus the parent's description and comments up to then),
// store.json (the replay's store cut to versions at or before asOf, no query log), brief.txt (the stage's brief), info.json.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
const [name, snapF, parentF, asOf, rd, stepDir, actor] = process.argv.slice(2);
const out = new URL(`./${name}/`, import.meta.url).pathname; mkdirSync(out, { recursive: true });
const sj = JSON.parse(readFileSync(snapF)); const snaps = (sj.snapshots || sj).slice().sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
const lim = new Date(Date.parse(asOf) + 60000).toISOString();
const snap = snaps.filter((x) => x.capturedAt <= lim).at(-1).snapshot;
const cm = (c) => `### Comment ${c.createdAt || ''}\n\n${c.body}\n`;
let md = `# Ticket ${snap.title}\n\n(as Harbour captured it at the start of this stage)\n\n## Description\n\n${snap.description || ''}\n\n## Comments\n\n${(snap.comments || []).map(cm).join('\n')}`;
if (parentF !== '-') { const pj = JSON.parse(readFileSync(parentF)); const p = pj.issue || pj;
  md += `\n\n# Parent ticket ${p.identifier}: ${p.title}\n\n(description as it stands now; comments up to ${asOf})\n\n## Description\n\n${p.description || ''}\n\n## Comments\n\n${(p.comments || []).filter((c) => c.createdAt <= asOf).map(cm).join('\n')}`; }
writeFileSync(out + 'ticket.md', md);
const st = JSON.parse(readFileSync(`${rd}/store.json`)); const recs = {};
for (const [id, vs] of Object.entries(st.records)) { const k = vs.filter((v) => v.at <= asOf); if (k.length) recs[id] = k; }
writeFileSync(out + 'store.json', JSON.stringify({ next: st.next, records: recs, log: [] }, null, 1));
copyFileSync(`${rd}/steps/${stepDir}/brief.txt`, out + 'brief.txt');
writeFileSync(out + 'info.json', JSON.stringify({ name, asOf, actor, stepDir }, null, 1));
console.log(name, 'ticket', md.length, 'store records', Object.keys(recs).length);
