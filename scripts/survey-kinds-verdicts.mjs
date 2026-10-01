// LIN-3207: plan-review and review verdicts, labels and estimate for the richer-kinds tickets and their matched straight-to-plan comparisons, read from each ticket's comments over the workspace proxy (paced), into a git-ignored snapshot.
// Usage: node scripts/survey-kinds-verdicts.mjs [--dir data/survey-kinds] [--per 3] [--pace-ms 6000] [--extra LIN-3200]
// Needs tickets.json from survey-kinds-analyse.mjs (run it once before this script, and again after). Matching: for each
// richer ticket, the --per straight-to-plan tickets with the same "implemented" and "research before plan" flags whose first
// dispatch is nearest in time, each used once. One GET /issues/<id> per ticket at no more than one call per --pace-ms (10 a
// minute at the default), under the 12-a-minute ceiling a live passage shares. A comment is a verdict when its opening names a
// (plan) review and it states **Request Changes** or **Approve**; "plan" in the opening makes it a plan-review verdict.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dir = arg('--dir', 'data/survey-kinds'); const per = Number(arg('--per', '3')); const pace = Number(arg('--pace-ms', '6000'));
const extra = (arg('--extra', '') || '').split(',').filter(Boolean);
const base = process.env.HARBOUR_LOCAL_BASE; if (!base) throw new Error('HARBOUR_LOCAL_BASE is not set');
const rows = JSON.parse(readFileSync(join(dir, 'tickets.json'), 'utf8'));

const richer = rows.filter((r) => r.group === 'richer');
const pool = rows.filter((r) => r.group === 'straight'); const used = new Set(); const match = {};
const firstAt = JSON.parse(readFileSync(join(dir, 'transcripts.json'), 'utf8'));
const firstOf = {}; for (const [, i] of Object.entries(firstAt.items)) if (i.issue && (!firstOf[i.issue] || i.at < firstOf[i.issue])) firstOf[i.issue] = i.at;
for (const e of firstAt.enqueues) if (e.ok && e.issue && (!firstOf[e.issue] || e.at < firstOf[e.issue])) firstOf[e.issue] = e.at;
for (const r of richer) {
  const t0 = Date.parse(firstOf[r.issue]);
  const cands = pool.filter((p) => !used.has(p.issue) && p.implemented === r.implemented && p.research === r.research)
    .sort((a, b) => Math.abs(Date.parse(firstOf[a.issue]) - t0) - Math.abs(Date.parse(firstOf[b.issue]) - t0)).slice(0, per);
  for (const c of cands) used.add(c.issue);
  match[r.issue] = cands.map((c) => c.issue);
}
const ids = [...new Set([...richer.map((r) => r.issue), ...Object.values(match).flat(), ...extra])];
mkdirSync(join(dir, 'issues'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const byTicket = {};
for (const id of ids) {
  const f = join(dir, 'issues', `${id}.json`);
  if (!existsSync(f)) {
    const res = await fetch(`${base}/api/proxy/issues/${id}`); const body = await res.text();
    writeFileSync(f, body); await sleep(pace);
  }
  let issue; try { issue = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  const v = { planRequestChanges: 0, planApprove: 0, reviewRequestChanges: 0, reviewApprove: 0, labels: (issue.labels || []).map((l) => l.name || l), estimate: issue.estimate ?? null, state: issue.state?.name || null };
  for (const c of issue.comments || []) {
    const body = String(c.body || ''); const open = body.slice(0, 400);
    if (!/review/i.test(open)) continue;
    const plan = /plan[- ]?review|review of the plan|plan review/i.test(open);
    const rc = /\*\*Request Changes\*\*|Verdict[^\n]{0,20}Request Changes|REQUEST_CHANGES/i.test(body.slice(0, 3000));
    const ok = !rc && /\*\*Approve[d]?\*\*|Verdict[^\n]{0,20}Approve|\bAPPROVE\b/.test(body.slice(0, 3000));
    if (rc) v[plan ? 'planRequestChanges' : 'reviewRequestChanges']++; else if (ok) v[plan ? 'planApprove' : 'reviewApprove']++;
  }
  byTicket[id] = v;
}
writeFileSync(join(dir, 'verdicts.json'), JSON.stringify({ generatedAt: new Date().toISOString(), match, byTicket }, null, 1));
console.log(`tickets=${ids.length} richer=${richer.length}`, JSON.stringify(match));
for (const [id, v] of Object.entries(byTicket)) console.log(id, JSON.stringify(v));
