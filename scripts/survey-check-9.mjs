// LIN-3185 (survey-check-9): the check's own figures for cost-mix.md — escapes on reliability-baseline v2's terms, the mid tier at its list ratio, the meter conversion, the fleet class's feature work, the options re-sized, and the small-change catch odds. No proxy calls.
// Usage: node scripts/survey-check-9.mjs [--projects ~/.claude/projects]
// Run cost-mix's own scripts first (its Method): reads data/survey-costmix/{classes,tokens,analysis}.json, data/survey/reliability-tracker.json and the
// committed codes. The transcript pass repeats survey-costmix-tokens.mjs's September window, weights and message-id dedupe, by model.
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const classes = read('data/survey-costmix/classes.json');
const tokens = read('data/survey-costmix/tokens.json');
const analysis = read('data/survey-costmix/analysis.json');
const tracker = read('data/survey/reliability-tracker.json');
const verdicts = read('docs/papers/harbour/reliability-baseline-defects.json').verdicts;
const readings = read('docs/papers/harbour/survey-check-readings.json');
const r1 = (x) => Math.round(x * 10) / 10;
const pc = (x) => `${r1(100 * x)}%`;
const wilson = (k, n) => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [p, Math.max(0, (c - m) / d), (c + m) / d]; };
const fmtW = (k, n) => { const [p, lo, hi] = wilson(k, n); return `${k}/${n} ${pc(p)} (${r1(100 * lo)}–${r1(100 * hi)})`; };
const amdahl = (held, f) => 1 / (held + (1 - held) / f);

// ---- 1. Escapes on reliability-baseline v2's terms: no residue (labelled or found by its text), no finder rows -------------------
const unlabelled = new Set(Object.values(readings.unlabelledResidue.tickets).flat());
const finder = new Set([...readings.finderRows.droppedByLagFilter, ...readings.finderRows.keptInVersion1]);
const mature = classes.rows.filter((r) => r.month >= '2026-06' && r.month <= '2026-08');
const ids = new Set(mature.map((r) => r.id));
const named = verdicts.filter((v) => v.verdict === 'escaped' && v.introducedBy && ids.has(v.introducedBy));
const clean = named.filter((v) => !v.residueLabel && !unlabelled.has(v.identifier) && !finder.has(v.identifier));
console.log(`1. Escaped Bugs naming a change merged Jun–Aug: ${named.length} as cost-mix counts them; ${clean.length} without residue and finder rows`);
const escTable = (key, keys) => { for (const k of keys) { const pop = mature.filter((r) => r[key] === k); const s = new Set(pop.map((r) => r.id)); const n1 = new Set(named.filter((v) => s.has(v.introducedBy)).map((v) => v.introducedBy)).size; const n2 = new Set(clean.filter((v) => s.has(v.introducedBy)).map((v) => v.introducedBy)).size; console.log(`   ${String(k).padEnd(18)} cost-mix ${fmtW(n1, pop.length).padEnd(24)} v2 terms ${fmtW(n2, pop.length)}`); } };
escTable('cls', ['credentials/auth', 'fleet machinery', 'simple-dispatcher', 'UI', 'other', 'docs/tests only']);
escTable('band', ['0', '1-49', '50-299', '300+']);

// ---- 2. September's units by model, and the mid tier at its list ratio (0.4 of the frontier tier's input price, not 0.6) -----------
const root = arg('--projects', join(homedir(), '.claude', 'projects'));
const since = Date.parse('2026-09-01T00:00:00Z'), until = Date.parse('2026-10-01T00:00:00Z');
const base = {}; const seen = new Set();
const scan = (p) => { for (const line of readFileSync(p, 'utf8').split('\n')) { if (!line.includes('"usage"')) continue; let j; try { j = JSON.parse(line); } catch { continue; }
  const m = j.message; if (!m?.usage || !m.id || seen.has(m.id)) continue; const t = Date.parse(j.timestamp); if (!(t >= since && t < until)) continue; seen.add(m.id);
  const u = m.usage; const c1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0; const c5 = (u.cache_creation_input_tokens || 0) - c1;
  const tier = /opus|fable/i.test(m.model) ? 'frontier' : /sonnet/i.test(m.model) ? 'mid' : /haiku/i.test(m.model) ? 'small' : 'other';
  base[tier] = (base[tier] || 0) + (u.input_tokens || 0) + 5 * (u.output_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0) + 2 * c1 + 1.25 * c5; } };
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); const s = statSync(p); if (s.isDirectory()) walk(p); else if (f.endsWith('.jsonl') && s.mtimeMs >= since) scan(p); } };
for (const d of readdirSync(root)) if (d.includes('simple-dispatcher-workspaces')) walk(join(root, d));
const asWeighted = (base.frontier || 0) + 0.6 * (base.mid || 0) + 0.2 * (base.small || 0);
const atList = (base.frontier || 0) + 0.4 * (base.mid || 0) + 0.2 * (base.small || 0);
console.log(`\n2. September fleet units: ${r1(asWeighted / 1e6)}M as weighted (mid tier ×0.6), ${r1(atList / 1e6)}M at list ratios (mid ×0.4); mid tier is ${pc(0.6 * (base.mid || 0) / asWeighted)} of the weighted total`);

