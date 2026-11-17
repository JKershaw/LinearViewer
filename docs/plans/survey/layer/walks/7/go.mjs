// go.mjs <replay> <task> <n>: record step n-1 (if any), brief step n from steps.json; prints the line for the stage prompt.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const here = (p) => new URL(p, import.meta.url).pathname;
const [rd, task, n] = process.argv.slice(2); const N = Number(n);
const steps = JSON.parse(readFileSync(here(`${rd}/steps.json`)));
const run = (...a) => process.stdout.write(execFileSync('node', [here('step.mjs'), ...a], { encoding: 'utf8' }));
const prev = steps.find((s) => s[0] === N - 1), cur = steps.find((s) => s[0] === N);
if (prev) run(rd, 'after', String(prev[0]), prev[1], task);
if (cur) { if (cur[1] !== 'John') run(rd, 'before', String(cur[0]), cur[1], task, cur[2]); console.log(`STEP=${cur[0]}-${cur[1]} STAGE=${cur[1]} START=${cur[3]}`); }
else console.log('done');
