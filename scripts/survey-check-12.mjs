// LIN-3195: survey-check-12, the independent check of steady-base-menu.md. Two jobs, no proxy calls:
// 1. --write-selection: a selection naming every ticket in a survey-costmix-tokens.mjs snapshot, so that survey-replay-chores.mjs
//    can be run over the whole fleet rather than over the replay's 13 tickets.
// 2. Given that fleet-wide chores output, where the tracker and remote chores sit (supervisor sessions — autopilot and wake — or
//    the rest), and what that does to the menu's stack arithmetic: v1's stacks as printed, and the corrected stacks of version 2.
// Usage:
//   node scripts/survey-check-12.mjs --costmix <costmix-tokens.json> --write-selection <sel.json>
//   node scripts/survey-replay-chores.mjs --selection <sel.json> --costmix <costmix-tokens.json> --out <chores.json>
//   node scripts/survey-check-12.mjs --chores <chores.json>
import { readFileSync, writeFileSync } from 'fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };

if (arg('--write-selection')) {
  const costmix = JSON.parse(readFileSync(arg('--costmix'), 'utf8'));
  const ids = [...new Set(costmix.sessionRows.map((r) => r.issue).filter(Boolean))].sort();
  writeFileSync(arg('--write-selection'), JSON.stringify({ selected: ids.map((id) => ({ id })) }));
  console.log(`selection: ${ids.length} tickets, ${costmix.sessionRows.length} sessions`);
  process.exit(0);
}

const c = JSON.parse(readFileSync(arg('--chores'), 'utf8'));
const SUPERVISOR = ['autopilot', 'wake'];
const units = (o) => Object.values(o).reduce((p, v) => p + v.units, 0);
const all = units(c.all);
const sup = SUPERVISOR.reduce((p, k) => p + (c.byKind[k] ? units(c.byKind[k]) : 0), 0);
const cls = (k, name) => c.byKind[k]?.[name]?.units || 0;
const pct = (x) => Math.round(1000 * x) / 10;
const chores = ['tracker', 'remote'].map((name) => {
  const fleet = c.all[name]?.units || 0, inSup = SUPERVISOR.reduce((p, k) => p + cls(k, name), 0);
  return { name, fleet: pct(fleet / all), inSupervisorSessions: pct(inSup / all), shareOfClassInSupervisor: pct(inSup / fleet) };
});
const supShare = 100 * sup / all;
const choreIn = chores.reduce((p, x) => p + x.inSupervisorSessions, 0), choreOut = chores.reduce((p, x) => p + x.fleet - x.inSupervisorSessions, 0);
console.log(`sessions ${c.sessions}; supervisor sessions (${SUPERVISOR.join(', ')}) ${pct(sup / all)}% of weighted tokens`);
for (const x of chores) console.log(`${x.name}: ${x.fleet}% of fleet tokens; ${x.inSupervisorSessions} points in supervisor sessions, ${x.shareOfClassInSupervisor}% of the class`);

// M12 (halve tracker and remote chores) as a share of what F1 leaves, if F1 removes f points of fleet tokens out of the supervisor
// sessions and the chores inside them go in proportion. v1 used 10 (low) and 15 (high) whatever F1 removed.
const m12Given = (f) => { const left = choreOut + choreIn * (1 - f / supShare); return 100 * (left / 2) / (100 - f); };
for (const f of [0, 10, 14, 27]) console.log(`M12 given F1 at ${f}%: ${pct(m12Given(f) / 100)}% of what F1 leaves (v1: 10–15)`);

// The stacks. Each factor's multiple is 1 / (1 − share); factors multiply. Credential work held: 1 / (0.097 + 0.903 / m).
const mult = (parts) => parts.reduce((p, s) => p / (1 - s / 100), 1);
const held = (m) => 1 / (0.097 + 0.903 / m);
const r2 = (x) => Math.round(x * 100) / 100;
const show = (name, lo, hi) => console.log(`${name.padEnd(44)} ×${r2(mult(lo))}–${r2(mult(hi))}  credential held ×${r2(held(mult(lo)))}–${r2(held(mult(hi)))}`);
const F4 = [8, 17], F3Q = [4.7, 8];
const F3rest = [3 + 1.5 + 1 + 1 + 0.2, 5 + 2 + 2 + 3 + 1]; // M9, M10, M11, M13, M14 at v1's sizes
console.log('\nv1 as printed (F1 10–14 in S1, 14–27 from S2; F2 2–6; M12 10–15; F4 8–17):');
show('S1', [10, 2, F3Q[0]], [14, 6, F3Q[1]]);
show('S4', [14, 2, F3rest[0] + 10, F4[0]], [27, 6, F3rest[1] + 15, F4[1]]);

// Version 2: F1 by class 10% (14% needs code to know quiet wakes in advance); F2 2–4 (M8's upper end unsized); M11 at most 1.7;
// M13 5.2% × 0.4–0.8; M14 0–1; M12 from the chores split given F1; M17 at survey-check-9's 1.23×.
const F2v2 = [2, 4], F4v2 = [8, 18.7], F3Qv2 = [3 + 1.5 + 0, 5 + 2 + 1];
const F3v2 = (f, end) => (end ? 5 + 2 + 1.7 + 4.2 + 1 : 3 + 1.5 + 1 + 2.1 + 0) + m12Given(f);
console.log('\nversion 2:');
show('S1  F1 10', [10, F2v2[0], F3Qv2[0]], [10, F2v2[1], F3Qv2[1]]);
show('S2  F1 10–27', [10, F2v2[0], F3Qv2[0]], [27, F2v2[1], F3Qv2[1]]);
show('S3  F1 10–27', [10, F2v2[0], F3Qv2[0], F4v2[0]], [27, F2v2[1], F3Qv2[1], F4v2[1]]);
show('S4  F1 10–27', [10, F2v2[0], F3v2(10, 0), F4v2[0]], [27, F2v2[1], F3v2(27, 1), F4v2[1]]);
show('S4  F1 top at the blind recode, 30', [10, F2v2[0], F3v2(10, 0), F4v2[0]], [30, F2v2[1], F3v2(30, 1), F4v2[1]]);
const gm = (lo, hi) => r2(Math.sqrt(mult(lo) * mult(hi)));
const f3mid = (3 + 1.5 + 1 + 2.1 + 0 + 5 + 2 + 1.7 + 4.2 + 1) / 2 + m12Given(18.5);
console.log(`S4 geometric middle of its ends: ×${gm([10, 2, F3v2(10, 0), 8], [27, 4, F3v2(27, 1), 18.7])}; every member at its range's midpoint: ×${r2(mult([18.5, 3, f3mid, 13.35]))}`);
