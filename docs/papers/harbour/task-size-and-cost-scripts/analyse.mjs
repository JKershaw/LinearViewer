#!/usr/bin/env node
// analyse.mjs — LIN-4257 (v1), with the LIN-4426 inputs and dispatch attribution. Builds every table in
// task-size-and-cost.md from the FROZEN evidence folder alone. No network, no git, no live re-reads. Running it twice
// on the same folder writes byte-identical output (no clock reads, sorted keys).
//
// Usage (LinearViewer root):
//   node docs/papers/harbour/task-size-and-cost-scripts/analyse.mjs <evidence-dir> [--inputs <file.json>]
// Writes <evidence-dir>/analysis.json and prints the markdown tables to stdout.
//
// Inputs (LIN-4426): every setting is data in an inputs file, read through the sibling's takeInputs/need
// (cleaner-than-it-started-scripts/inputs.mjs, imported, not edited). Without --inputs the default is inputs-v1.json
// beside this script, but only where <evidence-dir> holds no inputs.json of its own (dispatch-legs.mjs,
// takeTaskSizeInputs). The inputs' window_start must equal the manifest's, and an inputs file that carries
// freeze_finished_at must name the manifest's freeze.
//
// Attribution (inputs.attribution):
//   "lineage"  — v1's path, unchanged: each lineage's cost is one row, at its own kind's leg (bucketOf).
//   "dispatch" — each /cost dispatch is its own row (lineage.dispatches); classified by dispatch-legs.mjs.
//
// Cost legs use lib/wall-clock-summary.js bucketOf (no kind map of our own):
//   before → split into survey-* (own row) and the floor; after → floor;
//   diff → work; orchestration → keep-alive.
// Null is carried as null everywhere. A sum with a null term is null, with the reason.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { bucketOf } from '../../../../lib/wall-clock-summary.js';
import { need } from '../cleaner-than-it-started-scripts/inputs.mjs';
import { takeTaskSizeInputs, firstLineOf, isAfterAnswer, lineageBucketOf, classifyDispatch } from './dispatch-legs.mjs';

const EV = process.argv[2];
if (!EV) { console.error('usage: analyse.mjs <evidence-dir> [--inputs <file.json>]'); process.exit(2); }
const { inputs, inputsPath } = takeTaskSizeInputs(process.argv.slice(2), 'analyse.mjs <evidence-dir>', [EV]);
const read = (rel) => JSON.parse(readFileSync(path.join(EV, rel), 'utf8'));

const ATTRIBUTION = need(inputs, 'attribution');
if (ATTRIBUTION !== 'lineage' && ATTRIBUTION !== 'dispatch') throw new Error(`inputs attribution is "${ATTRIBUTION}"; it must be "lineage" or "dispatch"`);
const DISPATCH = ATTRIBUTION === 'dispatch';
const TICKET = need(inputs, 'ticket');
const CODING = need(inputs, 'custom_founded_legs');
const PAIR_SETS = need(inputs, 'pair_sets');

const manifest = read('manifest.json');
const WINDOW = manifest.window_start;
if (need(inputs, 'window_start') !== WINDOW) {
  throw new Error(`inputs window_start ${need(inputs, 'window_start')} is not the manifest's ${WINDOW}: the inputs were written for another freeze`);
}
if (inputs.freeze_finished_at !== undefined && inputs.freeze_finished_at !== manifest.freeze_finished_at) {
  throw new Error(`inputs freeze_finished_at ${inputs.freeze_finished_at} is not the manifest's ${manifest.freeze_finished_at}: the inputs were written for another freeze`);
}
const EXCLUDED = new Set(need(inputs, 'excluded'));
const pop = manifest.population.filter((t) => !EXCLUDED.has(t));

const sumNullable = (xs) => (xs.some((x) => x === null) ? null : xs.reduce((s, x) => s + x, 0));
const round = (x, d = 4) => (x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d);
const LEG_OF_BUCKET = { before: 'floor', after: 'floor', diff: 'work', orchestration: 'keepAlive', survey: 'survey' };

