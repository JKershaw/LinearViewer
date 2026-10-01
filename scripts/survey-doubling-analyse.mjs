// LIN-3170: dispatches per correct change by merge week, June–September, both repos, split by component (fresh session kind, wakes, beats into workers), per-step vs per-beat, size bands, and September's attribution to the steady-base map.
// Usage: node scripts/survey-doubling-analyse.mjs [--out data/survey-doubling/analysis.json]
// Run first: survey-doubling-runner.mjs, survey-doubling-transcripts.mjs, survey-model-git.mjs --since 2026-05-01 --out
// data/survey-doubling/git.json, and a same-day data/survey/scorecard.json from survey-scorecard.mjs (correct and complete verdicts).
// A dispatch is a runner-claimed item that opened a fresh session, resumed one cold or was signalled warm into a held one (aborts,
// rejects and busy re-queues are not work). Its kind is exact where a local transcript fetched it (29 Aug on). Otherwise a fresh
// session's kind is read from its bootstrap prompt's length: the "# LIN-n · kind" header (16 Jul on, LIN-1361) adds the kind name's
// length to a fixed base (292, 392, or 524 for a bootstrap-free leg), so the length names the kind. Six letters is review (or
// custom/triage/design, 12% of September's exact six-letter launches); nine letters is autopilot when the session later took a
// follow-up and close-out when it did not (95% right on September's exact launches). A follow-up takes the kind of the session it
// enters: into an autopilot it is a wake; into a worker session it is a beat (91% of those a transcript read are stepper beats).
// Dispatches per correct change for a week = the dispatches naming the changes merged that week / how many of them were correct
// and complete, over code changes with at least one runner dispatch (model-choice.md's rule). model-choice.md counted only items whose
// own log block names the ticket; that rule is reproduced as `issueLineOnly`.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const out = arg('--out', 'data/survey-doubling/analysis.json');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const runner = read('data/survey-doubling/runner.json');
const tx = read('data/survey-doubling/transcripts.json');
const git = read('data/survey-doubling/git.json');
const score = new Map(read('data/survey/scorecard.json').changes.map((c) => [c.id, c]));

const monday = (iso) => { const d = new Date(iso); const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7)); return m.toISOString().slice(0, 10); };
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const sum = (xs) => xs.reduce((a, b) => a + (b || 0), 0);
const r1 = (x) => (x == null ? null : +x.toFixed(1)); const r3 = (x) => (x == null ? null : +x.toFixed(3));

// ---- Items and kinds.
const WORK = new Set(['fresh', 'cold', 'warm']);
const items = runner.rows.filter((r) => WORK.has(r.shape));
const byId = new Map(items.map((r) => [r.item, r]));
const exact = tx.items;
const takesFollowUp = new Set(items.filter((r) => r.shape !== 'fresh').map((r) => r.root));
const LEN = { 3: 'bug', 4: 'plan', 6: 'review', 7: 'blocked', 8: 'research', 9: 'autopilot|close-out', 11: 'plan-review', 14: 'implementation' };
function decode(r) {
  if (r.promptLen == null || r.promptLen > 2000) return null;
  const res = r.promptLen - (r.issueLine ? r.issueLine.length : 0);
  if (!r.issueLine) return res === 385 ? 'other' : null;
  for (const base of [524, 392, 292]) {
    const k = LEN[res - base]; if (!k) continue;
    if (base === 524 && !['plan', 'research', 'implementation'].includes(k)) continue;
    return k === 'autopilot|close-out' ? (takesFollowUp.has(r.item) ? 'autopilot' : 'close-out') : k;
  }
  return null;
}
const PHASES = ['research', 'plan', 'plan-review', 'implementation', 'review', 'close-out'];
const freshKind = new Map();
for (const r of items) if (r.shape === 'fresh') {
  const e = exact[r.item]?.kind;
  let k = e || decode(r) || (r.harness === 'opencode' ? 'cheap harness, kind unread' : 'kind unread');
  if (k === 'implement') k = 'implementation';
  freshKind.set(r.item, { kind: k, how: e ? 'exact' : decode(r) ? 'decoded' : 'none' });
}
// Passage layer (September): Runner sessions and the autopilots they dispatched (legs), from the transcripts.
const wsKey = (s) => (s || '').slice(0, 8);
// A Runner is an autopilot session carrying the passage prompt (a worker that merely read the prompt's file is not one).
const isRunner = (s) => s.runner && s.header === 'autopilot';
const runnerSessions = new Set(tx.sessions.filter(isRunner).map((s) => wsKey(s.ws)));
const legIssues = new Set(); for (const s of tx.sessions) if (isRunner(s)) for (const x of s.dispatchedIssues) if (x !== s.headerIssue) legIssues.add(x);
const stepperSessions = new Set(tx.sessions.filter((s) => s.stepper).map((s) => wsKey(s.ws)));
const acted = {}; for (const s of tx.sessions) for (const [id, a] of Object.entries(s.acted)) acted[id] = acted[id] || a;

