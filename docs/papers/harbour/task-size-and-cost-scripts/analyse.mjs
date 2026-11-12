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
//   Dispatch mode also carries the LIN-4427 rules (version 2, read from its inputs.json): the Done filter, the
//   zero-request cost, primary and sensitivity size, the markers, the token sums, the fits (fit.mjs), the custom
//   sensitivity and the round trips. Lineage mode computes none of them.
//
// Cost legs use lib/wall-clock-summary.js bucketOf (no kind map of our own):
//   before → split into survey-* (own row) and the floor; after → floor;
//   diff → work; orchestration → keep-alive.
// Null is carried as null everywhere. A sum with a null term is null, with the reason.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { bucketOf } from '../../../../lib/wall-clock-summary.js';
import { promptTokensOf } from '../../../../lib/model-pricing.js';
import { need } from '../cleaner-than-it-started-scripts/inputs.mjs';
import { takeTaskSizeInputs, firstLineOf, isAfterAnswer, lineageBucketOf, classifyDispatch, LEG_OF_BUCKET } from './dispatch-legs.mjs';
import { fitSeries, olsMulti, bootstrapCoefs } from './fit.mjs';
import { computeIssueRoundTrips } from '../../../../lib/plan-review-round-trips.js';

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

// LIN-4427: the price-free token sum of one dispatch (inputs.tokens.formula): the prompt (lib/model-pricing.js
// promptTokensOf, the one definition of input + cache read + cache write) plus output. cacheCreation1hInputTokens is a
// partition marker inside cacheCreationInputTokens (lib/model-pricing.js:48-51), so it is not added again. Null when
// the tokens are unknown.
const tokenTotalOf = (t) => (t ? promptTokensOf(t) + t.outputTokens : null);

// The model of one dispatch: its one model, or 'multiple'; null when it made no request (its cost is then unknown).
const modelOf = (d) => (!d.byModel || d.byModel.length === 0 ? null : d.byModel.length === 1 ? d.byModel[0].model : 'multiple');

// Dispatch attribution (LIN-4426). Each /cost dispatch is one row in the same legs as legsOf, so the two read alike.
// (The lineage-mode path above is what version 1's byte-identical witness runs; nothing in it changed for LIN-4427.)
// A null dispatch cost stays null, except a dispatch that made no request, which costs 0 (LIN-4427, below). A lineage
// with dispatches: null is approximate: its whole cost sits at lineage level.
// Survey after-answers are read from their prompts (freeze saved one for every custom dispatch).
// LIN-4427: `customToKeepAlive` is the disclosed sensitivity (inputs.sensitivity): every custom dispatch that is not an
// after-answer goes to keep-alive instead of its lineage's leg. A dispatch with zero requests costs 0 (inputs.exact).
function legsOfDispatch(cost, readPrompt, { customToKeepAlive = false } = {}) {
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
      put({ kind: w.kind, model: w.model, costUsd: w.costUsd, dispatchedAt: w.dispatchedAt, bucket: founder, itemId: null, tokenTotal: null, custom: false, afterAnswer: false });
      continue;
    }
    splits.push({ rootItemId: w.rootItemId, kind: w.kind, lineageCostUsd: w.costUsd, dispatchCostsUsd: w.dispatches.map((d) => d.costUsd) });
    for (const d of w.dispatches) {
      const firstLine = d.kind === 'custom' ? firstLineOf(readPrompt(d.itemId).prompt) : undefined;
      const afterAnswer = d.kind === 'custom' && isAfterAnswer(firstLine);
      let bucket = classifyDispatch({ kind: d.kind, firstLine, lineageBucket: founder });
      if (customToKeepAlive && d.kind === 'custom' && !afterAnswer) bucket = 'orchestration';
      if (d.dispatchedAt && d.dispatchedAt < WINDOW) pre = true;
      if (d.kind === 'custom' && d.dispatchedAt && d.dispatchedAt >= WINDOW) {
        customs.push(d.itemId);
        if (afterAnswer) afterAnswers++;
      }
      const noRequests = d.requests === 0;
      put({ kind: d.kind, model: modelOf(d), costUsd: noRequests && d.costUsd === null ? 0 : d.costUsd, dispatchedAt: d.dispatchedAt, bucket, itemId: d.itemId,
        tokenTotal: noRequests ? 0 : tokenTotalOf(d.tokens), custom: d.kind === 'custom', afterAnswer });
    }
  }
  const sumOf = (rs) => sumNullable(rs.map((r) => r.costUsd));
  // LIN-4427: per-leg token totals (null if any row's tokens are unknown) and the after-answer and custom follow-up dollars.
  const tokensOfLeg = (rs) => sumNullable(rs.map((r) => r.tokenTotal));
  const legTokens = {
    floor: tokensOfLeg([...legs.before, ...legs.after]), work: tokensOfLeg(legs.diff),
    keepAlive: tokensOfLeg(legs.orchestration), survey: tokensOfLeg(legs.survey),
  };
  const firstDispatchedAt = rows.map((r) => r.dispatchedAt).filter(Boolean).sort()[0] ?? null;
  const afterAnswerUsd = sumNullable(rows.filter((r) => r.afterAnswer).map((r) => r.costUsd));
  const customFollowUpUsd = sumNullable(rows.filter((r) => r.custom && !r.afterAnswer).map((r) => r.costUsd));
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
    rows, splits, customs, afterAnswers, approximate, nullLegs, legTokens, firstDispatchedAt, afterAnswerUsd, customFollowUpUsd };
}

