// carry.mjs <replay>: copy walk 5's store for <replay> into walks/6/<replay>/store.json and give each run
// the stage's own words (walks/5/<replay>/real/<n>-<actor>.md) as its account, as a revise in the same second.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
const W5 = new URL('../5/', import.meta.url).pathname, here = new URL('./', import.meta.url).pathname;
const rd = process.argv[2], task = process.argv[3];
const st = JSON.parse(readFileSync(`${W5}${rd}/store.json`));
let steps = existsSync(`${W5}${rd}/steps.json`) ? JSON.parse(readFileSync(`${W5}${rd}/steps.json`)) : JSON.parse(process.argv[4]);
steps = steps.slice().sort((a, b) => a[0] - b[0]);
const notes = [];
for (let i = 0; i < steps.length; i++) {
  const [n, actor, asOf] = steps[i]; if (actor === 'John') continue;
  const until = steps[i + 1] ? steps[i + 1][2] : '9999';
  const f = `${W5}${rd}/real/${n}-${actor}.md`; if (!existsSync(f)) { notes.push(`${n}-${actor}: no real file`); continue; }
  const words = readFileSync(f, 'utf8');
  const runs = Object.values(st.records).filter((vs) => vs[0].kind === 'run' && vs[0].by === actor && vs[0].at >= asOf.slice(0, 19) && vs[0].at < until);
  if (!runs.length) { notes.push(`${n}-${actor}: no run found`); continue; }
  const vs = runs[0], last = vs.at(-1);
  vs.push({ ...last, v: last.v + 1, op: 'revise', at: vs[0].at, by: actor, reason: "the stage's own words, as it posted them", fields: { ...last.fields, account: words } });
  notes.push(`${n}-${actor}: ${vs[0].id} given ${words.length} chars`);
}
st.log = [];
mkdirSync(`${here}${rd}`, { recursive: true });
writeFileSync(`${here}${rd}/store.json`, JSON.stringify(st, null, 1));
writeFileSync(`${here}${rd}/carry-log.txt`, notes.join('\n') + '\n');
console.log(rd, notes.length, 'steps;', notes.filter((x) => /no /.test(x)).join('; ') || 'all runs found');
