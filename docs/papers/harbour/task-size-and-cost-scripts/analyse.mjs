#!/usr/bin/env node
// analyse.mjs — LIN-4257. Builds every table in task-size-and-cost.md from the FROZEN
// evidence folder alone. No network, no git, no live re-reads. Running it twice on the
// same folder writes byte-identical output (no clock reads, sorted keys).
//
// Usage (LinearViewer root):
//   node docs/papers/harbour/task-size-and-cost-scripts/analyse.mjs <evidence-dir>
// Writes <evidence-dir>/analysis.json and prints the markdown tables to stdout.
//
// Cost legs use lib/wall-clock-summary.js bucketOf (no kind map of our own):
//   before → split into survey-* (own row) and the floor; after → floor;
//   diff → work; orchestration → keep-alive.
// Null is carried as null everywhere. A sum with a null term is null, with the reason.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { bucketOf } from '../../../../lib/wall-clock-summary.js';

const EV = process.argv[2];
if (!EV) { console.error('usage: analyse.mjs <evidence-dir>'); process.exit(2); }
const read = (rel) => JSON.parse(readFileSync(path.join(EV, rel), 'utf8'));

const manifest = read('manifest.json');
const WINDOW = manifest.window_start;
const EXCLUDED = new Set(['LIN-4257']);                  // this ticket: in flight, not analysed
const pop = manifest.population.filter((t) => !EXCLUDED.has(t));