// ---- 3. The meter: one weekly allowance in units, and September's fleet in allowances ------------------------------------------
const lo = 1070.58 / 0.27 / 5, hiPaper = 1070.58 / (1 - 0.182) / 0.27 / 5, hi = 1070.58 * 1.182 / 0.27 / 5;
const perWeek = (u) => u / 30 * 7;
console.log(`\n3. One allowance: ${r1(lo)}M uncorrected; ${r1(hi)}M with LIN-2113's +18.2% as a markup (cost-mix divides by 0.818: ${r1(hiPaper)}M)`);
console.log(`   September a week: ${r1(perWeek(asWeighted) / 1e6)}M weighted → ${(perWeek(asWeighted) / 1e6 / hi).toFixed(2)}–${(perWeek(asWeighted) / 1e6 / lo).toFixed(2)} allowances; ${r1(perWeek(atList) / 1e6)}M at list ratios → ${(perWeek(atList) / 1e6 / hi).toFixed(2)}–${(perWeek(atList) / 1e6 / lo).toFixed(2)}`);
console.log(`   Per correct change at list ratios: ${r1(atList / 1e6 / analysis.native.sepGood)}M (cost-mix ${analysis.native.unitsPerGoodM}M)`);

// ---- 4. What the fleet-machinery class holds: feature work its path rule sweeps in --------------------------------------------
const title = Object.fromEntries(tracker.list.map((i) => [i.identifier, i.title || '']));
// A title rule, then read by hand: three matches that are process or fleet work stay in the class (CLAUDE.md shrink, a ruling on scope, an observer pass).
const FEATURE = /ruling|flight companion|companion|scan-due|rung-two|self-resolved|first screen/i;
const NOT_FEATURE = new Set(['LIN-2896', 'LIN-2825', 'LIN-2645']);
const fleet = classes.rows.filter((r) => r.cls === 'fleet machinery' && tokens.byChild[r.id]);
const feat = fleet.filter((r) => FEATURE.test(title[r.id]) && !NOT_FEATURE.has(r.id));
const total = analysis.tokTotalM * 1e6;
const featShare = feat.reduce((a, r) => a + tokens.byChild[r.id], 0) / total;
const G = analysis.gShare;
const credShare = G.credentials;
const fleetShare = analysis.mixRows.find((r) => r.bucket === 'fleet machinery').tokSepChild / 100;
console.log(`\n4. Fleet machinery: ${fleet.length} tickets with September spend; ${feat.length} titled as rulings, Flight Companion, scan-due or similar feature work = ${pc(featShare)} of the budget (of the class's ${pc(fleetShare)})`);
console.log(`   ${feat.sort((a, b) => tokens.byChild[b.id] - tokens.byChild[a.id]).map((r) => `${r.id} ${r1(tokens.byChild[r.id] / 1e6)}M`).join(', ')}`);
const heldNarrow = credShare + fleetShare - featShare;
console.log(`   Credentials and fleet held: ceiling ${r1(1 / (credShare + fleetShare))} as printed; ${r1(1 / heldNarrow)} with that feature work cut too (held ${pc(heldNarrow)}); at ×3 ${amdahl(credShare + fleetShare, 3).toFixed(2)} → ${amdahl(heldNarrow, 3).toFixed(2)}`);

// ---- 5. The options, re-sized on the spend each one touches ---------------------------------------------------------------------
const changesNotHeld = G['0-49'] + G['50-299'];
console.log(`\n5. Groups (child rule): ${Object.entries(G).map(([k, v]) => `${k} ${pc(v)}`).join(', ')}`);
console.log(`   Option 4 as printed (everything but credentials and 300+ halves): ${(1 / (G.credentials + G['300+'] + (1 - G.credentials - G['300+']) / 2)).toFixed(2)}×`);
console.log(`   Option 4 on changes only (0–299-line changes halve; papers, parents, no-change spend held): ${(1 / (1 - changesNotHeld / 2)).toFixed(2)}×`);
console.log(`   Options 1–4 combined, the paper's example: ${(1 / ((G.credentials + G['300+']) * 0.75 + (1 - G.credentials - G['300+']) / 2)).toFixed(2)}×; with option 1 at a third: ${(1 / ((G.credentials + G['300+']) * 0.75 + G['0-49'] / 3 + (1 - G.credentials - G['300+'] - G['0-49']) / 2)).toFixed(2)}×`);

// ---- 6. Small changes: the odds of no catch in 23, at the backtest's census rates ---------------------------------------------
for (const [label, k, n] of [['M3 light (small, low-risk)', 8, 328], ['M1/M2 light (docs and tests only)', 5, 140], ['M4 light (small by size)', 10, 468]]) console.log(`${label === 'M3 light (small, low-risk)' ? '\n6. ' : '   '}${label}: a catch on ${k} of ${n}; P(no catch in 23) = ${((1 - k / n) ** 23).toFixed(2)}`);

// ---- 7. The fixed part: floor share on code changes only, and the linear fit's intercept share ---------------------------------
const fit = analysis.linFit;
console.log(`\n7. Fixed part: floor share ${analysis.floorShare}% of the 120 standalone changes (cost-mix); linear fit on ${fit.n} code changes: intercept ${fit.interceptM}M of a ${fit.meanM}M mean = ${pc(fit.interceptM / fit.meanM)}`);
