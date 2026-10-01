// LIN-3171: the independent check of proportional-process-backtest.md (LIN-3166). Each subcommand prints one of the check's tables.
// Usage (from the repo root, after the paper's own scripts have filled data/survey-proportional/, data/survey/ and data/survey-effort/):
//   node scripts/survey-check-4-proportional.mjs shares    # light share by count, by effort covered, and a coverage-adjusted share of hours
//   node scripts/survey-check-4-proportional.mjs escapes   # scorecard and after-reading rates, Wilson and exact (Clopper-Pearson) intervals, light/heavy ratio
//   node scripts/survey-check-4-proportional.mjs catches   # the coded review catches: per rule, per leg, per effect, per change
//   node scripts/survey-check-4-proportional.mjs size      # size confounding: light vs heavy with size held fixed
//   node scripts/survey-check-4-proportional.mjs months    # monthly shares and September's docs/papers changes
//   node scripts/survey-check-4-proportional.mjs sample    # a systematic sample of coded real-fault findings, with the comments to read them against
// Reads git-ignored snapshots only (features.json, tokens.json, backtest.json, details.json, scorecard.json, the tracker) and the committed codes file. No proxy calls.
import { readFileSync, existsSync } from 'fs';
import { CLASSIFIERS } from './survey-proportional-classifiers.mjs';

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sc = read('data/survey/scorecard.json');
const feat = new Map(read('data/survey-proportional/features.json').rows.map((r) => [r.id, r]));
const tok = new Map(read('data/survey-proportional/tokens.json').rows.map((r) => [r.id, r]));
const bt = read('data/survey-proportional/backtest.json');
const codes = read('docs/papers/harbour/proportional-process-backtest-codes.json');
const KEYS = CLASSIFIERS.map((c) => c.key);

const changes = sc.changes.filter((c) => c.done).map((c) => {
  const f = feat.get(c.id); const t = tok.get(c.id);
  return { ...c, light: f.light, m: f.merge, total: f.merge.prodLines + f.merge.testLines + f.merge.docLines, tokens: t?.covered ? t.tokens / 1e6 : null, paths: f.paths };
});
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const W = s.length; let c = 0; for (const x of s) { c++; if (c >= W / 2) return x; } return null; }; // the backtest's lower-median rule
const r1 = (x, d = 1) => (x == null ? '-' : (+x).toFixed(d));
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : '-');
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// ---- Intervals ---------------------------------------------------------------------------------------------------------
const wilson = (k, n) => { const z = 1.96, p = k / n, d = 1 + z * z / n; const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d; return [100 * Math.max(0, c - h), 100 * Math.min(1, c + h)]; };
function lgamma(x) { const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let y = x; const t = x + 5.5 - (x + 0.5) * Math.log(x + 5.5); let s = 1.000000000190015; for (const c of g) s += c / ++y; return -t + Math.log(2.5066282746310005 * s / x); }
const binomCdf = (k, n, p) => { let s = 0; for (let i = 0; i <= k; i++) s += Math.exp(lgamma(n + 1) - lgamma(i + 1) - lgamma(n - i + 1) + i * Math.log(p) + (n - i) * Math.log(1 - p)); return s; };
function exact(k, n) { // Clopper-Pearson by bisection on the binomial tail
  const solve = (f) => { let lo = 0, hi = 1; for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (f(mid)) lo = mid; else hi = mid; } return lo; };
  const lower = k === 0 ? 0 : solve((p) => 1 - binomCdf(k - 1, n, p) < 0.025);
  const upper = k === n ? 1 : solve((p) => binomCdf(k, n, p) > 0.025);
  return [100 * lower, 100 * upper];
}

const cmd = process.argv[2];

