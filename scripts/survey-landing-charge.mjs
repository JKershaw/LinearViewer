// LIN-3182: what each wake-charging rule (child named, session entered, lineage spread, pooled) does to dispatches per correct change, by block and repo, and how noisy each rule's per-change series is.
// Usage: node scripts/survey-landing-charge.mjs [--runner data/survey-doubling/runner.json] [--scorecard data/survey/scorecard.json] [--tracker data/survey/reliability-tracker.json] [--out data/survey/landing-charge.json]
// Reads three git-ignored snapshots: survey-doubling-runner.mjs's per-item census of the runner's logs, survey-scorecard.mjs's changes and
// weekly rows, and survey-reliability-tracker.mjs's ticket list (for parent links). No proxy calls. Rules, for every dispatch the runner
// claimed (fresh session, warm follow-up or cold resume):
//   child   — the ticket on the item's own Issue line, else its follow-up chain's root (the log's line; from 13 Sep a wake names the child that woke it).
//   session — the ticket of the fresh launch that opened the session the item entered (follow-ups inherit it; fresh items are their own).
//   lineage — the session's ticket if it is a correct, complete change; otherwise split equally over the correct, complete changes beneath it in the tracker's parent tree.
//   pooled  — no charging: all fleet dispatches in a change's merge week over that week's correct, complete changes (the scorecard's headline).
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const runner = JSON.parse(readFileSync(arg('--runner', 'data/survey-doubling/runner.json'), 'utf8'));
const card = JSON.parse(readFileSync(arg('--scorecard', 'data/survey/scorecard.json'), 'utf8'));
const tracker = JSON.parse(readFileSync(arg('--tracker', 'data/survey/reliability-tracker.json'), 'utf8'));
const out = arg('--out', 'data/survey/landing-charge.json');

const DISPATCH = new Set(['fresh', 'warm', 'cold']);
const items = runner.rows.filter((r) => DISPATCH.has(r.shape));
const BLOCKS = [
  ['13 Jul – 9 Aug', '2026-07-13', '2026-08-09'],
  ['10 Aug – 12 Sep', '2026-08-10', '2026-09-12'],
  ['13 – 30 Sep', '2026-09-13', '2026-09-30'],
];
const blockOf = (day) => BLOCKS.find(([, a, b]) => day >= a && day <= b)?.[0] || null;

// Correct, complete changes with a merge in the runner's continuous census (13 July on).
const good = card.changes.filter((c) => c.good && c.lastMerge && c.lastMerge.slice(0, 10) >= '2026-07-13');
const goodIds = new Set(good.map((c) => c.id));
const mergedIds = new Set(card.changes.filter((c) => c.lastMerge).map((c) => c.id));

// Session → the ticket of its fresh launch.
const sessionTicket = new Map();
for (const it of items) if (it.shape === 'fresh' && it.session && it.issue && !sessionTicket.has(it.session)) sessionTicket.set(it.session, it.issue);

// Parent tree: ticket → correct, complete changes at or beneath it.
const children = new Map();
for (const t of tracker.list) if (t.parent) { if (!children.has(t.parent)) children.set(t.parent, []); children.get(t.parent).push(t.identifier); }
const beneathMemo = new Map();
const beneath = (id, seen = new Set()) => {
  if (beneathMemo.has(id)) return beneathMemo.get(id);
  if (seen.has(id)) return [];
  seen.add(id);
  const acc = goodIds.has(id) ? [id] : [];
  for (const k of children.get(id) || []) acc.push(...beneath(k, seen));
  const r = [...new Set(acc)];
  beneathMemo.set(id, r);
  return r;
};

const charged = { child: new Map(), session: new Map(), lineage: new Map() };
const chargedMerged = { child: new Map(), session: new Map() };
const wakes = { child: new Map(), session: new Map(), lineage: new Map() };
const add = (m, id, w) => m.set(id, (m.get(id) || 0) + w);
const unchargedByBlock = {};
let differ = 0; let differFrom13Sep = 0; let followUps = 0;
for (const it of items) {
  const isWake = it.shape !== 'fresh';
  const child = it.issue || null;
  const session = (it.session && sessionTicket.get(it.session)) || child;
  if (isWake) { followUps++; if (child !== session) { differ++; if (it.at >= '2026-09-13') differFrom13Sep++; } }
  for (const [rule, t] of [['child', child], ['session', session]]) {
    if (t && goodIds.has(t)) { add(charged[rule], t, 1); if (isWake) add(wakes[rule], t, 1); }
    if (t && mergedIds.has(t)) add(chargedMerged[rule], t, 1);
  }
  const under = session ? beneath(session) : [];
  for (const g of under) { add(charged.lineage, g, 1 / under.length); if (isWake) add(wakes.lineage, g, 1 / under.length); }
}

