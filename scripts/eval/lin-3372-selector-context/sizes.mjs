import { bundleAt, measure, selectorArgs, promptOf } from './harness.mjs';
import { POINTS } from './points.mjs';
import { writeFileSync, mkdirSync } from 'fs';
mkdirSync('prompts', { recursive: true });
const rows = [];
for (const p of POINTS) {
  const { issue, context } = await bundleAt(p.issue, p.at, p.states);
  const m = measure(issue, context);
  writeFileSync(`prompts/${p.id}-${p.issue}.txt`, promptOf(selectorArgs(issue, context)));
  rows.push({ id: p.id, issue: p.issue, snap: (issue.snapshotAt||"").slice(11,19), kids: context.children.length, runs: context.runs.length, ...m });
}
console.table(rows);