if (cmd === 'shares') {
  const all = { n: changes.length, disp: changes.filter((c) => c.dispatches != null), timed: changes.filter((c) => c.workH != null), tok: changes.filter((c) => c.tokens != null) };
  console.log(`Done ${all.n}; dispatched ${all.disp.length}; timed ${all.timed.length} (first ${all.timed.map((c) => c.lastMerge).sort()[0].slice(0, 10)}); tokened ${all.tok.length}`);
  console.log('rule | light n (share) | share of dispatched / timed / tokened changes | share of dispatches / hours / tokens | hours share if uncovered changes cost their group\'s covered mean | light mean h / heavy mean h');
  for (const k of KEYS) {
    const L = (cs) => cs.filter((c) => c.light[k]); const H = (cs) => cs.filter((c) => !c.light[k]);
    const nL = L(changes).length;
    const dS = pct(sum(L(all.disp).map((c) => c.dispatches)), sum(all.disp.map((c) => c.dispatches)));
    const hS = pct(sum(L(all.timed).map((c) => c.workH)), sum(all.timed.map((c) => c.workH)));
    const tS = pct(sum(L(all.tok).map((c) => c.tokens)), sum(all.tok.map((c) => c.tokens)));
    const mL = sum(L(all.timed).map((c) => c.workH)) / L(all.timed).length; const mH = sum(H(all.timed).map((c) => c.workH)) / H(all.timed).length;
    const adj = pct(nL * mL, nL * mL + (changes.length - nL) * mH);
    console.log(`${k} | ${nL} (${pct(nL, changes.length)}%) | ${pct(L(all.disp).length, all.disp.length)} / ${pct(L(all.timed).length, all.timed.length)} / ${pct(L(all.tok).length, all.tok.length)} | ${dS} / ${hS} / ${tS} | ${adj} | ${r1(mL, 2)} / ${r1(mH, 2)}`);
  }
  // Coverage by month: which months the hours measure sees.
  const months = ['2026-06', '2026-07', '2026-08', '2026-09'];
  console.log('\nmonth | Done | timed | dispatched | M1 light share (all / timed)');
  for (const m of months) { const cs = changes.filter((c) => c.lastMerge.startsWith(m)); const t = cs.filter((c) => c.workH != null); console.log(`${m} | ${cs.length} | ${t.length} | ${cs.filter((c) => c.dispatches != null).length} | ${pct(cs.filter((c) => c.light.M1).length, cs.length)} / ${pct(t.filter((c) => c.light.M1).length, t.length)}`); }
  // Medians against the all-change median (the 77% comparison is against the median ticket).
  const med = (cs, f) => median(cs.map(f));
  console.log('\nM1 light median / all-change median: dispatches', med(L1(), (c) => c.dispatches), '/', med(changes, (c) => c.dispatches), '; hours', r1(med(L1(), (c) => c.workH), 2), '/', r1(med(changes, (c) => c.workH), 2), '; tokens M', r1(med(L1(), (c) => c.tokens)), '/', r1(med(changes, (c) => c.tokens)));
  function L1() { return changes.filter((c) => c.light.M1); }
}

if (cmd === 'escapes') {
  console.log('rule | mature light | scorecard not-correct (per 100) | heavy (per 100) | light/heavy | after reading k | per 100 | Wilson | exact');
  for (const r of bt.results) {
    const n = r.light.mature, k = r.read.wentWrong.length, raw = r.light.outcomes.notCorrect;
    const w = wilson(k, n), e = exact(k, n);
    console.log(`${r.key} | ${n} | ${raw} (${r.light.outcomes.badPer100}) | ${r.heavy.outcomes.notCorrect}/${r.heavy.mature} (${r.heavy.outcomes.badPer100}) | ${(r.light.outcomes.badPer100 / r.heavy.outcomes.badPer100).toFixed(2)} | ${k} | ${pct(k, n)} | ${r1(w[0])}–${r1(w[1])} | ${r1(e[0])}–${r1(e[1])}`);
  }
  const blames = codes.namedFixes.filter((x) => x.code === 'blames');
  console.log(`\nnamed-fix pairs ${codes.namedFixes.length}; by code ${JSON.stringify(codes.namedFixes.reduce((a, x) => ((a[x.code] = (a[x.code] || 0) + 1), a), {}))}; blames reviewCouldCatch ${JSON.stringify(blames.reduce((a, x) => ((a[x.reviewCouldCatch] = (a[x.reviewCouldCatch] || 0) + 1), a), {}))}`);
  const m3 = bt.results.find((r) => r.key === 'M3');
  const finder = new Set(codes.finderOnly.ids);
  console.log('M3 removed on reading: finder rows', m3.lightEscapes.filter((e) => finder.has(e.id)).map((e) => e.id).join(', '),
    '; named fixes not coded blames', m3.lightNamedFix.map((e) => `${e.id} (${codes.namedFixes.filter((x) => x.id === e.id).map((x) => x.code).join('/')})`).filter((s) => !/blames/.test(s)).join(', '));
}

