// LIN-3166: backtest the six committed classifiers over every Done change since June in both repos — share routed light, the effort those changes consumed, and the scorecard's escapes, named fixes and follow-ups in the light group against the heavy.
// Usage: node scripts/survey-proportional-backtest.mjs [--scorecard data/survey/scorecard.json] [--features data/survey-proportional/features.json] [--out data/survey-proportional/backtest.json] [--sd ../simple-dispatcher]
// Run first: survey-scorecard.mjs (and the snapshots it names), survey-proportional-classifiers.mjs, survey-proportional-tokens.mjs,
// survey-proportional-fetch.mjs. Outcomes are the scorecard's own per-change fields (correct: Done, no escaped Bug naming it within
// 30 days, no named fix-follow-up; complete: no kind:follow-up or routed Bug naming it); rates use mature changes only. Review
// legs and verdicts come from comment headings (survey-rules-timeline.mjs's legOf/verdictOf). Every light change has comments; heavy
// changes are a 1-in-4 systematic sample, weighted 4 (see survey-proportional-fetch.mjs). No proxy calls.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, resolve } from 'path';
import { legOf, verdictOf } from './survey-rules-timeline.mjs';
import { CLASSIFIERS } from './survey-proportional-classifiers.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sc = read(arg('--scorecard', 'data/survey/scorecard.json'));
const feat = read(arg('--features', 'data/survey-proportional/features.json'));
const tok = read(arg('--tokens', 'data/survey-proportional/tokens.json'));
const tracker = read(arg('--tracker', 'data/survey/reliability-tracker.json'));
const verdicts = read(arg('--verdicts', 'docs/papers/harbour/reliability-baseline-defects.json')).verdicts;
const codes = read(arg('--codes', 'docs/papers/harbour/which-rules-pay-codes.json'));
const out = arg('--out', 'data/survey-proportional/backtest.json');
// Hand codes, committed beside the paper: finder-row changes (survey-check-2.md), the light group's named fixes read against the
// scorecard's rule, and what review caught on light changes it sent back. Optional, so the script also runs before coding.
const codesPath = arg('--read', 'docs/papers/harbour/proportional-process-backtest-codes.json');
const readCodes = existsSync(codesPath) ? read(codesPath) : null;
const sdDir = resolve(arg('--sd', '../simple-dispatcher'));
const DAY = 86400000; const WINDOW = sc.window;

const median = (xs, ws) => { const s = xs.map((x, i) => [x, ws ? ws[i] : 1]).filter(([x]) => x != null && !Number.isNaN(x)).sort((a, b) => a[0] - b[0]); if (!s.length) return null; const W = s.reduce((a, [, w]) => a + w, 0); let c = 0; for (const [x, w] of s) { c += w; if (c >= W / 2) return x; } return s.at(-1)[0]; };
const wilson = (k, n) => { if (!n) return [null, null]; const z = 1.96, p = k / n, d = 1 + z * z / n; const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d; return [+(100 * Math.max(0, c - h)).toFixed(1), +(100 * Math.min(1, c + h)).toFixed(1)]; };
const pct = (a, b) => (b ? +(100 * a / b).toFixed(1) : null);

// ---- Join ---------------------------------------------------------------------------------------------------------------
const featById = new Map(feat.rows.map((r) => [r.id, r]));
const tokById = new Map(tok.rows.map((r) => [r.id, r]));
const details = {};
for (const p of ['data/survey/reliability-tracker.json', 'data/survey/rules-tickets.json', 'data/survey-proportional/details.json']) if (existsSync(p)) Object.assign(details, read(p).details);
const fetched = existsSync('data/survey-proportional/details.json') ? read('data/survey-proportional/details.json') : { heavySample: [] };
const heavySample = new Set(fetched.heavySample);
const HEAVY_W = fetched.heavyEvery || 4;
const codesById = new Map(codes.tickets.map((t) => [t.id, t]));

