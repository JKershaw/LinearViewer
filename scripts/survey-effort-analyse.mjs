// LIN-3148: from the cached sample, attribute each ticket's weighted tokens and wall-clock to supervision layers, phases, re-orientation, app-side calls and waiting vs working; join change size and risk.
// Usage: node scripts/survey-effort-analyse.mjs [--dir data/survey-effort] [--json]   (run survey-effort-git.mjs, -runner.mjs and -fetch.mjs first)
// Two datasets: the September token sample (proxy lineages, 30-day retention) and the July–September census of every merged Done
// ticket the runner's logs can see (dispatches, sessions, working vs waiting hours).
// Units are frontier-input-token equivalents at list-price ratios, as fleet-complexity-read.md weights them: frontier input 1,
// output 5, cache read 0.1, 1h cache write 2, 5m cache write 1.25; mid tier × 0.6, small Claude tier × 0.2; spend reported in USD
// (the cheap tier, app-side calls) ÷ $5 per million, the frontier input list price those ratios anchor to. Only shares are reported.
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dir = arg('--dir', 'data/survey-effort');
const cache = join(dir, 'cache');
const read = (path) => { const f = join(cache, path.replace(/[^a-zA-Z0-9-]+/g, '_') + '.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; };
const { sample, population, done, doneByMonth, doneIds } = JSON.parse(readFileSync(join(dir, 'sample.json'), 'utf8'));
const runner = JSON.parse(readFileSync(join(dir, 'runner.json'), 'utf8'));
const git = Object.fromEntries(JSON.parse(readFileSync(join(dir, 'git.json'), 'utf8')).rows.map((r) => [r.id, r]));

const USD_PER_UNIT = 5 / 1e6;
export const tierOf = (model = '') => (/opus|fable/i.test(model) ? 'frontier' : /sonnet/i.test(model) ? 'mid' : /haiku/i.test(model) ? 'small' : 'cheap');
const TIER_W = { frontier: 1, mid: 0.6, small: 0.2 };
export function unitsOf(u) {
  const w = TIER_W[tierOf(u.model)];
  if (w == null) return (u.costUsd || 0) / USD_PER_UNIT;
  const cw1h = u.cacheCreation1hInputTokens ?? 0; const cw5m = (u.cacheCreationInputTokens || 0) - cw1h;
  return w * ((u.inputTokens || 0) + 5 * (u.outputTokens || 0) + 0.1 * (u.cacheReadInputTokens || 0) + 2 * cw1h + 1.25 * cw5m);
}
const PHASES = { research: 'research', plan: 'plan', 'plan-review': 'plan-review', implementation: 'implementation', implement: 'implementation', review: 'review', 'close-out': 'close-out', closeout: 'close-out' };

// A lineage's usage as a step function of time. Claude lines are cumulative per session and repeat; a drop in the running
// total means a new session began, so the lineage total is the sum of each session's maximum. Cheap-tier lines are per beat.
function usageSeries(feedback) {
  const pts = []; let segBase = 0; let prev = 0; let beatSum = 0;
  for (const f of feedback) {
    if (!f.message.startsWith('[usage]')) continue;
    let u; try { u = JSON.parse(f.message.slice(8)); } catch { continue; }
    const t = Date.parse(f.timestamp);
    if (u.harness === 'claude-code' && TIER_W[tierOf(u.model)] != null) {
      const v = unitsOf(u);
      if (v + 1 < prev) segBase += prev; // new session in the lineage
      prev = v; pts.push([t, segBase + v]);
    } else { beatSum += unitsOf(u); pts.push([t, beatSum]); }
  }
  return pts;
}
const at = (pts, t) => { let v = 0; for (const [ts, x] of pts) { if (ts <= t) v = Math.max(v, x); else break; } return v; };
const final = (pts) => pts.reduce((m, [, x]) => Math.max(m, x), 0);

// Working time: gaps between consecutive feedback entries of at most GAP are a session at work (heartbeats come every ≤30 s
// while a turn runs); longer gaps are waiting. Intervals after a [blocked] marker are waiting on a human.
const GAP = 120e3;
function intervals(feedback) {
  const ts = feedback.map((f) => [Date.parse(f.timestamp), f.message]).sort((a, b) => a[0] - b[0]);
  const work = []; const blocked = [];
  for (let i = 1; i < ts.length; i++) {
    const [a, m] = ts[i - 1]; const b = ts[i][0];
    if (/^\[blocked\]/.test(m)) blocked.push([a, b]);
    else if (b - a <= GAP) work.push([a, b]);
  }
  return { work, blocked };
}
const union = (iv) => { const s = [...iv].sort((a, b) => a[0] - b[0]); let tot = 0; let cur = null; for (const [a, b] of s) { if (!cur || a > cur[1]) { if (cur) tot += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b); } if (cur) tot += cur[1] - cur[0]; return tot; };

const runnerBy = Object.fromEntries(runner.rows.map((r) => [r.id, r]));
const tickets = []; const skipped = []; let droppedLineages = 0;
for (const id of sample) {
  const cost = read(`/issues/${id}/cost`);
  if (!cost || !(cost.workerSessions || []).length) { skipped.push({ id, why: cost?.noLineage ? 'no fleet lineage' : 'no cost data' }); continue; }
  const own = []; const upper = [];
  for (const s of cost.workerSessions) {
    const d = read(`/dispatch/${s.rootItemId}`); if (!d || d.error) { droppedLineages++; continue; }
    const fb = (d.feedback || []).slice().sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const L = { kind: s.kind, promptName: d.promptName || '', tier: tierOf(s.model || d.model), fb, pts: usageSeries(fb), durationMs: s.durationMs, dispatchedAt: Date.parse(s.dispatchedAt), completedAt: Date.parse(d.completedAt || fb.at(-1)?.timestamp || s.dispatchedAt) };
    if (s.harness === 'opencode' && s.costUsd != null && !L.pts.length) L.pts = [[L.completedAt, s.costUsd / USD_PER_UNIT]];
    // A lineage rooted on another issue, or on none (a stack walk), is a supervisor above this ticket that its work woke: a
    // parent or leg autopilot, a stack walk, or a passage Runner. It is shared, so only its usage inside this ticket's window counts.
    if (d.issueIdentifier !== id) { L.layer = /passage|runner/i.test(L.promptName) ? 'Runner' : /step/i.test(L.promptName) ? 'stepper' : 'leg'; upper.push(L); continue; }
    L.layer = s.kind === 'autopilot' ? (/step/i.test(L.promptName) ? 'stepper' : 'autopilot') : s.kind === 'wake' ? 'wakes' : PHASES[s.kind] || 'other worker';
    own.push(L);
  }
  if (!own.length) { skipped.push({ id, why: 'only supervisor lineages' }); continue; }
  const t0 = Math.min(...own.map((l) => l.dispatchedAt)); const t1 = Math.max(...own.map((l) => l.completedAt));
  const units = {}; const add = (k, v) => { units[k] = (units[k] || 0) + v; };
  let reorient = 0;
  const tierUnits = {};
  for (const l of own) {
    add(l.layer, final(l.pts)); tierUnits[l.tier] = (tierUnits[l.tier] || 0) + final(l.pts);
    // Re-orientation: the bootstrap summarise turn of a fresh session, and the handshake turn of a cold resume.
    for (let i = 0; i < l.fb.length; i++) {
      const m = l.fb[i].message;
      if (/^\[started\] Summarising|^\[onboarding\] Resume handshake/.test(m)) {
        const t = Date.parse(l.fb[i].timestamp);
        const next = l.pts.find(([ts]) => ts > t);
        if (next) reorient += Math.max(0, next[1] - at(l.pts, t));
      }
    }
  }
  for (const u of upper) { const v = Math.max(0, at(u.pts, t1) - at(u.pts, t0)); add(u.layer, v); tierUnits[u.tier] = (tierUnits[u.tier] || 0) + v; }
  const app = {}; for (const f of cost.appCalls?.byFeature || []) app[f.feature] = f.costUsd / USD_PER_UNIT;
  const work = []; const blocked = [];
  for (const l of own) { const iv = intervals(l.fb); work.push(...iv.work); blocked.push(...iv.blocked); }
  const phaseMs = {}; for (const l of own) phaseMs[l.layer] = (phaseMs[l.layer] || 0) + union(intervals(l.fb).work);
  const g = git[id] || {};
  tickets.push({
    id, month: g.month, repos: g.repos, risk: g.risk, prodLines: g.prodLines, testLines: g.testLines, docLines: g.docLines, prodFiles: g.prodFiles,
    units, tierUnits, reorient, app, appWindow: cost.window?.appCallsSince,
    spanMs: t1 - t0, workMs: union(work), blockedMs: union(blocked), phaseMs,
    dispatches: runnerBy[id]?.dispatches ?? null,
    reviewRounds: own.filter((l) => l.layer === 'review').length, planReviewRounds: own.filter((l) => l.layer === 'plan-review').length,
    tiers: [...new Set(own.map((l) => `${l.layer}:${l.tier}`))],
  });
}
tickets.forEach((t) => { t.total = Object.values(t.units).reduce((a, b) => a + b, 0); });

// Census: every merged Done ticket the runner dispatched for, by merge month.
const census = doneIds.map((id) => ({ ...git[id], ...(runnerBy[id] || {}), seen: !!runnerBy[id] }));
const out = { population, done, doneByMonth, sampled: sample.length, analysed: tickets.length, skipped, droppedLineages, tickets, runner: { logs: runner.logs, firstLog: runner.firstLog, oplogFrom: runner.oplogFrom }, census };
writeFileSync(join(dir, 'analysis.json'), JSON.stringify(out, null, 1));
if (process.argv.includes('--json')) { console.log(JSON.stringify(out)); process.exit(0); }

// Console report: the numbers the paper quotes.
const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const pct = (x) => (100 * x).toFixed(1) + '%';
console.log(`population ${population} merged tickets since June, ${done} Done; sampled ${sample.length}, analysed ${tickets.length}; ${droppedLineages} lineages aged out of the dispatch store; skipped ${skipped.length}:`, skipped.map((x) => x.id).join(' '));
const months = [...new Set(tickets.map((t) => t.month))].sort();
const layers = ['Runner', 'leg', 'stepper', 'autopilot', 'wakes', 'research', 'plan', 'plan-review', 'implementation', 'review', 'close-out', 'other worker'];
console.log('\n## Pooled weighted-token share by layer/phase, per month (repo: both; population: analysed sample)');
console.log(['month', 'n', ...layers, 'reorient*', 'app(recommend+brief)*'].join('\t'));
for (const m of [...months, 'ALL']) {
  const ts = tickets.filter((t) => m === 'ALL' || t.month === m); const tot = ts.reduce((a, t) => a + t.total, 0);
  const appTs = ts.filter((t) => t.appWindow && t.month >= t.appWindow.slice(0, 7));
  const appTot = appTs.reduce((a, t) => a + Object.values(t.app).reduce((x, y) => x + y, 0), 0); const appBase = appTs.reduce((a, t) => a + t.total, 0);
  console.log([m, ts.length, ...layers.map((k) => pct(ts.reduce((a, t) => a + (t.units[k] || 0), 0) / tot)), pct(ts.reduce((a, t) => a + t.reorient, 0) / tot), appTs.length ? pct(appTot / (appBase + appTot)) : 'n/a'].join('\t'));
}
console.log('* reorient is a subset of the layers; app share is of worker+app units, for tickets inside the 30-day app-call window');
const tierTot = {}; for (const t of tickets) for (const [k, v] of Object.entries(t.tierUnits)) tierTot[k] = (tierTot[k] || 0) + v;
const allU = tickets.reduce((a, t) => a + t.total, 0);
console.log(`median ticket ${(med(tickets.map((t) => t.total)) / 1e3).toFixed(0)}k units; tier share of sample units:`, Object.entries(tierTot).map(([k, v]) => `${k} ${pct(v / allU)}`).join(', '));
console.log('\n## Wall-clock per ticket, medians (hours) and working share');
console.log(['month', 'n', 'span_h', 'working_h', 'working_share_pooled', 'blocked_on_human_share_pooled', 'dispatches', 'review_rounds'].join('\t'));
for (const m of [...months, 'ALL']) {
  const ts = tickets.filter((t) => m === 'ALL' || t.month === m);
  const span = ts.reduce((a, t) => a + t.spanMs, 0);
  console.log([m, ts.length, (med(ts.map((t) => t.spanMs)) / 36e5).toFixed(2), (med(ts.map((t) => t.workMs)) / 36e5).toFixed(2), pct(ts.reduce((a, t) => a + t.workMs, 0) / span), pct(ts.reduce((a, t) => a + t.blockedMs, 0) / span), med(ts.map((t) => t.dispatches)), med(ts.map((t) => t.reviewRounds))].join('\t'));
}
console.log('\n## Working time by layer/phase, pooled share of summed per-lineage working time');
const allPh = {}; for (const t of tickets) for (const [k, v] of Object.entries(t.phaseMs)) allPh[k] = (allPh[k] || 0) + v;
const phTot = Object.values(allPh).reduce((a, b) => a + b, 0); console.log(Object.entries(allPh).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v / phTot)}`).join(', '));

// Proportionality.
const rank = (a) => { const s = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = Array(a.length); s.forEach(([, i], k) => (r[i] = k)); return r; };
const spearman = (x, y) => { const rx = rank(x); const ry = rank(y); const n = x.length; const d2 = rx.reduce((a, r, i) => a + (r - ry[i]) ** 2, 0); return 1 - (6 * d2) / (n * (n * n - 1)); };
console.log('\n## Proportionality: Spearman rank correlation against production lines (n tickets)');
for (const [k, f] of [['weighted tokens', (t) => t.total], ['wall-clock span', (t) => t.spanMs], ['working time', (t) => t.workMs], ['dispatches', (t) => t.dispatches ?? 0], ['review rounds', (t) => t.reviewRounds]]) {
  console.log(`${k}\trho=${spearman(tickets.map((t) => t.prodLines), tickets.map(f)).toFixed(2)}\tvs test lines rho=${spearman(tickets.map((t) => t.testLines), tickets.map(f)).toFixed(2)}`);
}
const bins = [[0, 1], [1, 50], [50, 200], [200, 1000], [1000, 1e9]];
console.log('\n## Median weighted tokens (k units) by production-size bin × risk class');
const risks = ['docs/tests only', 'UI only', 'rest', 'high'];
console.log(['prod lines', ...risks, 'all'].join('\t'));
for (const [lo, hi] of bins) {
  const inBin = tickets.filter((t) => t.prodLines >= lo && t.prodLines < hi);
  console.log([`${lo}-${hi >= 1e9 ? '' : hi - 1}`, ...risks.map((r) => { const s = inBin.filter((t) => t.risk === r); return s.length ? `${(med(s.map((t) => t.total)) / 1e3).toFixed(0)} (n=${s.length})` : '-'; }), `${(med(inBin.map((t) => t.total)) / 1e3).toFixed(0)} (n=${inBin.length})`].join('\t'));
}
console.log('\n## Median per risk class: weighted tokens (k units), span h, dispatches, review rounds, prod lines');
for (const r of risks) { const s = tickets.filter((t) => t.risk === r); if (s.length) console.log([r, s.length, (med(s.map((t) => t.total)) / 1e3).toFixed(0), (med(s.map((t) => t.spanMs)) / 36e5).toFixed(1), med(s.map((t) => t.dispatches)), med(s.map((t) => t.reviewRounds)), med(s.map((t) => t.prodLines))].join('\t')); }
console.log('\n## Same size, over time: median weighted tokens (k units) per month within size bins');
console.log(['prod lines', ...months].join('\t'));
for (const [lo, hi] of [[0, 50], [50, 300], [300, 1e9]]) console.log([`${lo}-${hi >= 1e9 ? '' : hi - 1}`, ...months.map((m) => { const s = tickets.filter((t) => t.month === m && t.prodLines >= lo && t.prodLines < hi); return s.length ? `${(med(s.map((t) => t.total)) / 1e3).toFixed(0)} (n=${s.length})` : '-'; })].join('\t'));
console.log('\n## Census (runner logs): merged Done tickets by merge month');
console.log(['month', 'done', 'runner-seen', 'timed', 'med dispatches', 'med fresh sessions', 'med cold', 'med warm', 'med work h', 'pooled work share', 'pooled peer-wait share', 'pooled human-wait share', 'med prod lines'].join('\t'));
const cMonths = [...new Set(census.map((c) => c.month))].sort();
for (const m of [...cMonths, 'Jul-Sep']) {
  const cs = census.filter((c) => (m === 'Jul-Sep' ? c.month >= '2026-07' : c.month === m)); const seen = cs.filter((c) => c.seen); const timed = seen.filter((c) => c.timedSessions);
  const w = timed.reduce((a, c) => a + c.workH, 0); const pw = timed.reduce((a, c) => a + c.peerWaitH, 0); const hw = timed.reduce((a, c) => a + c.humanWaitH, 0); const all = w + pw + hw;
  console.log([m, cs.length, seen.length, timed.length, med(seen.map((c) => c.dispatches)), med(seen.map((c) => c.freshSessions)), med(seen.map((c) => c.coldResumes)), med(seen.map((c) => c.warmFollowUps)), med(timed.map((c) => c.workH))?.toFixed(2), all ? pct(w / all) : '-', all ? pct(pw / all) : '-', all ? pct(hw / all) : '-', med(seen.map((c) => c.prodLines))].join('\t'));
}
const cs = census.filter((c) => c.seen && c.month >= '2026-07'); const ct = cs.filter((c) => c.timedSessions);
console.log(`census proportionality (Jul-Sep, n=${cs.length}; timed n=${ct.length}): rho(dispatches, prod lines)=${spearman(cs.map((c) => c.prodLines), cs.map((c) => c.dispatches)).toFixed(2)}, rho(work h, prod lines)=${spearman(ct.map((c) => c.prodLines), ct.map((c) => c.workH)).toFixed(2)}, rho(dispatches, test lines)=${spearman(cs.map((c) => c.testLines), cs.map((c) => c.dispatches)).toFixed(2)}`);
console.log('census median dispatches | work h by risk class (Jul-Sep):', risks.map((r) => { const s = cs.filter((c) => c.risk === r); const st = s.filter((c) => c.timedSessions); return `${r} n=${s.length} ${med(s.map((c) => c.dispatches))} | ${med(st.map((c) => c.workH))?.toFixed(2)} (prod ${med(s.map((c) => c.prodLines))})`; }).join('; '));
console.log('census risk at fixed size (Jul-Sep): median dispatches (work h) by production-size bin × risk class');
console.log(['prod lines', ...risks.slice(1)].join('\t'));
for (const [lo, hi] of [[1, 50], [50, 300], [300, 1e9]]) console.log([`${lo}-${hi >= 1e9 ? '' : hi - 1}`, ...risks.slice(1).map((r) => { const s = cs.filter((c) => c.risk === r && c.prodLines >= lo && c.prodLines < hi); const st = s.filter((c) => c.timedSessions); return s.length ? `${med(s.map((c) => c.dispatches))} (${med(st.map((c) => c.workH))?.toFixed(2)}) n=${s.length}` : '-'; })].join('\t'));
console.log('census same size over time: median dispatches (work h) per month within production-size bins');
console.log(['prod lines', ...cMonths.filter((m) => m >= '2026-07')].join('\t'));
for (const [lo, hi] of [[0, 1], [1, 50], [50, 300], [300, 1e9]]) console.log([`${lo}-${hi >= 1e9 ? '' : hi - 1}`, ...cMonths.filter((m) => m >= '2026-07').map((m) => { const s = cs.filter((c) => c.month === m && c.prodLines >= lo && c.prodLines < hi); const st = s.filter((c) => c.timedSessions); return s.length ? `${med(s.map((c) => c.dispatches))} (${med(st.map((c) => c.workH))?.toFixed(2)}) n=${s.length}` : '-'; })].join('\t'));
console.log('\n## By repo');
for (const r of ['LinearViewer', 'simple-dispatcher']) {
  const s = tickets.filter((t) => t.repos?.includes(r)); const c = cs.filter((x) => x.repos?.includes(r)); const ct2 = c.filter((x) => x.timedSessions);
  console.log(`${r}: sample n=${s.length} median k units ${s.length ? (med(s.map((t) => t.total)) / 1e3).toFixed(0) : '-'}, median prod lines ${med(s.map((t) => t.prodLines))}; census Jul-Sep n=${c.length} median dispatches ${med(c.map((x) => x.dispatches))}, median work h ${med(ct2.map((x) => x.workH))?.toFixed(2)}, median prod lines ${med(c.map((x) => x.prodLines))}, rho(dispatches, prod lines)=${c.length > 2 ? spearman(c.map((x) => x.prodLines), c.map((x) => x.dispatches)).toFixed(2) : '-'}`);
}
