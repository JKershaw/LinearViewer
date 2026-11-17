// Walk 3 replay harness. Usage (from walks/3):
//   node step.mjs <replay-dir> before <n> <stage> <task-id> <as-of>
//   node step.mjs <replay-dir> after  <n> <stage> <task-id>
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const here = (p) => new URL(p, import.meta.url).pathname;
const [rd, mode, n, stage, task, asOf] = process.argv.slice(2);
const dir = here(`${rd}/steps/${n}-${stage}/`); mkdirSync(dir, { recursive: true });
const store = here(`${rd}/store.json`);
const layer = (...a) => execFileSync('node', [here('model/layer.mjs'), ...a, '--store', store], { encoding: 'utf8' });
if (mode === 'before') {
  const b = JSON.parse(layer('brief', stage, '--task', task, ...(asOf ? ['--as-of', asOf] : [])));
  const t = layer('brief', stage, '--task', task, ...(asOf ? ['--as-of', asOf] : []), '--text');
  writeFileSync(dir + 'brief.txt', t); writeFileSync(dir + 'brief.json', JSON.stringify(b, null, 1));
  console.log(stage, 'brief', b.size.textBytes, 'bytes; carries', JSON.stringify(b.carries));
} else {
  const s = JSON.parse(layer('show', '--task', task, '--by', 'Harbour'));
  const lines = [s.task, ...s.records].map(r => `${r.id} ${r.kind} v${r.v} [${r.state}]${r.stale ? ' STALE' : ''}${r.to ? ' to ' + r.to : ''} by ${r.by}`);
  writeFileSync(dir + 'show.txt', lines.join('\n') + '\n');
  const c = JSON.parse(layer('check')); writeFileSync(dir + 'check.json', JSON.stringify(c, null, 1));
  const st = JSON.parse(readFileSync(store, 'utf8'));
  const q = st.queries.filter(x => x.by === stage);
  writeFileSync(dir + 'queries.json', JSON.stringify(q, null, 1));
  console.log(stage, 'after: in task', s.records.length, 'open', s.records.filter(r => r.state === 'open').length, 'stale', s.records.filter(r => r.stale).length, '| problems', c.problems.length, 'stale(all)', c.stale.length, '| queries by stage', q.length);
}
