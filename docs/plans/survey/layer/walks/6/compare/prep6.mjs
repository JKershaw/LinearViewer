// prep6.mjs <name> <snapshots.json> <parent.json|-> <asOf> <replay-dir> <actor> <task> [area-notes.md]
// Writes compare/<name>/: ticket.md (child as captured then, parent's description and comments up to then, and the area notes if given),
// store.json (replay store cut at asOf), brief.txt (computed by the round 6 model on the cut store).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const [name, snapF, parentF, asOf, rd, actor, task, notesF] = process.argv.slice(2);
const out = new URL(`./${name}/`, import.meta.url).pathname; mkdirSync(out, { recursive: true });
const sj = JSON.parse(readFileSync(snapF)); const snaps = (sj.snapshots || sj).slice().sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
const lim = new Date(Date.parse(asOf) + 60000).toISOString(); const snap = snaps.filter((x) => x.capturedAt <= lim).at(-1).snapshot;
const cm = (c) => `### Comment ${c.createdAt || ''}\n\n${c.body}\n`;
let md = `# Ticket ${snap.title}\n\n(as Harbour captured it at the start of this stage)\n\n## Description\n\n${snap.description || ''}\n\n## Comments\n\n${(snap.comments || []).map(cm).join('\n')}`;
if (parentF !== '-') { const pj = JSON.parse(readFileSync(parentF)); const p = pj.issue || pj;
  md += `\n\n# Parent ticket ${p.identifier}: ${p.title}\n\n(description as it stands now; comments up to ${asOf})\n\n## Description\n\n${p.description || ''}\n\n## Comments\n\n${(p.comments || []).filter((c) => c.createdAt <= asOf).map(cm).join('\n')}`; }
if (notesF && existsSync(notesF)) md += `\n\n# Area notes (as committed on main before ${asOf})\n\n${readFileSync(notesF, 'utf8')}`;
if (!existsSync(out + 'ticket.md') || notesF) writeFileSync(out + 'ticket.md', md);
const st = JSON.parse(readFileSync(`${rd}/store.json`)); const recs = {};
for (const [id, vs] of Object.entries(st.records)) { const k = vs.filter((v) => v.at <= asOf); if (k.length) recs[id] = k; }
writeFileSync(out + 'store.json', JSON.stringify({ next: st.next, records: recs, log: [] }, null, 1));
const model = new URL('../model/layer.mjs', import.meta.url).pathname;
const b = execFileSync('node', [model, 'brief', actor, '--task', task, '--as-of', asOf, '--text', '--store', out + 'store.json'], { encoding: 'utf8' });
writeFileSync(out + 'brief.txt', b);
const s2 = JSON.parse(readFileSync(out + 'store.json')); s2.log = []; writeFileSync(out + 'store.json', JSON.stringify(s2, null, 1));
writeFileSync(out + 'info.json', JSON.stringify({ name, asOf, actor, task }, null, 1));
console.log(name, 'ticket', readFileSync(out + 'ticket.md', 'utf8').length, 'brief', Buffer.byteLength(b), 'records', Object.keys(recs).length);
