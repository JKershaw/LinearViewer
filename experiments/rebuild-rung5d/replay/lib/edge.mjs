// Targeted edge cases read off the code of lib/pipeline-loops.js @ f4749b91:
// boundaries (30-day cutoff ±1 ms, inclusive agent-status windows, same-ms
// tie-breaks), the anchor/identifier-less kinds, lean digest variants, every
// _buildSessions stitch branch (LIN-1292/1341/1393), the I/O guards, and the
// handful of blocks the generator cannot reach by chance.
import { digestFeedback } from '/home/user/LinearViewer/lib/digest-feedback.js';
import { formatFeedbackEntries } from '/home/user/LinearViewer/lib/dispatch-feedback-format.js';
import { NOW_ISO } from './gen.mjs';

const NOW = Date.parse(NOW_ISO);
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();
const now = () => new Date(NOW_ISO);

function hist(id, o = {}) {
  const dispatchedAt = o.dispatchedAt ?? iso(NOW - 2 * HOUR);
  const raw = (o.rawFeedback || []).map(e => ({ ...e, timestamp: e.timestamp == null ? e.timestamp : new Date(e.timestamp) }));
  const item = {
    id, promptName: 'implementation', prompt: `p ${id}`, issueId: 'uuid-1', issueIdentifier: 'LIN-1', issueTitle: 'T', issueUrl: 'u',
    dispatchedAt, dispatchedBy: 'acct-1', trimHistory: [], sessionGroupId: null, rootItemId: null, kind: 'implementation', target: 'cli',
    repo: null, followUpTo: null, abort: false, abortTo: null, sessionId: null, maxTasks: null, status: 'taken',
    resolvedAt: iso(Date.parse(dispatchedAt) + MIN), takenByTokenLabel: null, bookkeeping: null, ...o,
  };
  delete item.rawFeedback;
  if (raw.length) item.feedback = formatFeedbackEntries(raw);
  if (!('feedbackDigest' in o)) {
    const d = digestFeedback({ feedback: raw, dispatchedAt }, { now: NOW });
    d.version = 0; item.feedbackVersion = 0; item.feedbackDigest = d;
  }
  return item;
}
function live(id, o = {}) {
  return { id, promptName: 'plan', prompt: 'p', issueId: 'uuid-1', issueIdentifier: 'LIN-1', issueTitle: 'T', issueUrl: 'u', workspace: { urlKey: 'ws' }, dispatchedAt: iso(NOW - 10 * MIN), dispatchedBy: 'acct-1', target: 'cli', repo: null, kind: 'plan', sessionId: null, followUpTo: null, sessionGroupId: null, rootItemId: null, maxTasks: null, abort: false, abortTo: null, expiresAt: iso(NOW + DAY), ...o };
}
const fs = (id, o = {}) => ({ id, taskIdentifier: 'LIN-1', action: 'implementation', status: 'completed', summary: 'Done.', timestamp: iso(NOW - HOUR), ...o });
const bl = (input) => ({ fn: '__internal._buildLoops', args: [{ now: now(), ...input }] });
const chain = (input, opts = {}) => [bl(input), { fn: '__internal._buildSessions', args: [{ $step: 0 }, { now: now(), ...opts }] }];
const D = (extra = {}) => ({ dispatchStore: { $store: 'dispatchStore' }, agentStatusStore: { $store: 'agentStatusStore' }, ...extra });
const world = (w) => ({ kind: 'semantic', live: [], history: [], status: [], raw: [], naive: false, historyCollection: false, modes: {}, ...w });

const T0 = NOW - 3 * HOUR;
const fbDone0 = () => [{ message: '[done] finished in 5m', timestamp: iso(5 * MIN) }];
const cases = [];
const add = (name, sc) => cases.push({ id: `edge:${cases.length}`, tier: 'edge', family: name, site: name, env: sc.env || {}, world: sc.world || null, steps: sc.steps });