// Survey after-answers: the Opus custom follow-up the Survey resumes into a build session.
const AFTER_RE = /^(A short, read-only follow-up for research \(the Survey|One more short, read-only follow-up for the same research)/;

const sumNullable = (xs) => (xs.some((x) => x === null) ? null : xs.reduce((s, x) => s + x, 0));
const round = (x, d = 4) => (x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d);

// ---- size inputs (frozen) ----
const lvPrs = read('size/lv-prs.json');
const sdPrs = read('size/sd-prs.json');
const lvPlace = read('size/lv-place-change.json');
const survey = read('size/survey-balance.json').rows.filter((r) => r.row_has_balance_cell);
const tokens = read('size/survey-costmix-tokens.json');

// Leg split for one ticket's frozen /cost and /dispatch. Shared by the population and the pairs.
function legsOf(cost, dispatch) {
  const legs = { before: [], diff: [], after: [], orchestration: [], survey: [] };
  let pre = false;
  for (const w of cost.workerSessions) {
    const b = bucketOf(w.kind);
    const row = { kind: w.kind, model: w.model, costUsd: w.costUsd, bucket: b, dispatchedAt: w.dispatchedAt };
    if (w.dispatchedAt < WINDOW) pre = true;
    legs[b].push(row);
    if (w.kind.startsWith('survey-')) legs.survey.push(row);
  }
  const sumOf = (rows) => sumNullable(rows.map((r) => r.costUsd));
  const surveyUsd = sumOf(legs.survey);
  const beforeExSurvey = legs.before.filter((r) => !r.kind.startsWith('survey-'));
  const floor = (() => {
    const a = sumOf(beforeExSurvey), c = sumOf(legs.after);
    return a === null || c === null ? null : a + c;
  })();
  const impl = legs.diff;
  const appCallsUsd = cost.appCalls?.costUsd ?? null;
  const workerTotal = sumOf(cost.workerSessions);
  const reconciles = cost.totalUsd === null || workerTotal === null ? null
    : Math.abs((workerTotal + (appCallsUsd ?? 0)) - cost.totalUsd) < 1e-6;
  return { legs, pre, sumOf, floor, surveyUsd, impl, workerTotal, appCallsUsd, reconciles, dispatch };
}

const perTicket = {};
for (const t of pop) {
  const cost = read(`cost/${t}.json`);
  const dispatch = read(`dispatch/${t}.json`).items;
  const customs = dispatch.filter((i) => i.kind === 'custom' && i.dispatchedAt && i.dispatchedAt >= WINDOW);
  const afterAnswers = customs.filter((c) => {
    const p = read(`prompts/${c.id}.json`);
    const first = String(p.prompt ?? '').split('\n').find((l) => l.trim()) ?? '';
    return AFTER_RE.test(first);
  });
  const { legs, pre, sumOf, floor, surveyUsd, impl, workerTotal, appCallsUsd, reconciles } = legsOf(cost, dispatch);
  const implModel = impl.length === 1 ? impl[0].model : impl.length === 0 ? null : 'multiple';
  const lv = lvPrs.filter((r) => r.ticket === t);
  const sd = sdPrs.filter((r) => r.ticket === t);
  const pl = lvPlace.filter((r) => r.ticket === t && r.change);
  // landed code = production or test lines in either repo; doc-only PRs (periodicals) do not count
  const landedLines = lv.reduce((x, r) => x + r.prodAdded + r.prodDeleted + r.testAdded + r.testDeleted, 0) + sd.reduce((x, r) => x + r.codeAdded + r.codeDeleted + r.testAdded + r.testDeleted, 0);
  const sv = survey.filter((r) => r.ticket === t);
  const kinds = dispatch.map((d) => d.kind);
  const tk = tokens.kindByTicket?.[t] ?? {};
  perTicket[t] = {
    ticket: t,
    state: manifest.states_at_freeze[t]?.state ?? null,
    totalUsd: cost.totalUsd,
    appCallsUsd: round(appCallsUsd),
    reconciles,
    unpriced: cost.unpriced,
    noLineage: cost.noLineage,
    preWindowLegs: pre,
    legs: { floor: round(floor), work: round(sumOf(impl)), keepAlive: round(sumOf(legs.orchestration)), survey: round(surveyUsd), before: round(sumOf(legs.before)), after: round(sumOf(legs.after)) },
    implModel,
    implRows: impl.length,
    customInWindow: customs.length,
    customLegs: cost.workerSessions.filter((w) => w.kind === 'custom').length,
    afterAnswers: afterAnswers.length,
    kindsSeen: [...new Set(kinds)].sort(),
    shape: impl.length === 0 ? (legs.before.some((r) => r.kind === 'research') ? 'research-as-work' : 'no-implementation-lineage')
      : (landedLines === 0 ? (legs.before.some((r) => r.kind === 'research') ? 'research-as-work' : 'no-landed-code') : 'code'),
    lv: { prs: lv.length, prodLines: lv.reduce((s, r) => s + r.prodAdded + r.prodDeleted, 0), testLines: lv.reduce((s, r) => s + r.testAdded + r.testDeleted, 0), prodFiles: lv.reduce((s, r) => s + r.prodFiles.length, 0) },
    sd: { prs: sd.length, codeLines: sd.reduce((s, r) => s + r.codeAdded + r.codeDeleted, 0), testLines: sd.reduce((s, r) => s + r.testAdded + r.testDeleted, 0), codeFiles: sd.reduce((s, r) => s + r.codeFiles, 0) },
    place: { crossAreaDelta: pl.reduce((s, r) => s + (r.change.crossAreaImports[1] - r.change.crossAreaImports[0]), 0), newPairs: pl.reduce((s, r) => s + r.change.newPairs.length, 0), grownPairs: pl.reduce((s, r) => s + r.change.grownPairs.length, 0), shrunkPairs: pl.reduce((s, r) => s + r.change.shrunkPairs.length, 0), homelessNewFiles: pl.reduce((s, r) => s + r.change.newFilesWithoutHome.length, 0), prsMapped: pl.length },
    surveyBalance: sv.length ? sv[0].balance : null,
    surveyBalanceLine: sv.length ? sv[0].line : null,
    weightedUnits: { all: tokens.byChild?.[t] ?? null, implementation: tk.implementation ?? null },
  };
}

// ---- statistics (descriptive below n = 8; no coefficient reported under that) ----
const ranks = (xs) => {
  const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1;
  }
  return r;
};
const spearman = (xs, ys) => {
  const n = xs.length; if (n < 3) return null;
  const rx = ranks(xs), ry = ranks(ys);
  const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
};
const test = (label, pairs) => {
  const n = pairs.length;
  return { label, n, rho: n >= 8 ? round(spearman(pairs.map((p) => p.x), pairs.map((p) => p.y)), 2) : null, points: n >= 8 ? undefined : pairs, note: n >= 8 ? 'Spearman rho' : 'n < 8: points shown, no coefficient' };
};

