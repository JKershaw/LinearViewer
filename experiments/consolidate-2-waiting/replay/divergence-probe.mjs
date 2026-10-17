#!/usr/bin/env node
// Cross-caller agreement probe: on the same production-shaped loop (wakeMarker and
// terminalStatus baked the way _buildLoops bakes them), does each caller say "waiting on a
// person"? Disagreements are the composition divergences; each is tagged with the input
// feature that explains it.   node divergence-probe.mjs <tree> [n=3000] [seed=1]
process.env.TZ = 'UTC'; process.env.NODE_ENV = 'test';
import { resolve } from 'node:path'; import { pathToFileURL } from 'node:url';
import { rngFor, feedback, FIXED_NOW_MS } from './callers.mjs';
const [dir, nArg = '3000', seed = '1'] = process.argv.slice(2);
const im = (f) => import(pathToFileURL(resolve(dir, f)).href);
for (const k of ['log', 'warn', 'error', 'info']) console[`_${k}`] = console[k];
const quiet = () => { for (const k of ['log', 'warn', 'error', 'info']) console[k] = () => {}; };
const loud = () => { for (const k of ['log', 'warn', 'error', 'info']) console[k] = console[`_${k}`]; };
quiet();
const dt = await im('lib/dispatch-terminal.js');
const { deriveSessionWaiting, enrichLoop } = await im('routes/dashboard.js');
const { renderStepFace } = await im('lib/render-run-steps.js');
const { buildRunView } = await im('lib/run-view.js');
const { resolveDisposition } = await im('lib/unanswered-decisions.js');
const { classifyLoop } = await im('lib/observer-sweep.js');
const { __internal: PL } = await im('lib/pipeline-loops.js');
loud();
const N = Number(nArg); const verdicts = ['banner', 'runFlag', 'clock', 'disposition', 'censusLane', 'wire'];
const pair = new Map(); const examples = new Map(); let anyWaiting = 0;
for (let i = 0; i < N; i++) {
  const r = rngFor(seed, 'probe', i);
  let fb = feedback(r); if (!Array.isArray(fb)) fb = [];
  fb = fb.filter(e => e && typeof e.message === 'string');
  if (r.chance(0.5)) fb.push({ message: '[blocked] Which option?', timestamp: new Date(FIXED_NOW_MS - 3600e3).toISOString() });
  if (r.chance(0.15)) fb.push({ message: '[working] Session resumed. Executing follow-up', timestamp: new Date(FIXED_NOW_MS - 60e3).toISOString() });
  if (r.chance(0.1)) fb.push({ kind: r.pick(['decision-answer', 'decision-withdrawn']), message: '[blocked] stamp text (synthetic)', timestamp: new Date(FIXED_NOW_MS).toISOString() });
  const loop = {
    loopId: 'L0', lineageId: 'G1', feedback: fb, kind: 'implementation',
    terminalStatus: dt.deriveTerminalStatus(fb), wakeMarker: dt.findWakeEvent(fb)?.marker ?? null,
    agentStatus: r.pick([null, null, 'in_progress', 'blocked', 'completed', 'failed']),
    historyStatus: r.pick([null, null, null, null, 'cancelled', 'expired']),
    bookkeeping: r.chance(0.15) ? { at: new Date(FIXED_NOW_MS - 60e3).toISOString(), reason: 'handed-on' } : null,
    agentSummary: 'summary', dispatchedAt: new Date(FIXED_NOW_MS - 7200e3).toISOString(),
  };
  loop.agentState = PL._deriveAgentState('history', loop.historyStatus, loop.agentStatus); // as _buildLoops derives it
  quiet();
  const v = {
    banner: deriveSessionWaiting([enrichLoop(loop)]).waiting, // its contract: an ENRICHED loop
    runFlag: renderStepFace(loop).includes('session-run-waiting-flag'),
    clock: buildRunView({ loops: [loop], seedIssue: 'LIN-1' }, { now: FIXED_NOW_MS }).waiting.active,
    disposition: resolveDisposition(loop, { now: new Date(FIXED_NOW_MS) }) === 'resumable' && !loop.terminalStatus && !loop.bookkeeping,
    censusLane: classifyLoop(loop, { superseded: new Set(), now: FIXED_NOW_MS, staleMs: 3600e3 }) === 'blocked',
    wire: dt.deriveWireStatus({ feedback: fb, bookkeeping: loop.bookkeeping }) === 'blocked',
  };
  loud();
  if (Object.values(v).some(Boolean)) anyWaiting++;
  const last = (re) => { for (let j = fb.length - 1; j >= 0; j--) if (re.test(fb[j].message)) return j; return -1; };
  const tags = [];
  if (loop.agentState === 'waiting' && loop.wakeMarker !== 'blocked') tags.push('agent-status channel only');
  if (loop.wakeMarker === 'blocked' && last(/^\s*\[working\]\s*Session resumed\./i) > last(/^\s*\[blocked\]/i)) tags.push('resume after [blocked]');
  if (loop.bookkeeping) tags.push('closed row');
  if (loop.historyStatus) tags.push(`history ${loop.historyStatus}`);
  if (!loop.historyStatus && (loop.agentStatus === 'completed' || loop.agentStatus === 'failed')) tags.push(`agent-status ${loop.agentStatus}`);
  if (fb.length && fb[fb.length - 1].kind && /^decision-/.test(fb[fb.length - 1].kind)) tags.push('stamp entry carries a wake prefix');
  for (let a = 0; a < verdicts.length; a++) for (let b = a + 1; b < verdicts.length; b++) {
    const x = verdicts[a], y = verdicts[b];
    if (v[x] === v[y]) continue;
    const key = `${x} vs ${y}`; const tagKey = tags.join(' + ') || 'untagged';
    if (!pair.has(key)) pair.set(key, new Map());
    pair.get(key).set(tagKey, (pair.get(key).get(tagKey) || 0) + 1);
    if (!examples.has(tagKey)) examples.set(tagKey, { v, loop: { ...loop, feedback: fb.map(e => `${e.kind ? e.kind + ':' : ''}${e.message.slice(0, 40)}`) } });
  }
}
console.log(`probe: ${N} production-shaped loops; ${anyWaiting} called waiting by at least one caller`);
for (const [k, m] of [...pair].sort((p, q) => [...q[1].values()].reduce((s, n) => s + n, 0) - [...p[1].values()].reduce((s, n) => s + n, 0))) {
  const total = [...m.values()].reduce((s, n) => s + n, 0);
  console.log(`${k.padEnd(28)} ${String(total).padStart(5)}  ` + [...m].sort((p, q) => q[1] - p[1]).slice(0, 6).map(([t, n]) => `${n}× ${t}`).join('; '));
}
if (process.argv.includes('--examples')) for (const [t, e] of examples) console.log(`\n[${t}]`, JSON.stringify(e));
process.exit(0);