// The implementation model when work comes from several dispatch rows: their one shared model, else 'multiple'.
function implModelOfDispatch(impl) {
  const models = [...new Set(impl.map((r) => r.model))];
  return models.length === 0 ? null : models.length === 1 ? models[0] : 'multiple';
}

// ---- LIN-4427 (dispatch mode only): inputs read through need(), so a missing rule throws ----
const V2 = DISPATCH ? {
  exactState: need(inputs, 'exact.state'),
  // The prose rules below are implemented in code (zero-request cost, primary and sensitivity size, marker, tokens, the
  // custom sensitivity). They are read here only so that a missing one stops the analysis rather than going unrecorded.
  proseRules: [need(inputs, 'exact.dispatch_cost_with_zero_requests'), need(inputs, 'size.primary'), need(inputs, 'size.sensitivity'), need(inputs, 'marker.rule'), need(inputs, 'tokens.formula'), need(inputs, 'sensitivity.custom_to_keepalive')],
  asOfRule: need(inputs, 'rounds.as_of'),
  roundPairs: need(inputs, 'rounds.pairs'),
  minN: need(inputs, 'fit.min_n'),
  boot: { seed: need(inputs, 'fit.bootstrap.seed'), resamples: need(inputs, 'fit.bootstrap.resamples'), level: need(inputs, 'fit.bootstrap.level') },
  haiku: need(inputs, 'strata.work_haiku_only'),
  opus: need(inputs, 'strata.work_opus_only'),
  cohortMs: Date.parse(need(inputs, 'strata.cohort_from')),
} : null;
if (DISPATCH) {
  if (V2.asOfRule !== 'manifest.freeze_finished_at') throw new Error(`inputs rounds.as_of is "${V2.asOfRule}"; the rule is manifest.freeze_finished_at`);
  if (!Number.isFinite(V2.cohortMs)) throw new Error('inputs strata.cohort_from is not a time');
}
const AS_OF = DISPATCH ? manifest.freeze_finished_at : null;
const GOLDEN_GLOB = DISPATCH ? [...read('size/lv-golden-glob.json'), ...read('size/sd-golden-glob.json')] : [];
const goldenLinesOf = (t) => GOLDEN_GLOB.filter((r) => r.ticket === t).reduce((s, r) => s + r.goldenGlobAdded + r.goldenGlobDeleted, 0);
// The round trips of each pair (lib/plan-review-round-trips.js, unchanged), from the frozen dispatch rows and issue.
const roundsOf = (t, items, issue) => Object.fromEntries(V2.roundPairs.map((pair) => {
  const r = computeIssueRoundTrips({ id: issue.id, identifier: t, rows: items, comments: issue.comments ?? [], description: issue.description ?? '' },
    { asOf: AS_OF, gateKind: pair.gate, rePassKind: pair.rePass });
  return [pair.gate, { roundTrips: r.roundTrips, gateRows: items.filter((i) => i.kind === pair.gate).length, gateDue: r.gateDue, gateHonoured: r.gateHonoured }];
}));

