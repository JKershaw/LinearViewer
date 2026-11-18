// tally.mjs: per step, brief bytes (walk 7 vs walk 8), queries, queries touching project or lessons, refusals noted.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
const here = (p) => new URL(p, import.meta.url).pathname;
const rows = [];
for (const r of ['replay-4450', 'replay-4446', 'replay-4469']) {
  for (const s of readdirSync(here(`${r}/steps`)).sort((a, b) => parseInt(a) - parseInt(b))) {
    const b8 = existsSync(here(`${r}/steps/${s}/brief.json`)) ? JSON.parse(readFileSync(here(`${r}/steps/${s}/brief.json`))).bytes : null;
    const p7 = here(`../7/${r}/steps/${s}/brief.json`);
    const b7 = existsSync(p7) ? JSON.parse(readFileSync(p7)).bytes : null;
    const q = existsSync(here(`${r}/steps/${s}/queries.json`)) ? JSON.parse(readFileSync(here(`${r}/steps/${s}/queries.json`))) : [];
    const proj = q.filter((x) => JSON.stringify(x.args || x.q || '').match(/project|lesson/)).length;
    const notes = existsSync(here(`${r}/steps/${s}/notes.md`)) ? readFileSync(here(`${r}/steps/${s}/notes.md`), 'utf8') : '';
    const refusals = (notes.match(/\{"error":|`?field \w+ does not belong|a verdict must have on|no such record/gi) || []).length;
    rows.push({ r, s, b7, b8, d: b7 && b8 ? Math.round((b8 - b7) / b7 * 100) : null, q: q.length, proj, refusals });
  }
}
console.log('replay | step | w7 bytes | w8 bytes | change % | queries | project/lesson queries | refusal mentions');
for (const x of rows) console.log([x.r, x.s, x.b7, x.b8, x.d, x.q, x.proj, x.refusals].join(' | '));
