// Replay harness (from walk 4; used unchanged in walk 7). Usage (from the walk folder):
//   node step.mjs <replay-dir> before <n> <actor> <task-id> <as-of>
//   node step.mjs <replay-dir> after  <n> <actor> <task-id>
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const here = (p) => new URL(p, import.meta.url).pathname;
const [rd, mode, n, actor, task, asOf] = process.argv.slice(2);
const dir = here(`${rd}/steps/${n}-${actor}/`); mkdirSync(dir, { recursive: true });
const store = here(`${rd}/store.json`);
const layer = (...a) => execFileSync('node', [here('model/layer.mjs'), ...a], { encoding: 'utf8', env: { ...process.env, LAYER_STORE: store } });
if (mode === 'before') {
  const b = JSON.parse(layer('brief', actor, '--task', task, ...(asOf ? ['--as-of', asOf] : [])));
  const t = layer('brief', actor, '--task', task, ...(asOf ? ['--as-of', asOf] : []), '--text');
  // the two brief calls above are the harness's, not the stage's: drop them from the query log
  const st = JSON.parse(readFileSync(store, 'utf8')); st.log = st.log.filter((x, i) => !(i >= st.log.length - 2 && x.by === actor && (x.cmd === 'brief' || (x.q || [])[0] === 'brief'))); writeFileSync(store, JSON.stringify(st, null, 1));
  writeFileSync(dir + 'brief.txt', t); writeFileSync(dir + 'brief.json', JSON.stringify(b, null, 1));
  console.log(actor, 'brief', b.bytes, 'bytes; carries', JSON.stringify(b.carries));
} else {
  const s = JSON.parse(layer('show', '--task', task, '--by', 'Harbour'));
  const st0 = JSON.parse(readFileSync(store, 'utf8')); if (st0.log.at(-1)?.by === 'Harbour') st0.log.pop(); writeFileSync(store, JSON.stringify(st0, null, 1));
  const lines = [s.task, ...s.records].map(r => `${r.id} ${r.kind} v${r.v} [${r.state}]${r.stale ? ' STALE(' + [].concat(r.stale).join('; ') + ')' : ''}${r.to ? ' to ' + r.to : ''}${r.answeredBy ? ' answered-by ' + r.answeredBy.id : ''} by ${r.by}`);
  writeFileSync(dir + 'show.txt', lines.join('\n') + '\n' + ((s.overlap || []).length ? 'overlap: ' + JSON.stringify(s.overlap) + '\n' : ''));
  const st = JSON.parse(readFileSync(store, 'utf8'));
  const q = st.log.filter(x => x.by === actor);
  writeFileSync(dir + 'queries.json', JSON.stringify(q, null, 1));
  const refusedNote = '(refusals: see notes.md)';
  console.log(actor, 'after: in task', s.records.length, 'open', s.records.filter(r => r.state === 'open').length, 'stale', s.records.filter(r => r.stale).length, '| queries by actor', q.length, refusedNote);
}