// Exact = finished, priced, code shape, and every leg dispatched inside the records era.
// Approximate (pre-window) legs are never pooled with exact ones.
const finished = pop.map((t) => perTicket[t]).filter((r) => r.totalUsd !== null && r.shape === 'code');
const exact = finished.filter((r) => !r.preWindowLegs && r.implRows === 1);
const clean = exact.filter((r) => r.implModel === 'claude-haiku-5-5' && r.customInWindow === 0 && r.customLegs === 0 && r.legs.work !== null && r.lv.prodLines > 0);
const workObserver = exact.filter((r) => r.implModel === 'claude-opus-5-5' && r.afterAnswers > 0 && r.legs.work !== null);

const SENSES = { prodLines: (r) => r.lv.prodLines, testLines: (r) => r.lv.testLines, prodFiles: (r) => r.lv.prodFiles, lvPRs: (r) => r.lv.prs,
  sdCodeLines: (r) => r.sd.codeLines, sdTestLines: (r) => r.sd.testLines, placeCrossAreaDelta: (r) => r.place.crossAreaDelta,
  placeGrownPairs: (r) => r.place.grownPairs, placeHomelessNewFiles: (r) => r.place.homelessNewFiles };
const series = (rows, yName, yOf) => Object.entries(SENSES).map(([sn, xOf]) => {
  const pairs = rows.filter((r) => yOf(r) !== null && yOf(r) !== undefined).map((r) => ({ ticket: r.ticket, x: xOf(r), y: yOf(r) }));
  const n = pairs.length;
  return { label: `${sn} vs ${yName}`, n, rho: n >= 8 ? round(spearman(pairs.map((p) => p.x), pairs.map((p) => p.y)), 2) : null, points: n >= 8 ? undefined : pairs };
});

const BAL = { '+': 1, '0': 0, '−': -1, '-': -1 };
const balOrd = (b) => (b === null ? null : b.startsWith('−/+') ? 0 : (BAL[b[0]] ?? null));
const balanceSeries = (rows, yName, yOf) => {
  const pairs = rows.filter((r) => balOrd(r.surveyBalance) !== null && yOf(r) !== null && yOf(r) !== undefined).map((r) => ({ ticket: r.ticket, x: balOrd(r.surveyBalance), y: yOf(r) }));
  const n = pairs.length;
  return [{ label: `survey balance (ordinal) vs ${yName}`, n, rho: n >= 8 ? round(spearman(pairs.map((p) => p.x), pairs.map((p) => p.y)), 2) : null, points: n >= 8 ? undefined : pairs }];
};
const analysis = {
  ticket: 'LIN-4257',
  window_start: WINDOW,
  population: pop,
  population_excluded: [...EXCLUDED],
  counts: {
    population: pop.length,
    shapeCode: pop.filter((t) => perTicket[t].shape === 'code').length,
    shapeResearchAsWork: pop.filter((t) => perTicket[t].shape === 'research-as-work').length,
    shapeNoImplementation: pop.filter((t) => perTicket[t].shape === 'no-implementation-lineage').length,
    shapeNoLandedCode: pop.filter((t) => perTicket[t].shape === 'no-landed-code').map((t) => t),
    unpricedNull: pop.filter((t) => perTicket[t].totalUsd === null),
    preWindowLegs: pop.filter((t) => perTicket[t].preWindowLegs),
    reconcileFailures: pop.filter((t) => perTicket[t].reconciles === false),
    finishedCode: finished.length,
    exact: exact.map((r) => r.ticket),
    clean: clean.map((r) => r.ticket),
    workObserver: workObserver.map((r) => r.ticket),
  },
  tests: {
    cleanStratum_vs_workUsd: series(clean, 'work USD', (r) => r.legs.work),
    cleanStratum_vs_workUnits: series(clean, 'implementation weighted units', (r) => r.weightedUnits.implementation),
    workObserver_vs_workUsd: series(workObserver, 'work USD (work + observer)', (r) => r.legs.work),
    exact_vs_workUsd_modelMixed: series(exact, 'work USD (models mixed; descriptive only)', (r) => r.legs.work),
    exact_vs_floorUsd: series(exact, 'floor USD', (r) => r.legs.floor),
    exact_vs_totalUsd: series(exact, 'total USD', (r) => r.totalUsd),
    // Bound as judged: the Survey ledger's own balance (+ / 0 / -), a selected sample. Ordinal: + 1, 0 0, - -1; -/+ and mixed by leading sign.
    surveyBalance_vs_floor: balanceSeries(exact, 'floor USD', (r) => r.legs.floor),
    surveyBalance_vs_work: balanceSeries(exact, 'work USD', (r) => r.legs.work),
  },
  perTicket,
};