// ── 30-day cutoff and horizon ──
add('cutoff exactly 30d kept, 30d+1ms dropped', { steps: [bl({ historyItems: [hist('h-edge', { dispatchedAt: iso(NOW - 30 * DAY) }), hist('h-over', { dispatchedAt: iso(NOW - 30 * DAY - 1) })], liveItems: [live('l-edge', { dispatchedAt: iso(NOW - 30 * DAY) }), live('l-over', { dispatchedAt: iso(NOW - 30 * DAY - 1) })] })] });
add('horizon all keeps 90d-old rows', { steps: [bl({ horizon: 'all', historyItems: [hist('h-old', { dispatchedAt: iso(NOW - 90 * DAY) })], liveItems: [live('l-old', { dispatchedAt: iso(NOW - 90 * DAY) })] })] });
add('horizon all + epoch-0 dispatchedAt (falsy item.dispatchedAt kept)', { steps: [bl({ horizon: 'all', lean: true, historyItems: [hist('h-zero', { dispatchedAt: 0, feedbackDigest: undefined })], liveItems: [live('l-zero', { dispatchedAt: 0 })] }), bl({ horizon: 'all', historyItems: [hist('h-zero2', { dispatchedAt: 0 })] })] });
add('horizon all + lean + digest + epoch-0 dispatchedAt', { steps: [bl({ horizon: 'all', lean: true, historyItems: [hist('h-zero3', { dispatchedAt: 0, rawFeedback: fbDone0() })] })] });
add('now as string throws', { steps: [{ fn: '__internal._buildLoops', args: [{ now: NOW_ISO, liveItems: [live('l1')] }] }] });
add('now as number throws', { steps: [{ fn: '__internal._buildLoops', args: [{ now: NOW }] }] });
add('no args / null arg', { steps: [{ fn: '__internal._buildLoops', args: [] }, { fn: '__internal._buildLoops', args: [undefined] }, { fn: '__internal._buildLoops', args: [null] }] });
add('items as non-arrays', { steps: [{ fn: '__internal._buildLoops', args: [{ now: now(), liveItems: null }] }, { fn: '__internal._buildLoops', args: [{ now: now(), historyItems: 'x' }] }, { fn: '__internal._buildLoops', args: [{ now: now(), agentStatusEntries: {} }] }] });

// ── malformed rows / warn-once ──
const badLive = [null, {}, { id: 'nid' }, { id: 'nid' }, { id: 'w1', kind: 'wake' }, { id: 'ap1', kind: 'autopilot', dispatchedAt: iso(NOW - HOUR) }, { id: 'bad-date', issueIdentifier: 'LIN-1', dispatchedAt: 'nope' }, { id: 0, issueIdentifier: 'LIN-1' }];
add('malformed rows warn once per cause per instance', { steps: [bl({ liveItems: badLive, historyItems: [null, { id: 'hn' }, { id: 'hw', kind: 'wake', issueIdentifier: '' }, { id: 'hb', issueIdentifier: 'LIN-1', dispatchedAt: undefined }] }), bl({ liveItems: badLive }), bl({ liveItems: [{ id: 'nid2' }], historyItems: [{ id: 'hn' }] })] });

