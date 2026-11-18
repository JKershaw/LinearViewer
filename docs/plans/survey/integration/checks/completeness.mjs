// Every census row (C1–C5 site tables) must be placed in checks/placement.md.
// Usage: node completeness.mjs  (run from this folder)  → prints missing ids, exit 1 if any.
import { readFileSync, readdirSync } from 'node:fs';
const dir = new URL('../', import.meta.url);
const census = readdirSync(new URL('census/', dir)).filter(f => /^C\d.*\.md$/.test(f));
const ids = new Map();
for (const f of census) for (const m of readFileSync(new URL(`census/${f}`, dir), 'utf8').matchAll(/^\| (C\d-[A-D]?\d{2}) \|/gm)) {
  const [c] = m[1].split('-'); (ids.get(c) || ids.set(c, new Set()).get(c)).add(m[1]);
}
const appendix = readFileSync(new URL('checks/placement.md', dir), 'utf8');
const missing = [];
for (const [c, set] of ids) {
  // C5 rows carry a letter (A05); C1–C4 rows are bare numbers. The section runs from its bold heading to the next.
  const start = appendix.indexOf(`**${c} (`);
  const next = appendix.slice(start + 1).search(/\n\*\*C\d \(/);
  const para = next < 0 ? appendix.slice(start) : appendix.slice(start, start + 1 + next);
  const placed = new Set();
  if (/all rows/.test(para)) set.forEach(id => placed.add(id));
  for (const m of para.matchAll(/\b([A-D]?)(\d{2})(?:–([A-D]?)(\d{2}))?\b/g)) {
    const from = +m[2], to = m[4] ? +m[4] : from;
    for (let n = from; n <= to; n++) placed.add(`${c}-${m[1]}${String(n).padStart(2, '0')}`);
  }
  for (const id of set) if (!placed.has(id)) missing.push(id);
  console.log(`${c}: ${set.size} rows, ${[...set].filter(id => placed.has(id)).length} placed`);
}
console.log(missing.length ? `MISSING: ${missing.join(', ')}` : 'All census rows placed.');
process.exit(missing.length ? 1 : 0);