// LIN-4427: the per-ticket fields only dispatch mode carries (the lineage-mode output is unchanged).
function v2Fields(t, cost, items, L, lv, sd) {
  const g = cost.totalUsd === null ? () => null : (x) => x;
  const primary = lv.reduce((s, r) => s + r.prodAdded + r.prodDeleted, 0) + sd.reduce((s, r) => s + r.codeAdded + r.codeDeleted, 0);
  const testLines = lv.reduce((s, r) => s + r.testAdded + r.testDeleted, 0) + sd.reduce((s, r) => s + r.testAdded + r.testDeleted, 0);
  const sensitivity = primary + testLines - goldenLinesOf(t);
  const lvProd = lv.reduce((s, r) => s + r.prodAdded + r.prodDeleted, 0), sdCode = sd.reduce((s, r) => s + r.codeAdded + r.codeDeleted, 0);
  // A tie goes to LinearViewer (inputs.marker.rule). A ticket with no production lines in either repository has no marker.
  const marker = lvProd === 0 && sdCode === 0 ? null : lvProd >= sdCode ? 'LinearViewer' : 'simple-dispatcher';
  // The same ticket with every custom follow-up in keep-alive (the disclosed sensitivity, inputs.sensitivity).
  const Ls = legsOfDispatch(cost, (id) => read(`prompts/${id}.json`), { customToKeepAlive: true });
  const rounds = roundsOf(t, items, read(`issue/${t}.json`));
  return {
    size: { primary, sensitivity, lvProd, sdCode },
    marker,
    incomplete: cost.workerSessions.some((w) => w.incomplete === true),
    firstDispatchedAt: L.firstDispatchedAt,
    legTokens: L.legTokens,
    afterAnswerUsd: round(g(L.afterAnswerUsd)),
    customFollowUpUsd: round(g(L.customFollowUpUsd)),
    legsCustomToKeepAlive: { floor: round(g(Ls.floor)), work: round(g(Ls.sumOf(Ls.impl))), keepAlive: round(g(Ls.sumOf(Ls.legs.orchestration))), survey: round(g(Ls.surveyUsd)) },
    rounds,
    roundTrips: Object.values(rounds).reduce((s, r) => s + r.roundTrips, 0),
  };
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
    ...(DISPATCH ? v2Fields(t, cost, dispatch, L, lv, sd) : {}),
  };
}

// ---- statistics (descriptive below n = 8; no coefficient reported under that) ----
// The minimum n for a coefficient: v1's 8 in lineage mode; inputs fit.min_n in dispatch mode (pre-registered as the same rule).
const COEF_MIN_N = DISPATCH ? V2.minN : 8;
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
  return { label, n, rho: n >= COEF_MIN_N ? round(spearman(pairs.map((p) => p.x), pairs.map((p) => p.y)), 2) : null, points: n >= COEF_MIN_N ? undefined : pairs, note: n >= COEF_MIN_N ? 'Spearman rho' : `n < ${COEF_MIN_N}: points shown, no coefficient` };
};

// Exact = finished, priced, code shape, and every leg dispatched inside the records era.
// Approximate (pre-window) legs are never pooled with exact ones.
// Dispatch attribution drops the lineage-only implRows === 1 rule: a ticket may hold several work dispatches (each
// is summed into work). Its replacement is the approximate flag (a dispatches: null lineage) and self-check d2.
const finished = pop.map((t) => perTicket[t]).filter((r) => r.totalUsd !== null && r.shape === 'code'
  && (!DISPATCH || (r.state === V2.exactState && !r.incomplete)));
const exact = finished.filter((r) => !r.preWindowLegs && (DISPATCH ? !r.approximate : r.implRows === 1));
const clean = exact.filter((r) => r.implModel === 'claude-haiku-5-5' && r.customInWindow === 0 && r.customLegs === 0 && r.legs.work !== null && r.lv.prodLines > 0);
const workObserver = exact.filter((r) => r.implModel === 'claude-opus-5-5' && r.afterAnswers > 0 && r.legs.work !== null);

const SENSES = { prodLines: (r) => r.lv.prodLines, testLines: (r) => r.lv.testLines, prodFiles: (r) => r.lv.prodFiles, lvPRs: (r) => r.lv.prs,
  sdCodeLines: (r) => r.sd.codeLines, sdTestLines: (r) => r.sd.testLines, placeCrossAreaDelta: (r) => r.place.crossAreaDelta,
  placeGrownPairs: (r) => r.place.grownPairs, placeHomelessNewFiles: (r) => r.place.homelessNewFiles };
const series = (rows, yName, yOf) => Object.entries(SENSES).map(([sn, xOf]) => {
  const pairs = rows.filter((r) => yOf(r) !== null && yOf(r) !== undefined).map((r) => ({ ticket: r.ticket, x: xOf(r), y: yOf(r) }));
  const n = pairs.length;
  return { label: `${sn} vs ${yName}`, n, rho: n >= COEF_MIN_N ? round(spearman(pairs.map((p) => p.x), pairs.map((p) => p.y)), 2) : null, points: n >= COEF_MIN_N ? undefined : pairs };
});

