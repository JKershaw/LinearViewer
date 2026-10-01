// LIN-3177: fetch each sampled ticket's full record (state, parent, comments) over the local workspace proxy into a git-ignored cache, paced at one call per 8 s.
// Usage: node scripts/survey-judgement-fetch.mjs [--sample data/survey-judgement/sample.json] [--cache data/survey-judgement/issues.json] [--ids LIN-1,LIN-2]
// The pace keeps this survey within its share of the proxy's limit (eight a minute, shared with five sibling papers and a live passage).
// Resumable: a re-run fetches only tickets not yet cached. --ids fetches extra tickets (a reserve, or a parent the digests need).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = `${process.env.HARBOUR_LOCAL_BASE}/api/proxy`;
const cacheFile = arg('--cache', 'data/survey-judgement/issues.json');
const sample = JSON.parse(readFileSync(arg('--sample', 'data/survey-judgement/sample.json'), 'utf8'));
const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
const ids = arg('--ids', null)?.split(',') || sample.sample.map((s) => s.id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const id of ids) {
  if (cache[id] && !cache[id].error) continue;
  try {
    const res = await fetch(`${base}/issues/${id}`);
    const body = await res.json();
    const i = body.issue || body;
    cache[id] = res.ok ? {
      id, title: i.title, state: i.state?.name, stateType: i.state?.type, completedAt: i.completedAt, createdAt: i.createdAt,
      parent: i.parent?.identifier || null, children: (i.children || []).map((c) => c.identifier), labels: (i.labels || []).map((l) => l.name),
      description: i.description || '', comments: (i.comments || []).map((c) => ({ id: c.id, at: c.createdAt, user: c.user?.name || c.user?.displayName || c.user || null, body: c.body || '' })),
    } : { id, error: res.status };
  } catch (e) { cache[id] = { id, error: String(e) }; }
  writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
  console.log(id, cache[id].error || `${cache[id].state} ${cache[id].comments.length} comments`);
  await sleep(8000);
}