for (const r of items) {
  const root = byId.get(r.root) || r; const rk = freshKind.get(root.item)?.kind || 'kind unread';
  r.rootKind = rk;
  if (r.shape === 'fresh') { r.kind = freshKind.get(r.item).kind; r.kindHow = freshKind.get(r.item).how; r.component = PHASES.includes(r.kind) ? r.kind : r.kind === 'autopilot' ? 'autopilot session' : /unread/.test(r.kind) ? 'fresh, kind unread' : 'other fresh'; }
  else {
    const e = exact[r.item];
    if (e?.kind === 'wake' || (!e && rk === 'autopilot')) r.component = 'wake';
    else if (e ? PHASES.includes(e.kind === 'implement' ? 'implementation' : e.kind) || /^beat/.test(e.promptName || '') : PHASES.includes(rk)) r.component = 'beat into a worker';
    else if (!e && /unread/.test(rk)) r.component = 'follow-up, session kind unread';
    else r.component = 'other follow-up';
    r.kind = e?.kind || null; r.promptName = e?.promptName || null; r.kindHow = e ? 'exact' : 'inferred';
  }
  const s8 = r.session8; const ownerSession = root.session8;
  r.passage = runnerSessions.has(ownerSession) ? 'Runner' : (rk === 'autopilot' || r.component === 'autopilot session') && legIssues.has(root.issueLine || r.issue) && r.at >= '2026-09-17' ? 'leg' : null;
  r.stepperSession = stepperSessions.has(ownerSession);
  r.quiet = r.component === 'wake' && r.item in acted ? !acted[r.item] : null;
  r.week = monday(r.at);
}
const COMPONENTS = ['research', 'plan', 'plan-review', 'implementation', 'review', 'close-out', 'autopilot session', 'other fresh', 'fresh, kind unread', 'wake', 'beat into a worker', 'follow-up, session kind unread', 'other follow-up'];

// ---- Changes.
const perIssue = new Map(); for (const r of items) if (r.issue) (perIssue.get(r.issue) || perIssue.set(r.issue, []).get(r.issue)).push(r);
const HIGH = /auth|credential|token|oauth|secret|crypto|security|permission|grant|session-store|connection|migrat|encrypt|revoke|refresh|login|account/;
const changes = git.rows.filter((g) => g.lastMerge >= '2026-06-01').map((g) => {
  const sc = score.get(g.id); const ds = perIssue.get(g.id) || [];
  const comp = {}; for (const c of COMPONENTS) comp[c] = 0; for (const d of ds) comp[d.component]++;
  const reviews = ds.filter((d) => d.component === 'review').sort((a, b) => a.at.localeCompare(b.at));
  const firstReview = reviews[0]?.at;
  return {
    id: g.id, repos: g.repos, week: monday(g.lastMerge), month: g.lastMerge.slice(0, 7), prodLines: g.prodLines, docsOnly: g.prodLines === 0,
    size: g.prodLines === 0 ? '0' : g.prodLines < 50 ? '1-49' : g.prodLines < 300 ? '50-299' : '300+', risk: g.risk,
    scored: !!sc, good: sc?.good ?? null, n: ds.length, issueLineOnly: ds.filter((d) => d.issueLine === g.id).length, comp,
    fresh: ds.filter((d) => d.shape === 'fresh').length, warm: ds.filter((d) => d.shape === 'warm').length, cold: ds.filter((d) => d.shape === 'cold').length,
    extraReviews: Math.max(0, reviews.length - 1), reimpl: firstReview ? ds.filter((d) => d.component === 'implementation' && d.at > firstReview).length : 0,
    ds,
  };
});
// A passage's own epic (the ticket its Runner flies) is a supervisor, not a change: its merges are docs, its dispatches the Runner's.
const passageEpics = new Set(tx.sessions.filter((s) => isRunner(s) && s.headerIssue).map((s) => s.headerIssue));
const scored = changes.filter((c) => c.scored && c.n > 0 && !passageEpics.has(c.id));
const code = scored.filter((c) => !c.docsOnly);