// ---- natural-experiment pairs: read LAST, from the pairs/ re-read only ----
const PAIR_SETS = [
  { name: 'tidy-first 1', tidy: 'LIN-4253', follow: 'LIN-4251' },
  { name: 'tidy-first 2', tidy: 'LIN-4252', follow: 'LIN-4246' },
  { name: 'tidy-after of 2', tidy: 'LIN-4255', follow: null },
  { name: 'second tidy-after', tidy: 'LIN-4254', follow: null },
  { name: 'control (tidy folded in)', tidy: 'LIN-4247', follow: null },
  { name: 'larger extra, split off', tidy: 'LIN-4201', follow: 'LIN-4226' },
];
const pairRow = (t) => {
  const base = `pairs/`;
  if (!existsSync(path.join(EV, base, 'cost', `${t}.json`))) return null;
  const cost = read(`${base}cost/${t}.json`);
  const dispatch = read(`${base}dispatch/${t}.json`).items;
  const state = read(`${base}issue/${t}.json`).state?.name ?? null;
  const L = legsOf(cost, dispatch);
  const noLin = cost.noLineage === true;   // no lineage: legs are unknown, never zero
  return { ticket: t, state, totalUsd: cost.totalUsd, noLineage: cost.noLineage, noTelemetryCount: cost.noTelemetryCount,
    floor: noLin ? null : round(L.floor), work: noLin ? null : round(L.sumOf(L.impl)), keepAlive: noLin ? null : round(L.sumOf(L.legs.orchestration)), survey: noLin ? null : round(L.surveyUsd),
    implModels: [...new Set(L.impl.map((r) => r.model))].sort(), preWindowLegs: L.pre };
};
analysis.pairs = PAIR_SETS.map((ps) => ({ name: ps.name, tidy: pairRow(ps.tidy), follow: ps.follow ? pairRow(ps.follow) : null }));