// Escaped and routed Bugs by the change they name, with the scorecard's window.
const createdAt = (id) => tracker.details[id]?.createdAt;
const bugsOf = (verdict) => { const m = new Map(); for (const v of verdicts) if (v.verdict === verdict && v.introducedBy && createdAt(v.identifier)) (m.get(v.introducedBy) || m.set(v.introducedBy, []).get(v.introducedBy)).push({ bug: v.identifier, at: createdAt(v.identifier), foundBy: v.foundBy, reason: v.reason }); return m; };
const escapesOf = bugsOf('escaped'); const routedOf = bugsOf('routed');
const followUpsOf = new Map();
for (const t of tracker.list) {
  if (!(t.labels || []).includes('kind:follow-up')) continue;
  const named = ((t.description || '').slice(0, 600).match(/\bLIN-\d+\b/g) || []).filter((x) => x !== t.identifier);
  const origin = t.parent || named[0];
  if (origin) (followUpsOf.get(origin) || followUpsOf.set(origin, []).get(origin)).push({ id: t.identifier, title: t.title, state: t.state.type });
}

function reviewOf(id) {
  const d = details[id]; if (!d || !d.comments) return null;
  let review = 0, planReview = 0, sendBacks = 0, closeOutHolds = 0;
  for (const c of d.comments) {
    const leg = legOf(c.body || ''); const v = verdictOf(c.body || '');
    if (leg === 'review') { review++; if (v === 'request-changes') sendBacks++; }
    if (leg === 'plan-review') { planReview++; if (v === 'request-changes') sendBacks++; }
    if (leg === 'close-out' && /\b(hold|held|cannot close|not closing)\b/i.test((c.body || '').slice(0, 400))) closeOutHolds++;
  }
  return { review, planReview, sendBacks, closeOutHolds, comments: d.comments.length };
}

const changes = sc.changes.filter((c) => c.done).map((c) => {
  const f = featById.get(c.id); const t = tokById.get(c.id);
  const merged = Date.parse(c.lastMerge);
  const within = (xs) => (xs || []).filter((x) => Date.parse(x.at) - merged <= WINDOW * DAY && Date.parse(x.at) - merged >= -2 * DAY);
  const inLight = CLASSIFIERS.some((k) => f.light[k.key]);
  const weight = inLight ? 1 : heavySample.has(c.id) ? HEAVY_W : 0;
  const cd = codesById.get(c.id);
  return {
    ...c, month: c.lastMerge.slice(0, 7), light: f.light, merge: f.merge, paths: f.paths,
    repo: c.repos.length > 1 ? 'both' : c.repos[0],
    escapeList: within(escapesOf.get(c.id)), routedList: routedOf.get(c.id) || [], followUpList: followUpsOf.get(c.id) || [],
    tokens: t?.covered ? t.tokens : null,
    review: weight ? reviewOf(c.id) : null, reviewWeight: weight,
    codes: cd ? { prod: cd.consequences.filter((x) => x.effect === 'prod').length, realFault: cd.consequences.filter((x) => x.realFault).length,
      prodFindings: cd.consequences.filter((x) => x.effect === 'prod').map((x) => ({ finding: x.finding, realFault: x.realFault, leg: x.leg })) } : null,
  };
});
if (changes.some((c) => c.escapes !== c.escapeList.length)) throw new Error('escape list disagrees with the scorecard');