// ── agent-status matching ──
const L = live('L1', { dispatchedAt: iso(T0) });
add('window bounds inclusive (lower == dispatchedAt, upper == next dispatch)', { steps: [bl({ liveItems: [L, live('L2', { dispatchedAt: iso(T0 + HOUR) })], agentStatusEntries: [fs('at-lower', { timestamp: iso(T0), status: 'blocked' }), fs('at-upper', { timestamp: iso(T0 + HOUR), status: 'failed' }), fs('before', { timestamp: iso(T0 - 1) }), fs('after-now', { timestamp: iso(NOW + 1) })] })] });
add('exact dispatchId beats window; ties keep the first; null timestamps', { steps: [bl({ historyItems: [hist('H1', { dispatchedAt: iso(T0), resolvedAt: iso(T0 + MIN) })], agentStatusEntries: [fs('e1', { dispatchId: 'H1', timestamp: null, status: 'failed' }), fs('e2', { dispatchId: 'H1', timestamp: iso(T0 + 5 * HOUR), status: 'blocked' }), fs('e3', { dispatchId: 'H1', timestamp: iso(T0 + 5 * HOUR), status: 'completed' }), fs('e4', { dispatchId: 'H1', timestamp: 'bad' }), fs('w', { timestamp: iso(T0 + 30 * 1000) })] }), { fn: '__internal._matchAgentStatusToLoop', args: [{ loopId: 'X', _dispatchedAtDate: new Date(T0) }, [fs('n1', { dispatchId: 'X', timestamp: null }), fs('n2', { dispatchId: 'X', timestamp: null })], now()] }, { fn: '__internal._matchAgentStatusToLoop', args: [{ loopId: 'X', _dispatchedAtDate: new Date(T0) }, [fs('n1', { dispatchId: 'X', timestamp: iso(T0) }), fs('n2', { dispatchId: 'X', timestamp: null })], now()] }, { fn: '__internal._matchAgentStatusToLoop', args: [{ loopId: 'X', _dispatchedAtDate: null }, [fs('w1')], now()] }, { fn: '__internal._matchAgentStatusToLoop', args: [{ loopId: 'X', _dispatchedAtDate: new Date(T0), _upperDate: null }, [fs('w1', { timestamp: iso(T0 + 1) })], null] }] });
add('resolvedAt before dispatchedAt: empty window', { steps: [bl({ historyItems: [hist('H1', { dispatchedAt: iso(T0), resolvedAt: iso(T0 - MIN) })], agentStatusEntries: [fs('x', { timestamp: iso(T0) })] })] });
add('same-ms dispatches tie-break on String(loopId).localeCompare', { steps: [bl({ liveItems: [live('b', { dispatchedAt: iso(T0) }), live('B', { dispatchedAt: iso(T0) }), live('a', { dispatchedAt: iso(T0) }), live(10, { dispatchedAt: iso(T0) }), live(9, { dispatchedAt: iso(T0) }), live('é', { dispatchedAt: iso(T0) }), live('e', { dispatchedAt: iso(T0) })] })] });
add('issueIdentifier that looks like an anchor bucket key', { steps: [bl({ liveItems: [live('X1', { issueIdentifier: '__anchor__:X1' }), live('X2', { issueIdentifier: '__anchor__:zzz', dispatchedAt: iso(NOW - 5 * MIN) })], agentStatusEntries: [fs('s1', { taskIdentifier: '__anchor__:X1', timestamp: iso(NOW - 8 * MIN) }), fs('s2', { dispatchId: 'X1', taskIdentifier: undefined, timestamp: iso(NOW - 9 * MIN), status: 'failed' })] })] });
add('general autopilot anchors: own bucket, dispatchId-only status, empty-string identifier', { steps: chain({ liveItems: [live('G1', { kind: 'autopilot', issueIdentifier: null, maxTasks: 3 }), live('G2', { kind: 'autopilot', issueIdentifier: '', maxTasks: 2, dispatchedAt: iso(NOW - 20 * MIN) })], historyItems: [hist('w1', { sessionId: 'G1', issueIdentifier: 'LIN-2' }), hist('w2', { sessionId: 'G1', issueIdentifier: 'LIN-2', followUpTo: 'w1' }), hist('w3', { sessionId: 'G1', issueIdentifier: 'LIN-3', abort: true }), hist('w4', { sessionId: 'G2', issueIdentifier: null, kind: 'wake' })], agentStatusEntries: [fs('a', { taskIdentifier: undefined, dispatchId: 'G1', status: 'blocked', timestamp: iso(NOW - 5 * MIN) }), fs('b', { taskIdentifier: 'G1', timestamp: iso(NOW - 4 * MIN) })] }) });
add('agentState truth table via rows', { steps: [bl({ liveItems: [live('q')], historyItems: ['expired', 'cancelled', 'taken', 'aborted', undefined].flatMap((st, i) => ['completed', 'failed', 'blocked', 'weird', undefined].map((as, j) => hist(`h${i}${j}`, { issueIdentifier: `LIN-${10 + i * 5 + j}`, status: st }))), agentStatusEntries: ['expired', 'cancelled', 'taken', 'aborted', undefined].flatMap((st, i) => ['completed', 'failed', 'blocked', 'weird', undefined].map((as, j) => fs(`s${i}${j}`, { taskIdentifier: `LIN-${10 + i * 5 + j}`, status: as, action: j % 2 ? '' : 'review', timestamp: iso(NOW - 2 * HOUR + 1000) }))) })] });