// ---- size inputs (frozen) ----
const lvPrs = read('size/lv-prs.json');
const sdPrs = read('size/sd-prs.json');
const lvPlace = read('size/lv-place-change.json');
const survey = read('size/survey-balance.json').rows.filter((r) => r.row_has_balance_cell);
const tokens = read('size/survey-costmix-tokens.json');

// Leg split for one ticket's frozen /cost and /dispatch (lineage attribution). Shared by the population and the pairs.
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

// The model of one dispatch: its one model, or 'multiple'; null when it made no request (its cost is then unknown).
const modelOf = (d) => (!d.byModel || d.byModel.length === 0 ? null : d.byModel.length === 1 ? d.byModel[0].model : 'multiple');

// Dispatch attribution (LIN-4426). Each /cost dispatch is one row in the same legs as legsOf, so the two read alike.
// A null dispatch cost stays null. A lineage with dispatches: null is approximate: its whole cost sits at lineage level.
// Survey after-answers are read from their prompts (freeze saved one for every custom dispatch).
function legsOfDispatch(cost, readPrompt) {
  const legs = { before: [], diff: [], after: [], orchestration: [], survey: [] };
  const rows = [];
  const splits = [];
  const customs = [];
  let pre = false, approximate = false, afterAnswers = 0;
  const put = (row) => { legs[row.bucket].push(row); rows.push(row); };
  for (const w of cost.workerSessions) {
    const founder = lineageBucketOf(w, CODING);
    if (w.dispatches === null) {
      approximate = true;
      if (w.dispatchedAt < WINDOW) pre = true;
      put({ kind: w.kind, model: w.model, costUsd: w.costUsd, dispatchedAt: w.dispatchedAt, bucket: founder, itemId: null });
      continue;
    }
    splits.push({ rootItemId: w.rootItemId, kind: w.kind, lineageCostUsd: w.costUsd, dispatchCostsUsd: w.dispatches.map((d) => d.costUsd) });
    for (const d of w.dispatches) {
      const firstLine = d.kind === 'custom' ? firstLineOf(readPrompt(d.itemId).prompt) : undefined;
      const bucket = classifyDispatch({ kind: d.kind, firstLine, lineageBucket: founder });
      if (d.dispatchedAt && d.dispatchedAt < WINDOW) pre = true;
      if (d.kind === 'custom' && d.dispatchedAt && d.dispatchedAt >= WINDOW) {
        customs.push(d.itemId);
        if (isAfterAnswer(firstLine)) afterAnswers++;
      }
      put({ kind: d.kind, model: modelOf(d), costUsd: d.costUsd, dispatchedAt: d.dispatchedAt, bucket, itemId: d.itemId });
    }
  }
  const sumOf = (rs) => sumNullable(rs.map((r) => r.costUsd));
  const surveyUsd = sumOf(legs.survey);
  const floor = (() => {
    const a = sumOf(legs.before), c = sumOf(legs.after);
    return a === null || c === null ? null : a + c;
  })();
  const impl = legs.diff;
  const appCallsUsd = cost.appCalls?.costUsd ?? null;
  const workerTotal = sumOf(cost.workerSessions);
  const reconciles = cost.totalUsd === null || workerTotal === null ? null
    : Math.abs((workerTotal + (appCallsUsd ?? 0)) - cost.totalUsd) < 1e-6;
  const nullLegs = [...new Set(rows.filter((r) => r.costUsd === null).map((r) => LEG_OF_BUCKET[r.bucket]))];
  return { legs, pre, sumOf, floor, surveyUsd, impl, workerTotal, appCallsUsd, reconciles, dispatch: null,
    rows, splits, customs, afterAnswers, approximate, nullLegs };
}

// The implementation model when work comes from several dispatch rows: their one shared model, else 'multiple'.
function implModelOfDispatch(impl) {
  const models = [...new Set(impl.map((r) => r.model))];
  return models.length === 0 ? null : models.length === 1 ? models[0] : 'multiple';
}

