// LIN-3149: page every LinearViewer-team ticket over the local proxy, then fetch full detail (dates, comments) for Bug-labelled and incident/regression/revert/hotfix-titled tickets, into a git-ignored cache.
// Usage: node scripts/survey-reliability-tracker.mjs [cache=data/survey/reliability-tracker.json] [--sample github-cache.json] [--also LIN-1,LIN-2]   (paced at one call per 4.5 s, under the survey's 15/min share)
// --only-extra skips the Bug/incident details; --list-from <cache> copies that cache's list rather than re-paging it.
// --sample adds every 8th shipped ticket (named by a merged PR in either repo, by ticket number) for the process-depth denominator; --also adds named tickets.
// Resumable: a re-run keeps the cached list and every detail already fetched, and fetches only what is missing.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const samplePath = opt('--sample');
const onlyExtra = argv.includes('--only-extra') && argv.splice(argv.indexOf('--only-extra'), 1);
const listFrom = opt('--list-from'); // reuse another cache's ticket list instead of re-paging it
const also = (opt('--also') || '').split(',').filter(Boolean);
const cachePath = argv[0] || 'data/survey/reliability-tracker.json';
export const SAMPLE_EVERY = 8;
export const ticketOf = (s) => (s.match(/\bLIN-(\d+)\b/i) || [])[0]?.toUpperCase() || null;
// Every SAMPLE_EVERY-th ticket, in ticket-number order, among tickets a merged PR in either repo names.
export function shippedSample(github) {
  const ids = new Set();
  for (const { prs } of Object.values(github.repos)) for (const p of prs) { const t = ticketOf(`${p.title} ${p.headRefName}`); if (t) ids.add(t); }
  return [...ids].sort((a, b) => a.split('-')[1] - b.split('-')[1]).filter((_, i) => i % SAMPLE_EVERY === 0);
}
const B = `${process.env.HARBOUR_LOCAL_BASE}/api/proxy`;
const TEAM = '7e6de730-3028-4ebc-af8a-a4de237a686d'; // LinearViewer: tracks both repos' tickets
const PACE_MS = 4500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A ticket gets a detail fetch when it is a defect candidate or an incident candidate.
export const DETAIL_TITLE = /\b(incident|regression|regress|revert|reverted|hotfix|broke|broken|outage)\b/i;
export const needsDetail = (i) => i.labels.includes('Bug') || DETAIL_TITLE.test(i.title);

async function get(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(PACE_MS);
    const res = await fetch(`${B}${path}`);
    if (res.status === 429) { await sleep(60_000); continue; }
    if (res.status === 404 || res.status === 400) return null; // trashed-and-purged or archived tickets
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return res.json();
  }
  throw new Error(`rate-limited 4 times: ${path}`);
}

async function main() {
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : { fetchedAt: null, list: [], details: {} };
  const save = () => { mkdirSync(dirname(cachePath), { recursive: true }); writeFileSync(cachePath, JSON.stringify(cache)); };
  if (!cache.list.length && listFrom) cache.list = JSON.parse(readFileSync(listFrom, 'utf8')).list;
  if (!cache.list.length) {
    let after = null;
    do {
      const page = await get(`/issues?teamId=${TEAM}&limit=250${after ? `&after=${encodeURIComponent(after)}` : ''}`);
      cache.list.push(...page.issues.map(({ identifier, title, description, state, labels, parent }) =>
        ({ identifier, title, description, state, labels, parent: parent?.identifier || null })));
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      process.stderr.write(`list ${cache.list.length}\n`);
    } while (after);
    cache.fetchedAt = new Date().toISOString();
    save();
  }
  const extra = [...(samplePath ? shippedSample(JSON.parse(readFileSync(samplePath, 'utf8'))) : []), ...also];
  const want = [...(onlyExtra ? [] : cache.list.filter(needsDetail).map((i) => i.identifier)), ...extra];
  const todo = [...new Set(want)].filter((id) => !cache.details[id]).map((identifier) => ({ identifier }));
  process.stderr.write(`details to fetch: ${todo.length}\n`);
  for (const i of todo) {
    const d = await get(`/issues/${i.identifier}`);
    if (!d) { cache.details[i.identifier] = { missing: true }; save(); continue; }
    cache.details[i.identifier] = {
      createdAt: d.createdAt, completedAt: d.completedAt, state: d.state, labels: d.labels,
      comments: (d.comments || []).map((c) => ({ createdAt: c.createdAt, body: c.body })),
      relations: [...(d.relations || []), ...(d.inverseRelations || [])],
    };
    save();
  }
  process.stderr.write('done\n');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
