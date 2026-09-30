// LIN-3148: fetch the proxy data for a systematic monthly sample of Done tickets (cost lineages and each lineage's feedback with its [usage] lines), paced and cached.
// Usage: HARBOUR_LOCAL_BASE=http://127.0.0.1:NNNN node scripts/survey-effort-fetch.mjs [--months 2026-09] [--per-month 146] [--git data/survey-effort/git.json] [--cache data/survey-effort/cache]
// Reads the population from survey-effort-git.mjs's output, keeps tickets whose tracker state is Done, and takes every k-th
// ticket per merge month (sorted by number, from the first) so each month contributes about --per-month; the default is every second
// September ticket, since about half have no lineage left to read. When this survey was taken dispatch history
// was kept 30 days (it is lifetime-retained since LIN-3163, LIN-3157 B+D), so only tickets merged inside that window had lineages to read. Every response is cached to disk
// under the git-ignored data/ tree, so a re-run makes no proxy calls. Paced at one call per 4.2 s (≤15/min).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const base = (process.env.HARBOUR_LOCAL_BASE || '').replace(/\/$/, '') + '/api/proxy';
const perMonth = +arg('--per-month', 146);
const onlyMonths = arg('--months', '2026-09').split(',');
const gitFile = arg('--git', 'data/survey-effort/git.json');
const cache = arg('--cache', 'data/survey-effort/cache');
mkdirSync(cache, { recursive: true });

let last = 0; let calls = 0;
async function get(path) {
  const f = join(cache, path.replace(/[^a-zA-Z0-9-]+/g, '_') + '.json');
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const wait = last + 4200 - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now(); calls++;
  const res = await fetch(base + path);
  if (res.status === 429) { await new Promise((r) => setTimeout(r, 30000)); return get(path); }
  const body = res.ok ? await res.json() : { error: res.status };
  writeFileSync(f, JSON.stringify(body));
  return body;
}

// 1. Tracker state for every issue (paged, 250 a page).
const state = {};
let after = null;
do {
  const r = await get(`/issues?limit=250${after ? `&after=${encodeURIComponent(after)}` : ''}`);
  for (const i of r.issues || []) state[i.identifier] = i.state?.type;
  after = r.pageInfo?.hasNextPage ? r.pageInfo.endCursor : null;
} while (after);

// 2. Systematic sample per merge month.
const { rows } = JSON.parse(readFileSync(gitFile, 'utf8'));
const done = rows.filter((r) => state[r.id] === 'completed');
const months = [...new Set(done.map((r) => r.month))].filter((m) => onlyMonths.includes(m)).sort();
const sample = [];
for (const m of months) {
  const pool = done.filter((r) => r.month === m).sort((a, b) => +a.id.slice(4) - +b.id.slice(4));
  const k = Math.max(1, Math.floor(pool.length / perMonth));
  for (let i = 0; i < pool.length && sample.filter((s) => s.month === m).length < perMonth; i += k) sample.push(pool[i]);
}
console.error(`population: ${rows.length} merged tickets, ${done.length} Done; sample ${sample.length} (${months.map((m) => m + ':' + sample.filter((s) => s.month === m).length).join(' ')})`);

// 3. Per ticket: cost lineages and every lineage root's feedback (dispatch counts come from the runner's logs instead).
for (const [n, t] of sample.entries()) {
  const cost = await get(`/issues/${t.id}/cost`);
  for (const s of cost.workerSessions || []) await get(`/dispatch/${s.rootItemId}`);
  console.error(`${n + 1}/${sample.length} ${t.id} lineages=${(cost.workerSessions || []).length} calls=${calls}`);
}
writeFileSync(join(cache, '..', 'sample.json'), JSON.stringify({ population: rows.length, done: done.length, doneByMonth: Object.fromEntries(months.map((m) => [m, done.filter((r) => r.month === m).length])), sample: sample.map((s) => s.id), doneIds: done.map((r) => r.id) }));
console.error(`done; ${calls} proxy calls this run`);
