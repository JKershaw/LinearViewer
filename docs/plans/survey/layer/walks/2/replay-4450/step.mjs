// Replay harness. Usage:
//   node step.mjs before <n> <stage> <task-id> <as-of>   -> steps/<n>-<stage>/brief.txt (+ brief.json)
//   node step.mjs after  <n> <stage> <task-id> [<as-of>] -> steps/<n>-<stage>/show.txt, check.json
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const here = (p) => new URL(p, import.meta.url).pathname;
const [mode, n, stage, task, asOf] = process.argv.slice(2);
const dir = here(`steps/${n}-${stage}/`); mkdirSync(dir, { recursive: true });
const layer = (...a) => execFileSync('node', [here('../model/layer.mjs'), ...a, '--store', here('store.json')], { encoding: 'utf8' });
if (mode === 'before') {
  const asStage = stage === 'leftover' ? 'implementation' : stage; // leftover has no declared stage
  const j = JSON.parse(layer('brief', asStage, '--task', task, ...(asOf ? ['--as-of', asOf] : [])));
  writeFileSync(dir + 'brief.txt', j.text + '\n'); writeFileSync(dir + 'brief.json', JSON.stringify(j, null, 1));
  console.log(stage, 'brief', j.size.textChars, 'chars; carries', JSON.stringify(j.carries));
} else {
  const s = JSON.parse(layer('show', '--task', task, ...(asOf ? ['--as-of', asOf] : [])));
  writeFileSync(dir + 'show.txt', s.text + '\n');
  const c = JSON.parse(layer('check')); writeFileSync(dir + 'check.json', JSON.stringify(c, null, 1));
  console.log(stage, 'after: records', s.carries.records, 'open', s.carries.open, 'stale', s.carries.stale, '| check ok', c.ok, 'problems', c.problems.length, 'stale', c.stale.length);
}
