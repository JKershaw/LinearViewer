// LIN-3188: snapshot every tracker issue (list rows, which carry title and description but no dates or comments) over the local workspace proxy, then the full detail (createdAt, completedAt, comments) of the issues named in --detail.
// Usage: node scripts/survey-hides-tracker.mjs [--out data/survey-hides] [--detail LIN-1,LIN-2|@file.json] [--gap-ms 10000]
// The proxy is shared with sibling sessions and a live passage, so every call waits --gap-ms (default 10 s, 6 a minute).
// List rows go to <out>/issues.json; details to <out>/details/<identifier>.json, skipped when already present. Read-only.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const base = process.env.HARBOUR_LOCAL_BASE;
if (!base) { console.error('HARBOUR_LOCAL_BASE is not set'); process.exit(1); }
const out = arg('--out', 'data/survey-hides'); mkdirSync(join(out, 'details'), { recursive: true });
const gap = Number(arg('--gap-ms', '10000'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;
async function get(path) {
  if (calls++) await sleep(gap);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${base}/api/proxy${path}`);
    if (res.ok) return res.json();
    console.error(`GET ${path} → ${res.status}`);
    await sleep(gap * 2);
  }
  throw new Error(`GET ${path} failed`);
}

const detailArg = arg('--detail', null);
if (!detailArg || process.argv.includes('--list')) {
  const rows = []; let after = null;
  do {
    const q = `/issues?limit=250${after ? `&after=${encodeURIComponent(after)}` : ''}`;
    const d = await get(q);
    rows.push(...d.issues);
    after = d.pageInfo?.hasNextPage ? d.pageInfo.endCursor : null;
    console.log(`page ${calls}: ${rows.length} issues`);
  } while (after);
  writeFileSync(join(out, 'issues.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), issues: rows }));
  console.log(`${rows.length} issues → ${join(out, 'issues.json')}`);
}
if (detailArg) {
  const ids = detailArg.startsWith('@')
    ? JSON.parse(readFileSync(detailArg.slice(1), 'utf8')).incidents.map((x) => x.id)
    : detailArg.split(',');
  for (const id of [...new Set(ids)]) {
    const p = join(out, 'details', `${id}.json`);
    if (existsSync(p)) continue;
    const d = await get(`/issues/${id}`);
    writeFileSync(p, JSON.stringify(d.issue || d));
    console.log(`detail ${id}`);
  }
}
console.log(`${calls} proxy calls`);