// ---- 1. Weekly decomposition.
const WEEKS = [...new Set(code.map((c) => c.week))].filter((w) => w >= '2026-06-01' && w <= '2026-09-22').sort();
function perGood(cs) {
  const g = cs.filter((c) => c.good).length; if (!g) return null;
  const comp = {}; for (const k of COMPONENTS) comp[k] = r3(sum(cs.map((c) => c.comp[k])) / g);
  return { changes: cs.length, good: g, total: r3(sum(cs.map((c) => c.n)) / g), issueLineOnly: r3(sum(cs.map((c) => c.issueLineOnly)) / g), fresh: r3(sum(cs.map((c) => c.fresh)) / g), warm: r3(sum(cs.map((c) => c.warm)) / g), cold: r3(sum(cs.map((c) => c.cold)) / g), comp };
}
const weekly = WEEKS.map((w) => ({ week: w, ...perGood(code.filter((c) => c.week === w)) }));
const PERIODS = [['June (from 20 Jun logs)', '2026-06-01', '2026-06-29'], ['29 Jun–12 Jul', '2026-06-29', '2026-07-13'], ['13–26 Jul', '2026-07-13', '2026-07-27'], ['27 Jul–31 Aug', '2026-07-27', '2026-08-31'], ['1–13 Sep', '2026-08-31', '2026-09-14'], ['14–28 Sep', '2026-09-14', '2026-09-29']];
const inP = (c, p) => c.week >= p[1] && c.week < p[2];
const periods = PERIODS.map((p) => ({ period: p[0], ...perGood(code.filter((c) => inP(c, p))) }));

// Fleet view: every dispatch in a week (including supervisors of epics that are not changes) over the week's correct code changes.
const fleetWeekly = WEEKS.map((w) => { const g = code.filter((c) => c.week === w && c.good).length; const ds = items.filter((r) => r.week === w); return { week: w, dispatches: ds.length, withTicket: ds.filter((r) => r.issue).length, good: g, perGood: g ? r1(ds.length / g) : null }; });

// ---- 2. Kind coverage: how each fresh session's kind was known, by month.
const coverage = {}; for (const r of items) if (r.shape === 'fresh') { const m = r.at.slice(0, 7); (coverage[m] ||= {}); coverage[m][r.kindHow] = (coverage[m][r.kindHow] || 0) + 1; }
const decodeCheck = {}; for (const r of items) if (r.shape === 'fresh' && exact[r.item] && decode(r)) { const e = exact[r.item].kind === 'implement' ? 'implementation' : exact[r.item].kind; const k = `${decode(r)}`; (decodeCheck[k] ||= { right: 0, wrong: 0 }); decodeCheck[k][e === k ? 'right' : 'wrong']++; }
const issueLineShare = {}; for (const r of items) if (r.shape !== 'fresh') { const w = r.at.slice(0, 7) + (r.at.slice(8, 10) < '16' ? 'a' : 'b'); (issueLineShare[w] ||= { n: 0, own: 0 }); issueLineShare[w].n++; if (r.issueLine) issueLineShare[w].own++; }

