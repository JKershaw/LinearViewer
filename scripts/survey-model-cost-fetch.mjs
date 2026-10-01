// LIN-3165: fetch each merged change's worker-session cost lineage (kind, model, effort, USD, duration per root session) from the local proxy's /issues/{id}/cost, into a git-ignored cache.
// Usage: node scripts/survey-model-cost-fetch.mjs [--since 2026-07-20] [--git data/survey-effort/git.json] [--out data/survey-model/cost.json] [--also LIN-1,LIN-2]
// Population: every ticket survey-effort-git.mjs names by a first-parent merge whose last merge is on or after --since (worker
// usage telemetry starts on 23 July, so earlier changes have no lineage cost), plus --also. Paced at one call per 4.6 s, under
// the survey's 15/min share. Resumable: a re-run keeps every row already fetched and fetches only what is missing.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SINCE = arg('--since', '2026-07-20');
const out = arg('--out', 'data/survey-model/cost.json');
const git = JSON.parse(readFileSync(arg('--git', 'data/survey-effort/git.json'), 'utf8'));
const also = (arg('--also', '') || '').split(',').filter(Boolean);
const B = `${process.env.HARBOUR_LOCAL_BASE}/api/proxy`;
const PACE_MS = 4600;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ids = [...new Set([...git.rows.filter((r) => r.lastMerge.slice(0, 10) >= SINCE).map((r) => r.id), ...also])];
const cache = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { since: SINCE, rows: {} };
mkdirSync(dirname(out), { recursive: true });
const todo = ids.filter((id) => !cache.rows[id]);
console.error(`${ids.length} tickets, ${todo.length} to fetch (~${Math.ceil((todo.length * PACE_MS) / 60000)} min)`);
let n = 0;
for (const id of todo) {
  for (;;) {
    await sleep(PACE_MS);
    let res;
    try { res = await fetch(`${B}/issues/${id}/cost`); } catch (e) { console.error(id, e.message); continue; }
    if (res.status === 429) { await sleep(60_000); continue; }
    const body = await res.json().catch(() => null);
    cache.rows[id] = res.ok && body ? { ...body, fetchedAt: new Date().toISOString() } : { error: res.status, fetchedAt: new Date().toISOString() };
    break;
  }
  if (++n % 10 === 0 || n === todo.length) { writeFileSync(out, JSON.stringify(cache)); console.error(`${n}/${todo.length}`); }
}
writeFileSync(out, JSON.stringify(cache));