// ── lean digest variants ──
const fbDone = [{ message: '[working · running] 3 tools in 9s', timestamp: iso(T0 + MIN), kind: 'heartbeat' }, { message: '[done] finished in 5m', timestamp: iso(T0 + 5 * MIN) }];
add('lean: digest missing decisionCase / answeredDecisions / withdrawalReversed keys', { steps: [bl({ lean: true, historyItems: [
  (() => { const h = hist('h1', { rawFeedback: fbDone }); delete h.feedbackDigest.decisionCase; delete h.feedbackDigest.answeredDecisions; h.feedbackDigest.answeredDecisionId = 'd-9'; delete h.feedbackDigest.withdrawalReversed; delete h.feedback; return h; })(),
  (() => { const h = hist('h2', { rawFeedback: fbDone }); h.feedbackDigest.answeredDecisions = 'not-array'; h.feedbackDigest.withdrawalReversed = 'yes'; h.feedbackDigest.telemetry.ticketMarkers = []; delete h.feedback; return h; })(),
  (() => { const h = hist('h3', { rawFeedback: fbDone }); h.feedbackDigest = { version: 0 }; delete h.feedback; return h; })(),
  (() => { const h = hist('h4', { rawFeedback: fbDone }); h.feedbackDigest.telemetry = null; return h; })(),
  hist('h5', { feedbackDigest: null }), hist('h6', { feedbackDigest: undefined }),
] })] });
add('lean vs non-lean: same rows both ways', { steps: [bl({ historyItems: [hist('a', { rawFeedback: fbDone, rootItemId: 'r' }), hist('b', { rawFeedback: [{ message: '[working] 7 tools/30s', timestamp: iso(T0 + 2 * MIN) }], rootItemId: 'r', dispatchedAt: iso(T0 + MIN) })] }), bl({ lean: true, historyItems: [hist('a', { rawFeedback: fbDone, rootItemId: 'r' }), hist('b', { rawFeedback: [{ message: '[working] 7 tools/30s', timestamp: iso(T0 + 2 * MIN) }], rootItemId: 'r', dispatchedAt: iso(T0 + MIN) })] })] });
const abortRow = (id, to, msg, ts) => hist(id, { issueIdentifier: null, abort: true, abortTo: to, status: 'aborted', kind: 'custom', rawFeedback: [{ message: msg, timestamp: ts }] });
add('abort harvest: later abort wins, earlier abort loses to [done], [skipped] ignored, lean and non-lean', { steps: [
  bl({ liveItems: [live('T1', { dispatchedAt: iso(T0) })], historyItems: [hist('T2', { dispatchedAt: iso(T0), rawFeedback: fbDone }), hist('T3', { dispatchedAt: iso(T0), issueIdentifier: 'LIN-3', rawFeedback: fbDone }), abortRow('A1', 'T1', '[aborted] cancelled', iso(T0 + 9 * MIN)), abortRow('A2', 'T2', '[aborted] cancelled', iso(T0 + 2 * MIN)), abortRow('A3', 'T3', '[aborted] cancelled', iso(T0 + 50 * MIN)), abortRow('A4', 'T1', '[skipped] human-continued session', iso(T0 + 10 * MIN))] }),
  bl({ lean: true, liveItems: [live('T1', { dispatchedAt: iso(T0) })], historyItems: [hist('T2', { dispatchedAt: iso(T0), rawFeedback: fbDone }), hist('T3', { dispatchedAt: iso(T0), issueIdentifier: 'LIN-3', rawFeedback: fbDone }), abortRow('A1', 'T1', '[aborted] cancelled', iso(T0 + 9 * MIN)), abortRow('A2', 'T2', '[aborted] cancelled', iso(T0 + 2 * MIN)), abortRow('A3', 'T3', '[aborted] cancelled', iso(T0 + 50 * MIN))] }),
] });
add('decisions: answered, withdrawn, reversed, assistant-text case', { steps: [bl({ historyItems: [hist('D1', { rawFeedback: [
  { message: 'Thinking.', kind: 'assistant-text', timestamp: iso(T0 + 1000) }, { message: 'More.', kind: 'assistant-text', timestamp: iso(T0 + 2000) },
  { message: '[decision] {"decision_id":"d-1","question":"Q?","options":[{"id":"a","label":"A"}],"recommended":"a"}', kind: 'decision', timestamp: iso(T0 + 3000) },
  { message: JSON.stringify({ decision_id: 'd-1', outcome: 'dismissed' }), kind: 'decision-answer', timestamp: iso(T0 + 4000) },
  { message: JSON.stringify({ decision_id: 'd-1', reason: 'moot' }), kind: 'decision-withdrawn', timestamp: iso(T0 + 5000) },
  { message: JSON.stringify({ decision_id: 'd-1' }), kind: 'decision-withdrawal-reversed', timestamp: iso(T0 + 6000) },
  { message: '[blocked] awaiting a ruling', timestamp: iso(T0 + 7000) }] })] }),
  { fn: 'firstRaisedAt', args: [[{ kind: 'decision', message: '[decision] {"decision_id":"d-1"}' }, { kind: 'decision', message: '[decision] {"decision_id":"d-1"}', timestamp: 't2' }], 'd-1'] },
  { fn: 'firstRaisedAt', args: [[{ kind: 'decision', message: '[decision] {"decision_id":"d-1"}', timestamp: '' }], 'd-1'] },
  { fn: 'firstRaisedAt', args: [[null, { kind: 'decision' }], 'd-1'] }] });

