// LIN-3177: draw a stratified sample of September's merged changes (both repos) by size band, risk class and repo, for the census of consequential decisions.
// Usage: node scripts/survey-judgement-sample.mjs [--git data/survey-doubling/git.json] [--runner data/survey-doubling/runner.json] [--out data/survey-judgement/sample.json]
// Run survey-model-git.mjs (--since 2026-05-01 --out data/survey-doubling/git.json) and survey-doubling-runner.mjs first. The population is
// every change whose last merge to origin/main (either repo) falls in September and whose first runner dispatch is on or after 30 August,
// so that its whole life is in the local transcripts (they begin 29 August 19:15Z). Cells: production lines 0 / 1-49 / 50-299 / 300+,
// risk high (credentials, auth, tokens, sessions, security, migration) or not, and whether the change touched simple-dispatcher. Within a
// cell, changes are ordered by ticket number and drawn every k-th from a fixed offset; the rest of the cell, in the same order, are
// reserves for a ticket that turns out not to be Done: with --issues (survey-judgement-fetch.mjs's cache), a drawn ticket whose state is
// not Done is replaced by the next reserve in its cell by ticket number, and the reserve's id is printed for fetching. No proxy calls.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const git = JSON.parse(readFileSync(arg('--git', 'data/survey-doubling/git.json'), 'utf8'));
const runner = JSON.parse(readFileSync(arg('--runner', 'data/survey-doubling/runner.json'), 'utf8'));
const out = arg('--out', 'data/survey-judgement/sample.json');

// Fixed before any ticket was read: 36 tickets, simple-dispatcher over-sampled so both repos can be read separately.
const PLAN = {
  '0|other|LV': 4, '0|other|SD': 1,
  '1-49|other|LV': 5, '1-49|other|SD': 2,
  '50-299|other|LV': 6, '50-299|other|SD': 4, '50-299|high|LV': 3,
  '300+|other|LV': 5, '300+|other|SD': 2, '300+|high|LV': 4,
};

const first = {}; const dispatches = {};
for (const r of runner.rows) {
  if (!r.issue) continue;
  if (!first[r.issue] || r.at < first[r.issue]) first[r.issue] = r.at;
  dispatches[r.issue] = (dispatches[r.issue] || 0) + 1;
}
const band = (p) => (p === 0 ? '0' : p < 50 ? '1-49' : p < 300 ? '50-299' : '300+');
const utc = (s) => new Date(s).toISOString();
const pop = git.rows.filter((x) => utc(x.lastMerge) >= '2026-09-01' && utc(x.lastMerge) < '2026-10-01');
const covered = pop.filter((x) => first[x.id] && first[x.id] >= '2026-08-30');
const cellOf = (x) => `${band(x.prodLines)}|${x.risk === 'high' ? 'high' : 'other'}|${x.repos.includes('simple-dispatcher') ? 'SD' : 'LV'}`;
const cells = {};
for (const x of covered) (cells[cellOf(x)] ||= []).push(x);
const num = (id) => Number(id.slice(4));
const sample = []; const reserves = []; const weights = {};
for (const [cell, xs] of Object.entries(cells)) {
  xs.sort((a, b) => num(a.id) - num(b.id));
  const n = PLAN[cell] || 0;
  weights[cell] = { population: xs.length, planned: n };
  if (!n) continue;
  const k = xs.length / n; const picked = new Set();
  for (let i = 0; i < n; i++) picked.add(Math.floor(k / 2 + i * k));
  xs.forEach((x, i) => {
    const row = { id: x.id, cell, repos: x.repos, prodLines: x.prodLines, testLines: x.testLines, risk: x.risk, area: x.area, writerTier: x.writerTier, lastMerge: utc(x.lastMerge), firstDispatch: first[x.id], dispatches: dispatches[x.id] };
    (picked.has(i) ? sample : reserves).push(row);
  });
}
// Replace a drawn ticket that is not Done by the next reserve in its cell (by ticket number), once the fetch cache says so.
const issuesFile = arg('--issues', null);
const replaced = [];
if (issuesFile) {
  const iss = JSON.parse(readFileSync(issuesFile, 'utf8'));
  for (let i = 0; i < sample.length; i++) {
    const s = sample[i]; const st = iss[s.id];
    if (!st || st.error || st.stateType === 'completed') continue;
    const next = reserves.filter((r) => r.cell === s.cell && num(r.id) > num(s.id) && !(iss[r.id] && !iss[r.id].error && iss[r.id].stateType !== 'completed')).sort((a, b) => num(a.id) - num(b.id))[0];
    if (!next) continue;
    replaced.push({ out: s.id, state: st.state, in: next.id });
    reserves.splice(reserves.indexOf(next), 1); reserves.push(s); sample[i] = next;
  }
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), population: pop.length, covered: covered.length, noDispatch: pop.filter((x) => !first[x.id]).length, weights, replaced, sample, reserves }, null, 1));
console.log({ population: pop.length, covered: covered.length, sample: sample.length, weights, replaced });
console.log(sample.map((s) => `${s.id} ${s.cell} prod=${s.prodLines} d=${s.dispatches}`).join('\n'));
