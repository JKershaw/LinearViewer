// LIN-3147: fleet dispatches per ISO week, from simple-dispatcher's own run logs ("Found dispatch item") dated by its oplog where it covers the item (from 12 July) and by position within the log file otherwise.
// Usage: node scripts/survey-growth-fleet.mjs [sdStateDir=~/development/simple-dispatcher/state] [--json]
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { isoWeek } from './survey-growth-tracker.mjs';

const dir = process.argv.slice(2).find((a) => !a.startsWith('--')) || join(homedir(), 'development/simple-dispatcher/state');

// Exact first-seen time per dispatch item, from the oplog (hook and feedback events carry "item").
const oplogTs = new Map();
for (const line of readFileSync(join(dir, 'oplog.jsonl'), 'utf8').split('\n')) {
  if (!line.includes('"item"')) continue;
  let d; try { d = JSON.parse(line); } catch { continue; }
  if (d.item && !oplogTs.has(d.item)) oplogTs.set(d.item, d.ts);
}

// Run logs have no per-line timestamps: a log runs from the time in its name (local) to its mtime.
const logs = readdirSync(dir).filter((f) => /^dispatcher(\.run-.*)?\.log$/.test(f)).map((f) => {
  const m = f.match(/(\d{8})-(\d{6})\.log$/);
  const end = statSync(join(dir, f)).mtime;
  const start = m ? new Date(`${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)}T${m[2].slice(0, 2)}:${m[2].slice(2, 4)}:${m[2].slice(4)}`) : end;
  return { f, start, end };
}).sort((a, b) => a.start - b.start);

const items = new Map();
for (const { f, start, end } of logs) {
  const lines = readFileSync(join(dir, f), 'utf8').split('\n');
  lines.forEach((l, i) => {
    const m = l.match(/^Found dispatch item: ([0-9a-f-]{36})/);
    if (!m || items.has(m[1])) return;
    const block = lines.slice(i + 1, i + 8);
    const ws = (block.find((b) => /^ {2}Workspace: /.test(b)) || '').replace(/^ {2}Workspace: /, '').toLowerCase();
    // Model tier from the payload: frontier, mid, or cheap (every OpenRouter model seen here); unstated means the harness default.
    const model = (block.find((b) => /^ {2}Model \(payload\): /.test(b)) || '').replace(/^ {2}Model \(payload\): /, '');
    const tier = !model ? 'unstated' : /opus/i.test(model) ? 'frontier' : /sonnet/i.test(model) ? 'mid' : 'cheap';
    const issue = ((block.find((b) => /^ {2}Issue: /.test(b)) || '').match(/\b[A-Z]+-\d+\b/) || [null])[0];
    // A fresh session is claimed; a follow-up beat is signalled or resumed into a held one.
    const next = lines.slice(i + 1, i + 12).join('\n').split(/\nFound dispatch item/)[0];
    const shape = /\[follow-up\]/.test(next) ? 'followUp' : /Claimed item/.test(next) ? 'launch' : 'other';
    const est = new Date(start.getTime() + (end - start) * (i / Math.max(1, lines.length)));
    items.set(m[1], { ws, issue, shape, tier, at: oplogTs.get(m[1]) || est.toISOString(), dated: oplogTs.has(m[1]) ? 'oplog' : 'log position', log: f });
  });
}

const weeks = {};
for (const it of items.values()) {
  const w = (weeks[isoWeek(it.at)] ||= { all: 0, harbour: 0, launch: 0, followUp: 0, other: 0, tiers: { frontier: 0, mid: 0, cheap: 0, unstated: 0 }, harbourWithIssue: 0, issues: new Set(), datedByOplog: 0 });
  w.all++;
  if (it.dated === 'oplog') w.datedByOplog++;
  if (it.ws === 'linearviewer' || it.ws === 'harbour-cat' || it.ws === 'simple-dispatcher') {
    w.harbour++; w[it.shape]++;
    if (it.shape === 'launch') w.tiers[it.tier]++;
    if (it.issue) { w.harbourWithIssue++; w.issues.add(it.issue); }
  }
}
const rows = Object.keys(weeks).sort().map((wk) => ({ week: wk, ...weeks[wk], issues: weeks[wk].issues.size }));
const out = { logs: logs.length, firstLog: logs[0]?.f, items: items.size, oplogItems: oplogTs.size, oplogMatched: [...items.values()].filter((i) => i.dated === 'oplog').length, rows };

if (process.argv.includes('--json')) console.log(JSON.stringify(out));
else {
  console.log(`${out.logs} logs from ${out.firstLog}; ${out.items} distinct items (${out.oplogMatched} dated by oplog, which has ${out.oplogItems})`);
  console.log('week        all harbour launch followUp other withIssue distinctIssues datedByOplog  launches by tier f/m/c/unstated');
  for (const r of rows) console.log(`${r.week} ${String(r.all).padStart(5)} ${String(r.harbour).padStart(7)} ${String(r.launch).padStart(6)} ${String(r.followUp).padStart(8)} ${String(r.other).padStart(5)} ${String(r.harbourWithIssue).padStart(9)} ${String(r.issues).padStart(14)} ${String(r.datedByOplog).padStart(12)}  ${r.tiers.frontier}/${r.tiers.mid}/${r.tiers.cheap}/${r.tiers.unstated}`);
}
