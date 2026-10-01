// LIN-3189: joins the replay's cost, test runs, hand codes and blind judgements into the per-ticket verdicts and every table in replay-small-work.md.
// Usage: node scripts/survey-replay-analyse.mjs --subagents <replay session's subagents dir> [--cost data/survey-replay/cost.json] [--tests data/survey-replay/tests.json] [--out data/survey-replay/analysis.json]
// Run after survey-replay-cost.mjs and survey-replay-tests.mjs. Blind judgements, review verdicts and close-out lines are read from the
// subagents' own last messages, by their "[replay LIN-n role]" tag. A/B unblinding follows the pre-registration: the original is A
// when the ticket number is odd. The correctness verdict is the pre-registered rule: the blind judgement, overridden to "worse" when
// a shipped test fails on behaviour or the replay ships the known fault its own review did not stop. Codes come from
// docs/papers/harbour/replay-small-work-codes.json. No proxy calls.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const subDir = arg('--subagents');
if (!subDir) throw new Error('--subagents is required');
const cost = JSON.parse(readFileSync(arg('--cost', 'data/survey-replay/cost.json'), 'utf8'));
const tests = JSON.parse(readFileSync(arg('--tests', 'data/survey-replay/tests.json'), 'utf8'));
const codes = JSON.parse(readFileSync('docs/papers/harbour/replay-small-work-codes.json', 'utf8')).codes;
const out = arg('--out', 'data/survey-replay/analysis.json');