// ---- 3. Steps vs beats per change, by period.
const MONTHS = ['2026-06', '2026-07', '2026-08', '2026-09'];
const stepsBeats = PERIODS.map((p) => {
  const cs = code.filter((c) => inP(c, p)); const g = cs.filter((c) => c.good);
  const phase = {}; for (const k of [...PHASES, 'autopilot']) {
    const sess = cs.flatMap((c) => c.ds.filter((d) => d.shape === 'fresh' && (d.kind === k)));
    const beats = cs.flatMap((c) => c.ds.filter((d) => d.shape !== 'fresh' && d.rootKind === k));
    phase[k] = { sessionsPerGood: g.length ? r3(sess.length / g.length) : null, beatsPerSession: sess.length ? r3(beats.length / sess.length) : null };
  }
  return { period: p[0], changes: cs.length, good: g.length, medFresh: median(cs.map((c) => c.fresh)), medFollowUps: median(cs.map((c) => c.warm + c.cold)), meanFresh: r1(sum(cs.map((c) => c.fresh)) / cs.length), meanFollowUps: r1(sum(cs.map((c) => c.warm + c.cold)) / cs.length), phase };
});
// Re-beats inside dispatches (not dispatch items): Stop-hook turns per session, "not done yet" verdicts, PENDING-EXTERNAL pauses, stall re-fires, compactions.
const rebeats = PERIODS.slice(2).map((p) => {
  const cs = code.filter((c) => inP(c, p)); const g = cs.filter((c) => c.good).length;
  const sessions = new Set(cs.flatMap((c) => c.ds.map((d) => d.session8).filter(Boolean)));
  const its = cs.flatMap((c) => c.ds.map((d) => d.item));
  const stops = sum([...sessions].map((s) => runner.sessions[s]?.stops || 0));
  const refires = sum([...sessions].map((s) => sum(Object.values(runner.sessions[s]?.refires || {}))));
  const notDone = sum(its.map((i) => runner.itemHook[i]?.notDoneYet || 0)); const pending = sum(its.map((i) => runner.itemHook[i]?.pendingExternal || 0));
  return { period: p[0], good: g, dispatchesPerGood: r1(sum(cs.map((c) => c.n)) / g), stopTurnsPerGood: r1(stops / g), notDoneYetPerGood: r1(notDone / g), pendingExternalPerGood: r1(pending / g), stallRefiresPerGood: r1(refires / g) };
});
const compactions = { sessions: tx.sessions.length, compactions: sum(tx.sessions.map((s) => s.compactions)) };

// ---- 4. Size held fixed, and by repo.
const bands = ['0', '1-49', '50-299', '300+'];
const bySize = PERIODS.map((p) => { const o = { period: p[0] }; for (const b of bands) { const cs = scored.filter((c) => inP(c, p) && c.size === b); const x = perGood(cs); o[b] = x ? { n: cs.length, good: x.good, perGood: r1(x.total), freshPerGood: r1(x.fresh) } : null; } return o; });
const byRepo = PERIODS.map((p) => { const o = { period: p[0] }; for (const repo of ['LinearViewer', 'simple-dispatcher']) { const cs = code.filter((c) => inP(c, p) && c.repos.includes(repo)); const x = perGood(cs); o[repo] = x ? { n: cs.length, good: x.good, perGood: r1(x.total), freshPerGood: r1(x.fresh), wakes: r1(x.comp.wake), beats: r1(x.comp['beat into a worker']) } : null; } return o; });

