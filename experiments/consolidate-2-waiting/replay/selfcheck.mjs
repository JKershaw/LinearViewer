#!/usr/bin/env node
// Replay self-check: identity on two seeds (old vs a second fresh copy of old), then planted
// mutants, each of which must be detected on the caller(s) it names and nowhere unexpected;
// equivalent mutants must show 0 differences.
//   node selfcheck.mjs <oldA> <oldB> <newTree> <workDir(fresh)> [n=1000]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, cpSync, symlinkSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const [A, B, NEWT, WORK, nArg = '1000'] = process.argv.slice(2);
if (!A || !B || !NEWT || !WORK) { console.error('usage: selfcheck.mjs <oldA> <oldB> <newTree> <workDir> [n]'); process.exit(2); }
if (existsSync(WORK)) { console.error(`refusing: ${WORK} exists`); process.exit(2); }
mkdirSync(WORK, { recursive: true });

const replay = (oldDir, newDir, seed, out) => {
  const r = spawnSync(process.execPath, [join(HERE, 'replay.mjs'), '--old', oldDir, '--new', newDir, '--n', nArg, '--seed', String(seed), '--quiet', '--out', out], { encoding: 'utf8' });
  if (r.status === 2) throw new Error(r.stderr || r.stdout);
  return JSON.parse(readFileSync(out, 'utf8'));
};
const side = (base, id, file, from, to) => {
  const dir = join(WORK, id); mkdirSync(dir);
  for (const e of readdirSync(base)) {
    if (e === 'lib' || e === 'routes') cpSync(join(base, e), join(dir, e), { recursive: true });
    else symlinkSync(realpathSync(join(base, e)), join(dir, e));
  }
  const p = join(dir, file); const src = readFileSync(p, 'utf8');
  const count = src.split(from).length - 1;
  if (count !== 1) throw new Error(`${id}: pattern occurs ${count}× in ${file}`);
  writeFileSync(p, src.replace(from, to));
  return dir;
};
const MUTANTS = [
  // [id, base, file, from, to, expected callers that must differ ([] = equivalent mutant, must show 0)]
  ['M1-dashboard-set+pending', A, 'routes/dashboard.js', "const WAITING_WAKE_MARKERS = new Set(['blocked']);", "const WAITING_WAKE_MARKERS = new Set(['blocked', 'pending']);", ['dashboard.deriveSessionWaiting']],
  ['M2-render-run-steps-set-dropped', A, 'lib/render-run-steps.js', "const WAITING_WAKE_MARKERS = new Set(['blocked']);", 'const WAITING_WAKE_MARKERS = new Set([]);', ['render-run-steps.renderStepFace', 'render-session.renderSessionPage']],
  ['M3-digest-feedback-set+pending', A, 'lib/digest-feedback.js', "export const WAITING_WAKE_MARKERS = new Set(['blocked']);", "export const WAITING_WAKE_MARKERS = new Set(['blocked', 'pending']);", ['digest-feedback.deriveLoopFacingFacts']],
  ['M4-run-view-pending', A, 'lib/run-view.js', "wake.marker !== 'blocked'", "wake.marker !== 'pending'", ['run-view.buildRunView', 'render-session.renderSessionPage']],
  ['M5-task-page-loader-pending', A, 'lib/task-page-loader.js', "wake.marker === 'blocked' && state", "wake.marker === 'pending' && state", ['task-page-loader.sessionMessage']],
  ['M6-dispatch-terminal-pending', A, 'lib/dispatch-terminal.js', "=== 'blocked' ? 'blocked' : null", "=== 'pending' ? 'blocked' : null", ['dispatch-terminal.deriveBlockedStatus', 'dispatch-terminal.deriveLifecycleStatus', 'dispatch-terminal.deriveWireStatus', 'recent-runs.recentRuns', 'observer-efficacy-signal.computeIncumbentSignal']],
  ['M7-unanswered-decisions-case', A, 'lib/unanswered-decisions.js', "loop.wakeMarker === 'blocked'", "loop.wakeMarker === 'Blocked'", ['unanswered-decisions.resolveDisposition']],
  ['M8-observer-sweep-drop-marker-channel', A, 'lib/observer-sweep.js', "(wakeMarker === 'blocked' || agentState === 'waiting')", "(agentState === 'waiting')", ['observer-sweep.classifyLoop']],
  ['M9-efficacy-regex+pending', A, 'lib/observer-efficacy-signal.js', 'const BLOCKED_MARKER_RE = /^\\s*\\[blocked\\]/i;', 'const BLOCKED_MARKER_RE = /^\\s*\\[(blocked|pending)\\]/i;', ['observer-efficacy-signal.computeIncumbentSignal']],
  ['M10-dispatch-wake-case', A, 'lib/dispatch-wake.js', "marker === 'blocked' ? 'blocked'", "marker === 'BLOCKED' ? 'blocked'", ['dispatch-wake.classifyWake']],
  ['M11-live-console-drop-pending', A, 'lib/live-console.js', "s === 'blocked' || s === 'pending' || s === 'waiting'", "s === 'blocked' || s === 'waiting'", ['live-console.statusToKind']],
  ['M12-pipeline-loops-case-fold', A, 'lib/pipeline-loops.js', "if (agentStatus === 'blocked') return 'waiting';", "if (String(agentStatus).toLowerCase() === 'blocked') return 'waiting';", ['pipeline-loops._deriveAgentState']],
  ['M13-render-session-drop-pending', A, 'lib/render-session.js', '/^\\s*\\[(blocked|pending)\\]/i', '/^\\s*\\[(blocked)\\]/i', ['render-session.renderSessionPage']],
  ['M14-recent-runs-label', A, 'lib/recent-runs.js', "if (status === 'blocked') return", "if (status === 'waiting') return", ['recent-runs.recentRuns']],
  ['M15-authority+pending (new tree)', NEWT, 'lib/dispatch-terminal.js', "export const WAITING_WAKE_MARKERS = new Set(['blocked']);", "export const WAITING_WAKE_MARKERS = new Set(['blocked', 'pending']);", null],
  ['E1-equivalent-null-guard', A, 'routes/dashboard.js', '  return marker != null && WAITING_WAKE_MARKERS.has(marker);', '  return WAITING_WAKE_MARKERS.has(marker);', []],
  ['E2-equivalent-regex-spelling', A, 'lib/observer-efficacy-signal.js', 'const BLOCKED_MARKER_RE = /^\\s*\\[blocked\\]/i;', 'const BLOCKED_MARKER_RE = /^\\s*\\[(?:blocked)\\]/i;', []],
];
let failures = 0; const results = [];
for (const seed of [1, 2]) {
  const rep = replay(A, B, seed, join(WORK, `identity-s${seed}.json`));
  const ok = rep.totals.diffs === 0 && rep.totals.missing === 0;
  if (!ok) failures++;
  results.push({ check: `identity seed ${seed}`, ok, inputs: rep.totals.inputs, diffs: rep.totals.diffs });
  console.log(`${ok ? 'PASS' : 'FAIL'} identity seed ${seed}: ${rep.totals.inputs} inputs, ${rep.totals.diffs} diffs`);
}
for (const [id, base, file, from, to, expect] of MUTANTS) {
  const dir = side(base, id.replace(/[^\w-]+/g, '_'), file, from, to);
  const rep = replay(base, dir, 1, join(WORK, `${id.replace(/[^\w-]+/g, '_')}.json`));
  const differing = Object.entries(rep.callers).filter(([, c]) => c.diffs || c.missing).map(([k, c]) => `${k}(${c.diffs})`);
  const names = differing.map(s => s.replace(/\(.*$/, ''));
  let ok;
  if (expect === null) ok = differing.length >= 5; // the authority reaches many callers
  else if (expect.length === 0) ok = differing.length === 0;
  else ok = expect.every(e => names.includes(e)) && names.every(n => expect.includes(n));
  if (!ok) failures++;
  results.push({ check: id, ok, expected: expect, differing });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: differing ${differing.join(', ') || 'none'}${expect && expect.length ? '' : expect ? ' (equivalent: expect none)' : ' (expect ≥5 callers)'}`);
}
writeFileSync(join(WORK, 'selfcheck.json'), JSON.stringify(results, null, 2));
console.log(failures ? `SELF-CHECK FAILED (${failures})` : 'SELF-CHECK PASSED');
process.exit(failures ? 1 : 0);