const perTicket = {};
const dispatchOf = {};   // dispatch attribution only: each ticket's legsOfDispatch result, for the self-checks
for (const t of pop) {
  const cost = read(`cost/${t}.json`);
  const dispatch = read(`dispatch/${t}.json`).items;
  let L, customs, afterAnswers;
  if (DISPATCH) {
    L = legsOfDispatch(cost, (id) => read(`prompts/${id}.json`));
    dispatchOf[t] = L;
    customs = L.customs;
    afterAnswers = L.afterAnswers;
  } else {
    L = legsOf(cost, dispatch);
    customs = dispatch.filter((i) => i.kind === 'custom' && i.dispatchedAt && i.dispatchedAt >= WINDOW);
    afterAnswers = customs.filter((c) => {
      const p = read(`prompts/${c.id}.json`);
      return isAfterAnswer(firstLineOf(p.prompt));
    }).length;
  }
  const { legs, pre, sumOf, floor, surveyUsd, impl, workerTotal, appCallsUsd, reconciles } = L;
  const implModel = DISPATCH ? implModelOfDispatch(impl) : impl.length === 1 ? impl[0].model : impl.length === 0 ? null : 'multiple';
  // Dispatch attribution: a ticket whose totalUsd is null gives no leg a value. A partial sum is never reported.
  const g = DISPATCH && cost.totalUsd === null ? () => null : (x) => x;
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
    legs: { floor: round(g(floor)), work: round(g(sumOf(impl))), keepAlive: round(g(sumOf(legs.orchestration))), survey: round(g(surveyUsd)), before: round(g(sumOf(legs.before))), after: round(g(sumOf(legs.after))) },
    implModel,
    implRows: impl.length,
    customInWindow: customs.length,
    customLegs: cost.workerSessions.filter((w) => w.kind === 'custom').length,
    afterAnswers,
    kindsSeen: [...new Set(kinds)].sort(),
    shape: impl.length === 0 ? (legs.before.some((r) => r.kind === 'research') ? 'research-as-work' : 'no-implementation-lineage')
      : (landedLines === 0 ? (legs.before.some((r) => r.kind === 'research') ? 'research-as-work' : 'no-landed-code') : 'code'),
    lv: { prs: lv.length, prodLines: lv.reduce((s, r) => s + r.prodAdded + r.prodDeleted, 0), testLines: lv.reduce((s, r) => s + r.testAdded + r.testDeleted, 0), prodFiles: lv.reduce((s, r) => s + r.prodFiles.length, 0) },
    sd: { prs: sd.length, codeLines: sd.reduce((s, r) => s + r.codeAdded + r.codeDeleted, 0), testLines: sd.reduce((s, r) => s + r.testAdded + r.testDeleted, 0), codeFiles: sd.reduce((s, r) => s + r.codeFiles, 0) },
    place: { crossAreaDelta: pl.reduce((s, r) => s + (r.change.crossAreaImports[1] - r.change.crossAreaImports[0]), 0), newPairs: pl.reduce((s, r) => s + r.change.newPairs.length, 0), grownPairs: pl.reduce((s, r) => s + r.change.grownPairs.length, 0), shrunkPairs: pl.reduce((s, r) => s + r.change.shrunkPairs.length, 0), homelessNewFiles: pl.reduce((s, r) => s + r.change.newFilesWithoutHome.length, 0), prsMapped: pl.length },
    surveyBalance: sv.length ? sv[0].balance : null,
    surveyBalanceLine: sv.length ? sv[0].line : null,
    weightedUnits: { all: tokens.byChild?.[t] ?? null, implementation: tk.implementation ?? null },
    ...(DISPATCH ? { approximate: L.approximate, nullLegs: L.nullLegs } : {}),
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
// Dispatch attribution drops the lineage-only implRows === 1 rule: a ticket may hold several work dispatches (each
// is summed into work). Its replacement is the approximate flag (a dispatches: null lineage) and self-check d2.
const finished = pop.map((t) => perTicket[t]).filter((r) => r.totalUsd !== null && r.shape === 'code');
const exact = finished.filter((r) => !r.preWindowLegs && (DISPATCH ? !r.approximate : r.implRows === 1));
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
  ticket: TICKET,
  window_start: WINDOW,
  ...(DISPATCH ? { attribution: ATTRIBUTION } : {}),
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
    ...(DISPATCH ? { approximate: pop.filter((t) => perTicket[t].approximate) } : {}),
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
const PAIR_BASE = 'pairs/';
const pairRow = (t) => {
  if (!existsSync(path.join(EV, PAIR_BASE, 'cost', `${t}.json`))) return null;
  const cost = read(`${PAIR_BASE}cost/${t}.json`);
  const dispatch = read(`${PAIR_BASE}dispatch/${t}.json`).items;
  const state = read(`${PAIR_BASE}issue/${t}.json`).state?.name ?? null;
  const L = DISPATCH ? legsOfDispatch(cost, (id) => read(`${PAIR_BASE}prompts/${id}.json`)) : legsOf(cost, dispatch);
  const noLin = cost.noLineage === true;   // no lineage: legs are unknown, never zero
  const g = DISPATCH && cost.totalUsd === null ? () => null : (x) => x;
  return { ticket: t, state, totalUsd: cost.totalUsd, noLineage: cost.noLineage, noTelemetryCount: cost.noTelemetryCount,
    floor: noLin ? null : round(g(L.floor)), work: noLin ? null : round(g(L.sumOf(L.impl))), keepAlive: noLin ? null : round(g(L.sumOf(L.legs.orchestration))), survey: noLin ? null : round(g(L.surveyUsd)),
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
if (!DISPATCH) {
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
} else {
  // (b′) a null dispatch cost (or a null lineage cost at lineage level) makes the leg that holds it null
  const nullDispatchFail = [];
  for (const t of pop) {
    for (const leg of dispatchOf[t].nullLegs) {
      if (perTicket[t].legs[leg] !== null) nullDispatchFail.push(`${t} null ${leg} -> ${perTicket[t].legs[leg]}`);
    }
  }
  check('null dispatch cost reaches its leg as null', nullDispatchFail.length === 0, nullDispatchFail.join('; '));
}
// (c) exact tickets carry no null leg
check('exact tickets have no null leg', exact.every((r) => r.legs.floor !== null && r.legs.work !== null && r.legs.keepAlive !== null && r.legs.survey !== null), '');
// (d) every worker-leg reconciles to totalUsd (sessions + app calls)
check('worker legs + app calls reconcile to totalUsd', pop.every((t) => perTicket[t].reconciles !== false), '');
if (DISPATCH) {
  // (d2) replaces the lineage-only split of workers: each lineage's dispatches sum to that lineage's cost. Compared only
  // where both sides are known: a null on either side is not a mismatch, it is an unknown.
  const splitFail = [];
  let compared = 0;
  for (const t of pop) {
    for (const s of dispatchOf[t].splits) {
      if (s.lineageCostUsd === null || s.dispatchCostsUsd.some((x) => x === null)) continue;
      compared++;
      const sum = s.dispatchCostsUsd.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - s.lineageCostUsd) > 1e-6) splitFail.push(`${t} ${s.rootItemId} (${s.kind}): dispatches ${sum} vs lineage ${s.lineageCostUsd}`);
    }
  }
  check('each lineage dispatch split sums to its lineage cost', splitFail.length === 0, `${compared} lineages compared; ${splitFail.join('; ')}`);
}
// (e) population excludes the excluded tickets that the manifest holds, and matches the manifest count
const EXCLUDED_IN_POP = [...EXCLUDED].filter((t) => manifest.population.includes(t));
check('population count matches manifest', pop.length === manifest.population_count - EXCLUDED_IN_POP.length, `${pop.length} vs ${manifest.population_count - EXCLUDED_IN_POP.length}`);
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
if (DISPATCH) lines.push(`attribution: dispatch (inputs ${path.relative(process.cwd(), inputsPath)})`);
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