if (cmd === 'catches') {
  const byId = new Map(codes.reviewCatches.map((t) => [t.id, t]));
  const F = codes.reviewCatches.flatMap((t) => t.findings.map((f) => ({ id: t.id, ...f })));
  const effects = F.reduce((a, f) => ((a[f.effect] = (a[f.effect] || 0) + 1), a), {});
  const rf = F.filter((f) => f.realFault);
  console.log(`coded changes ${codes.reviewCatches.length}; send-backs ${sum(codes.reviewCatches.map((t) => t.sendBacks))}; findings ${F.length} ${JSON.stringify(effects)}`);
  console.log(`real faults ${rf.length} on ${new Set(rf.map((f) => f.id)).size} changes; by effect ${JSON.stringify(rf.reduce((a, f) => ((a[f.effect] = (a[f.effect] || 0) + 1), a), {}))}; by confidence ${JSON.stringify(rf.reduce((a, f) => ((a[f.confidence] = (a[f.confidence] || 0) + 1), a), {}))}`);
  console.log(`changes with no real fault ${codes.reviewCatches.filter((t) => !t.findings.some((f) => f.realFault)).length}; with no prod finding ${codes.reviewCatches.filter((t) => !t.findings.some((f) => f.effect === 'prod')).length}`);
  console.log('\nrule | light n | changes with a real fault | findings | plan-review / review / close-out | real-fault findings whose effect is prod | changes over 100 prod lines');
  for (const r of bt.results) {
    const ids = r.read.caughtRealFault; const ff = r.read.faultFindings;
    const leg = (l) => ff.filter((f) => f.leg === l).length;
    console.log(`${r.key} | ${r.light.n} | ${ids.length} (${pct(ids.length, r.light.n)}%) | ${ff.length} | ${leg('plan-review')} / ${leg('review')} / ${leg('close-out')} | ${ff.filter((f) => f.effect === 'prod').length} | ${ids.filter((id) => feat.get(id).merge.prodLines > 100).length}`);
  }
  console.log('\nper change (id, prod lines, real faults, rules light under):');
  for (const id of [...new Set(rf.map((f) => f.id))]) console.log(` ${id} ${feat.get(id).merge.prodLines} ${byId.get(id).findings.filter((f) => f.realFault).length} ${KEYS.filter((k) => feat.get(id).light[k]).join(',')}`);
}

if (cmd === 'size') {
  const band = (x, edges) => { for (let i = 0; i < edges.length; i++) if (x <= edges[i]) return i; return edges.length; };
  const E = [49, 149, 499]; const names = ['1–49', '50–149', '150–499', '500+'];
  const row = (cs) => `n ${cs.length} | disp ${median(cs.map((c) => c.dispatches)) ?? '-'} (${cs.filter((c) => c.dispatches != null).length}) | h ${r1(median(cs.map((c) => c.workH)), 2)} (${cs.filter((c) => c.workH != null).length}) | tok ${r1(median(cs.map((c) => c.tokens)))} (${cs.filter((c) => c.tokens != null).length})`;
  // 1. Docs/tests-only (M1 light) against production changes of the same total diff size (prod + test + docs lines, noise excluded).
  console.log('A. total lines changed (prod+test+docs), docs/tests-only vs production changes');
  const docOnly = changes.filter((c) => c.light.M1 && c.total > 0); const prod = changes.filter((c) => !c.light.M1);
  for (let b = 0; b <= E.length; b++) { const d = docOnly.filter((c) => band(c.total, E) === b), p = prod.filter((c) => band(c.total, E) === b); console.log(` ${names[b]} | docs/tests-only: ${row(d)}\n ${' '.repeat(names[b].length)} | production:      ${row(p)}`); }
  // Size-standardised: compare each light change with heavy changes in its own band, by the ratio of band medians, weighted by the light group's band mix.
  const standardised = (L, H, f, bandOf, nb) => { let wsum = 0, acc = 0; for (let b = 0; b < nb; b++) { const l = L.filter((c) => bandOf(c) === b && f(c) != null), h = H.filter((c) => bandOf(c) === b && f(c) != null); if (!l.length || !h.length) continue; acc += l.length * (median(l.map(f)) / median(h.map(f))); wsum += l.length; } return wsum ? acc / wsum : null; };
  const bt4 = (c) => band(c.total, E);
  for (const [lab, f] of [['dispatches', (c) => c.dispatches], ['hours', (c) => c.workH], ['tokens', (c) => c.tokens]]) {
    const raw = median(docOnly.map(f)) / median(prod.map(f));
    console.log(` ${lab}: raw light/heavy median ratio ${r1(raw, 2)}; within total-size bands, weighted by the light mix ${r1(standardised(docOnly, prod, f, bt4, 4), 2)}`);
  }
  // 2. Small changes heavy only because of their paths: M4 light (≤49 prod lines, ≤3 files) split by M3.
  console.log('\nB. within M4-light (≤49 prod lines in ≤3 files): M3 light vs M3 heavy (risky, invariant or process-text paths)');
  const m4 = changes.filter((c) => c.light.M4);
  const m3L = m4.filter((c) => c.light.M3), m3H = m4.filter((c) => !c.light.M3);
  console.log(` M3 light: ${row(m3L)}\n M3 heavy: ${row(m3H)}`);
  console.log(`  of which production lines > 0: light ${row(m3L.filter((c) => c.m.prodLines > 0))}\n                               heavy ${row(m3H.filter((c) => c.m.prodLines > 0))}`);
  const bn2 = (c) => band(c.total, [49, 149]); // by total diff size within the band
  for (const [lab, f] of [['dispatches', (c) => c.dispatches], ['hours', (c) => c.workH], ['tokens', (c) => c.tokens]]) console.log(`  ${lab}: raw ${r1(median(m3L.map(f)) / median(m3H.map(f)), 2)}; total-size-banded ${r1(standardised(m3L, m3H, f, bn2, 3), 2)}`);
  // 3. The whole M3 and M4 contrast, banded by production lines and by total lines.
  console.log('\nC. light/heavy median ratio, raw and with size held fixed (bands of total lines 1–49 / 50–149 / 150–499 / 500+)');
  for (const k of KEYS) {
    const L = changes.filter((c) => c.light[k] && c.total > 0), H = changes.filter((c) => !c.light[k] && c.total > 0);
    const out = [['dispatches', (c) => c.dispatches], ['hours', (c) => c.workH], ['tokens', (c) => c.tokens]].map(([lab, f]) => `${lab} ${r1(median(L.map(f)) / median(H.map(f)), 2)} → ${r1(standardised(L, H, f, bt4, 4), 2)}`);
    console.log(` ${k}: ${out.join('; ')}; light total-lines median ${median(L.map((c) => c.total))}, heavy ${median(H.map((c) => c.total))}`);
  }
  // 4. Heavy changes in the light group's size range: how much of the heavy group is large.
  console.log('\nD. medians by total-lines band, all changes (effort rises with size regardless of class)');
  for (let b = 0; b <= E.length; b++) console.log(` ${names[b]} | ${row(changes.filter((c) => c.total > 0 && band(c.total, E) === b))}`);
}