// Fleet dispatches per week (the scorecard's rows) for the pooled rule.
const weekRow = new Map(card.rows.map((r) => [r.week, r]));
const monday = (iso) => { const d = new Date(iso.slice(0, 10) + 'T00:00:00Z'); const k = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - k); return d.toISOString().slice(0, 10); };

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const sdLog = (a) => { const l = a.filter((x) => x > 0).map(Math.log); const m = mean(l); return l.length > 1 ? Math.sqrt(l.reduce((s, x) => s + (x - m) ** 2, 0) / (l.length - 1)) : null; };
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

const table = [];
for (const [name] of BLOCKS) {
  for (const repo of ['both', 'LinearViewer', 'simple-dispatcher']) {
    const cs = good.filter((c) => blockOf(c.lastMerge.slice(0, 10)) === name && (repo === 'both' || c.repos.includes(repo)));
    if (!cs.length) continue;
    const row = { block: name, repo, changes: cs.length };
    for (const rule of ['child', 'session', 'lineage']) {
      const v = cs.map((c) => charged[rule].get(c.id) || 0);
      const w = cs.map((c) => wakes[rule].get(c.id) || 0);
      row[rule] = { mean: r1(mean(v)), median: r1(median(v)), wakesMean: r1(mean(w)), sdLog: r2(sdLog(v)), zero: v.filter((x) => x === 0).length };
    }
    // what-doubled-the-dispatches.md's ratio: dispatches naming every change merged in the block, over the correct, complete ones.
    const all = card.changes.filter((c) => c.lastMerge && blockOf(c.lastMerge.slice(0, 10)) === name && (repo === 'both' || c.repos.includes(repo)));
    row.ratio = Object.fromEntries(['child', 'session'].map((rule) => [rule, r1(all.reduce((s, c) => s + (chargedMerged[rule].get(c.id) || 0), 0) / cs.length)]));
    // Pooled: each week's fleet dispatches over that week's correct, complete changes, weighted by the changes in the block.
    if (repo === 'both') {
      const weeks = [...new Set(cs.map((c) => monday(c.lastMerge)))].sort();
      const fleet = weeks.reduce((s, w) => s + (weekRow.get(w)?.fleetDispatches || 0), 0);
      const goodW = weeks.reduce((s, w) => s + (weekRow.get(w)?.good || 0), 0);
      const hours = weeks.reduce((s, w) => s + (weekRow.get(w)?.fleetWorkH || 0), 0);
      row.pooled = { weeks: weeks.length, perChange: r1(fleet / goodW), hoursPerChange: r1(hours / goodW) };
    }
    table.push(row);
  }
}

// Share of all claimed dispatches each rule charges to some correct, complete change at all (the rest is overhead under that rule).
const coverage = {};
const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
for (const [name, a, b] of BLOCKS) {
  const inBlock = items.filter((it) => it.at.slice(0, 10) >= a && it.at.slice(0, 10) <= b);
  const n = inBlock.length;
  const cov = { dispatches: n };
  for (const rule of ['child', 'session']) {
    cov[rule] = r1((100 * inBlock.filter((it) => { const t = rule === 'child' ? it.issue : (it.session && sessionTicket.get(it.session)) || it.issue; return t && goodIds.has(t); }).length) / n);
  }
  cov.lineage = r1((100 * inBlock.filter((it) => { const s = (it.session && sessionTicket.get(it.session)) || it.issue; return s && beneath(s).length; }).length) / n);
  coverage[name] = cov;
}

const result = {
  generatedAt: new Date().toISOString(), runnerGeneratedAt: runner.generatedAt, scorecardCut: card.cut, scorecardHeads: card.heads,
  items: items.length, followUps, followUpsWhoseRulesDiffer: differ, ofThemFrom13Sep: differFrom13Sep,
  totals: Object.fromEntries(['child', 'session', 'lineage'].map((r) => [r, Math.round(sum(charged[r]))])),
  table, coverage,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 1));

console.log(`claimed dispatches ${items.length}; follow-ups ${followUps}; follow-ups the child and session rules charge differently ${differ} (${differFrom13Sep} from 13 Sep)`);
console.log('dispatches charged to correct, complete changes, all blocks:', result.totals);
console.log('\nPer correct, complete change (mean / median; wakes mean; sd of log; changes charged nothing)');
for (const r of table) {
  const f = (x) => `${x.mean} / ${x.median}; wakes ${x.wakesMean}; sdLog ${x.sdLog}; zero ${x.zero}`;
  console.log(`${r.block.padEnd(16)} ${r.repo.padEnd(17)} n=${String(r.changes).padStart(3)} | child ${f(r.child)} | session ${f(r.session)} | lineage ${f(r.lineage)} | ratio child ${r.ratio.child} session ${r.ratio.session}${r.pooled ? ` | pooled ${r.pooled.perChange} dispatches, ${r.pooled.hoursPerChange} h over ${r.pooled.weeks} weeks` : ''}`);
}
console.log('\nShare of claimed dispatches charged to any correct, complete change (%):');
for (const [k, v] of Object.entries(coverage)) console.log(`${k.padEnd(16)} n=${v.dispatches} child ${v.child}% session ${v.session}% lineage ${v.lineage}% pooled 100%`);