// ---- 5. September attribution to the steady-base map (docs/steady-base.md rows), code changes merged 1–28 Sep.
const sept = code.filter((c) => c.week >= '2026-08-31' && c.week < '2026-09-29'); const septGood = sept.filter((c) => c.good).length;
const bucket = {}; const add = (k) => (bucket[k] = (bucket[k] || 0) + 1);
const TESTCI = /\bCI\b|test|suite|green|red\b|flak|push|PR\b/i;
const exactBeats = sept.flatMap((c) => c.ds).filter((d) => d.component === 'beat into a worker' && d.promptName);
const testShare = exactBeats.length ? exactBeats.filter((d) => TESTCI.test(d.promptName)).length / exactBeats.length : 0;
const exactWakes = sept.flatMap((c) => c.ds).filter((d) => d.component === 'wake' && d.quiet != null && !d.passage);
const quietShare = exactWakes.length ? exactWakes.filter((d) => d.quiet).length / exactWakes.length : 0;
let testFrac = 0, quietFrac = 0;
for (const c of sept) {
  const reviews = c.ds.filter((d) => d.component === 'review').sort((a, b) => a.at.localeCompare(b.at)); const first = reviews[0]?.at;
  for (const d of c.ds) {
    if (d.passage) { add('2 passage layer (Runner and legs)'); continue; }
    if (d.component === 'wake') { if (d.quiet === true) add('1 quiet wakes'); else if (d.quiet === false) add('3 supervision that acted'); else { quietFrac += quietShare; testFrac += 0; add('wake, transcript missing'); } continue; }
    if (d.component === 'autopilot session') { add('3 supervision that acted'); continue; }
    if (first && ((d.component === 'review' && d.at > first) || (d.component === 'implementation' && d.at > first))) { add('8 review rounds after the first (ceiling)'); continue; }
    if (first && d.shape !== 'fresh' && ['review', 'implementation'].includes(d.rootKind) && d.at > first) { add('8 review rounds after the first (ceiling)'); continue; }
    if (d.component === 'beat into a worker') { if (d.promptName) add(TESTCI.test(d.promptName) ? 'test or CI beats' : 'unexplained: other stepper beats'); else add('beat, name unread'); continue; }
    add(`unexplained: ${PHASES.includes(d.component) ? 'first-round legs (' + d.component + ')' : d.component}`);
  }
}
// Unread wakes and beats are split by the shares measured on the read ones.
if (bucket['wake, transcript missing']) { const n = bucket['wake, transcript missing']; bucket['1 quiet wakes'] = (bucket['1 quiet wakes'] || 0) + n * quietShare; bucket['3 supervision that acted'] = (bucket['3 supervision that acted'] || 0) + n * (1 - quietShare); delete bucket['wake, transcript missing']; }
if (bucket['beat, name unread']) { const n = bucket['beat, name unread']; bucket['test or CI beats'] = (bucket['test or CI beats'] || 0) + n * testShare; bucket['unexplained: other stepper beats'] = (bucket['unexplained: other stepper beats'] || 0) + n * (1 - testShare); delete bucket['beat, name unread']; }
const septTotal = sum(Object.values(bucket));
const attribution = Object.entries(bucket).map(([k, v]) => ({ bucket: k, perGood: r1(v / septGood), share: r3(v / septTotal) })).sort((a, b) => b.perGood - a.perGood);
// Row 7 is a lens, not a component: the share of September's dispatches that sit on docs/tests-only or small low-risk changes.
const small = sept.filter((c) => c.size === '1-49' && c.risk !== 'high'); const docsSept = scored.filter((c) => c.docsOnly && c.week >= '2026-08-31' && c.week < '2026-09-29');
const row7 = { smallLowRisk: { changes: small.length, dispatches: sum(small.map((c) => c.n)), shareOfCode: r3(sum(small.map((c) => c.n)) / sum(sept.map((c) => c.n))), perGood: r1(perGood(small)?.total) }, docsOnly: { changes: docsSept.length, dispatches: sum(docsSept.map((c) => c.n)), perGood: r1(perGood(docsSept)?.total), passageShare: r3(sum(docsSept.map((c) => c.ds.filter((d) => d.passage).length)) / sum(docsSept.map((c) => c.n))), wakeShare: r3(sum(docsSept.map((c) => c.comp.wake)) / sum(docsSept.map((c) => c.n))), withoutPassageEpic: r1(perGood(docsSept.filter((c) => c.id !== 'LIN-3099'))?.total), top: docsSept.sort((a, b) => b.n - a.n).slice(0, 5).map((c) => `${c.id}:${c.n}`) }, codePerGood: r1(perGood(sept)?.total) };

