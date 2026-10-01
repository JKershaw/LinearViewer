// LIN-3179: page the LinearViewer team's ticket list (state, parent, dates) and fetch named tickets' full detail (description, comments with ids and times, children) over the local proxy, into a git-ignored cache.
// Usage: node scripts/survey-overlap-fetch.mjs [--cache data/survey-overlap/proxy.json] [--list] [--ids LIN-1,LIN-2 | --ids-file data/survey-overlap/want.json]
// Paced at one call per 7.5 s (the wave's 8-a-minute share). Resumable: a re-run keeps what is cached and fetches only what is missing.
// --ids-file reads a JSON array of identifiers (survey-overlap-select.mjs writes it).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const cachePath = arg('--cache', 'data/survey-overlap/proxy.json');
const B = `${process.env.HARBOUR_LOCAL_BASE}/api/proxy`;
const TEAM = '7e6de730-3028-4ebc-af8a-a4de237a686d'; // LinearViewer: tracks both repos' tickets
const PACE_MS = 7500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(PACE_MS);
    let res; try { res = await fetch(`${B}${path}`, { signal: AbortSignal.timeout(60_000) }); } catch { continue; }
    if (res.status === 429 || res.status === 401 || res.status >= 500) { process.stderr.write(`retry ${res.status} ${path}\n`); await sleep(res.status === 429 ? 30_000 : 5_000); continue; }
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return res.json();
  }
  throw new Error(`failed 4 times: ${path}`);
}

const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : { listAt: null, list: [], details: {} };
const save = () => { mkdirSync(dirname(cachePath), { recursive: true }); writeFileSync(cachePath, JSON.stringify(cache)); };

if (process.argv.includes('--list') && !cache.list.length) {
  let after = null;
  do {
    const page = await get(`/issues?teamId=${TEAM}&limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`);
    cache.list.push(...page.issues.map(({ identifier, title, state, parent, createdAt, completedAt }) => ({ identifier, title, state: state?.name || null, parent: parent?.identifier || null, createdAt, completedAt })));
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    process.stderr.write(`list ${cache.list.length}\n`);
  } while (after);
  cache.listAt = new Date().toISOString(); save();
}

const ids = arg('--ids', null)?.split(',') || (arg('--ids-file', null) ? JSON.parse(readFileSync(arg('--ids-file'), 'utf8')) : []);
for (const t of ids) {
  if (t in cache.details) continue;
  const d = await get(`/issues/${t}`);
  cache.details[t] = d && { identifier: d.identifier, title: d.title, description: d.description, state: d.state?.name, createdAt: d.createdAt, completedAt: d.completedAt, parent: d.parent?.identifier || null, children: (d.children || []).map((c) => c.identifier || c), comments: (d.comments || []).map(({ id, body, createdAt }) => ({ id, body, createdAt })), fetchedAt: new Date().toISOString() };
  save(); process.stderr.write(`detail ${t} (${cache.details[t]?.comments.length ?? 'missing'} comments)\n`);
}
console.log(`list=${cache.list.length} details=${Object.keys(cache.details).length}`);
