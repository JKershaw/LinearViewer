/**
 * Tables for unwedge-or-breakdown.md (LIN-3932). Reads the census table, the size table and the
 * cache; writes plain-text tables to <out-dir>/*.txt, and prints a summary. Every number in the
 * paper is read from those files.
 *
 * Usage: node analyse.mjs <cache-dir> <census-json> <sizes-json> <out-dir> [next-moves-json]
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { assemblePlanReviewFacts } from '../../../../lib/recommendation-facts.js';
import { carveChild, classifyRefactor } from './classify.mjs';

const [cacheDir, censusPath, sizesPath, outDir, nextMovesPath] = process.argv.slice(2);
if (!outDir) {
  console.error('usage: node analyse.mjs <cache-dir> <census-json> <sizes-json> <out-dir> [next-moves-json]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const census = JSON.parse(readFileSync(censusPath, 'utf8'));
const sizes = JSON.parse(readFileSync(sizesPath, 'utf8')).sizes;
const nextMoves = nextMovesPath ? JSON.parse(readFileSync(nextMovesPath, 'utf8')) : null;
const byId = new Map();
for (const file of readdirSync(cacheDir).filter(f => /^LIN-\d+\.json$/.test(f))) {
  const rec = JSON.parse(readFileSync(join(cacheDir, file), 'utf8'));
  if (!rec.issue._error) byId.set(rec.issue.identifier, rec);
}
const rowById = new Map(census.rows.map(r => [r.id, r]));
const write = (name, lines) => writeFileSync(join(outDir, name), lines.join('\n') + '\n');
const pad = (s, n) => String(s).padEnd(n);
const wide = (s) => pad(s, 28);
const median = (xs) => {
  const v = xs.filter(x => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const summary = {};

// --- 1. Census coverage ------------------------------------------------------------------
{
  const withSessions = [...byId.values()].filter(r => (r.cost.workerSessions || []).length);
  const noLineage = [...byId.values()].filter(r => r.cost.noLineage).length;
  const kinds = {};
  for (const r of byId.values()) for (const s of r.cost.workerSessions || []) kinds[s.kind] = (kinds[s.kind] || 0) + 1;
  const firstSession = withSessions.map(r => r.issue.identifier).map(id => Number(id.split('-')[1])).sort((a, b) => a - b)[0];
  summary.coverage = { tickets: byId.size, unresolved: census.unresolved.map(u => u.identifier), withSessions: withSessions.length, noLineage, firstSessionTicket: `LIN-${firstSession}`, relevantRows: census.rows.length };
  write('01-coverage.txt', [
    `tickets read (LIN-1500..LIN-3932, minus unresolved): ${byId.size}`,
    `unresolved (400 "Could not find referenced Issue"): ${census.unresolved.map(u => u.identifier).join(' ')}`,
    `tickets with any /cost worker session: ${withSessions.length}`,
    `tickets with /cost noLineage: ${noLineage}`,
    `lowest-numbered ticket with a /cost session: LIN-${firstSession}`,
    `relevant rows in census.json: ${census.rows.length}`,
    `session kinds across /cost (lineage roots):`,
    ...Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${pad(k, 22)}${n}`),
  ]);
}

// --- 2. Breakdown record -----------------------------------------------------------------
{
  const b1 = census.rows.filter(r => r.bkB1).map(r => r.id);
  const b2 = census.rows.filter(r => r.bkB2).map(r => r.id);
  const union = [...new Set([...b1, ...b2])].sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]));
  const overlap = b1.filter(id => b2.includes(id)).length;
  const trees = [];
  for (const id of union) {
    const rec = byId.get(id);
    const row = rowById.get(id);
    const childIds = [...new Set([...(rec.issue.children || []).map(c => c.identifier), ...row.carveChildren])];
    const childStates = childIds.map(c => byId.get(c)?.issue.state.type || 'missing');
    const count = (pred) => childStates.filter(pred).length;
    const sess = (rid) => (byId.get(rid)?.cost.workerSessions || []).filter(s => !['wake', 'autopilot'].includes(s.kind));
    const allSess = [id, ...childIds].flatMap(sess);
    const kindsOf = (k) => allSess.filter(s => s.kind === k).length;
    const parentCloseOut = (rec.issue.comments || []).some(c => /^[#*\s]*(✅\s*)?close-out/i.test(String(c.body || '').slice(0, 80)));
    const followOns = census.rows.filter(r => r.id !== id && r.createdAt > rec.issue.createdAt && generatorOf(r) && [id, ...childIds].includes(generatorOf(r))).length;
    const size = [id, ...childIds].reduce((acc, c) => acc + (sizes[c]?.lines || 0), 0);
    trees.push({
      id, title: rec.issue.title.slice(0, 60), state: rec.issue.state.type, b1: row.bkB1, b2: row.bkB2,
      children: childIds.length, done: count(s => s === 'completed'), cancelled: count(s => s === 'canceled'),
      neverWorked: count(s => s === 'backlog' || s === 'unstarted' || s === 'triage'), inProgress: count(s => s === 'started'),
      sessions: allSess.length, reviewSessions: kindsOf('review'), planReviewSessions: kindsOf('plan-review'),
      costKnown: allSess.length > 0 || sess(id).length > 0,
      parentCloseOut, followOns, lines: size, band: bandOf(size),
    });
  }
  const costTrees = trees.filter(t => t.costKnown);
  write('02-breakdown-trees.txt', [
    `breakdown cases: B1 (a /cost breakdown session) ${b1.length}; B2 (a parent with a carve child, root-task-ratio rule) ${b2.length}; union ${union.length}; both ${overlap}`,
    `carve children of the union: ${trees.reduce((a, t) => a + (rowById.get(t.id).carveChildren.length), 0)}`,
    `trees with any /cost session (post-LIN-2750 telemetry): ${costTrees.length} of ${trees.length}`,
    '',
    `${pad('tree', 10)}${pad('state', 11)}${pad('B1', 4)}${pad('B2', 4)}${pad('kids', 6)}${pad('done', 6)}${pad('cancl', 7)}${pad('never', 7)}${pad('sess', 6)}${pad('rev', 5)}${pad('pRev', 6)}${pad('close', 7)}${pad('follow', 8)}${pad('lines', 8)}band   title`,
    ...trees.map(t => `${pad(t.id, 10)}${pad(t.state, 11)}${pad(t.b1 ? 'y' : '', 4)}${pad(t.b2 ? 'y' : '', 4)}${pad(t.children, 6)}${pad(t.done, 6)}${pad(t.cancelled, 7)}${pad(t.neverWorked, 7)}${pad(t.costKnown ? t.sessions : 'n/a', 6)}${pad(t.costKnown ? t.reviewSessions : 'n/a', 5)}${pad(t.costKnown ? t.planReviewSessions : 'n/a', 6)}${pad(t.parentCloseOut ? 'yes' : 'no', 7)}${pad(t.followOns, 8)}${pad(t.lines, 8)}${pad(t.band, 7)}${t.title}`),
  ]);
  summary.breakdown = {
    b1: b1.length, b2: b2.length, union: union.length, overlap,
    children: trees.reduce((a, t) => a + t.children, 0),
    done: trees.reduce((a, t) => a + t.done, 0),
    cancelled: trees.reduce((a, t) => a + t.cancelled, 0),
    neverWorked: trees.reduce((a, t) => a + t.neverWorked, 0),
    inProgress: trees.reduce((a, t) => a + t.inProgress, 0),
    treesWithCost: costTrees.length,
    treesCancelledParent: trees.filter(t => t.state === 'canceled').length,
    treesWithCloseOut: trees.filter(t => t.parentCloseOut).length,
    treesFollowOns: trees.reduce((a, t) => a + t.followOns, 0),
    carveChildren: trees.reduce((a, t) => a + rowById.get(t.id).carveChildren.length, 0),
    trees,
  };
  // Same-size comparator: non-breakdown tickets with a plan-loop stop that were built, same band
  // and same creation month as each tree, with cost sessions. Sessions exclude wake and autopilot.
  const comparators = [];
  const bkSet = new Set([...union, ...trees.flatMap(t => [...(byId.get(t.id).issue.children || []).map(c => c.identifier), ...rowById.get(t.id).carveChildren])]);
  const built = nextMoves ? new Set(nextMoves.codes.filter(c => c.code === 'built' || c.code === 'built-after-ruling').map(c => c.id)) : new Set();
  for (const t of costTrees) {
    const month = rowById.get(t.id).createdAt.slice(0, 7);
    const pool = census.rows.filter(r => !bkSet.has(r.id) && built.has(r.id) && r.sessions > 0 && r.createdAt.slice(0, 7) === month && bandOf(sizes[r.id]?.lines || 0) === t.band);
    comparators.push({ tree: t.id, band: t.band, month, pool: pool.length, poolSessions: median(pool.map(r => (byId.get(r.id)?.cost.workerSessions || []).filter(s => !['wake', 'autopilot'].includes(s.kind)).length)), treeSessions: t.sessions });
  }
  write('03-comparator.txt', [
    'Same-size comparator for the cost-known breakdown trees. Pool: non-breakdown, non-carve tickets',
    'whose next move after a plan-loop stop was a build, with /cost sessions, in the same change-size',
    'band and created in the same month. Sessions exclude wake and autopilot. A pool under three is',
    'not a comparison; it is printed so the reader can see how thin the control is.',
    '',
    `${pad('tree', 10)}${pad('band', 7)}${pad('month', 9)}${pad('pool', 6)}${pad('pool median sess', 18)}tree sessions`,
    ...comparators.map(c => `${pad(c.tree, 10)}${pad(c.band, 7)}${pad(c.month, 9)}${pad(c.pool, 6)}${pad(c.poolSessions ?? 'n/a', 18)}${c.treeSessions}`),
  ]);
  summary.comparator = comparators;
}

function bandOf(lines) {
  if (!lines) return 'none';
  return lines <= 200 ? 'small' : lines <= 612 ? 'mid' : 'large';
}

// The generator rule of tasks-generate-tasks.md: the parent if there is one, else the first
// LIN-nnnn in the opening 400 characters.
function generatorOf(row) {
  if (row.parent) return row.parent;
  const rec = byId.get(row.id);
  const m = String(rec?.issue.description || '').slice(0, 400).match(/LIN-\d+/);
  return m ? m[0] : null;
}

// --- 3. Unwedge record -------------------------------------------------------------------
{
  const strictU = census.candidates.filter(c => c.class === 'U');
  const looseU = census.candidates.filter(c => c.classLoose === 'U');
  const tally = (key) => {
    const t = {};
    for (const c of census.candidates) t[c[key]] = (t[c[key]] || 0) + 1;
    return t;
  };
  const refactorIds = [...byId.values()].filter(r => classifyRefactor(r.issue)).map(r => r.issue.identifier);
  const seeds = ['LIN-3364', 'LIN-3430', 'LIN-1352', 'LIN-1402', 'LIN-2125', 'LIN-2126', 'LIN-3328', 'LIN-3232'];
  summary.unwedge = { candidates: census.candidates.length, strictU: strictU.map(c => `${c.X}<-${c.Y}`), looseU: looseU.map(c => `${c.X}<-${c.Y}`), strictClasses: tally('class'), looseClasses: tally('classLoose') };
  write('04-unwedge.txt', [
    `candidate pairs (an inverse blocks relation, Y blocks X): ${census.candidates.length}`,
    `  with X dated from /cost (session telemetry): ${census.candidates.filter(c => c.dateSource === 'cost').length}`,
    `  with X dated from the comment trail: ${census.candidates.filter(c => c.dateSource === 'comments').length}`,
    `  with X undated (neither source): ${census.candidates.filter(c => c.dateSource === 'none').length}; these can still be P, sibling or own-child, which need no X dates`,
    '',
    'strict reading (implementation = a comment saying "implemented" with a PR link, or a session):',
    ...Object.entries(tally('class')).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${pad(k, 12)}${n}`),
    '',
    'pairs and distinct blocked tasks, strict reading:',
    ...['U', 'P', 'sibling', 'own-child', 'after-impl'].map(k => { const ps = census.candidates.filter(c => c.class === k); return `  ${pad(k, 12)}${ps.length} pairs, ${new Set(ps.map(c => c.X)).size} blocked tasks`; }),
    (() => { const rows = new Map(census.rows.map(r => [r.id, r])); const ps = census.candidates.filter(c => c.class === 'P'); const cross = ps.filter(c => { const x = rows.get(c.X); const y = rows.get(c.Y); return !(x?.parent && y?.parent && x.parent === y.parent); }).length; return `  P pairs with the blocker outside the blocked task's parent (or X has none): ${cross} of ${ps.length}`; })(),
    '',
    'loose reading (implementation = the first PR link posted after the plan; an upper bound):',
    ...Object.entries(tally('classLoose')).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${pad(k, 12)}${n}`),
    '',
    `U, strict (${strictU.length}):`,
    ...strictU.map(c => `  ${pad(c.X, 10)}<- ${pad(c.Y, 10)}Y created ${c.Ycreated}, Y done ${c.Ycompleted}; X plan ${c.Xplan}, X impl ${c.Ximpl} (${c.dateSource})`),
    `U, loose (${looseU.length}):`,
    ...looseU.map(c => `  ${pad(c.X, 10)}<- ${pad(c.Y, 10)}Y created ${c.Ycreated}, Y done ${c.Ycompleted}; X plan ${c.Xplan} (${c.dateSource})`),
    '',
    `R (LIN-397-style titles, census-wide): ${refactorIds.length}; of the research seeds, title-matched: ${seeds.filter(s => refactorIds.includes(s)).length} of ${seeds.length}`,
  ]);
}

// --- 4. Plan-loop stops and their next move ----------------------------------------------
{
  const stops = census.rows.filter(r => r.stop);
  const since = stops.filter(r => r.stop.at >= '2026-09-25');
  const research = 'LIN-3833 3772 3660 3648 3634 3614 3611 3601 3570 3102 3126 3258 2950 3059 3197 2884 3200 3201 3142 3124 3127 3107 3075 3049'.split(' ').map(x => `LIN-${x.replace('LIN-', '')}`);
  const sinceIds = since.map(r => r.id);
  const codeOf = new Map((nextMoves?.codes || []).map(c => [c.id, c.code]));
  const byEra = {};
  for (const r of stops) {
    const key = `${r.stop.era}/${r.stop.kind}`;
    byEra[key] ??= {};
    const code = codeOf.get(r.id) || 'uncoded';
    byEra[key][code] = (byEra[key][code] || 0) + 1;
  }
  summary.stops = { total: stops.length, since: since.length, researchRecovered: research.filter(x => sinceIds.includes(x)).length, researchMissed: research.filter(x => !sinceIds.includes(x)), replayOnly: sinceIds.filter(x => !research.includes(x)) };
  write('05-loop-stops.txt', [
    `plan-loop stops replayed under the rule in force on each verdict: ${stops.length}`,
    `  on or after 25 Sep (the rulings store starts): ${since.length}`,
    `  research spike's 24 tickets recovered by the replay: ${summary.stops.researchRecovered} of ${research.length}`,
    `  research tickets the replay does not stop: ${summary.stops.researchMissed.join(' ') || 'none'}`,
    `  replay stops since 25 Sep that the research did not list: ${summary.stops.replayOnly.join(' ') || 'none'}`,
    '',
    'next move by era/kind (rule-coded; see code-next-moves.mjs):',
    ...Object.entries(byEra).map(([k, v]) => `  ${wide(k)}${Object.entries(v).map(([c, n]) => `${c}=${n}`).join('  ')}`),
    '',
    'next move, all stops:',
    ...Object.entries(Object.fromEntries(Object.entries(stops.reduce((a, r) => { const c = codeOf.get(r.id) || 'uncoded'; a[c] = (a[c] || 0) + 1; return a; }, {})))).map(([c, n]) => `  ${pad(c, 20)}${n}`),
  ]);
  summary.stopCodes = stops.reduce((a, r) => { const c = codeOf.get(r.id) || 'uncoded'; a[c] = (a[c] || 0) + 1; return a; }, {});
}

// --- 5. Verdict parser miss rate ---------------------------------------------------------
// A comment whose first line is a "Plan Review Verdict" heading that the router's own counter
// (assemblePlanReviewFacts) reads as zero verdicts. The replay can only be as good as that counter.
{
  let heads = 0;
  let misses = 0;
  const missed = [];
  for (const r of byId.values()) {
    for (const c of r.issue.comments) {
      const h = (c.body || '').split('\n').find(l => l.trim()) || '';
      if (!/^[#\s*]*Plan Review Verdict\b/i.test(h)) continue;
      heads++;
      if (assemblePlanReviewFacts([{ body: c.body, createdAt: c.createdAt }]).verdicts === 0) {
        misses++;
        missed.push(`${r.issue.identifier} ${c.createdAt.slice(0, 16)}`);
      }
    }
  }
  summary.parser = { heads, misses };
  write('06-parser.txt', [
    `comments whose first line is a "Plan Review Verdict" heading: ${heads}`,
    `read as zero verdicts by assemblePlanReviewFacts: ${misses} (${(100 * misses / heads).toFixed(1)}%)`,
    ...missed.map(m => `  ${m}`),
  ]);
}

// --- 6. Bound and ceiling stops: what happened next -------------------------------------
// The paper's item 3 compares the stops the code bound settles (bound-3, ceiling-5) with the
// one-cycle stops. Per stop: the rule-coded next move, /cost sessions to the stop's Done
// (excluding wake and autopilot; post-LIN-2750 only), follow-ons by the generator rule, and
// follow-ons whose titles name a fault.
{
  const codeOf = new Map((nextMoves?.codes || []).map(c => [c.id, c.code]));
  const rows = census.rows.filter(r => r.stop && r.stop.era !== 'one-cycle').map(r => {
    const rec = byId.get(r.id);
    const sess = (r.id && (rec.cost.workerSessions || []).filter(s => !['wake', 'autopilot'].includes(s.kind))) || [];
    const follow = census.rows.filter(f => f.id !== r.id && f.createdAt > r.createdAt && generatorOf(f) === r.id);
    const faults = follow.filter(f => /\b(fix|bug|regression|fault)\b/i.test(byId.get(f.id)?.issue.title || '')).length;
    return { id: r.id, stopAt: r.stop.at.slice(0, 10), era: r.stop.era, kind: r.stop.kind, count: r.stop.count, code: codeOf.get(r.id) || 'uncoded', state: rec.issue.state.type, sessions: sess.length, followOns: follow.length, faultFollowOns: faults };
  });
  write('07-bound-and-ceiling.txt', [
    'Stops under the bound-3 and ceiling-5 eras, with the rule-coded next move. Sessions exclude wake and autopilot.',
    `${pad('ticket', 10)}${pad('stop', 12)}${pad('era/kind', 28)}${pad('n', 4)}${pad('next move', 22)}${pad('state', 11)}${pad('sess', 6)}${pad('follow', 8)}fault`,
    ...rows.map(r => `${pad(r.id, 10)}${pad(r.stopAt, 12)}${pad(r.era + '/' + r.kind, 28)}${pad(r.count, 4)}${pad(r.code, 22)}${pad(r.state, 11)}${pad(r.sessions || '-', 6)}${pad(r.followOns, 8)}${r.faultFollowOns}`),
  ]);
  const tally = {};
  for (const r of rows) { const k = r.era; tally[k] ??= { stops: 0, built: 0, breakdown: 0, other: 0, followOns: 0, faultFollowOns: 0 }; const t = tally[k]; t.stops++; if (/^built/.test(r.code)) t.built++; else if (r.code === 'breakdown') t.breakdown++; else t.other++; t.followOns += r.followOns; t.faultFollowOns += r.faultFollowOns; }
  summary.boundStops = tally;
}

write('summary.json.txt', [JSON.stringify(summary, null, 1)]);
console.log(JSON.stringify({ breakdownUnion: summary.breakdown.union, children: summary.breakdown.children, strictU: summary.unwedge.strictU, looseU: summary.unwedge.looseU.length, stops: summary.stops.total, stopCodes: summary.stopCodes }));