// ---- 6. Around the 12 July step: two weeks either side, per component.
const before = perGood(code.filter((c) => c.week >= '2026-06-29' && c.week < '2026-07-13')); const after = perGood(code.filter((c) => c.week >= '2026-07-13' && c.week < '2026-07-27'));
const step = { before, after, delta: Object.fromEntries(COMPONENTS.map((k) => [k, r3(after.comp[k] - before.comp[k])])) };

const result = { generatedAt: new Date().toISOString(), items: items.length, changes: changes.length, scored: scored.length, code: code.length, COMPONENTS, weekly, periods, fleetWeekly, coverage, decodeCheck, issueLineShare, stepsBeats, rebeats, compactions, bySize, byRepo, attribution, septGood, septTotal: r1(septTotal), testShare: r3(testShare), quietShare: r3(quietShare), quietRead: exactWakes.length, row7, step, passage: { runnerSessions: runnerSessions.size, legIssues: legIssues.size, epics: [...passageEpics] } };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 1));
const show = (x) => console.log(JSON.stringify(x));
console.log('items', items.length, 'code changes with dispatches', code.length, 'scored', scored.length);
console.log('periods'); for (const p of periods) show({ p: p.period, n: p.changes, good: p.good, total: p.total, issueLineOnly: p.issueLineOnly, fresh: p.fresh, warm: p.warm, cold: p.cold, comp: Object.fromEntries(Object.entries(p.comp).map(([k, v]) => [k, r1(v)])) });
console.log('step 12 Jul'); show(step.delta); show({ before: before.total, after: after.total, bIL: before.issueLineOnly, aIL: after.issueLineOnly });
console.log('coverage', JSON.stringify(coverage)); console.log('decodeCheck', JSON.stringify(decodeCheck)); console.log('issueLineShare', JSON.stringify(issueLineShare));
console.log('stepsBeats'); for (const s of stepsBeats) show(s);
console.log('rebeats'); for (const s of rebeats) show(s); show(compactions);
console.log('bySize'); for (const s of bySize) show(s);
console.log('byRepo'); for (const s of byRepo) show(s);
console.log('attribution', septGood, r1(septTotal), 'testShare', r3(testShare), 'quietShare', r3(quietShare), exactWakes.length); for (const a of attribution) show(a); show(row7);
console.log('fleet'); for (const f of fleetWeekly) show(f);
console.log('weekly'); for (const w of weekly) show({ w: w.week, n: w.changes, good: w.good, total: r1(w.total), il: r1(w.issueLineOnly), wake: r1(w.comp?.wake), beat: r1(w.comp?.['beat into a worker']), ap: r1(w.comp?.['autopilot session']), unread: r1(w.comp?.['fresh, kind unread']) });

// ---- 7. Fully observed cohorts either side of the step: changes whose every runner dispatch and last merge fall inside one logged
// window (1–5 Jul, before the 6–11 Jul log gap; 12–26 Jul after it), so neither the thin June logs nor the gap can cut their history.
// maxDays caps a change's life (first dispatch to last merge), so a 15-day window can be compared with the 5-day one before the gap.
function cohort(from, to, maxDays = 99) {
  const cs = code.filter((c) => { const ats = c.ds.map((d) => d.at).sort(); const g = git.rows.find((r) => r.id === c.id); return ats[0] >= from && ats.at(-1) < to && g.lastMerge.slice(0, 10) < to && g.lastMerge.slice(0, 10) >= from && (Date.parse(g.lastMerge) - Date.parse(ats[0])) / 864e5 <= maxDays; });
  const x = perGood(cs); if (!x) return null;
  const roots = {}; for (const c of cs) for (const d of c.ds) if (d.shape !== 'fresh') { const root = byId.get(d.root); const k = root ? (takesFollowUp.has(root.item) ? `root took ${items.filter((y) => y.root === root.item && y.shape !== 'fresh').length > 3 ? '>3' : '1-3'} follow-ups` : '') : 'root unseen'; roots[k] = (roots[k] || 0) + 1; }
  return { from, to, changes: cs.length, good: x.good, perGood: r1(x.total), fresh: r1(x.fresh), warm: r1(x.warm), cold: r1(x.cold), wake: r1(x.comp.wake), beat: r1(x.comp['beat into a worker']), unreadFollowUps: r1(x.comp['follow-up, session kind unread']), medDispatches: median(cs.map((c) => c.n)), roots };
}
const cohorts = { pre: cohort('2026-07-01', '2026-07-06'), post: cohort('2026-07-12', '2026-07-27'), postShort: cohort('2026-07-12', '2026-07-27', 5), post16Short: cohort('2026-07-16', '2026-07-27', 5), post12to15: cohort('2026-07-12', '2026-07-16'), postAug: cohort('2026-08-03', '2026-08-17'), postSep: cohort('2026-09-14', '2026-09-29') };
console.log('cohorts'); for (const [k, v] of Object.entries(cohorts)) console.log(k, JSON.stringify(v));
result.cohorts = cohorts; writeFileSync(out, JSON.stringify(result, null, 1));