// ── sessions: every stitch branch ──
const S = (id, o) => hist(id, { dispatchedAt: iso(T0 + (o.at || 0) * MIN), ...o, at: undefined });
add('LIN-1393 straddle: root unclaimed session-target', { steps: chain({ historyItems: [S('A', { at: 0 }), S('B', { at: 1, followUpTo: 'A' }), S('C', { at: 2, followUpTo: 'B', sessionGroupId: 'B' })] }) });
add('LIN-1393 straddle: root owned by an autopilot session', { steps: chain({ historyItems: [S('AP', { at: 0, kind: 'autopilot' }), S('A', { at: 1, sessionId: 'AP' }), S('B', { at: 2, followUpTo: 'A', sessionId: null }), S('C', { at: 3, followUpTo: 'B', sessionGroupId: 'B' })] }) });
add('LIN-1393 straddle: root is a dash row (cannot anchor)', { steps: chain({ historyItems: [S('A', { at: 0, target: 'dash' }), S('B', { at: 1, followUpTo: 'A' }), S('C', { at: 2, followUpTo: 'B', sessionGroupId: 'B' })] }) });
add('LIN-1393 straddle: chain root aged out (resolve null)', { steps: chain({ historyItems: [S('B', { at: 1, followUpTo: 'gone' }), S('C', { at: 2, followUpTo: 'B', sessionGroupId: 'B' })] }) });
add('group id is an autopilot session key', { steps: chain({ historyItems: [S('AP', { at: 0, kind: 'autopilot', issueIdentifier: 'LIN-1' }), S('W', { at: 1, sessionId: 'AP', issueIdentifier: 'LIN-2' }), S('R', { at: 2, followUpTo: 'W', sessionGroupId: 'AP' })] }) });
add('group root aged out: followers coalesce anchorless', { steps: chain({ historyItems: [S('F1', { at: 1, followUpTo: 'old', sessionGroupId: 'old' }), S('F2', { at: 2, followUpTo: 'F1', sessionGroupId: 'old' })] }) });
add('group root present but incompatible (autopilot / dash / claimed)', { steps: chain({ historyItems: [S('AP', { at: 0, kind: 'autopilot', issueIdentifier: null }), S('F1', { at: 1, followUpTo: 'AP', sessionGroupId: 'AP2' }), S('AP2', { at: 0, kind: 'autopilot', target: 'web' }), S('DR', { at: 0, target: 'dash' }), S('F2', { at: 1, followUpTo: 'DR', sessionGroupId: 'DR' }), S('F3', { at: 2, followUpTo: 'DR', target: 'local' })] }) });
add('legacy chain: root dash, root autopilot, cycle, self-loop, missing root', { steps: chain({ historyItems: [S('R1', { at: 0, target: 'dash' }), S('f1', { at: 1, followUpTo: 'R1' }), S('AP', { at: 0, kind: 'autopilot', issueIdentifier: 'LIN-7' }), S('f2', { at: 1, followUpTo: 'AP', issueIdentifier: 'LIN-8' }), S('c1', { at: 1, followUpTo: 'c2' }), S('c2', { at: 2, followUpTo: 'c1' }), S('self', { at: 3, followUpTo: 'self' }), S('m', { at: 4, followUpTo: 'missing' }), S('A', { at: 5, target: 'web' }), S('B', { at: 6, followUpTo: 'A', target: 'web' }), S('C', { at: 7, followUpTo: 'B', target: 'cli' })] }) });
add('duplicate loopIds across live and history', { steps: chain({ liveItems: [live('DUP', { kind: 'autopilot', dispatchedAt: iso(T0) }), live('W', { sessionId: 'GONE', dispatchedAt: iso(T0 + MIN) })], historyItems: [S('DUP', { at: 2, sessionId: 'GONE2' }), S('W', { at: 3, sessionId: 'DUP' }), S('X', { at: 4, sessionId: 'GONE' })] }) });
add('inference: seed/descendant/ancestor in window, stamped elsewhere never stolen, other orchestrator never absorbed', { steps: chain({ historyItems: [S('AP', { at: 0, kind: 'autopilot', issueIdentifier: 'P', rawFeedback: [{ message: '[done] in 9m', timestamp: iso(T0 + 60 * MIN) }] }), S('k1', { at: 5, issueIdentifier: 'C1' }), S('k2', { at: 59, issueIdentifier: 'GP' }), S('k3', { at: 61, issueIdentifier: 'C1' }), S('k4', { at: 6, issueIdentifier: 'C2', sessionId: 'OTHER' }), S('AP2', { at: 7, kind: 'autopilot', issueIdentifier: 'C1' }), S('k5', { at: 8, issueIdentifier: 'UNREL' }), S('k6', { at: 0, issueIdentifier: 'P' })] }, { issueGraph: { parentOf: { C1: 'P', C2: 'C1', P: 'GP', GP: null, X: 'GP' } } }) });
add('taskPosition: maxTasks variants and seam scoping', { steps: ['3', 0, 1, 2.5, null, Infinity].map((mt, i) => ({ fn: '__internal._assembleSession', args: [`AP${i}`, { loopId: `AP${i}`, kind: 'autopilot', issueIdentifier: 'LIN-1', dispatchedAt: iso(T0), maxTasks: mt, terminalCompletedAt: null }, [{ loopId: `AP${i}`, kind: 'autopilot', issueIdentifier: 'LIN-1', dispatchedAt: iso(T0), terminalCompletedAt: null }, { loopId: 'w1', sessionId: `AP${i}`, issueIdentifier: 'LIN-2', dispatchedAt: iso(T0 + 1), terminalCompletedAt: iso(T0 + 9) }, { loopId: 'w2', sessionId: `AP${i}`, issueIdentifier: 'LIN-2', dispatchedAt: iso(T0 + 2), terminalCompletedAt: iso(T0 + 8) }, { loopId: 'w3', sessionId: `AP${i}`, issueIdentifier: 'LIN-3', followUpTo: 'w1', dispatchedAt: iso(T0 + 3) }, { loopId: 'w4', sessionId: `AP${i}`, issueIdentifier: 'LIN-4', abort: true, dispatchedAt: iso(T0 + 4) }, { loopId: 'w5', sessionId: `AP${i}`, issueIdentifier: null, dispatchedAt: 'bad' }]] })) });
add('_assembleSession: completedAt only when all terminal; empty loops', { steps: [{ fn: '__internal._assembleSession', args: ['S', null, []] }, { fn: '__internal._assembleSession', args: ['S', null, [{ loopId: 'a', dispatchedAt: iso(T0), terminalCompletedAt: iso(T0 + 5) }, { loopId: 'b', dispatchedAt: iso(T0), terminalCompletedAt: 'bad' }]] }, { fn: '__internal._assembleSession', args: ['S', null, [{ loopId: 'a', dispatchedAt: iso(T0), feedback: [{ message: '[done]', timestamp: iso(T0 + 7) }] }, { loopId: 'b', dispatchedAt: null, terminalCompletedAt: iso(T0 + 3) }]] }] });
add('_buildSessions: defaults', { steps: [{ fn: '__internal._buildSessions', args: [] }, { fn: '__internal._buildSessions', args: [undefined, undefined] }, { fn: '__internal._buildSessions', args: [[{ loopId: 'x', target: 'cli', dispatchedAt: iso(T0) }]] }] });
add('_hierarchyHelpers: cycles, missing graph', { steps: [{ fn: '__internal._hierarchyHelpers', args: [{ parentOf: { a: 'b', b: 'a', c: 'a', d: 'c', e: '' } }], invoke: ['a', 'b', 'c', 'd', 'e', 'zz'].flatMap(id => [{ method: 'descendantsOf', args: [id] }, { method: 'ancestorsOf', args: [id] }]) }, { fn: '__internal._hierarchyHelpers', args: [], invoke: [{ method: 'descendantsOf', args: ['a'] }, { method: 'ancestorsOf', args: ['a'] }] }] });
add('deriveIssueGraph: parent outside set, identifier missing, duplicate ids', { steps: [{ fn: 'deriveIssueGraph', args: [[{ id: 'u1', identifier: 'A' }, { id: 'u2', identifier: 'B', parent: { id: 'u1' } }, { id: 'u3', parent: { id: 'u2' } }, { id: 'u4', identifier: 'D', parent: { id: 'nope' } }, { id: 'u2', identifier: 'B2' }, { id: 'u5', identifier: 'E', parent: { id: 'u3' } }, null, { identifier: 'noid' }]] }, { fn: 'deriveIssueGraph', args: [] }] });

