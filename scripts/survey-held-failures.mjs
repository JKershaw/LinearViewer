// LIN-3176: fetch the 25 supervisor failures on record (wake-inventory-failures.json) with their comments, so each recovery can be read for whether it used a held session's memory or the record.
// Usage: HARBOUR_LOCAL_BASE=… node scripts/survey-held-failures.mjs [--out data/survey-held/failures] [--gap-ms 10000]
// One proxy call per ticket, one every --gap-ms (six a minute by default, under the wave's shared 8/min). Skips tickets already fetched.
// Then renders each ticket's title, description and comments as plain text in failures-text/*.ticket for the coders (an extension the repo's doc-anchor sweep does not read) (from the fetched JSON; no calls).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const out = arg('--out', 'data/survey-held/failures'); mkdirSync(out, { recursive: true });
const gap = +arg('--gap-ms', 10000);
const base = process.env.HARBOUR_LOCAL_BASE; if (!base) throw new Error('HARBOUR_LOCAL_BASE is not set');
const ids = JSON.parse(readFileSync('docs/papers/harbour/wake-inventory-failures.json', 'utf8')).failures.map((f) => f.id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const id of ids) {
  const p = join(out, `${id}.json`); if (existsSync(p)) continue;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`${base}/api/proxy/issues/${id}`); const body = await r.text();
    await sleep(gap);
    if (r.ok) { writeFileSync(p, body); console.log(id, 'ok', body.length); break; }
    console.log(id, r.status, body.slice(0, 120));
  }
}
const textDir = join(dirname(out), 'failures-text'); mkdirSync(textDir, { recursive: true });
for (const id of ids) {
  const p = join(out, `${id}.json`); if (!existsSync(p)) continue;
  const d = JSON.parse(readFileSync(p, 'utf8'));
  const lines = [`# ${id}: ${d.title}`, `state: ${d.state?.name}; created ${d.createdAt}; completed ${d.completedAt}`, '', '## Description', d.description || ''];
  for (const c of d.comments || []) lines.push('', `## Comment ${c.createdAt} by ${typeof c.user === 'object' ? c.user?.name : c.user}`, c.body || '');
  writeFileSync(join(textDir, `${id}.ticket`), lines.join('\n'));
}
