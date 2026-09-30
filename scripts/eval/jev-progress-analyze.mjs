#!/usr/bin/env node
/**
 * LIN-3169 — offline analysis over the jev-progress-eval.mjs caches (no Jev calls; the drift run
 * is the one exception, via jev-progress-eval.mjs `run`).
 *
 *   ALLK=1 SPLIT=dev node scripts/eval/jev-progress-analyze.mjs calibrate   # temperature + ensembles (dev)
 *   ALLK=1 node scripts/eval/jev-progress-analyze.mjs final                 # locked finalists on test, once
 *   ALLK=1 node scripts/eval/jev-progress-analyze.mjs drift-prep            # weekly norms → snapshots-drift.json
 *   SNAPF=snapshots-drift.json SPLIT=drift CONFIGS=rawnfRoll:rem2,rawnfFrozen:rem2,rawnfOracle:rem2 \
 *     OPENROUTER_API_KEY=… node scripts/eval/jev-progress-eval.mjs run
 *   node scripts/eval/jev-progress-analyze.mjs drift
 *   node scripts/eval/jev-progress-analyze.mjs summary                      # writes jev-progress-out/summary.json
 *
 * Env: CFGS (calibrate candidates), TS (temperatures), TOP.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { F, score, baselines, loadResults, toBins, rps, computeNorms, normsText } from './jev-progress-eval.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER = new Set(['autopilot', 'wake']);
const load = (n) => JSON.parse(readFileSync(F(n), 'utf8'));
export const temper = (d, T) => d && toBins(d.map((x) => Math.pow(x + 1e-4, 1 / T)));
const avg = (...ds) => (ds.some((d) => !d) ? null : ds[0].map((_, i) => ds.reduce((s, d) => s + d[i], 0) / ds.length));
const fmt = (n, m) => `${n.padEnd(46)} n ${String(m.n).padStart(3)}  RPS ${m.rps.toFixed(4)}  MAE ${m.mae.toFixed(1).padStart(4)}  bias ${m.bias.toFixed(1).padStart(5)}  rho ${m.rho.toFixed(3)}  order ${m.order.toFixed(2)}  sd ${m.sd.toFixed(1).padStart(4)}  cov80 ${m.cover80.toFixed(2)}`;
const round = (m) => m && Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(4) : v]));

// ── calibrate: temperature widening, Jev-only ensembles, and Jev + lookup (dev) ──────────────
function calibrate() {
  const all = load('snapshots-allk.json'); const snaps = all.filter((s) => s.split === (process.env.SPLIT || 'dev'));
  const res = loadResults(); const B = baselines(snaps, all); const H = B['base:history(lastKind,k)'];
  const get = (c) => (s) => res[`${c}|${s.sid}`]?.dist;
  const cands = (process.env.CFGS || 'rawnf:rem2,tmnfl2c:rem2,tmnf:rem2,tmf:rem2,tmhnf:rem2,tmnf:score').split(',');
  const Ts = (process.env.TS || '1,1.25,1.5,2').split(',').map(Number);
  const rows = [];
  for (const c of cands) for (const T of Ts) {
    rows.push([`${c} T=${T}`, score(snaps, (s) => temper(get(c)(s), T))]);
    rows.push([`${c} T=${T} +lookup`, score(snaps, (s) => avg(temper(get(c)(s), T), H(s)))]);
  }
  for (const [a, b] of [['tmnf:rem2', 'tmf:rem2'], ['tmnf:rem2', 'tmnf:score']]) for (const T of Ts) rows.push([`[${a} + ${b}] T=${T}`, score(snaps, (s) => avg(temper(get(a)(s), T), temper(get(b)(s), T)))]);
  rows.push(['base:history(lastKind,k)', score(snaps, H)]);
  rows.filter((r) => r[1]).sort((a, b) => a[1].rps - b[1].rps).slice(0, Number(process.env.TOP || 30)).forEach(([n, m]) => console.log(fmt(n, m)));
}

// ── final: the finalists, locked on dev, scored once on the held-out test split ──────────────
function finalists(snaps, all) {
  const res = loadResults(); const B = baselines(snaps, all); const H = B['base:history(lastKind,k)'];
  const cell = (c) => (s) => res[`${c}|${s.sid}`];
  return {
    F: {
      'rawnf:rem2 T=1.25 (full context)': (s) => temper(cell('rawnf:rem2')(s)?.dist, 1.25),
      'tmnfl2c:rem2 T=1.5 (metadata + last 2 comments)': (s) => temper(cell('tmnfl2c:rem2')(s)?.dist, 1.5),
      'tmnf:rem2 T=1.5 (metadata only)': (s) => temper(cell('tmnf:rem2')(s)?.dist, 1.5),
      'tmnf:rem2 T=1.5 + lookup': (s) => avg(temper(cell('tmnf:rem2')(s)?.dist, 1.5), H(s)),
      'lookup history(lastKind,k), no model': H,
      'first attempt rawsess:stage': (s) => cell('rawsess:stage')(s)?.dist,
      'const 50%': B['base:const50'], uniform: B['base:uniform'],
    },
    res,
  };
}
function bootstrap(snaps, fa, fb, R = 4000) {
  const byId = {}; for (const s of snaps) (byId[s.id] ||= []).push(s);
  const ids = Object.keys(byId);
  const rpsOf = (f, s) => rps(f(s), s.truth);
  const diffs = ids.map((id) => byId[id].map((s) => [rpsOf(fa, s), rpsOf(fb, s)]));
  const stat = (sample) => { let a = 0, b = 0, n = 0; for (const rows of sample) for (const [x, y] of rows) { a += x; b += y; n++; } return (a - b) / n; };
  let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const bs = []; for (let r = 0; r < R; r++) bs.push(stat(ids.map(() => diffs[Math.floor(rnd() * ids.length)])));
  bs.sort((x, y) => x - y);
  return { delta: stat(diffs), lo: bs[Math.floor(R * 0.025)], hi: bs[Math.floor(R * 0.975)] };
}
function final() {
  const all = load('snapshots-allk.json'); const snaps = all.filter((s) => s.split === 'test');
  const { F: fs, res } = finalists(snaps, all); const K = Object.keys(fs);
  console.log(`TEST: ${snaps.length} snapshots, ${new Set(snaps.map((s) => s.id)).size} tasks (never used for tuning)`);
  for (const [n, f] of Object.entries(fs)) console.log(fmt(n, score(snaps, f)));
  for (const [a, b] of [[0, 4], [0, 5], [1, 4], [2, 4], [3, 4], [0, 1]]) {
    const r = bootstrap(snaps, fs[K[a]], fs[K[b]]);
    console.log(`ΔRPS ${K[a]} − ${K[b]}: ${r.delta.toFixed(4)}  95% CI [${r.lo.toFixed(4)}, ${r.hi.toFixed(4)}]`);
  }
  for (const c of ['rawnf:rem2', 'tmnfl2c:rem2', 'tmnf:rem2']) {
    const r = snaps.map((s) => res[`${c}|${s.sid}`]).filter(Boolean); const ms = r.map((x) => x.ms).sort((a, b) => a - b);
    console.log(`${c.padEnd(14)} cost/call $${(r.reduce((s, x) => s + x.cost, 0) / r.length).toFixed(6)}  input tok ${Math.round(r.reduce((s, x) => s + x.tok, 0) / r.length)}  latency median ${ms[ms.length >> 1]}ms`);
  }
}

// ── drift: tasks bucketed by the week they closed; norms rolling / frozen (week 1) / oracle ──
const workOf = (costs, id) => costs[id].filter((x) => !DRIVER.has(x.kind)).sort((a, b) => a.dispatchedAt.localeCompare(b.dispatchedAt));
const weekOf = (iso) => `${iso.slice(0, 8)}w${Math.min(4, Math.ceil(+iso.slice(8, 10) / 7.5))}`;
function driftPrep() {
  const S = load('snapshots-allk.json'); const costs = load('costs.json');
  const period = (id) => weekOf(workOf(costs, id).at(-1).dispatchedAt);
  const ids = [...new Set(S.map((s) => s.id))];
  const periods = [...new Set(ids.map(period))].sort();
  const stats = Object.fromEntries(periods.map((p) => [p, computeNorms(ids.filter((id) => period(id) === p).map((id) => workOf(costs, id).map((x) => x.kind)))]));
  for (const p of periods) console.log(p, JSON.stringify(stats[p]));
  const first = periods.find((p) => stats[p].n >= 15);
  for (const s of S) {
    const p = period(s.id), prev = periods.slice(0, periods.indexOf(p)).reverse().find((x) => stats[x].n >= 15);
    s.period = p; s.split = p > first ? 'drift' : 'drift-base';
    s.norms = { roll: prev ? normsText(stats[prev]) : null, frozen: normsText(stats[first]), oracle: normsText(stats[p]), frozenPeriod: first };
  }
  writeFileSync(F('snapshots-drift.json'), JSON.stringify(S));
  console.log(`frozen norms from ${first}; evaluated snapshots (split=drift): ${S.filter((s) => s.split === 'drift').length}`);
}
function driftScores() {
  const ALL = load('snapshots-drift.json'); const EV = ALL.filter((s) => s.split === 'drift');
  const res = loadResults(); const tb = (t) => Math.min(9, Math.floor(t / 10));
  const J = (c) => (s) => temper(res[`${c}|${s.sid}`]?.dist, 1.25);
  const key = (x) => `${x.sessions.at(-1)?.kind}|${Math.min(x.k, 4)}`;
  const lookup = (poolOf) => (s) => { const b = Array(10).fill(0.1); for (const x of poolOf(s)) if (x.id !== s.id && key(x) === key(s)) b[tb(x.truth)] += 1; return toBins(b); };
  const first = EV[0].norms.frozenPeriod;
  const M = {
    'Jev · rolling norms (previous week)': J('rawnfRoll:rem2'),
    'Jev · frozen norms (week 1)': J('rawnfFrozen:rem2'),
    'Jev · oracle norms (own week)': J('rawnfOracle:rem2'),
    'Lookup · rolling (all earlier weeks)': lookup((s) => ALL.filter((x) => x.period < s.period)),
    'Lookup · frozen (week 1 only)': lookup(() => ALL.filter((x) => x.period === first)),
  };
  const out = { pooled: {}, byWeek: {} };
  for (const [n, f] of Object.entries(M)) out.pooled[n] = round(score(EV, f));
  for (const p of [...new Set(EV.map((s) => s.period))].sort()) { const S = EV.filter((s) => s.period === p); out.byWeek[p] = Object.fromEntries(Object.entries(M).map(([n, f]) => [n, round(score(S, f))])); }
  return out;
}
function drift() {
  const out = driftScores();
  console.log('== weeks after week 1, pooled'); for (const [n, m] of Object.entries(out.pooled)) console.log(fmt(n, m));
  for (const [p, rows] of Object.entries(out.byWeek)) { console.log(`\n== ${p}`); for (const [n, m] of Object.entries(rows)) console.log(fmt(n, m)); }
}

// ── summary: the committed metrics record (no task text, no raw answers) ─────────────────────
function summary() {
  const all = load('snapshots-allk.json'); const res = loadResults();
  const table = (snaps, cfgs, T = 1) => Object.fromEntries(cfgs.map((c) => [c, round(score(snaps, (s) => temper(res[`${c}|${s.sid}`]?.dist, T)))]).filter(([, m]) => m && m.n >= snaps.length * 0.9));
  const cfgsSeen = [...new Set(Object.values(res).map((r) => r.cfg))].sort();
  const dev = all.filter((s) => s.split === 'dev'), test = all.filter((s) => s.split === 'test');
  const fixedAll = existsSync(F('snapshots.json')) ? load('snapshots.json') : [];
  const fixed = fixedAll.filter((s) => s.split === 'dev');
  const bl = (snaps, pool = all) => Object.fromEntries(Object.entries(baselines(snaps, pool)).map(([n, f]) => [n, round(score(snaps, f))]));
  const { F: fs } = finalists(test, all);
  const out = {
    ticket: 'LIN-3169', model: 'typesafe/jev-1.13', endpoint: 'https://openrouter.ai/api/alpha/decisions',
    population: { snapshotsEveryBoundary: all.length, dev: { snapshots: dev.length, tasks: new Set(dev.map((s) => s.id)).size }, test: { snapshots: test.length, tasks: new Set(test.map((s) => s.id)).size } },
    metrics: 'rps = ranked probability score over the 10 bands (lower is better); mae/bias = curve mean vs truth, points; rho = Spearman; order = within-task pair ordering; sd = mean curve spread; cover80 = truth band inside the 80% central interval',
    round1a_fixedK_dev: fixed.length ? { baselines: bl(fixed, fixedAll), configs: table(fixed, cfgsSeen) } : null,
    everyBoundary_dev: { baselines: bl(dev), configs: table(dev, cfgsSeen) },
    test_finalists: Object.fromEntries(Object.entries(fs).map(([n, f]) => [n, round(score(test, f))])),
    drift: existsSync(F('snapshots-drift.json')) ? driftScores() : null,
    calls: Object.keys(res).length, spendUsd: +Object.values(res).reduce((s, r) => s + (r.cost || 0), 0).toFixed(2),
  };
  const dir = join(HERE, 'jev-progress-out'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(out, null, 1) + '\n');
  console.log('wrote', join(dir, 'summary.json'), 'configs(dev every-boundary):', Object.keys(out.everyBoundary_dev.configs).length);
}

const cmd = process.argv[2];
({ calibrate, final, 'drift-prep': driftPrep, drift, summary }[cmd] || (() => console.log('usage: jev-progress-analyze.mjs calibrate|final|drift-prep|drift|summary')))();