// ── I/O boundary ──
const W1 = world({ live: [live('L1')], history: [hist('H1', { rawFeedback: fbDone }), hist('H2', { feedbackDigest: undefined, rawFeedback: fbDone }), hist('H3', { feedbackVersion: 2 })], status: [fs('s1')], raw: [{ _id: 'H2', feedback: [], dispatchedAt: new Date(T0), feedbackVersion: undefined }, { _id: 'H3', feedback: fbDone.map(e => ({ ...e, timestamp: new Date(e.timestamp) })), dispatchedAt: new Date(T0), feedbackVersion: 2 }], historyCollection: true });
add('guards: missing urlKey/issue/stores', { world: W1, steps: [{ fn: 'getLoopsForIssue', args: ['', 'LIN-1', D()] }, { fn: 'getLoopsForIssue', args: ['ws', '', D()] }, { fn: 'getLoopsForIssue', args: ['ws', 'LIN-1'] }, { fn: 'getLoopsForWorkspace', args: [''] }, { fn: 'getLoopsForWorkspace', args: ['ws'] }, { fn: 'getSessionsForWorkspace', args: [null] }, { fn: 'getSessionsForWorkspace', args: ['ws', { dispatchStore: { $store: 'dispatchStore' } }] }, { fn: 'getSessionsForIssues', args: [''] }, { fn: 'getSessionsForIssues', args: ['ws', {}] }, { fn: 'getSessionsForIssues', args: ['ws', D(), []] }, { fn: 'getSessionsForIssues', args: ['ws', D(), [], { extraItems: [] }] }, { fn: 'getSessionsForIssues', args: ['ws', D(), ['LIN-1'], { extraItems: null }] }, { fn: 'getSessionsForIssues', args: ['ws', D(), null, { extraItems: [{ id: 'G', kind: 'autopilot', status: 'queued', dispatchedAt: iso(NOW - MIN) }] }] }] });
add('lean self-heal: stale rows re-read, written back, vanished row served stale', { world: { ...W1, modes: {} }, steps: [{ fn: 'getLoopsForWorkspace', args: ['ws', D({ lean: true })] }, { fn: '__internal._fetchWorkspaceData', args: ['ws', D(), { lean: true, issueIdentifier: 'LIN-1', horizon: 'all' }] }] });
add('lean self-heal: updateOne rejects with a non-Error / empty message', { world: { ...W1, modes: { updateOne: 'rejectBare' } }, steps: [{ fn: 'redigestHistoryRows', args: [['H2', 'H3', 'nope'], { $store: 'dispatchStore' }] }, { fn: 'redigestHistoryRows', args: [['H3'], { $store: 'dispatchStore' }, { persist: false }] }, { fn: 'redigestHistoryRows', args: ['H3', { $store: 'dispatchStore' }] }, { fn: 'redigestHistoryRows', args: [['H3'], {}] }] });
add('OBSERVATION_FEED_TIMING=1 lean prints one timing line', { env: { OBSERVATION_FEED_TIMING: '1' }, world: W1, steps: [{ fn: 'getSessionsForWorkspace', args: ['ws', D({ lean: true })] }, { fn: 'getSessionsForWorkspace', args: ['ws', D({ lean: false })] }] });
add('stores returning sync values / garbage shapes', { world: { ...W1, modes: { listItems: 'sync', listHistory: 'itemsNotArray', listStatus: 'null' } }, steps: [{ fn: 'getLoopsForWorkspace', args: ['ws', D()] }, { fn: 'getSessionsForIssues', args: ['ws', D(), ['LIN-1', 'LIN-1', ''], { lean: true, extraItems: [{ id: 'G', issueIdentifier: null, kind: 'autopilot', status: 'taken', dispatchedAt: iso(NOW - MIN) }, { id: 'L1', status: 'queued', issueIdentifier: 'LIN-1', dispatchedAt: iso(NOW - MIN) }] }] }] });
add('stores throwing synchronously', { world: { ...W1, modes: { listStatus: 'throw' } }, steps: [{ fn: 'getLoopsForIssue', args: ['ws', 'LIN-1', D()] }, { fn: 'getSessionsForIssues', args: ['ws', D(), ['LIN-1'], { extraItems: [{ id: 'G', kind: 'autopilot', status: 'taken' }] }] }] });
add('updateOne rejects with an empty Error', { world: { ...W1, modes: { updateOne: 'rejectEmpty' } }, steps: [{ fn: 'getLoopsForWorkspace', args: ['ws', D({ lean: true })] }] });
add('find rejects: self-heal fails the whole fill', { world: { ...W1, modes: { find: 'reject' } }, steps: [{ fn: 'getLoopsForWorkspace', args: ['ws', D({ lean: true })] }] });
add('internal export constants', { steps: [{ fn: '__internal._deriveStage', args: [] }, { fn: '__internal._deriveAgentState', args: [] }, { fn: '__internal._loopCompletedAt', args: [] }, { fn: '__internal._sessionWindow', args: [{ dispatchedAt: 'bad', terminalCompletedAt: 'bad' }, now()] }, { fn: '__internal._findLastDecision', args: ['x'] }, { fn: '__internal.correlateDecisionCase', args: [[{ kind: 'assistant-text' }, { kind: 'decision' }], 1] }] });

export function edgeCases() { return cases; }
