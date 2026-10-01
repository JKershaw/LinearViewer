// LIN-3207: the per-kind census by route (September), the runner's coverage check, and the per-ticket rows for the richer-kinds comparison, from the survey-kinds snapshots.
// Usage: node scripts/survey-kinds-analyse.mjs [--dir data/survey-kinds] [--since 2026-09-01] [--until 2026-10-01]
// Inputs (all git-ignored): transcripts.json (survey-kinds-transcripts.mjs), runner.json (survey-doubling-runner.mjs --out
// data/survey-kinds/runner.json), tokens.json (survey-costmix-tokens.mjs --out data/survey-kinds/tokens.json), and
// verdicts.json (survey-kinds-verdicts.mjs). Writes census.json and tickets.json next to them and prints the tables the paper quotes.
// An item is every dispatch id a transcript enqueued or fetched; its route is read from how it was enqueued:
//   recommender   recommend-and-dispatch, the kind the engine chose
//   override      recommend-and-dispatch with "kind" (the response says "override": true): the caller chose, the server wrote the template
//   written       POST /dispatch with no followUpTo: the caller chose the kind label and wrote the prompt itself
//   beat          POST /dispatch with followUpTo: a written follow-up into a held session (stepper beats, corrections)
//   kickoff       POST /autopilot/kickoff
//   wake          kind "wake": minted by the server when a child posts feedback (wake-inventory.md)
//   untraced      fetched by a session, enqueued by nothing a transcript shows: the UI, server-minted work (triage, periodicals,
//                 the passage Runner's legs, the Flight Companion), a session on another harness, or an unparsed enqueue.
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dir = arg('--dir', 'data/survey-kinds');
const since = arg('--since', '2026-09-01'); const until = arg('--until', '2026-10-01');
const load = (f) => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; } };
const T = load('transcripts.json'); const R = load('runner.json'); const K = load('tokens.json'); const V = load('verdicts.json');

export const KINDS = ['blocked', 'bug', 'plan', 'look-into', 'triage', 'breakdown', 'research', 'scoping', 'design', 'spike', 'context',
  'plan-review', 'implementation', 'review', 'close-out', 'retrospective-audit', 'retro'];
const TEMPLATE_NAMES = new Set([...KINDS, 'implement', 'look into']);
const ROUTES = ['recommender', 'override', 'written', 'beat', 'kickoff', 'wake', 'untraced'];
const inWin = (t) => t && t >= since && t < until;

const items = new Map();
for (const e of T.enqueues) {
  if (!e.ok || e.error) continue;
  if (items.has(e.id)) continue;
  const route = e.ep === 'kickoff' ? 'kickoff' : e.ep === 'recommend-and-dispatch' ? (e.override ? 'override' : 'recommender') : e.followUp ? 'beat' : 'written';
  items.set(e.id, { id: e.id, kind: e.kind, promptName: e.promptName, issue: e.issue, at: e.at, route, caller: e.callerRole, session: e.session });
}
for (const [id, f] of Object.entries(T.items)) {
  const it = items.get(id);
  if (it) { it.kind ??= f.kind; it.fetched = true; it.promptLen = f.promptLen; it.promptHead = f.promptHead; it.issue ??= f.issue; continue; }
  const route = f.kind === 'wake' ? 'wake' : 'untraced';
  const sub = route !== 'untraced' ? null : /\(leg \d+\)|^Worker Lane|leg \d+/i.test(f.promptName || '') ? 'passage leg' : TEMPLATE_NAMES.has(f.promptName) ? 'template-named' : f.kind === 'periodical' || f.kind === 'triage' ? 'server-minted' : 'written';
  items.set(id, { id, kind: f.kind, promptName: f.promptName, issue: f.issue, at: f.at, route, sub, fetched: true, promptLen: f.promptLen, promptHead: f.promptHead, followUpTo: f.followUpTo, session: f.session });
}
const win = [...items.values()].filter((i) => inWin(i.at));

// Census: kind × route.
const census = {}; const kindOf = (k) => (k === 'implement' ? 'implementation' : k || 'null');
for (const i of win) { const k = kindOf(i.kind); census[k] ??= Object.fromEntries(ROUTES.map((r) => [r, 0])); census[k][i.route]++; }
const untracedSub = {}; for (const i of win.filter((x) => x.route === 'untraced')) { const k = `${kindOf(i.kind)} / ${i.sub}`; untracedSub[k] = (untracedSub[k] || 0) + 1; }

// Recommender's own choices, and the share of the core loop by route.
const CORE = new Set(['plan', 'plan-review', 'implementation', 'review', 'close-out', 'research']);
const nonWake = win.filter((i) => i.route !== 'wake' && i.route !== 'kickoff');
const shareCore = (xs) => { const t = xs.filter((i) => KINDS.includes(kindOf(i.kind))); return { n: t.length, core: t.filter((i) => CORE.has(kindOf(i.kind))).length }; };
const byRouteCore = Object.fromEntries(ROUTES.map((r) => [r, shareCore(nonWake.filter((i) => i.route === r))]));