// ---- self-checks: the analysis fails loudly rather than reporting a broken table ----
const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });
// (a) no frozen JSON carries a top-level error (the freeze also refuses these; this re-checks the folder)
const frozenJson = [...manifest.files.map((f) => f.path), 'manifest.json'];
const badFrozen = frozenJson.filter((rel) => { const j = read(rel); return j && typeof j === 'object' && !Array.isArray(j) && 'error' in j; });
check('no frozen file carries a top-level error', badFrozen.length === 0, badFrozen.join(', '));
// (b) a null session cost makes the leg that holds it null (never zero, never dropped)
const LEG_OF = { before: 'before', after: 'after', diff: 'work', orchestration: 'keepAlive' };
const nullLegFail = [];
for (const t of pop) {
  const cost = read(`cost/${t}.json`);
  for (const w of cost.workerSessions) {
    if (w.costUsd !== null) continue;
    const b = bucketOf(w.kind);
    const r = perTicket[t];
    const leg = w.kind.startsWith('survey-') ? 'survey' : (b === 'before' ? 'floor' : b === 'after' ? 'floor' : LEG_OF[b]);
    if (r.legs[leg] !== null) nullLegFail.push(`${t} ${w.kind} -> ${leg}=${r.legs[leg]}`);
  }
}
check('null session cost reaches its leg as null', nullLegFail.length === 0, nullLegFail.join('; '));
// (c) exact tickets carry no null leg
check('exact tickets have no null leg', exact.every((r) => r.legs.floor !== null && r.legs.work !== null && r.legs.keepAlive !== null && r.legs.survey !== null), '');
// (d) every worker-leg reconciles to totalUsd (sessions + app calls)
check('worker legs + app calls reconcile to totalUsd', pop.every((t) => perTicket[t].reconciles !== false), '');
// (e) population excludes the in-flight ticket and matches the manifest count
check('population count matches manifest', pop.length === manifest.population_count - 1, `${pop.length} vs ${manifest.population_count - 1}`);
// (f) no coefficient below n = 8
const allSeries = Object.values(analysis.tests).flat();
check('no coefficient below n = 8', allSeries.every((b) => b.n >= 8 || b.rho === null), '');
analysis.checks = checks;
const failed = checks.filter((c) => !c.ok);
if (failed.length) { console.error('SELF-CHECK FAILED:\n' + failed.map((c) => `  ${c.name}: ${c.detail}`).join('\n')); process.exitCode = 1; }

writeFileSync(path.join(EV, 'analysis.json'), JSON.stringify(analysis, null, 2) + '\n');

// ---- markdown for the paper ----
const f = (x) => (x === null || x === undefined ? 'null' : x.toFixed(2));
const lines = [];
lines.push(`population ${pop.length} (excluded ${[...EXCLUDED].join(', ')}); code ${analysis.counts.shapeCode}, research-as-work ${analysis.counts.shapeResearchAsWork}, no implementation ${analysis.counts.shapeNoImplementation}`);
lines.push(`unpriced (totalUsd null): ${analysis.counts.unpricedNull.join(', ')}`);
lines.push(`pre-window legs: ${analysis.counts.preWindowLegs.join(', ') || 'none'}`);
lines.push(`reconcile failures: ${analysis.counts.reconcileFailures.join(', ') || 'none'}`);
lines.push(`clean stratum (n=${clean.length}): ${analysis.counts.clean.join(', ')}`);
lines.push(`work + observer (n=${workObserver.length}): ${analysis.counts.workObserver.join(', ')}`);
lines.push('');
lines.push('| ticket | state | total | floor | work | keep-alive | survey | impl model | after-answers | prod lines | test lines | SD code | place cross-area Δ | survey balance |');
lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const t of pop) {
  const r = perTicket[t];
  lines.push(`| ${t} | ${r.state} | ${f(r.totalUsd)} | ${f(r.legs.floor)} | ${f(r.legs.work)} | ${f(r.legs.keepAlive)} | ${f(r.legs.survey)} | ${r.implModel ?? '-'} | ${r.afterAnswers} | ${r.lv.prodLines} | ${r.lv.testLines} | ${r.sd.codeLines} | ${r.place.crossAreaDelta} | ${r.surveyBalance ?? '-'} |`);
}
lines.push('');
for (const [name, block] of Object.entries(analysis.tests)) {
  lines.push(`## ${name}`);
  for (const b of block) lines.push(`${b.label}: n=${b.n}, ${b.rho !== null ? `rho=${b.rho}` : 'no coefficient (n<8)'}`);
}
lines.push('## pairs (re-read last)');
for (const p of analysis.pairs) {
  for (const r of [p.tidy, p.follow].filter(Boolean)) lines.push(`${p.name}: ${r.ticket} ${r.state} total=${f(r.totalUsd)} floor=${f(r.floor)} work=${f(r.work)} keep-alive=${f(r.keepAlive)} survey=${f(r.survey)} models=${r.implModels.join('/') || '-'} noLineage=${r.noLineage} noTelemetry=${r.noTelemetryCount}`);
}
lines.push('## self-checks');
for (const c of checks) lines.push(`${c.ok ? 'pass' : 'FAIL'}  ${c.name}`);
console.log(lines.join('\n'));
