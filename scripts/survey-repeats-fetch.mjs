// LIN-3174: page every LinearViewer-team ticket (state, labels, parent) over the local proxy, then fetch full detail (comments) for named tickets and the launch prompt of named dispatch items, into a git-ignored cache.
// Usage: node scripts/survey-repeats-fetch.mjs [--cache data/survey-repeats/proxy.json] [--detail data/survey-repeats/sample.json] [--every 3 --census data/survey-repeats/census.json]   (paced at one call per 4.5 s, under the survey's 15/min share)
// Pages at 100: a 250-row page past the 3,000th ticket answers 503. --detail reads the sample file survey-repeats-sample.mjs writes
// and fetches /issues/{id} (comments) for each sampled ticket and /dispatch/{id}/prompt for each sampled leg. --every n also fetches
// /issues/{id} for every n-th census ticket by ticket number (the convergence sample, for plan length), and for every ticket
// which-rules-pay-codes.json coded (to date each coded finding's comment and so its review round). Resumable: a re-run keeps
// everything already cached and fetches only what is missing.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const cachePath = arg('--cache', 'data/survey-repeats/proxy.json');
const detailFrom = arg('--detail', null);
const every = +arg('--every', 0);
const censusPath = arg('--census', 'data/survey-repeats/census.json');
const B = `${process.env.HARBOUR_LOCAL_BASE}/api/proxy`;
const TEAM = '7e6de730-3028-4ebc-af8a-a4de237a686d'; // LinearViewer: tracks both repos' tickets
const PACE_MS = 4500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(PACE_MS);
    let res; try { res = await fetch(`${B}${path}`, { signal: AbortSignal.timeout(60_000) }); } catch { continue; } // a hung request is retried
    if (res.status === 429 || res.status === 401 || res.status >= 500) { process.stderr.write(`retry ${res.status} ${path}\n`); await sleep(res.status === 429 ? 30_000 : 5_000); continue; } // 401 is transient here: the local proxy re-mints its upstream credential
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return res.json();
  }
  throw new Error(`failed 4 times: ${path}`);
}

const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : { fetchedAt: null, list: [], details: {}, prompts: {} };
const save = () => { mkdirSync(dirname(cachePath), { recursive: true }); writeFileSync(cachePath, JSON.stringify(cache)); };

if (!cache.list.length) {
  let after = null;
  do {
    const page = await get(`/issues?teamId=${TEAM}&limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`);
    cache.list.push(...page.issues.map(({ identifier, title, state, labels, parent }) => ({ identifier, title, state: state?.name || null, labels: (labels || []).map((l) => l.name || l), parent: parent?.identifier || null })));
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    process.stderr.write(`list ${cache.list.length}\n`);
  } while (after);
  cache.fetchedAt = new Date().toISOString();
  save();
}

const detail = async (t) => { if (t in cache.details) return; const d = await get(`/issues/${t}`); cache.details[t] = d && { identifier: d.identifier, title: d.title, description: d.description, state: d.state?.name, comments: (d.comments || []).map(({ body, createdAt }) => ({ body, createdAt })) }; save(); process.stderr.write(`detail ${t}\n`); };
if (detailFrom) {
  const sample = JSON.parse(readFileSync(detailFrom, 'utf8'));
  for (const t of [...new Set(sample.legs.map((l) => l.issue))]) await detail(t);
  for (const id of sample.legs.map((l) => l.item)) if (!(id in cache.prompts)) { const p = await get(`/dispatch/${id}/prompt`); const it = p?.item || p; cache.prompts[id] = it && { promptName: it.promptName, kind: it.kind, issueIdentifier: it.issueIdentifier, followUpTo: it.followUpTo, dispatchedAt: it.dispatchedAt, prompt: it.prompt }; save(); process.stderr.write(`prompt ${id.slice(0, 8)}\n`); }
}
if (every) {
  const ids = JSON.parse(readFileSync(censusPath, 'utf8')).tickets.map((t) => t.issue).sort((a, b) => a.split('-')[1] - b.split('-')[1]);
  for (const t of ids.filter((_, i) => i % every === 0)) await detail(t);
  for (const t of JSON.parse(readFileSync('docs/papers/harbour/which-rules-pay-codes.json', 'utf8')).tickets.map((x) => x.id)) await detail(t);
}
console.log(`list=${cache.list.length} details=${Object.keys(cache.details).length} prompts=${Object.keys(cache.prompts).length}`);