// Named fix-follow-ups: the later commit(s) the scorecard's rule matched, recovered for naming (the scorecard stores only a flag).
const descs = new Map(tracker.list.map((t) => [t.identifier, `${t.title} ${t.description || ''}`]));
const FIX = /\b(fix|fixes|fixed|fixing|regression|regressed|regresses|hotfix|broke|broken|revert|reverts|reverted)\b/i;
const logCache = {};
function fixCommits(c) {
  const out = [];
  for (const [repo, dir] of [['LinearViewer', resolve('.')], ['simple-dispatcher', sdDir]]) {
    if (!c.repos.includes(repo)) continue;
    const since = new Date(Date.parse(c.lastMerge)).toISOString(); const until = new Date(Date.parse(c.lastMerge) + WINDOW * DAY).toISOString();
    const key = `${repo}|${since}`;
    const raw = logCache[key] ??= execFileSync('git', ['-C', dir, 'log', feat.heads[repo], '--first-parent', '-m', `--since=${since}`, `--until=${until}`, '--name-only', '--format=%x00%h%x09%s'], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const own = new Set(c.paths.filter((p) => (repo === 'simple-dispatcher' ? p.startsWith('sd:') : !p.startsWith('sd:'))).map((p) => p.replace(/^sd:/, '')));
    for (const chunk of raw.split('\x00').filter(Boolean)) {
      const [head, ...files] = chunk.split('\n').filter(Boolean);
      const [sha, subject] = head.split('\t');
      const tid = (subject.match(/\blin-\d+\b/i) || [])[0]?.toUpperCase();
      if (!tid || tid === c.id || !files.some((p) => own.has(p))) continue;
      const text = `${subject} ${descs.get(tid) || ''}`;
      if (!FIX.test(`${subject} ${(descs.get(tid) || '').slice(0, 200)}`) && !FIX.test(subject)) continue;
      if (new RegExp(`\\b${c.id}\\b`, 'i').test(text)) out.push({ repo, sha, ticket: tid, subject: subject.slice(0, 120) });
    }
  }
  return [...new Map(out.map((o) => [o.ticket, o])).values()];
}

// ---- Per classifier -----------------------------------------------------------------------------------------------------
const MONTHS = ['2026-06', '2026-07', '2026-08', '2026-09'];
const REPOS = ['LinearViewer', 'simple-dispatcher', 'both'];
const bad = (c) => c.escapes > 0 || c.namedFix;
function groupStats(cs) {
  const mat = cs.filter((c) => c.mature);
  const disp = cs.filter((c) => c.dispatches != null); const timed = cs.filter((c) => c.workH != null); const tk = cs.filter((c) => c.tokens != null);
  const rv = cs.filter((c) => c.review && c.reviewWeight); const w = rv.map((c) => c.reviewWeight); const W = w.reduce((a, b) => a + b, 0);
  const wmean = (f) => (W ? +(rv.reduce((a, c) => a + f(c) * c.reviewWeight, 0) / W).toFixed(2) : null);
  const wshare = (f) => (W ? +(100 * rv.reduce((a, c) => a + (f(c) ? c.reviewWeight : 0), 0) / W).toFixed(1) : null);
  const k = (f) => mat.filter(f).length;
  return {
    n: cs.length, mature: mat.length,
    effort: {
      dispatched: disp.length, dispatches: disp.reduce((a, c) => a + c.dispatches, 0), medDispatches: median(disp.map((c) => c.dispatches)),
      timed: timed.length, workH: +timed.reduce((a, c) => a + c.workH, 0).toFixed(1), medWorkH: median(timed.map((c) => +c.workH.toFixed(2))),
      medSpanH: median(cs.map((c) => c.spanH)),
      tokened: tk.length, tokensM: +(tk.reduce((a, c) => a + c.tokens, 0) / 1e6).toFixed(1), medTokensM: tk.length ? +(median(tk.map((c) => c.tokens)) / 1e6).toFixed(2) : null,
      reviewed: rv.length, reviewWeight: W, meanReviewRounds: wmean((c) => c.review.review), meanPlanReviewRounds: wmean((c) => c.review.planReview),
      anyReviewShare: wshare((c) => c.review.review > 0), sentBackShare: wshare((c) => c.review.sendBacks > 0), meanSendBacks: wmean((c) => c.review.sendBacks),
    },
    outcomes: {
      escaped: k((c) => c.escapes > 0), namedFix: k((c) => c.namedFix), notCorrect: k((c) => !c.correct),
      followedUp: k((c) => c.followUps > 0), routed: k((c) => c.routed > 0), notComplete: k((c) => !c.complete), good: k((c) => c.good),
      escapedPer100: pct(k((c) => c.escapes > 0), mat.length), escapedCI: wilson(k((c) => c.escapes > 0), mat.length),
      badPer100: pct(k(bad), mat.length), badCI: wilson(k(bad), mat.length),
      notCompletePer100: pct(k((c) => !c.complete), mat.length), goodPer100: pct(k((c) => c.good), mat.length),
    },
  };
}
const all = groupStats(changes);
const totals = all.effort;
const matureBad = changes.filter((c) => c.mature && bad(c));
const results = CLASSIFIERS.map((cl) => {
  const L = changes.filter((c) => c.light[cl.key]); const H = changes.filter((c) => !c.light[cl.key]);
  const ls = groupStats(L), hs = groupStats(H);
  const lightMature = L.filter((c) => c.mature);
  return {
    key: cl.key, name: cl.name, when: cl.when, rule: cl.rule,
    share: pct(L.length, changes.length), shareMature: pct(lightMature.length, changes.filter((c) => c.mature).length),
    byRepo: Object.fromEntries(REPOS.map((r) => { const cs = changes.filter((c) => c.repo === r); return [r, { n: cs.length, light: cs.filter((c) => c.light[cl.key]).length, share: pct(cs.filter((c) => c.light[cl.key]).length, cs.length) }]; })),
    byMonth: Object.fromEntries(MONTHS.map((m) => { const cs = changes.filter((c) => c.month === m); const lm = cs.filter((c) => c.light[cl.key]); return [m, { n: cs.length, light: lm.length, share: pct(lm.length, cs.length), lightBad: lm.filter((c) => c.mature && bad(c)).length, lightMature: lm.filter((c) => c.mature).length }]; })),
    effortShare: { dispatches: pct(ls.effort.dispatches, totals.dispatches), workH: pct(ls.effort.workH, totals.workH), tokens: pct(ls.effort.tokensM, totals.tokensM) },
    light: ls, heavy: hs,
    // Of every mature change that later went wrong (escape or named fix), how many this classifier would have sent heavy.
    caughtBad: { bad: matureBad.length, sentHeavy: matureBad.filter((c) => !c.light[cl.key]).length },
    lightEscapes: lightMature.filter((c) => c.escapes > 0).map((c) => ({ id: c.id, repo: c.repo, prodLines: c.prodLines, bugs: c.escapeList.map((e) => ({ bug: e.bug, foundBy: e.foundBy, reason: (e.reason || '').slice(0, 300) })) })),
    lightNamedFix: lightMature.filter((c) => c.namedFix).map((c) => ({ id: c.id, repo: c.repo, prodLines: c.prodLines, fixes: fixCommits(c) })),
    lightRouted: lightMature.filter((c) => c.routed > 0).map((c) => ({ id: c.id, repo: c.repo, bugs: c.routedList.map((b) => b.bug) })),
    lightFollowUps: lightMature.filter((c) => c.followUps > 0).map((c) => ({ id: c.id, repo: c.repo, followUps: c.followUpList.map((f) => `${f.id} (${f.state})`) })),
    lightSentBack: L.filter((c) => c.review?.sendBacks > 0).map((c) => ({ id: c.id, repo: c.repo, prodLines: c.prodLines, sendBacks: c.review.sendBacks })),
    lightCodedProd: L.filter((c) => c.codes?.prod > 0).map((c) => ({ id: c.id, repo: c.repo, prodLines: c.prodLines, ...c.codes })),
    lightInCodes: L.filter((c) => c.codes).length,
    lightIds: L.map((c) => c.id),
  };
});
// After reading: an escape survives unless its change is named only by finder rows; a named fix survives when read as blaming the
// change; a review catch is a send-back finding on a light change that changed production code, and a real fault when it was one.
if (readCodes) {
  const finder = new Set(readCodes.finderOnly.ids);
  const blames = new Set(readCodes.namedFixes.filter((x) => x.code === 'blames').map((x) => x.id));
  const catches = new Map();
  for (const t of readCodes.reviewCatches) catches.set(t.id, t.findings || []);
  for (const r of results) {
    const lightSet = new Set(r.lightIds);
    const escaped = r.lightEscapes.filter((e) => !finder.has(e.id)).map((e) => e.id);
    const fixed = r.lightNamedFix.filter((e) => blames.has(e.id)).map((e) => e.id);
    const wrong = [...new Set([...escaped, ...fixed])];
    const coded = r.lightSentBack.filter((x) => catches.has(x.id));
    const prod = coded.filter((x) => catches.get(x.id).some((f) => f.effect === 'prod'));
    const fault = coded.filter((x) => catches.get(x.id).some((f) => f.realFault));
    const faultFindings = coded.flatMap((x) => catches.get(x.id).filter((f) => f.realFault).map((f) => ({ id: x.id, ...f })));
    const monthOf = new Map(changes.map((c) => [c.id, c.month]));
    const wentWrongByMonth = {}; for (const id of wrong) wentWrongByMonth[monthOf.get(id)] = (wentWrongByMonth[monthOf.get(id)] || 0) + 1;
    r.read = { wentWrongByMonth, escapes: escaped, blamedFixes: fixed, wentWrong: wrong, wentWrongPer100: pct(wrong.length, r.light.mature), wentWrongCI: wilson(wrong.length, r.light.mature),
      sentBack: r.lightSentBack.length, sentBackCoded: coded.length, caughtProd: prod.map((x) => x.id), caughtRealFault: fault.map((x) => x.id), faultFindings,
      caughtRealFaultPer100: pct(fault.length, r.light.n) };
    if (!r.lightSentBack.every((x) => lightSet.has(x.id))) throw new Error('sent-back list outside light set');
  }
}

mkdirSync(dirname(out), { recursive: true });
const coverage = {
  done: changes.length, mature: changes.filter((c) => c.mature).length,
  lightAny: changes.filter((c) => c.reviewWeight === 1).length, lightAnyWithComments: changes.filter((c) => c.reviewWeight === 1 && c.review).length,
  heavySample: changes.filter((c) => c.reviewWeight === HEAVY_W).length, heavySampleWithComments: changes.filter((c) => c.reviewWeight === HEAVY_W && c.review).length,
  byRepo: Object.fromEntries(REPOS.map((r) => [r, changes.filter((c) => c.repo === r).length])),
  byMonth: Object.fromEntries(MONTHS.map((m) => [m, changes.filter((c) => c.month === m).length])),
  tokensCovered: changes.filter((c) => c.tokens != null).length, timed: changes.filter((c) => c.workH != null).length, dispatched: changes.filter((c) => c.dispatches != null).length,
  matureBad: matureBad.length,
};
writeFileSync(out, JSON.stringify({ cut: sc.cut, window: WINDOW, heads: feat.heads, coverage, all, results }, null, 1));

// ---- Print --------------------------------------------------------------------------------------------------------------
console.log(`Done changes ${coverage.done} (mature ${coverage.mature}); repos ${JSON.stringify(coverage.byRepo)}; months ${JSON.stringify(coverage.byMonth)}`);
console.log(`comments: light-any ${coverage.lightAnyWithComments}/${coverage.lightAny}, heavy sample ${coverage.heavySampleWithComments}/${coverage.heavySample}; tokens covered ${coverage.tokensCovered}; timed ${coverage.timed}; dispatched ${coverage.dispatched}`);
console.log(`ALL: ${JSON.stringify(all.outcomes)}`);
for (const r of results) {
  console.log(`\n${r.key} ${r.name} — light ${r.light.n} (${r.share}%), mature ${r.light.mature}; byRepo ${Object.entries(r.byRepo).map(([k, v]) => `${k} ${v.light}/${v.n}`).join(', ')}`);
  console.log(`  months ${Object.entries(r.byMonth).map(([m, v]) => `${m} ${v.share}%`).join(' ')}; effort share disp ${r.effortShare.dispatches}% workH ${r.effortShare.workH}% tokens ${r.effortShare.tokens}%`);
  for (const [g, s] of [['L', r.light], ['H', r.heavy]]) console.log(`  ${g}: esc ${s.outcomes.escaped} (${s.outcomes.escapedPer100}/100 ${s.outcomes.escapedCI}), fix ${s.outcomes.namedFix}, bad ${s.outcomes.badPer100}/100 ${s.outcomes.badCI}, notComplete ${s.outcomes.notCompletePer100}/100, good ${s.outcomes.goodPer100}; medDisp ${s.effort.medDispatches} medWorkH ${s.effort.medWorkH} medTokM ${s.effort.medTokensM} (n${s.effort.tokened}); review rounds ${s.effort.meanReviewRounds} plan ${s.effort.meanPlanReviewRounds} sentBack ${s.effort.sentBackShare}% (n${s.effort.reviewed})`);
  console.log(`  caught bad: ${r.caughtBad.sentHeavy}/${r.caughtBad.bad}; light escapes ${r.lightEscapes.map((e) => `${e.id}←${e.bugs.map((b) => b.bug).join('+')}`).join(', ') || 'none'}`);
  if (r.read) console.log(`  READ: went wrong ${r.read.wentWrong.length} (${r.read.wentWrongPer100}/100 ${r.read.wentWrongCI}) [esc ${r.read.escapes.join(',') || '-'}; fix ${r.read.blamedFixes.join(',') || '-'}]; review caught prod on ${r.read.caughtProd.length}, real fault on ${r.read.caughtRealFault.length} (${r.read.caughtRealFault.join(',')}) of ${r.read.sentBackCoded}/${r.read.sentBack} coded`);
  console.log(`  light named fixes ${r.lightNamedFix.map((e) => `${e.id}←${e.fixes.map((f) => f.ticket).join('+') || '?'}`).join(', ') || 'none'}; routed ${r.lightRouted.map((e) => e.id).join(', ') || 'none'}; follow-ups ${r.lightFollowUps.length}; sent back ${r.lightSentBack.length}; coded prod ${r.lightCodedProd.map((e) => `${e.id}(${e.prod}/${e.realFault})`).join(', ') || 'none'} of ${r.lightInCodes} coded`);
}