// Last assistant text per tagged subagent.
const last = new Map();
for (const f of readdirSync(subDir).filter((x) => x.endsWith('.jsonl'))) {
  const lines = readFileSync(join(subDir, f), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const first = lines.find((e) => e.type === 'user'); const c = first?.message?.content;
  const m = (typeof c === 'string' ? c : (c || []).map((x) => x.text || '').join('')).match(/^\[replay (LIN-\d+) (implementer|reviewer|close-out|blind2?)\]/);
  if (!m) continue;
  let t = '';
  for (const e of lines) if (e.type === 'assistant') { const tx = (e.message.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('\n'); if (tx.trim()) t = tx; }
  // A stopped read leaves no closing line; prefer the transcript whose last message carries one.
  const key = `${m[1]} ${m[2]}`;
  if (!last.has(key) || /JUDGEMENT:|VERDICT:|CLOSE-OUT:/.test(t)) last.set(key, t);
}

const sum = (run) => run.files.reduce((a, f) => ({ pass: a.pass + (f.pass || 0), fail: a.fail + (f.fail || 0) }), { pass: 0, fail: 0 });
const rows = cost.rows.map((c) => {
  const id = c.id, code = codes[id], t = tests.rows.find((r) => r.id === id);
  const originalIsA = +id.slice(4) % 2 === 1;
  const j = (last.get(`${id} blind`) || '').match(/JUDGEMENT:\s*(A BETTER|B BETTER|EQUIVALENT)/)?.[1] ?? null;
  const blind = !j ? null : j === 'EQUIVALENT' ? 'equivalent' : (j === 'A BETTER') === originalIsA ? 'worse' : 'better';
  // Added after pre-registration: the same read with A and B swapped (original is A when the number is even). Not used in the verdict.
  const j2 = (last.get(`${id} blind2`) || '').match(/JUDGEMENT:\s*(A BETTER|B BETTER|EQUIVALENT)/)?.[1] ?? null;
  const blind2 = !j2 ? null : j2 === 'EQUIVALENT' ? 'equivalent' : (j2 === 'A BETTER') === !originalIsA ? 'worse' : 'better';
  const posA = [j && (j === 'A BETTER' ? 'A' : j === 'B BETTER' ? 'B' : '='), j2 && (j2 === 'A BETTER' ? 'A' : j2 === 'B BETTER' ? 'B' : '=')];
  const review = (last.get(`${id} reviewer`) || '').match(/VERDICT:\s*(APPROVE|REQUEST CHANGES)/)?.[1] ?? null;
  const closeout = (last.get(`${id} close-out`) || '').match(/CLOSE-OUT:\s*(READY|NOT READY)/)?.[1] ?? null;
  const shipped = { original: sum(t.shippedOnOriginal), replay: sum(t.shippedOnReplay), files: t.shippedTests.length, unitFiles: t.shippedOnOriginal.files.length };
  const fix = t.fix ? { sha: t.fix.sha, original: sum(t.fix.onOriginal), fix: sum(t.fix.onFix), replay: sum(t.fix.onReplay), unitFiles: t.fix.onFix.files.length } : null;
  const overrides = [];
  if (code.shippedFailClass === 'behaviour') overrides.push('shipped test fails on behaviour');
  if (code.knownFault === 'same') overrides.push('ships the known fault');
  const verdict = overrides.length ? 'worse' : blind;
  return { id, repo: c.repo, stratum: c.stratum, blind, blind2, positions: posA, review, closeout, verdict, overrides, shipped, fix, ...code, cost: { lean: c.lean, original: c.original, ratio: c.ratio, roles: c.roleRows.map(({ role, units, turns, wallS, tiers }) => ({ role, units, turns, wallS, tiers })) } };
});

const count = (k, f = () => true) => rows.filter(f).reduce((a, r) => ((a[r[k]] = (a[r[k]] || 0) + 1), a), {});
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const summary = {
  n: rows.length,
  byRepo: count('repo'),
  blind: count('blind'), blind2: count('blind2'), verdict: count('verdict'),
  blindAgreement: { both: rows.filter((r) => r.blind && r.blind2).length, agree: rows.filter((r) => r.blind && r.blind2 && r.blind === r.blind2).length,
    firstPositionPreferred: rows.flatMap((r) => r.positions).filter((p) => p === 'A').length, secondPositionPreferred: rows.flatMap((r) => r.positions).filter((p) => p === 'B').length },
  verdictByStratum: { escape: count('verdict', (r) => r.stratum === 'escape'), clean: count('verdict', (r) => r.stratum === 'clean') },
  blindByHindsight: Object.fromEntries(['shipped', 'plan', 'none'].map((h) => [h, count('blind', (r) => r.hindsight === h)])),
  sameThing: count('sameThing'), knownFault: count('knownFault', (r) => r.stratum === 'escape'),
  reviewRequestedChanges: rows.filter((r) => r.review === 'REQUEST CHANGES').map((r) => r.id),
  closeoutNotReady: rows.filter((r) => r.closeout !== 'READY').map((r) => r.id),
  shippedTests: { tickets: rows.filter((r) => r.shipped.unitFiles).length, allPass: rows.filter((r) => r.shipped.unitFiles && !r.shipped.replay.fail).map((r) => r.id), failing: rows.filter((r) => r.shipped.replay.fail).map((r) => ({ id: r.id, ...r.shipped.replay, class: r.shippedFailClass })) },
  ratios: {
    tokensBySession: { median: med(rows.map((r) => r.cost.ratio.tokensBySession)), min: Math.min(...rows.map((r) => r.cost.ratio.tokensBySession).filter((x) => x != null)), max: Math.max(...rows.map((r) => r.cost.ratio.tokensBySession).filter((x) => x != null)), n: rows.filter((r) => r.cost.ratio.tokensBySession != null).length },
    tokensByChild: { median: med(rows.map((r) => r.cost.ratio.tokensByChild)), n: rows.filter((r) => r.cost.ratio.tokensByChild != null).length },
    hours: { median: med(rows.map((r) => r.cost.ratio.hours)), min: Math.min(...rows.map((r) => r.cost.ratio.hours)), max: Math.max(...rows.map((r) => r.cost.ratio.hours)) },
  },
  // Where the original's tokens went, by the kind of session entered, pooled over the tickets with transcripts.
  originalByKind: (() => { const k = {}; let tot = 0; for (const r of rows) for (const [kind, u] of Object.entries(r.cost.original.byKind || {})) { k[kind] = (k[kind] || 0) + u; tot += u; } return Object.fromEntries(Object.entries(k).sort((a, b) => b[1] - a[1]).map(([kind, u]) => [kind, { units: Math.round(u), share: +(u / tot).toFixed(3) }])); })(),
  // Like for like: the original's implementation sessions against the replay's implementer, and review+close-out against the same.
  legRatios: (() => { const imp = [], rev = [];
    for (const r of rows) { const k = r.cost.original.byKind; if (!k) continue; const role = (n) => r.cost.roles.filter((x) => x.role === n).reduce((a, x) => a + x.units, 0);
      if (k.implementation) imp.push(role('implementer') / k.implementation);
      if (k.review && k['close-out']) rev.push((role('reviewer') + role('close-out')) / (k.review + k['close-out'])); }
    return { implementer: { median: med(imp), n: imp.length }, reviewPlusCloseout: { median: med(rev), n: rev.length } }; })(),
  lean: { medianUnits: med(rows.map((r) => r.cost.lean.units)), medianTurns: med(rows.map((r) => r.cost.lean.turns)), medianWallMin: +(med(rows.map((r) => r.cost.lean.wallH)) * 60).toFixed(1) },
  original: { medianUnits: med(rows.map((r) => r.cost.original.unitsBySession)), medianDispatches: med(rows.map((r) => r.cost.original.dispatches)), medianWorkH: med(rows.map((r) => r.cost.original.workH)) },
  blindCostUnits: cost.blind.reduce((a, b) => a + b.units, 0),
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 1));
const f = (x) => (x == null ? '–' : x >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : x >= 1e3 ? Math.round(x / 1e3) + 'k' : x);
console.log('id\trepo\tstratum\thindsight\tsame\treview\tblind\tblind2\tverdict\tshipped(replay)\tfix tests(replay/original)\tlean\toriginal\tratio\tratio h');
for (const r of rows) console.log([r.id, r.repo === 'LinearViewer' ? 'Harbour' : 'runner', r.stratum, r.hindsight, r.sameThing, r.review, r.blind, r.blind2, r.verdict + (r.overrides.length ? '*' : ''), r.shipped.unitFiles ? `${r.shipped.replay.pass}/${r.shipped.replay.pass + r.shipped.replay.fail}` : '–', r.fix?.unitFiles ? `${r.fix.replay.fail}/${r.fix.original.fail} fail` : '–', f(r.cost.lean.units), f(r.cost.original.unitsBySession), r.cost.ratio.tokensBySession ?? '–', r.cost.ratio.hours].join('\t'));
console.log(JSON.stringify(summary, null, 1));