const BAL = { '+': 1, '0': 0, '−': -1, '-': -1 };
const balOrd = (b) => (b === null ? null : b.startsWith('−/+') ? 0 : (BAL[b[0]] ?? null));
const balanceSeries = (rows, yName, yOf) => {
  const pairs = rows.filter((r) => balOrd(r.surveyBalance) !== null && yOf(r) !== null && yOf(r) !== undefined).map((r) => ({ ticket: r.ticket, x: balOrd(r.surveyBalance), y: yOf(r) }));
  const n = pairs.length;
  return [{ label: `survey balance (ordinal) vs ${yName}`, n, rho: n >= COEF_MIN_N ? round(spearman(pairs.map((p) => p.x), pairs.map((p) => p.y)), 2) : null, points: n >= COEF_MIN_N ? undefined : pairs }];
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
// ---- LIN-4427 fits (dispatch mode only): every rule is the inputs file's, read above; nothing is tuned after a slope ----
if (DISPATCH) {
  const LEGS = ['floor', 'work', 'keepAlive', 'survey'];
  const fitOpts = { seed: V2.boot.seed, resamples: V2.boot.resamples, level: V2.boot.level, minN: V2.minN };
  const pointsOf = (rows, usdOf, sizeOf = (r) => r.size.primary) => rows.map((r) => ({ ticket: r.ticket, marker: r.marker, size: sizeOf(r), usd: usdOf(r) }));
  const legFits = (rows, { tokens = false, sizeOf, legsOf = (r) => r.legs } = {}) =>
    Object.fromEntries(LEGS.map((leg) => [leg, fitSeries(pointsOf(rows, (r) => (tokens ? r.legTokens[leg] : legsOf(r)[leg]), sizeOf), fitOpts)]));
  const EXACT = exact;
  const byRepo = (m) => EXACT.filter((r) => r.marker === m);
  const fits = {
    primary: legFits(EXACT),
    tokens: legFits(EXACT, { tokens: true }),
    sensitivitySize: legFits(EXACT, { sizeOf: (r) => r.size.sensitivity }),
    customToKeepAlive: legFits(EXACT, { legsOf: (r) => r.legsCustomToKeepAlive }),
    workHaikuOnly: { work: fitSeries(pointsOf(EXACT.filter((r) => r.implModel === V2.haiku), (r) => r.legs.work), fitOpts) },
    workOpusOnly: { work: fitSeries(pointsOf(EXACT.filter((r) => r.implModel === V2.opus), (r) => r.legs.work), fitOpts) },
    cohortFirstDispatchedFrom: legFits(EXACT.filter((r) => r.firstDispatchedAt && Date.parse(r.firstDispatchedAt) >= V2.cohortMs)),
    byMarker: { LinearViewer: legFits(byRepo('LinearViewer')), 'simple-dispatcher': legFits(byRepo('simple-dispatcher')) },
  };
  // The disclosed sensitivity: which tickets' legs move when custom follow-ups go to keep-alive (population, not only exact).
  const moved = pop.filter((t) => LEGS.some((leg) => perTicket[t].legs[leg] !== undefined && perTicket[t].legsCustomToKeepAlive[leg] !== perTicket[t].legs[leg]))
    .map((t) => ({ ticket: t, exact: EXACT.some((r) => r.ticket === t), legs: Object.fromEntries(LEGS.filter((leg) => perTicket[t].legsCustomToKeepAlive[leg] !== perTicket[t].legs[leg]).map((leg) => [leg, { now: perTicket[t].legs[leg], sensitivity: perTicket[t].legsCustomToKeepAlive[leg] }])) }));
  // Rounds (inputs.rounds): floor on log10 size, with and without the round trips as a regressor. Exact tickets only.
  const usable = EXACT.filter((r) => r.size.primary > 0 && r.legs.floor > 0);
  const X0 = usable.map((r) => [1, Math.log10(r.size.primary)]);
  const X1 = usable.map((r) => [1, Math.log10(r.size.primary), r.roundTrips]);
  const yF = usable.map((r) => Math.log10(r.legs.floor));
  const roundsFit = usable.length < V2.minN ? { n: usable.length, reading: `n=${usable.length} < ${V2.minN}: no regression` } : (() => {
    const b0 = olsMulti(X0, yF), b1 = olsMulti(X1, yF);
    const c0 = bootstrapCoefs(X0, yF, fitOpts), c1 = bootstrapCoefs(X1, yF, fitOpts);
    return { n: usable.length,
      withoutRounds: { sizeSlope: b0 && b0[1], sizeSlopeCi: c0.ci[1] },
      withRounds: { sizeSlope: b1 && b1[1], sizeSlopeCi: c1.ci[1], roundsCoef: b1 && b1[2], roundsCoefCi: c1.ci[2] },
      bootstrap: { resamples: V2.boot.resamples, singularWithout: c0.singular, singularWith: c1.singular } };
  })();
  const roundsSummary = Object.fromEntries(V2.roundPairs.map((pair) => {
    const rs = EXACT.map((r) => r.rounds[pair.gate]);
    return [pair.gate, { tickets: EXACT.length, withGateRow: rs.filter((x) => x.gateRows > 0).length, gateDue: rs.filter((x) => x.gateDue).length,
      gateHonoured: rs.filter((x) => x.gateHonoured).length, roundTrips: rs.reduce((s, x) => s + x.roundTrips, 0), ticketsWithRoundTrip: rs.filter((x) => x.roundTrips > 0).length }];
  }));
  analysis.v2 = { asOf: AS_OF, freezeFinishedAt: manifest.freeze_finished_at, bootstrap: { ...V2.boot, minN: V2.minN }, cohortFrom: V2.cohortMs ? new Date(V2.cohortMs).toISOString() : null,
    exactCount: EXACT.length, exact: EXACT.map((r) => r.ticket), fits, sensitivityMoved: moved, rounds: { fit: roundsFit, summary: roundsSummary },
    zeroSizeInExact: EXACT.filter((r) => r.size.primary === 0).map((r) => r.ticket), landedNoTokens: EXACT.filter((r) => r.legTokens.floor === null || r.legTokens.work === null).map((r) => r.ticket) };
  // self-checks for the fits: a reported slope has n >= min_n; the interval brackets the slope; exact tickets are Done and complete
  const allFits = [];
  const walk = (o, name) => { if (o && typeof o === 'object' && 'n' in o && 'dropped' in o) allFits.push([name, o]); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${name}.${k}`); };
  walk(fits, 'fits');
  analysis.v2.fitCount = allFits.length;
  check('every reported slope has n >= min_n', allFits.every(([, f]) => f.slope === null || f.n >= V2.minN), '');
  check('every slope interval brackets its point estimate', allFits.every(([, f]) => f.slope === null || (f.ci[0] <= f.slope && f.slope <= f.ci[1])), '');
  check('exact tickets are Done, priced and complete', EXACT.every((r) => r.state === V2.exactState && r.totalUsd !== null && !r.incomplete), '');
  check('exact tickets carry no null leg', EXACT.every((r) => LEGS.every((leg) => r.legs[leg] !== null)), '');
}

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
check(`no coefficient below n = ${COEF_MIN_N}`, allSeries.every((b) => b.n >= COEF_MIN_N || b.rho === null), '');
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
  for (const b of block) lines.push(`${b.label}: n=${b.n}, ${b.rho !== null ? `rho=${b.rho}` : `no coefficient (n<${COEF_MIN_N})`}`);
}
lines.push('## pairs (re-read last)');
for (const p of analysis.pairs) {
  for (const r of [p.tidy, p.follow].filter(Boolean)) lines.push(`${p.name}: ${r.ticket} ${r.state} total=${f(r.totalUsd)} floor=${f(r.floor)} work=${f(r.work)} keep-alive=${f(r.keepAlive)} survey=${f(r.survey)} models=${r.implModels.join('/') || '-'} noLineage=${r.noLineage} noTelemetry=${r.noTelemetryCount}`);
}
if (DISPATCH) {
  lines.push('## LIN-4427 fits (USD unless stated): slope [95% bootstrap interval], n, dropped (size, cost)');
  const printFits = (o, name) => {
    if (o && 'n' in o && 'dropped' in o) {
      const f = o;
      lines.push(`${name}: n=${f.n} dropped=${f.dropped.zeroOrNullSize},${f.dropped.zeroOrNullCost} slope=${f.slope === null ? 'none' : f.slope.toFixed(3)} ci=${f.ci ? `[${f.ci[0].toFixed(3)}, ${f.ci[1].toFixed(3)}]` : 'none'} ${f.reading}`);
    } else for (const [k, v] of Object.entries(o)) printFits(v, `${name}/${k}`);
  };
  printFits(analysis.v2.fits, 'fits');
  lines.push(`moved by custom->keep-alive: ${analysis.v2.sensitivityMoved.map((m) => `${m.ticket}${m.exact ? '' : '(not exact)'}`).join(', ') || 'none'}`);
  lines.push(`rounds summary: ${JSON.stringify(analysis.v2.rounds.summary)}`);
  lines.push(`rounds regression: ${JSON.stringify(analysis.v2.rounds.fit)}`);
}
lines.push('## self-checks');
for (const c of checks) lines.push(`${c.ok ? 'pass' : 'FAIL'}  ${c.name}`);
console.log(lines.join('\n'));
