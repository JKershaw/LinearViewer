// analyse.mjs: walk 7 read-out. Brief sizes against walk 5 at the same steps, refusals noted by stages, stale per step, what is open at the end.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
const here = (p) => new URL(p, import.meta.url).pathname;
for (const r of ['replay-4450', 'replay-4446', 'replay-4469']) {
  const steps = readdirSync(here(`${r}/steps`)).sort((a, b) => parseInt(a) - parseInt(b));
  console.log(`\n## ${r}`);
  console.log('step | brief bytes (walk 5) | stale after | refusals noted');
  for (const s of steps) {
    const b = existsSync(here(`${r}/steps/${s}/brief.json`)) ? JSON.parse(readFileSync(here(`${r}/steps/${s}/brief.json`))).bytes : '-';
    const w5p = here(`../5/${r}/steps/${s}/brief.json`);
    const b5 = existsSync(w5p) ? JSON.parse(readFileSync(w5p)).bytes : '-';
    const show = existsSync(here(`${r}/steps/${s}/show.txt`)) ? readFileSync(here(`${r}/steps/${s}/show.txt`), 'utf8') : '';
    const stale = (show.match(/STALE/g) || []).length;
    const notes = existsSync(here(`${r}/steps/${s}/notes.md`)) ? readFileSync(here(`${r}/steps/${s}/notes.md`), 'utf8') : '';
    const ref = (notes.match(/"error"\s*:/g) || []).length;
    console.log(`${s} | ${b} (${b5}) | ${stale} | ${ref}`);
  }
  const last = steps.at(-1), show = readFileSync(here(`${r}/steps/${last}/show.txt`), 'utf8');
  console.log('open at end:', show.split('\n').filter((l) => /\[open\]/.test(l)).map((l) => l.replace(/ v\d+ \[open\]/, '')).join('; ') || 'none');
}