if (cmd === 'months') {
  const sep = changes.filter((c) => c.lastMerge.startsWith('2026-09') && c.light.M1);
  const jun = changes.filter((c) => c.lastMerge.startsWith('2026-06') && c.light.M1);
  const papers = (cs) => cs.filter((c) => c.paths.some((p) => p.startsWith('docs/papers/'))).length;
  console.log(`M1 light: September ${sep.length}, touching docs/papers/ ${papers(sep)}; June ${jun.length}, touching docs/papers/ ${papers(jun)}`);
  for (const r of bt.results) console.log(`${r.key} ${Object.entries(r.byMonth).map(([m, v]) => `${m} ${v.share}% (${v.light}/${v.n})`).join('  ')}`);
}

if (cmd === 'sample') {
  // Every 5th real-fault finding in id order, starting at the 1st, plus every finding on the M1/M3 light changes.
  const details = {};
  for (const p of ['data/survey/reliability-tracker.json', 'data/survey/rules-tickets.json', 'data/survey-proportional/details.json']) if (existsSync(p)) Object.assign(details, read(p).details);
  const rf = codes.reviewCatches.flatMap((t) => t.findings.filter((f) => f.realFault).map((f) => ({ id: t.id, ...f })));
  const pick = rf.filter((_, i) => i % 5 === 0);
  const words = (s) => s.toLowerCase().match(/[a-z_][a-z0-9_:/.-]{4,}/g) || [];
  for (const f of pick) {
    const cs = (details[f.id]?.comments || []);
    const w = new Set(words(f.finding));
    const best = cs.map((c) => ({ c, hit: words(c.body || '').filter((x) => w.has(x)).length })).sort((a, b) => b.hit - a.hit)[0];
    console.log(`\n### ${f.id} [${f.leg}, ${f.effect}, ${f.confidence}] ${f.finding}`);
    if (best) { const body = best.c.body || ''; const i = Math.max(0, body.toLowerCase().indexOf([...w].find((x) => body.toLowerCase().includes(x)) || '') - 300); console.log(`  best comment ${best.c.createdAt} (${best.hit} shared words): ${body.slice(i, i + 900).replace(/\n+/g, ' ')}`); }
  }
  console.log(`\nsampled ${pick.length} of ${rf.length} real-fault findings (every 5th in id order)`);
}
