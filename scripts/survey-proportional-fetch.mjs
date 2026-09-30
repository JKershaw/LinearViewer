// LIN-3166: fetch full ticket detail (comments) over the local proxy for every change any classifier routes light, plus every 4th heavy change, where no same-day snapshot already holds it.
// Usage: node scripts/survey-proportional-fetch.mjs [--features data/survey-proportional/features.json] [--have data/survey/rules-tickets.json,data/survey/reliability-tracker.json] [--out data/survey-proportional/details.json] [--every 4]
// Paced at one call per 4.5 s (the survey's 15/min share). Resumable: a re-run keeps what it has and fetches only what is missing.
// The heavy sample is every --every-th heavy change in ticket-number order, so it is systematic and fixed before any fetch.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const features = JSON.parse(readFileSync(arg('--features', 'data/survey-proportional/features.json'), 'utf8'));
const havePaths = arg('--have', 'data/survey/rules-tickets.json,data/survey/reliability-tracker.json').split(',');
const out = arg('--out', 'data/survey-proportional/details.json');
const EVERY = +arg('--every', 4);
const B = `${process.env.HARBOUR_LOCAL_BASE}/api/proxy`;
const PACE_MS = 4500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const have = new Set();
for (const p of havePaths) if (existsSync(p)) for (const id of Object.keys(JSON.parse(readFileSync(p, 'utf8')).details || {})) have.add(id);
const byNum = [...features.rows].sort((a, b) => +a.id.slice(4) - +b.id.slice(4));
const light = byNum.filter((r) => Object.values(r.light).some(Boolean));
const heavySample = byNum.filter((r) => !Object.values(r.light).some(Boolean)).filter((_, i) => i % EVERY === 0);
const want = [...light, ...heavySample].map((r) => r.id).filter((id) => !have.has(id));

const cache = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { fetchedAt: null, heavyEvery: EVERY, heavySample: [], details: {} };
cache.heavySample = heavySample.map((r) => r.id);
mkdirSync(dirname(out), { recursive: true });
const todo = want.filter((id) => !cache.details[id]);
console.log(`light ${light.length}, heavy sample ${heavySample.length}; already in snapshots ${[...light, ...heavySample].length - want.length}; to fetch ${todo.length}`);
let n = 0;
for (const id of todo) {
  let res;
  try { res = await fetch(`${B}/issues/${id}`); } catch (e) { console.error(id, e.message); await sleep(PACE_MS); continue; }
  if (res.ok) {
    const d = await res.json();
    cache.details[id] = { title: d.title, createdAt: d.createdAt, completedAt: d.completedAt, state: d.state, labels: (d.labels || []).map((l) => l.name || l),
      comments: (d.comments || []).map((c) => ({ createdAt: c.createdAt, body: c.body })) };
  } else console.error(id, res.status);
  if (++n % 20 === 0) { cache.fetchedAt = new Date().toISOString(); writeFileSync(out, JSON.stringify(cache)); console.log(`${n}/${todo.length}`); }
  await sleep(PACE_MS);
}
cache.fetchedAt = new Date().toISOString();
writeFileSync(out, JSON.stringify(cache));
console.log(`done: ${Object.keys(cache.details).length} details cached`);
