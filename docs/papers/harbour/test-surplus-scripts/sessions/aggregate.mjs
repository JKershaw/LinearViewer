// LIN-3551: aggregate sessions.json (from scan-sessions.mjs) into the figures quoted in notes.md. Usage: node aggregate.mjs sessions.json > summary.json
import { readFileSync } from 'fs';
const rows = JSON.parse(readFileSync(process.argv[2] || 'sessions.json', 'utf8'));
const CAP = 30 * 60; // seconds; a single run longer than this is almost certainly a hung/interrupted call, reported separately

const norm = (k) => {
  k = k.replace(/:+$/, '');
  if (k === 'script:test:unit' || k === 'script:test:hermetic' || k === 'script:test:hermetic:proxy') return 'unit-suite';
  return k;
};
const isUnit = (kinds) => kinds.some((k) => k === 'unit-suite' || k === 'unit-files' || k === 'full');
const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r1 = (x) => Math.round(x * 10) / 10; const pct = (a, b) => (b ? r1((100 * a) / b) : 0);

function cohort(repo) {
  const S = rows.filter((s) => s.primary === repo);
  const o = { sessions: S.length, dispatched: S.filter((s) => s.dispatched).length, withSubagents: S.filter((s) => s.subagents).length };
  // ---- 1. test runs (runs attributed to this repo; runs with unknown repo assigned to the session's primary repo) ----
  const runs = []; const perSess = [];
  let sessAnyUnit = 0, sessSuite = 0, sessFiles = 0, sessE2e = 0, sessAnyRun = 0;
  let activeMin = 0, wallMin = 0, bashMin = 0;
  for (const s of S) {
    activeMin += s.activeMin; wallMin += s.wallMin; bashMin += s.bashWaitMin;
    const rr = s.runs.filter((u) => (u.repo || s.primary) === repo).map((u) => ({ ...u, kinds: u.kinds.map(norm) }));
    runs.push(...rr);
    if (rr.length) sessAnyRun++;
    if (rr.some((u) => isUnit(u.kinds))) sessAnyUnit++;
    if (rr.some((u) => u.kinds.includes('unit-suite') || u.kinds.includes('full'))) sessSuite++;
    if (rr.some((u) => u.kinds.includes('unit-files'))) sessFiles++;
    if (rr.some((u) => u.kinds.includes('e2e') || u.kinds.includes('full'))) sessE2e++;
    const fg = rr.filter((u) => !u.bg);
    perSess.push({ n: rr.length, min: fg.reduce((a, u) => a + Math.min(u.sec, CAP), 0) / 60, active: s.activeMin, bash: s.bashWaitMin });
  }
  const fg = runs.filter((u) => !u.bg);
  const sumMin = (a) => a.reduce((x, u) => x + u.sec, 0) / 60; const sumCap = (a) => a.reduce((x, u) => x + Math.min(u.sec, CAP), 0) / 60;
  const byKind = {};
  for (const u of runs) { const k = u.kinds.includes('full') ? 'full (unit+e2e)' : u.kinds.includes('unit-suite') && u.kinds.includes('e2e') ? 'unit-suite+e2e' : u.kinds.includes('unit-suite') ? 'unit-suite' : u.kinds.includes('unit-files') ? 'unit-files' : u.kinds.includes('e2e') ? 'e2e' : u.kinds.join('+') || 'other';
    const B = byKind[k] || (byKind[k] = { runs: 0, bg: 0, minCapped: 0, medianSec: [], subagentRuns: 0 }); B.runs++; if (u.bg) B.bg++; else { B.minCapped += Math.min(u.sec, CAP) / 60; B.medianSec.push(u.sec); } if (u.sub) B.subagentRuns++; }
  for (const B of Object.values(byKind)) { B.p50Sec = r1(q(B.medianSec, 0.5)); B.p90Sec = r1(q(B.medianSec, 0.9)); B.minCapped = r1(B.minCapped); delete B.medianSec; }
  const runsPerSess = perSess.map((x) => x.n); const minPerSess = perSess.map((x) => x.min);
  o.runs = {
    sessionsWithAnyTestRun: sessAnyRun, sessionsRunningUnit: sessAnyUnit, sessionsRunningUnitSuite: sessSuite, sessionsRunningUnitFiles: sessFiles, sessionsRunningE2e: sessE2e,
    totalRuns: runs.length, unitRuns: runs.filter((u) => isUnit(u.kinds)).length, unitFileRuns: runs.filter((u) => u.kinds.includes('unit-files')).length,
    unitFileRunsWithNameFilter: runs.filter((u) => u.kinds.includes('unit-files') && u.filter).length,
    filesPerUnitFileRunP50: q(runs.filter((u) => u.kinds.includes('unit-files')).map((u) => u.nFiles), 0.5),
    backgroundRuns: runs.length - fg.length, erroredRuns: runs.filter((u) => u.err).length, runsInSubagents: runs.filter((u) => u.sub).length,
    runsPerSessionP50: q(runsPerSess, 0.5), runsPerSessionP90: q(runsPerSess, 0.9), runsPerSessionMean: r1(runs.length / (S.length || 1)),
    waitMinRaw: r1(sumMin(fg)), waitMinCapped30: r1(sumCap(fg)), runsOver30min: fg.filter((u) => u.sec > CAP).length,
    waitHoursCapped30: r1(sumCap(fg) / 60), unitWaitMinCapped: r1(sumCap(fg.filter((u) => isUnit(u.kinds)))), e2eOnlyWaitMinCapped: r1(sumCap(fg.filter((u) => !isUnit(u.kinds) && u.kinds.includes('e2e')))),
    waitMinPerSessionP50: r1(q(minPerSess, 0.5)), waitMinPerSessionP90: r1(q(minPerSess, 0.9)), waitMinPerSessionMean: r1(sumCap(fg) / (S.length || 1)),
    sessionActiveHours: r1(activeMin / 60), sessionWallHours: r1(wallMin / 60), bashWaitHours: r1(bashMin / 60),
    testWaitShareOfActive: pct(sumCap(fg), activeMin), testWaitShareOfBashWait: pct(sumCap(fg), bashMin),
    // per-session share, median over sessions with >=10 active minutes
    testWaitShareOfActivePerSessionP50: r1(q(perSess.filter((x) => x.active >= 10).map((x) => (100 * x.min) / x.active), 0.5)),
    byKind,
  };
  // ---- 2. edits in this repo by role ----
  const ed = {}; const tot = { calls: 0, linesWritten: 0, linesNet: 0 };
  let sessEditTests = 0, sessEditProduct = 0, sessEditAny = 0, sessOnlyTests = 0;
  for (const s of S) {
    const mine = Object.entries(s.edits).filter(([k]) => k.startsWith(repo + ':'));
    for (const [k, v] of mine) { const role = k.split(':')[1]; const E = ed[role] || (ed[role] = { calls: 0, writeCalls: 0, editCalls: 0, writesCreated: 0, linesWritten: 0, linesNet: 0 }); for (const f of Object.keys(E)) E[f] += v[f] || 0; tot.calls += v.calls; tot.linesWritten += v.linesWritten; tot.linesNet += v.linesNet; }
    const roles = new Set(mine.map(([k]) => k.split(':')[1]));
    if (roles.size) sessEditAny++; if (roles.has('test')) sessEditTests++; if (roles.has('product')) sessEditProduct++; if (roles.has('test') && !roles.has('product')) sessOnlyTests++;
  }
  for (const E of Object.values(ed)) { E.shareOfCalls = pct(E.calls, tot.calls); E.shareOfLinesWritten = pct(E.linesWritten, tot.linesWritten); E.shareOfLinesNet = pct(E.linesNet, tot.linesNet); }
  const tp = (ed.test?.calls || 0) + (ed.product?.calls || 0);
  o.edits = { total: tot, byRole: ed, testShareOfTestPlusProductCalls: pct(ed.test?.calls || 0, tp), testShareOfTestPlusProductLines: pct(ed.test?.linesWritten || 0, (ed.test?.linesWritten || 0) + (ed.product?.linesWritten || 0)),
    testShareOfTestPlusProductNetLines: pct(ed.test?.linesNet || 0, (ed.test?.linesNet || 0) + (ed.product?.linesNet || 0)),
    sessionsEditingRepo: sessEditAny, sessionsEditingTests: sessEditTests, sessionsEditingProduct: sessEditProduct, sessionsEditingTestsButNotProduct: sessOnlyTests,
    scratchEditCalls: S.reduce((a, s) => a + (s.edits['scratch:scratch']?.calls || 0), 0),
    bashInPlaceEditCalls: Object.fromEntries(['test', 'product', 'docs', 'other'].map((r) => [r, S.reduce((a, s) => a + (s.bashEdits[repo + ':' + r] || 0), 0)])) };
  // ---- 3. test files: new vs pre-existing ----
  let fNew = 0, fPre = 0, cNew = 0, cPre = 0, lNew = 0, lPre = 0; const newPaths = {};
  for (const s of S) { const F = s.testFiles[repo]; if (F) { fNew += F.new; fPre += F.preexisting; for (const p of F.newPaths) newPaths[p.replace(/^.*?(tests?\/)/, '$1')] = (newPaths[p.replace(/^.*?(tests?\/)/, '$1')] || 0) + 1; } const T = s.testEditCalls[repo]; if (T) { cNew += T.onNewFile; cPre += T.onPreexisting; lNew += T.linesOnNew; lPre += T.linesOnPre; } }
  o.testFiles = { sessionFileTouches: fNew + fPre, newFiles: fNew, preexistingFiles: fPre, newShare: pct(fNew, fNew + fPre), editCallsOnNewFiles: cNew, editCallsOnPreexisting: cPre, editCallShareOnPreexisting: pct(cPre, cNew + cPre), linesOnNew: lNew, linesOnPre: lPre, distinctNewTestPaths: Object.keys(newPaths).length };
  // ---- 4. output tokens / turns by focus ----
  const fo = {}; let turns = 0, tok = 0;
  for (const s of S) for (const [k, v] of Object.entries(s.focus)) { const F = fo[k] || (fo[k] = { turns: 0, outTok: 0 }); F.turns += v.turns; F.outTok += v.outTok; turns += v.turns; tok += v.outTok; }
  for (const F of Object.values(fo)) { F.turnShare = pct(F.turns, turns); F.tokShare = pct(F.outTok, tok); }
  const repoFocused = Object.entries(fo).filter(([k]) => k.startsWith(repo + ':') && !k.endsWith(':testrun')).reduce((a, [, v]) => ({ turns: a.turns + v.turns, outTok: a.outTok + v.outTok }), { turns: 0, outTok: 0 });
  o.focus = { assistantTurns: turns, outputTokens: tok, byFocus: fo,
    testFileFocusShareOfFileFocusedTokens: pct(fo[repo + ':test']?.outTok || 0, repoFocused.outTok), testFileFocusShareOfFileFocusedTurns: pct(fo[repo + ':test']?.turns || 0, repoFocused.turns) };
  // ---- per dispatch phase (from the kickoff prompt '# LIN-NNNN · <phase>') ----
  const ph = {};
  for (const s of S) {
    const k = s.phase || 'unknown'; const P = ph[k] || (ph[k] = { sessions: 0, sessionsWithUnitRun: 0, runs: 0, waitMin: 0, activeMin: 0, editCalls: 0, testEditCalls: 0, productEditCalls: 0 });
    const rr = s.runs.filter((u) => (u.repo || s.primary) === repo);
    P.sessions++; if (rr.some((u) => isUnit(u.kinds.map(norm)))) P.sessionsWithUnitRun++; P.runs += rr.length;
    P.waitMin += rr.filter((u) => !u.bg).reduce((a, u) => a + Math.min(u.sec, CAP), 0) / 60; P.activeMin += s.activeMin;
    P.editCalls += Object.entries(s.edits).filter(([k2]) => k2.startsWith(repo + ':')).reduce((a, [, v]) => a + v.calls, 0);
    P.testEditCalls += s.edits[repo + ':test']?.calls || 0; P.productEditCalls += s.edits[repo + ':product']?.calls || 0;
  }
  for (const P of Object.values(ph)) { P.waitShareOfActive = pct(P.waitMin, P.activeMin); P.testShareOfEditCalls = pct(P.testEditCalls, P.editCalls); P.waitMin = r1(P.waitMin); P.activeMin = r1(P.activeMin); }
  o.byPhase = Object.fromEntries(Object.entries(ph).sort((a, b) => b[1].sessions - a[1].sessions));
  const nonAuto = S.filter((s) => s.phase !== 'autopilot'); const naAct = nonAuto.reduce((a, s) => a + s.activeMin, 0);
  o.runs.testWaitShareOfActiveExclAutopilot = pct(o.runs.waitMinCapped30 - (ph.autopilot?.waitMin || 0), naAct);
  // Edit-tool + bash in-place edit calls combined (bash edit targets are a regex heuristic)
  const bt = o.edits.bashInPlaceEditCalls; const tc = (ed.test?.calls || 0) + bt.test; const pc = (ed.product?.calls || 0) + bt.product;
  o.edits.testShareOfTestPlusProductCallsInclBash = pct(tc, tc + pc);
  return o;
}

const ts = rows.map((s) => s.firstTs).sort();
const summary = {
  transcriptsRange: { firstSessionStart: ts[0], lastSessionStart: ts[ts.length - 1], lastActivity: rows.map((s) => s.lastTs).sort().pop(),
    sessionsByStartMonth: rows.reduce((a, s) => ((a[s.firstTs.slice(0, 7)] = (a[s.firstTs.slice(0, 7)] || 0) + 1), a), {}), p05Start: q(ts, 0.05), p50Start: q(ts, 0.5) },
  sessionsTotal: rows.length, byPrimary: rows.reduce((a, s) => ((a[s.primary] = (a[s.primary] || 0) + 1), a), {}),
  lvSessionsAlsoEditingSd: rows.filter((s) => s.primary === 'lv' && s.sdEditCalls).length, sdSessionsAlsoEditingLv: rows.filter((s) => s.primary === 'sd' && s.lvEditCalls).length,
  harbour: cohort('lv'), simpleDispatcher: cohort('sd'),
};
console.log(JSON.stringify(summary, null, 1));
