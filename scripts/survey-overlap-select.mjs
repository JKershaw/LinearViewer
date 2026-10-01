// LIN-3179: choose which tickets to fetch: the four-step census (research, plan, plan-review and implementation sessions on disk), the tickets with coded real review faults or real plan-review finds, a trend sample of Done tickets by start half-month since 20 June, and split parents with their children; writes the id list and the strata.
// Usage: node scripts/survey-overlap-select.mjs [--per-bin 10] [--out data/survey-overlap/select.json]
// Needs data/survey-overlap/transcripts.json, data/survey-overlap/proxy.json (with --list) and data/survey-doubling/runner.json.
// The trend sample is systematic: within each half-month (by the ticket's first fresh session in the runner log), Done tickets
// with at least one fresh session, sorted by number, every k-th from the first, k chosen to give --per-bin.
import { readFileSync, writeFileSync } from 'fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const perBin = +arg('--per-bin', 10);
const out = arg('--out', 'data/survey-overlap/select.json');
const J = (p) => JSON.parse(readFileSync(p, 'utf8'));
const tx = J('data/survey-overlap/transcripts.json').sessions;
const proxy = J('data/survey-overlap/proxy.json');
const runner = J('data/survey-doubling/runner.json').rows;
const state = new Map(proxy.list.map((t) => [t.identifier, t]));
const num = (id) => +id.split('-')[1];

// 1. Census: a fresh session of each of the four kinds on the ticket, by the session's first task.
const kinds = new Map();
for (const s of tx) { const k = s.tasks[0]?.kind || s.header; const i = s.tasks[0]?.issue || s.headerIssue; if (!i) continue; (kinds.get(i) || kinds.set(i, new Set()).get(i)).add(k); }
const four = ['research', 'plan', 'plan-review', 'implementation'];
const census = [...kinds].filter(([, ks]) => four.every((k) => ks.has(k))).map(([i]) => i).sort((a, b) => num(a) - num(b));

// 2. Value: tickets with a coded real fault (which-rules-pay) or a real new plan-review find (why-legs-repeat, survey-check-6).
const rules = J('docs/papers/harbour/which-rules-pay-codes.json').tickets.filter((t) => t.consequences.some((c) => c.realFault)).map((t) => t.id);
const prFinds = [...J('docs/papers/harbour/why-legs-repeat-codes.json').final, ...J('docs/papers/harbour/survey-check-6-codes.json').final]
  .filter((r) => r.kind === 'plan-review' && r.real === 'yes').map((r) => r.issue);

// 3. Trend: half-month bins by first fresh session.
const firstFresh = new Map(); const freshN = new Map();
for (const r of runner) if (r.shape === 'fresh' && r.issue) { if (!firstFresh.has(r.issue) || r.at < firstFresh.get(r.issue)) firstFresh.set(r.issue, r.at); freshN.set(r.issue, (freshN.get(r.issue) || 0) + 1); }
const bin = (at) => `${at.slice(0, 7)}-${+at.slice(8, 10) <= 15 ? 'a' : 'b'}`;
const bins = {};
for (const [i, at] of firstFresh) if (state.get(i)?.state === 'Done' && freshN.get(i) >= 1 && at >= '2026-06-20') (bins[bin(at)] ||= []).push(i);
const trend = {};
for (const [b, ids] of Object.entries(bins).sort()) { ids.sort((x, y) => num(x) - num(y)); const k = Math.max(1, Math.floor(ids.length / perBin)); trend[b] = { eligible: ids.length, every: k, ids: ids.filter((_, j) => j % k === 0).slice(0, perBin) }; }

// 4. Splitting: parents whose children include at least two with a research or plan session on disk.
const planned = new Set(tx.filter((s) => ['research', 'plan'].includes(s.tasks[0]?.kind || s.header)).map((s) => s.tasks[0]?.issue || s.headerIssue));
const kids = {};
for (const t of proxy.list) if (t.parent && planned.has(t.identifier)) (kids[t.parent] ||= []).push(t.identifier);
// The eight parents with the most such children, and the three lowest-numbered children of each (the proxy's pace bounds the fetch).
const split = Object.fromEntries(Object.entries(kids).filter(([, c]) => c.length >= 2).sort((a, b) => b[1].length - a[1].length || num(a[0]) - num(b[0])).slice(0, 8).map(([p, c]) => [p, c.sort((a, b) => num(a) - num(b)).slice(0, 3)]));

const want = [...new Set([...census, ...rules, ...prFinds, ...Object.values(trend).flatMap((t) => t.ids), ...Object.keys(split), ...Object.values(split).flat()])];
writeFileSync(out, JSON.stringify({ census, rules, prFinds: [...new Set(prFinds)], trend, split, want }, null, 1));
writeFileSync('data/survey-overlap/want.json', JSON.stringify(want));
console.log(`census=${census.length} rules=${rules.length} prFinds=${new Set(prFinds).size} trend=${Object.values(trend).reduce((a, t) => a + t.ids.length, 0)} (${Object.entries(trend).map(([b, t]) => `${b}:${t.ids.length}/${t.eligible}`).join(' ')}) splitParents=${Object.keys(split).length} splitKids=${Object.values(split).flat().length} want=${want.length} cached=${want.filter((w) => w in proxy.details).length}`);