// Session headers (fresh sessions, by the kind in their first line) as the second census.
const sessWin = T.sessions.filter((s) => inWin(s.first));
const headers = {}; for (const s of sessWin) { const k = s.header || 'none'; headers[k] = (headers[k] || 0) + 1; }

// Tokens by session kind (survey-costmix-tokens.mjs's per-ticket split, summed).
const tokByKind = {}; if (K) for (const kinds of Object.values(K.kindByTicket)) for (const [k, u] of Object.entries(kinds)) tokByKind[k] = (tokByKind[k] || 0) + u;

// Runner coverage: September items simple-dispatcher claimed, and how many a transcript saw.
let coverage = null;
if (R) {
  const claimed = R.rows.filter((r) => inWin(r.at) && r.shape !== 'rejected');
  const ids = new Set(claimed.map((r) => r.item));
  const seen = [...ids].filter((id) => items.has(id)).length;
  const byWs = {}; for (const r of claimed) { const w = r.ws || 'unknown'; byWs[w] ??= { claimed: 0, seen: 0 }; if (byWs[w]._s?.has(r.item)) continue; (byWs[w]._s ??= new Set()).add(r.item); byWs[w].claimed++; if (items.has(r.item)) byWs[w].seen++; }
  for (const w of Object.values(byWs)) delete w._s;
  const shapes = {}; for (const r of new Map(claimed.map((c) => [c.item, c])).values()) { shapes[r.shape] ??= { claimed: 0, seen: 0 }; shapes[r.shape].claimed++; if (items.has(r.item)) shapes[r.shape].seen++; }
  coverage = { claimed: ids.size, seen, byWs, shapes };
}

// Per-ticket rows for the richer-kinds comparison (finding C).
const RICH = new Set(['design', 'spike', 'scoping', 'look-into']);
const tickets = {};
for (const i of [...items.values()].sort((a, b) => (a.at < b.at ? -1 : 1))) {
  if (!i.issue || i.route === 'wake' || i.route === 'kickoff') continue;
  const t = (tickets[i.issue] ??= { issue: i.issue, seq: [], first: i.at });
  t.seq.push(kindOf(i.kind));
}
const verdicts = V?.byTicket || {};
const rows = [];
for (const t of Object.values(tickets)) {
  if (!inWin(t.first)) continue; // whole life inside the transcript window
  const firstPlan = t.seq.indexOf('plan');
  if (firstPlan < 0) continue;
  const rich = t.seq.slice(0, firstPlan).filter((k) => RICH.has(k));
  const count = (k) => t.seq.filter((x) => x === k).length;
  rows.push({ issue: t.issue, group: rich.length ? 'richer' : 'straight', rich, plans: count('plan'), planReviews: count('plan-review'),
    replans: Math.max(0, count('plan') - 1), legs: t.seq.length, implemented: t.seq.includes('implementation'), research: t.seq.slice(0, firstPlan).includes('research'),
    planRC: verdicts[t.issue]?.planRequestChanges ?? null, reviewRC: verdicts[t.issue]?.reviewRequestChanges ?? null,
    units: K?.bySession?.[t.issue] ?? null, seq: t.seq.join(' ') });
}
writeFileSync(join(dir, 'census.json'), JSON.stringify({ since, until, census, untracedSub, byRouteCore, headers, tokByKind, coverage }, null, 1));
writeFileSync(join(dir, 'tickets.json'), JSON.stringify(rows, null, 1));

const order = [...KINDS, ...Object.keys(census).filter((k) => !KINDS.includes(k)).sort()];
console.log(`items in window=${win.length} (of ${items.size}); fresh sessions in window=${sessWin.length}`);
console.log(`| kind | ${ROUTES.join(' | ')} | total | fresh sessions | weighted units (M) |`);
for (const k of order) {
  const c = census[k] || Object.fromEntries(ROUTES.map((r) => [r, 0]));
  const tot = ROUTES.reduce((s, r) => s + c[r], 0);
  console.log(`| ${k} | ${ROUTES.map((r) => c[r]).join(' | ')} | ${tot} | ${headers[k] || 0} | ${tokByKind[k] ? (tokByKind[k] / 1e6).toFixed(0) : 0} |`);
}
console.log('core share by route (template kinds only)', byRouteCore);
console.log('untraced by kind / sub', untracedSub);
console.log('coverage', coverage);
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
for (const g of ['richer', 'straight']) {
  for (const impl of [true, false]) {
    const xs = rows.filter((r) => r.group === g && r.implemented === impl);
    console.log(`${g} implemented=${impl} n=${xs.length} med planReviews=${med(xs.map((r) => r.planReviews))} mean=${(xs.reduce((s, r) => s + r.planReviews, 0) / (xs.length || 1)).toFixed(2)} replans>0=${xs.filter((r) => r.replans > 0).length} med legs=${med(xs.map((r) => r.legs))} med units(M)=${((med(xs.map((r) => r.units)) || 0) / 1e6).toFixed(1)} planRC=${xs.reduce((s, r) => s + (r.planRC || 0), 0)}`);
  }
}
console.log('richer tickets', rows.filter((r) => r.group === 'richer').map((r) => `${r.issue} [${r.rich}] ${r.seq}`));