// ---- 8. Held sessions by launch window: the share of fresh sessions that later took follow-ups, and how many each took. Kind-free,
// so it reaches back before the 16 July header; it dates when follow-ups per held session rose.
const WINDOWS = [['1–5 Jul', '2026-07-01', '2026-07-06'], ['12–15 Jul', '2026-07-12', '2026-07-16'], ['16–26 Jul', '2026-07-16', '2026-07-27'], ['27 Jul–31 Aug', '2026-07-27', '2026-09-01'], ['1–16 Sep', '2026-09-01', '2026-09-17'], ['17–30 Sep', '2026-09-17', '2026-10-01']];
const fuCount = {}; for (const r of items) if (r.shape !== 'fresh') fuCount[r.root] = (fuCount[r.root] || 0) + 1;
const held = WINDOWS.map(([label, a, z]) => { const fs = items.filter((r) => r.shape === 'fresh' && r.at >= a && r.at < z); const h = fs.filter((r) => fuCount[r.item]); const fu = sum(h.map((r) => fuCount[r.item])); return { window: label, fresh: fs.length, held: h.length, heldShare: r3(h.length / fs.length), followUpsPerHeld: r1(fu / h.length) }; });
console.log('held'); for (const h of held) console.log(JSON.stringify(h));
result.held = held; writeFileSync(out, JSON.stringify(result, null, 1));

// ---- 9. Wakes per worker event: each worker session or beat reaching a boundary can wake one or more supervisors above it.
const wakeRate = PERIODS.slice(2).map((p) => { const cs = code.filter((c) => inP(c, p)); const ds = cs.flatMap((c) => c.ds); const worker = ds.filter((d) => PHASES.includes(d.component) || d.component === 'beat into a worker').length; const wakes = ds.filter((d) => d.component === 'wake'); return { period: p[0], workerEvents: worker, wakes: wakes.length, wakesPerWorkerEvent: r3(wakes.length / worker), intoLegOrRunner: wakes.filter((d) => d.passage).length, intoStepper: wakes.filter((d) => d.stepperSession && !d.passage).length, quietRead: wakes.filter((d) => d.quiet != null).length, quiet: wakes.filter((d) => d.quiet).length }; });
console.log('wakeRate'); for (const w of wakeRate) console.log(JSON.stringify(w));
result.wakeRate = wakeRate; writeFileSync(out, JSON.stringify(result, null, 1));

// ---- 10. Of the beats into worker sessions whose item a transcript read, how many are stepper beats ("beat N/M")?
const readBeats = items.filter((r) => r.component === 'beat into a worker' && r.kindHow === 'exact');
const stepperBeatShare = { read: readBeats.length, stepper: readBeats.filter((r) => /^beat /.test(r.promptName || '')).length };
console.log('stepperBeatShare', JSON.stringify(stepperBeatShare), r3(stepperBeatShare.stepper / stepperBeatShare.read));
result.stepperBeatShare = stepperBeatShare; writeFileSync(out, JSON.stringify(result, null, 1));
