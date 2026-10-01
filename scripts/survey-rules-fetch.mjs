// LIN-3156: page every LinearViewer-team ticket over the local proxy, then fetch full detail (dates, comments, relations) for the most recent Done tickets by number, into a git-ignored cache.
// Usage: node scripts/survey-rules-fetch.mjs [cache=data/survey/rules-tickets.json] [--top 200] [--also LIN-1,LIN-2]   (paced at one call per 4.5 s, under the survey's 15/min share)
// Resumable: a re-run keeps the cached list and every detail already fetched, and fetches only what is missing.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const top = Number(opt('--top') || 200);
const also = (opt('--also') || '').split(',').filter(Boolean);
const cachePath = argv[0] || 'data/survey/rules-tickets.json';
const B = `${process.env.HARBOUR_LOCAL_BASE}/api/proxy`;
const TEAM = '7e6de730-3028-4ebc-af8a-a4de237a686d'; // LinearViewer: tracks both repos' tickets
const PACE_MS = 4500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (id) => Number(id.split('-')[1]);

async function get(path) {
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(PACE_MS);
    const res = await fetch(`${B}${path}`);
    if (res.status === 429 || res.status >= 500) { await sleep(30_000); continue; } // provider hiccups page a cursor 500 now and then
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return res.json();
  }
  throw new Error(`failed 6 times: ${path}`);
}

async function main() {
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : { fetchedAt: null, list: [], details: {} };
  const save = () => { mkdirSync(dirname(cachePath), { recursive: true }); writeFileSync(cachePath, JSON.stringify(cache)); };
  if (!cache.list.length) {
    let after = null;
    do {
      const page = await get(`/issues?teamId=${TEAM}&limit=250${after ? `&after=${encodeURIComponent(after)}` : ''}`);
      cache.list.push(...page.issues.map(({ identifier, title, state, labels, parent }) =>
        ({ identifier, title, state, labels, parent: parent?.identifier || null })));
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      process.stderr.write(`list ${cache.list.length}\n`);
    } while (after);
    cache.fetchedAt = new Date().toISOString();
    save();
  }
  const done = cache.list.filter((i) => i.state?.type === 'completed').sort((a, b) => num(b.identifier) - num(a.identifier));
  const want = [...done.slice(0, top).map((i) => i.identifier), ...also];
  const todo = [...new Set(want)].filter((id) => !cache.details[id]);
  process.stderr.write(`details to fetch: ${todo.length}\n`);
  for (const id of todo) {
    const d = await get(`/issues/${id}`);
    cache.details[id] = d ? {
      title: d.title, createdAt: d.createdAt, completedAt: d.completedAt, state: d.state, labels: d.labels,
      description: d.description || '',
      comments: (d.comments || []).map((c) => ({ createdAt: c.createdAt, body: c.body || '' })),
      relations: [...(d.relations || []), ...(d.inverseRelations || [])].map((r) => ({ type: r.type, other: r.relatedIssue?.identifier || r.issue?.identifier || null })),
    } : { missing: true };
    save();
    process.stderr.write(`${id} ${Object.keys(cache.details).length}\n`);
  }
  process.stderr.write('done\n');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
