// LIN-3151: read-only, rate-limited snapshot of tickets from the Harbour workspace proxy (full issue list, keyword searches, chosen issue details) into a git-ignored cache.
// Usage: HARBOUR_LOCAL_BASE=http://127.0.0.1:PORT node scripts/survey-tests-friction-proxy.mjs <list|search|detail> [terms or LIN-ids...] [--cache data/survey-tests/proxy] [--max 120]
// GET only, no auth header. Calls are spaced >= 7.5 s apart (a hard shared budget of 8/min), and the spacing survives across
// invocations via a timestamp file. Every response is cached by URL, so a re-run spends no calls on anything already fetched.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const cache = arg('--cache', 'data/survey-tests/proxy');
const maxCalls = Number(arg('--max', '120'));
const GAP_MS = 7600;
const base = `${process.env.HARBOUR_LOCAL_BASE || ''}/api/proxy`;
const flagged = new Set(['--cache', '--max']);
const pos = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !flagged.has(all[i - 1]));
const [mode, ...items] = pos;

mkdirSync(cache, { recursive: true });
const ledger = join(cache, 'calls.json');
const state = existsSync(ledger) ? JSON.parse(readFileSync(ledger, 'utf8')) : { total: 0, last: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function get(path) {
  const file = join(cache, createHash('sha1').update(path).digest('hex').slice(0, 16) + '.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')).body;
  if (!process.env.HARBOUR_LOCAL_BASE) throw new Error('HARBOUR_LOCAL_BASE is not set');
  if (state.total >= maxCalls) throw new Error(`call budget ${maxCalls} spent`);
  const wait = state.last + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  state.last = Date.now(); state.total++;
  writeFileSync(ledger, JSON.stringify(state));
  const res = await fetch(base + path);
  const body = await res.json().catch(() => null);
  if (!res.ok) { console.error(`${res.status} ${path}`); return null; }
  writeFileSync(file, JSON.stringify({ path, fetchedAt: new Date().toISOString(), body }));
  return body;
}

async function list() {
  const all = []; let after = '';
  for (;;) {
    const page = await get(`/issues?limit=250${after ? `&after=${encodeURIComponent(after)}` : ''}`);
    all.push(...page.issues);
    console.error(`page: +${page.issues.length} = ${all.length}`);
    if (!page.pageInfo?.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  writeFileSync(join(cache, 'issues.json'), JSON.stringify(all));
  console.log(`issues=${all.length}`);
}

async function search() {
  const hits = existsSync(join(cache, 'search.json')) ? JSON.parse(readFileSync(join(cache, 'search.json'), 'utf8')) : {};
  for (const q of items) {
    const r = await get(`/search?q=${encodeURIComponent(q)}`);
    hits[q] = (r?.issues || []).map((i) => ({ identifier: i.identifier, title: i.title, state: i.state?.name }));
    console.log(`${q}: ${hits[q].length}`);
  }
  writeFileSync(join(cache, 'search.json'), JSON.stringify(hits, null, 1));
}

async function detail() {
  for (const id of items) {
    const r = await get(`/issues/${id}`);
    console.log(`${id}: ${r ? r.title : 'missing'}`);
  }
}

if (mode === 'list') await list();
else if (mode === 'search') await search();
else if (mode === 'detail') await detail();
else console.error('mode must be list, search or detail');
console.error(`proxy calls so far: ${state.total}`);
