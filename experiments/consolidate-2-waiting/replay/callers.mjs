// The callers of the "waiting on a person" decision, as they stand at d349e78c, and a
// seeded generator of inputs for each. A caller is the outsider-visible export that
// reaches the site (the site's own function when it is exported).
export const FIXED_NOW_ISO = '2026-10-15T12:00:00.000Z';
export const FIXED_NOW_MS = Date.parse(FIXED_NOW_ISO);

export function rngFor(seed, id, i) {
  let h = 2166136261 >>> 0;
  for (const ch of `${seed}|${id}|${i}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  let a = h || 1;
  const next = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const r = { next, int: (n) => Math.floor(next() * n), pick: (arr) => arr[Math.floor(next() * arr.length)], chance: (p) => next() < p };
  return r;
}

// ── Vocabulary: every marker/state value seen in the repo, plus unknown ones ──
export const WAKE = ['done', 'complete', 'failed', 'aborted', 'blocked', 'pending'];
const NON_WAKE = ['working', 'usage', 'evidence', 'decision', 'skipped', 'info', 'status', 'dispatcher'];
const UNKNOWN = ['question', 'waiting', 'paused', 'needs-input', 'blocked2', 'input'];
const CASES = (m) => [m, m.toUpperCase(), m[0].toUpperCase() + m.slice(1)];
export const MARKER_VALUES = [...WAKE, ...WAKE.flatMap(m => CASES(m).slice(1)), ...NON_WAKE, ...UNKNOWN];
const AGENT_STATES = ['queued', 'running', 'waiting', 'complete', 'error', 'stalled', null, undefined];
const AGENT_STATUS_WORDS = ['completed', 'complete', 'done', 'success', 'succeeded', 'in-progress', 'in_progress', 'In Progress',
  'working', 'started', 'running', 'blocked', 'Blocked', 'BLOCKED', ' blocked ', 'pending', 'Pending', 'waiting', 'waiting_on_human',
  'failed', 'failure', 'error', 'aborted', 'cancelled', 'canceled', 'skipped', 'question', 'unknown', '', null, undefined, 42];
const TERMINAL_STATUS = [undefined, null, 'done', 'failed', 'aborted', 'skipped', 'complete', 'blocked'];
const HISTORY_STATUS = [undefined, null, 'cancelled', 'expired', 'taken', 'done', 'pending'];
const TASK_STATES = ['queued', 'running', 'waiting', 'done', 'failed', 'closed', 'ended', 'unknown', undefined];
const STAMP_KINDS = ['decision-answer', 'decision-withdrawn', 'decision-withdrawal-reversed'];
const KINDS = [undefined, null, 'decision', 'status', 'assistant-text', 'usage', ...STAMP_KINDS];
const STAGES = ['plan', 'implementation', 'review', 'close-out', 'research', 'blocked', 'custom', 'autopilot', undefined];

const isoAt = (r) => new Date(FIXED_NOW_MS - r.int(10 * 24 * 3600) * 1000).toISOString();
const timeVal = (r) => r.pick([() => isoAt(r), () => new Date(isoAt(r)), () => null, () => undefined, () => 'not-a-date'])();

function message(r) {
  const m = r.pick([...MARKER_VALUES, ...WAKE, 'blocked', 'blocked', 'pending']);
  return r.pick([
    () => `[${m}] ${r.pick(['Need a ruling on X', 'All done', 'Waiting on the parent', 'PR #12 opened', ''])}`,
    () => `  [${m}]  text`,
    () => `see [${m}] mid-sentence`,
    () => '[working] Session resumed. Executing follow-up',
    () => '[working] heartbeat',
    () => '[usage] {"tokens":12}',
    () => JSON.stringify({ decision_id: r.pick(['d1', 'd2']) }),
    () => '',
    () => undefined,
    () => `[${m}]`,
  ])();
}

export function feedback(r, max = 7) {
  if (r.chance(0.04)) return r.pick([null, undefined, {}, 'x']);
  const n = r.int(max + 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const e = { message: message(r), timestamp: timeVal(r) };
    if (r.chance(0.3)) e.kind = r.pick(KINDS);
    if (r.chance(0.05)) e.message = 42;
    out.push(r.chance(0.02) ? null : e);
  }
  if (r.chance(0.3)) {
    out.push({ message: `[${r.pick(['blocked', 'Blocked', 'pending', 'question', 'done'])}] Need a person`, timestamp: timeVal(r), ...(r.chance(0.1) ? { kind: r.pick(STAMP_KINDS) } : {}) });
    if (r.chance(0.5)) out.push({ message: r.pick(['[usage] {}', '[working] heartbeat', '[working] Session resumed. Executing follow-up', JSON.stringify({ decision_id: 'd1' })]), timestamp: timeVal(r), kind: r.pick([undefined, 'decision-answer', 'usage']) });
  }
  return out;
}

const bookkeeping = (r) => r.pick([undefined, null, null, { at: isoAt(r), reason: 'handed-on' }, { at: new Date(isoAt(r)), reason: 'fossil-pass-lin2633' }, { reason: 'operator' }]);

export function loop(r, i = 0, ids = ['L0', 'L1', 'L2', 'L3']) {
  const fb = feedback(r);
  const l = {
    loopId: r.chance(0.95) ? `L${i}` : undefined,
    kind: r.pick(STAGES),
    terminalStatus: r.pick(TERMINAL_STATUS),
    agentState: r.pick(AGENT_STATES),
    historyStatus: r.pick(HISTORY_STATUS),
    bookkeeping: bookkeeping(r),
    feedback: fb,
    agentSummary: r.pick([null, undefined, 'agent summary text', '[blocked] summary with marker']),
    waitingMessage: r.pick([null, undefined, '[blocked] question?']),
    issueIdentifier: r.pick(['LIN-1', 'LIN-2', null]),
    issueTitle: r.pick([undefined, 'A task']),
    lineageId: r.pick([undefined, 'G1', 'G2']),
    dispatchedAt: timeVal(r),
    target: r.pick(['cli', 'web', 'local', undefined]),
    source: r.pick(['live', 'history', undefined]),
    decision: r.pick([null, undefined, { decision_id: 'd1', question: 'Q?' }]),
    decisionCase: r.pick([undefined, [], ['why']]),
  };
  if (r.chance(0.3)) l.followUpTo = r.pick(ids);
  // A third of loops are biased toward the live, waiting-shaped region the decision lives in.
  if (r.chance(0.35)) {
    delete l.terminalStatus; l.bookkeeping = null; l.historyStatus = r.pick([null, 'taken']);
    if (Array.isArray(l.feedback)) l.feedback.push({ message: `[${r.pick(['blocked', 'blocked', 'pending', 'BLOCKED', 'question'])}] Need a ruling`, timestamp: timeVal(r) },
      ...(r.chance(0.4) ? [{ message: r.pick(['[usage] {}', '[working] heartbeat', '[working] Session resumed. Executing follow-up', JSON.stringify({ decision_id: 'd1' })]), timestamp: timeVal(r), kind: r.pick([undefined, 'decision-answer', 'usage']) }] : []));
    if (r.chance(0.5)) l.agentState = r.pick(['running', 'waiting', 'queued']);
  }
  // wakeMarker: usually what the build-time scan would bake, sometimes anything at all.
  const w = r.next();
  if (w < 0.25) l.wakeMarker = r.pick([undefined, null, ...MARKER_VALUES]);
  else if (w < 0.5) {
    const last = Array.isArray(fb) ? [...fb].reverse().find(e => e && typeof e.message === 'string' && /^\s*\[(done|complete|failed|aborted|blocked|pending)\]/i.test(e.message)) : null;
    l.wakeMarker = last ? /^\s*\[(\w+)\]/.exec(last.message)[1].toLowerCase() : null;
  } // else leave absent (undefined property → fallback scan path)
  for (const k of Object.keys(l)) if (l[k] === undefined && r.chance(0.5)) delete l[k];
  return l;
}

const loops = (r, max = 4) => { const n = r.int(max + 1); const ids = Array.from({ length: n }, (_, i) => `L${i}`); return Array.from({ length: n }, (_, i) => loop(r, i, ids)); };

export const CALLERS = [
  { id: 'digest-feedback.deriveLoopFacingFacts', file: 'lib/digest-feedback.js', path: ['deriveLoopFacingFacts'],
    sites: ['lib/digest-feedback.js:56', 'lib/digest-feedback.js:346'],
    gen: (r) => [feedback(r), r.pick([isoAt(r), null])] },
  { id: 'render-run-steps.renderStepFace', file: 'lib/render-run-steps.js', path: ['renderStepFace'],
    sites: ['lib/render-run-steps.js:159', 'lib/render-run-steps.js:198'],
    gen: (r) => [loop(r), r.pick([{}, { supersededLoopIds: new Set(r.pick([[], ['L0'], ['L0', 'L1']])) }])] },
  { id: 'dashboard.deriveSessionWaiting', file: 'routes/dashboard.js', path: ['deriveSessionWaiting'],
    sites: ['routes/dashboard.js:338', 'routes/dashboard.js:356', 'routes/dashboard.js:362'],
    gen: (r) => [loops(r)] },
  { id: 'run-view.buildRunView', file: 'lib/run-view.js', path: ['buildRunView'],
    sites: ['lib/run-view.js:232'],
    gen: (r) => [{ loops: loops(r), seedIssue: r.pick(['LIN-1', null]), dispatchedAt: timeVal(r) }, { now: r.pick([FIXED_NOW_ISO, undefined]) }] },
  { id: 'task-page-loader.sessionMessage', file: 'lib/task-page-loader.js', path: ['sessionMessage'],
    sites: ['lib/task-page-loader.js:175'],
    gen: (r) => [loop(r), r.pick(TASK_STATES)] },
  { id: 'dispatch-terminal.deriveBlockedStatus', file: 'lib/dispatch-terminal.js', path: ['deriveBlockedStatus'],
    sites: ['lib/dispatch-terminal.js:225'], gen: (r) => [feedback(r)] },
  { id: 'dispatch-terminal.deriveLifecycleStatus', file: 'lib/dispatch-terminal.js', path: ['deriveLifecycleStatus'],
    sites: ['lib/dispatch-terminal.js:207'], gen: (r) => [feedback(r)] },
  { id: 'dispatch-terminal.deriveWireStatus', file: 'lib/dispatch-terminal.js', path: ['deriveWireStatus'],
    sites: ['lib/dispatch-terminal.js:257'], gen: (r) => [{ feedback: feedback(r), bookkeeping: bookkeeping(r) }] },
  { id: 'unanswered-decisions.resolveDisposition', file: 'lib/unanswered-decisions.js', path: ['resolveDisposition'],
    sites: ['lib/unanswered-decisions.js:71'],
    gen: (r) => { const l = loop(r); if (r.chance(0.5)) l.terminalCompletedAt = timeVal(r); return [l, { now: new Date(FIXED_NOW_MS) }]; } },
  { id: 'observer-sweep.classifyLoop', file: 'lib/observer-sweep.js', path: ['classifyLoop'],
    sites: ['lib/observer-sweep.js:97'],
    gen: (r) => [loop(r), { superseded: new Set(r.pick([[], ['L0']])), now: FIXED_NOW_MS, staleMs: r.pick([60000, 3600000]),
      answeredByLineage: r.pick([undefined, new Map(), new Map([['G1', new Set(['d1'])]])]) }] },
  { id: 'recent-runs.recentRuns', file: 'lib/recent-runs.js', path: ['recentRuns'],
    sites: ['lib/recent-runs.js:39'],
    gen: (r) => [Array.from({ length: r.int(6) }, (_, i) => ({ id: `R${i}`, kind: r.pick(STAGES), status: r.pick(['pending', 'taken', undefined, 'done', 'cancelled']),
      feedback: feedback(r), bookkeeping: bookkeeping(r), dispatchedAt: timeVal(r), ...(r.chance(0.1) ? { abort: true, abortTo: `R${r.int(3)}` } : {}) })), r.pick([undefined, 2, 5])] },
  { id: 'pipeline-loops._deriveAgentState', file: 'lib/pipeline-loops.js', path: ['__internal', '_deriveAgentState'],
    sites: ['lib/pipeline-loops.js:150'],
    gen: (r) => [r.pick(['live', 'history', undefined]), r.pick(HISTORY_STATUS), r.pick(AGENT_STATUS_WORDS)] },
  { id: 'live-console.statusToKind', file: 'lib/live-console.js', path: ['statusToKind'],
    sites: ['lib/live-console.js:122'], gen: (r) => [r.pick(AGENT_STATUS_WORDS)] },
  { id: 'observer-efficacy-signal.computeIncumbentSignal', file: 'lib/observer-efficacy-signal.js', path: ['computeIncumbentSignal'],
    sites: ['lib/observer-efficacy-signal.js:110', 'lib/observer-efficacy-signal.js:295'], gen: (r) => [loops(r)] },
  { id: 'dispatch-wake.classifyWake', file: 'lib/dispatch-wake.js', path: ['classifyWake'],
    sites: ['lib/dispatch-wake.js:343'],
    gen: (r) => [{ marker: r.pick([undefined, null, '', ...MARKER_VALUES]), personOriginated: r.chance(0.2), message: message(r) ?? '',
      prior: r.pick([null, { marker: 'pending', refs: [], text: 'x' }, { marker: 'blocked' }]) }] },
  { id: 'render-session.renderSessionPage', file: 'lib/render-session.js', path: ['renderSessionPage'],
    sites: ['lib/render-session.js:80'],
    gen: (r) => [{ session: { sessionId: 'S1', loops: loops(r, 3), seedIssue: 'LIN-1' }, urlKey: 'ws', canReply: r.chance(0.5), waiting: r.chance(0.3) }, {}] },
];
