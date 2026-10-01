// LIN-3185 (survey-check-9): the check's own figures for how-process-changes-land.md — what-doubled v2's count like for like, follow-up ages, clustered holdout hours, the add:remove interval. No proxy calls.
// Usage: node scripts/survey-check-9-landing.mjs (run survey-doubling-runner.mjs, survey-scorecard.mjs and survey-landing-halfdone.mjs first)
import { readFileSync } from 'fs';

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const runner = read('data/survey-doubling/runner.json');
const card = read('data/survey/scorecard.json');
const tracker = read('data/survey/reliability-tracker.json');
const halfdone = read('data/survey/landing-halfdone.json'); // written by survey-landing-halfdone.mjs from the tracker snapshot
const r1 = (x) => Math.round(x * 10) / 10;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// (a) what-doubled-the-dispatches.md v2's count, like for like: code changes (prodLines > 0) whose last merge falls 14–28 Sep
// inclusive (UTC date), every claimed dispatch (fresh, warm, cold) naming any of them, over the correct, complete ones.
// Child named: the item's own ticket (its Issue line, else its follow-up root's, as survey-doubling-runner.mjs sets it).
// Session entered: the ticket of the first fresh launch with a ticket in the item's session (survey-landing-charge.mjs's rule),
// falling back to the child-named ticket when the session has none.
const items = runner.rows.filter((r) => ['fresh', 'warm', 'cold'].includes(r.shape));
const sessionTicket = new Map();
for (const it of items) if (it.shape === 'fresh' && it.session && it.issue && !sessionTicket.has(it.session)) sessionTicket.set(it.session, it.issue);
const inWindow = card.changes.filter((c) => c.lastMerge && c.lastMerge.slice(0, 10) >= '2026-09-14' && c.lastMerge.slice(0, 10) <= '2026-09-28' && c.prodLines > 0);
const ids = new Set(inWindow.map((c) => c.id));
const good = inWindow.filter((c) => c.good).length;
let child = 0; let session = 0;
for (const it of items) {
  if (ids.has(it.issue)) child++;
  if (ids.has((it.session && sessionTicket.get(it.session)) || it.issue)) session++;
}
console.log(`(a) 14–28 Sep code changes (prodLines > 0, last merge 14–28 Sep UTC; ${inWindow.length} merged, ${good} correct, complete): dispatches per correct change by child named ${r1(child / good)}, by session entered ${r1(session / good)} (what-doubled v2: 47.1 and 36.3)`);

// (b) Open process follow-ups' ages, as survey-landing-halfdone.mjs records them (204 of 214 interpolated from ticket numbers).
const ages = (cls) => halfdone.followUps.filter((f) => !cls || f.class === cls).map((f) => f.ageDays);
const fu = ages('follow-up'); const rr = ages('review-residue'); const all = ages();
console.log(`(b) median age in days to ${halfdone.at || '2026-10-01'}: follow-ups ${median(fu)} (n=${fu.length}), review residue ${median(rr)} (n=${rr.length}), pooled ${median(all)} (n=${all.length})`);

// (c) Holdout by ticket, working hours per change, 4 weeks: survey-landing-trials.mjs's mdc, perWeek and cluster size m.
const mdc = (sd, n) => Math.round(Math.exp(2.8 * sd * Math.sqrt(2 / n)) * 100) / 100;
const timed = card.changes.filter((c) => c.good && c.dispatches != null && c.lastMerge >= '2026-07-13' && c.lastMerge < '2026-09-28');
const perWeek = timed.length / 11;
const parentOf = new Map(tracker.list.filter((t) => t.parent).map((t) => [t.identifier, t.parent]));
const topOf = (id) => { let x = id; const seen = new Set(); while (parentOf.has(x) && !seen.has(x)) { seen.add(x); x = parentOf.get(x); } return x; };
const clusters = new Map();
for (const c of timed) { const t = topOf(c.id); clusters.set(t, (clusters.get(t) || 0) + 1); }
const sizes = [...clusters.values()];
const m = sizes.reduce((a, n) => a + n * n, 0) / sizes.reduce((a, n) => a + n, 0);
const sdH = card.sens.perChangeWorkH.sdLog;
const nArm = (perWeek * 4) / 2;
const deff = (rho) => 1 + (m - 1) * rho;
console.log(`(c) holdout, working hours per change, 4 weeks (sdLog ${sdH}, ${r1(nArm)} changes an arm, m ${r1(m)}): plain ×${mdc(sdH, nArm)}, ρ=0.1 ×${mdc(sdH, nArm / deff(0.1))}, ρ=0.3 ×${mdc(sdH, nArm / deff(0.3))}`);

// (d) First reader's add:remove ratio (25 of 80 added something, 4 removed something), bounds from the two Wilson 95% intervals.
const wilson = (k, n, z = 1.96) => { const p = k / n; const d = 1 + (z * z) / n; const c = p + (z * z) / (2 * n); const h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n)); return [(c - h) / d, (c + h) / d]; };
const [aLo, aHi] = wilson(25, 80); const [rLo, rHi] = wilson(4, 80);
console.log(`(d) add:remove 25:4 = ${r1(25 / 4)}:1; adds ${r1(100 * aLo)}–${r1(100 * aHi)}%, removes ${r1(100 * rLo)}–${r1(100 * rHi)}% (Wilson 95%); ratio bounds ${r1(aLo / rHi)}:1 to ${r1(aHi / rLo)}:1 (conservative: low adds over high removes, and the reverse)`);
