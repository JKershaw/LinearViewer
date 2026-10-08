#!/usr/bin/env node
// Fetch each ticket's detail (comments, labels, dates, parent) and its /cost lineage from the workspace proxy into a cache.
// Read-only. Paced under the proxy's 60/min cap. Usage: node tracker-fetch.mjs <tickets.txt> <out.json> [--token-file f]
import { readFileSync, writeFileSync, existsSync } from 'fs';

const [listFile, outFile] = process.argv.slice(2);
const tokenFile = process.argv.includes('--token-file') ? process.argv[process.argv.indexOf('--token-file') + 1] : null;
const T = (tokenFile ? readFileSync(tokenFile, 'utf8') : process.env.HARBOUR_TOKEN || '').trim();
if (!T) { console.error('no token'); process.exit(1); }
const B = 'https://harbour.cat/api/proxy';
const ids = readFileSync(listFile, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
const cache = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : { fetchedAt: new Date().toISOString(), tickets: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PACE = 1250; // ms between calls → 48/min
let calls = 0;
async function get(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const t0 = Date.now();
    let res;
    try { res = await fetch(B + path, { headers: { Authorization: `Bearer ${T}` } }); } catch (e) { await sleep(5000); continue; }
    calls++;
    const wait = PACE - (Date.now() - t0); if (wait > 0) await sleep(wait);
    if (res.status === 429) { await sleep(15000); continue; }
    if (res.status === 404) return { __status: 404 };
    if (!res.ok) { await sleep(3000); if (attempt === 3) return { __status: res.status }; continue; }
    return res.json();
  }
  return null;
}
let n = 0;
for (const id of ids) {
  n++;
  if (cache.tickets[id]?.issue && cache.tickets[id]?.cost) continue;
  const issue = await get(`/issues/${id}`);
  const cost = await get(`/issues/${id}/cost`);
  cache.tickets[id] = {
    issue: issue && !issue.__status ? {
      identifier: issue.identifier, title: issue.title, state: issue.state, labels: issue.labels, priority: issue.priority, createdAt: issue.createdAt, completedAt: issue.completedAt,
      parent: issue.parent ? issue.parent.identifier : null, children: (issue.children || []).map((c) => c.identifier), project: issue.project?.name || null,
      descriptionChars: (issue.description || '').length, descriptionHead: (issue.description || '').slice(0, 600),
      comments: (issue.comments || []).map((c) => ({ id: c.id, createdAt: c.createdAt, chars: (c.body || '').length, head: (c.body || '').slice(0, 400) })),
      relations: (issue.relations || []).map((r) => ({ type: r.type, id: r.relatedIssue?.identifier })),
    } : { __status: issue?.__status || 'error' },
    cost: cost && !cost.__status ? { pricedUsd: cost.pricedUsd, totalUsd: cost.totalUsd, noLineage: cost.noLineage, unpriced: cost.unpriced, noTelemetryCount: cost.noTelemetryCount, workerSessions: cost.workerSessions, appCalls: cost.appCalls ? { calls: cost.appCalls.calls, costUsd: cost.appCalls.costUsd } : null } : { __status: cost?.__status || 'error' },
  };
  if (n % 10 === 0) { writeFileSync(outFile, JSON.stringify(cache)); console.error(`${n}/${ids.length} ${id} calls=${calls}`); }
}
writeFileSync(outFile, JSON.stringify(cache));
console.error(`done ${n} tickets, ${calls} calls`);
