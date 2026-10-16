// Seeded generator of realistic dispatch histories and the calls made over
// them. Every case is a pure function of (seed, tier, index), so `gen:1234`
// is identical at any --n. Shapes follow the store formatters
// (lib/dispatch-store.js _formatItem/_formatHistoryItem + dispatch-fields.js
// RUN_FIELDS, lib/agent-status-store.js listStatus) and the feedback grammar
// the parsers read (lib/dispatch-terminal.js, lib/session-telemetry.js,
// lib/digest-feedback.js). Digests are minted by the REAL digestFeedback.
import { mulberry32 } from './hermetic.mjs';
import { digestFeedback } from '/home/user/LinearViewer/lib/digest-feedback.js';
import { formatFeedbackEntries } from '/home/user/LinearViewer/lib/dispatch-feedback-format.js';

export const NOW_ISO = '2026-10-01T12:00:00.000Z';
const NOW = Date.parse(NOW_ISO);
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const LOOKBACK = 30 * DAY;

export function rngFor(seed, tier, index) {
  let h = 2166136261 >>> 0;
  const s = `${seed}|${tier}|${index}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const r = mulberry32(h);
  const R = {
    f: r,
    int: (a, b) => a + Math.floor(r() * (b - a + 1)),
    chance: (p) => r() < p,
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    wpick: (pairs) => { const t = pairs.reduce((s, [, w]) => s + w, 0); let x = r() * t; for (const [v, w] of pairs) { if ((x -= w) < 0) return v; } return pairs[pairs.length - 1][0]; },
    hex: (n = 8) => { let s = ''; for (let i = 0; i < n; i++) s += '0123456789abcdef'[Math.floor(r() * 16)]; return s; },
    shuffle: (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
  };
  return R;
}

const iso = (ms) => new Date(ms).toISOString();

// A timestamp in one of the shapes the stores can hand back.
function tsShape(R, ms, { allowBad = true } = {}) {
  const k = R.wpick([['iso', 86], ['date', 5], ['epoch', 2], ['bad', allowBad ? 2 : 0], ['missing', allowBad ? 2 : 0], ['null', allowBad ? 1 : 0], ['offset', 2]]);
  if (k === 'iso') return iso(ms);
  if (k === 'date') return new Date(ms);
  if (k === 'epoch') return ms;
  if (k === 'bad') return R.pick(['not-a-date', '', 't5', '2026-13-45T99:00:00Z']);
  if (k === 'null') return null;
  if (k === 'offset') return new Date(ms).toISOString().replace('Z', '+00:00');
  return undefined;
}

// ── feedback grammar ─────────────────────────────────────────────────────
const HEARTBEATS = [
  (R) => `[working · running] ${R.int(1, 40)} tools in ${R.int(2, 300)}s`,
  (R) => `[working] ${R.int(1, 30)} tools/${R.int(1, 90)}s · alive`,
  (R) => `[working · running] ${R.int(2, 9)} tools in ${R.int(1, 9)}m: Bash×${R.int(1, 5)} Read×${R.int(1, 5)} · ${R.int(5, 50)} total`,
  () => '[working] no tool calls · idle',
  () => '[working · running] alive',
  (R) => `${R.int(1, 9)} tools in ${R.int(1, 59)}s`,
  () => '[working] Session resumed. Continuing.',
];
const TERMINALS = [
  (R) => `[done] finished in ${R.int(1, 50)}m`, () => '[done]', () => '[complete] all checks green',
  (R) => `[failed] tests red in ${R.int(1, 9)}m`, () => '[aborted] cancelled by operator',
  () => '[skipped] human-continued session 3e626118 (implementation).', () => '  [DONE] Task completed in 45s',
];
const WAKES = [() => '[blocked] awaiting a ruling', () => '[blocked]', () => '[pending] waiting for CI'];

function decisionPayload(R, id) {
  const shape = R.wpick([['full', 5], ['min', 3], ['bad', 1], ['noId', 1], ['array', 0.5]]);
  if (shape === 'bad') return `[decision] {"decision_id":"${id}", not-json`;
  if (shape === 'noId') return `[decision] {"kind":"escalate","options":["A","B"]}`;
  if (shape === 'array') return '[decision] [1,2]';
  const p = { decision_id: id };
  if (shape === 'full') {
    p.question = R.pick(['Ship it?', 'Which approach — batch 3 tools in one turn?', 'Split the PR?']);
    p.options = [{ id: 'a', label: 'Option A', cost: R.int(1, 5) }, { id: 'b', label: 'Option B' }, { id: 7, label: 'bad' }];
    if (R.chance(0.7)) p.recommended = R.pick(['a', 'b', 'zz']);
    if (R.chance(0.3)) p.free_text = R.chance(0.5);
    if (R.chance(0.3)) p.if_unanswered = { after: '2h', default: 'a' };
    if (R.chance(0.3)) p.on_answer = { effect: R.pick(['resume', 'dispatch', 'record', 'explode']), record_on: R.pick(['LIN-101', 'nope']) };
  }
  return `[decision] ${JSON.stringify(p)}`;
}

/** Raw feedback (Date timestamps, as Mongo stores it) for one run. */
export function genRawFeedback(R, startMs, endMs, opts = {}) {
  const out = [];
  const n = opts.n ?? R.wpick([[0, 15], [1, 10], [3, 25], [6, 30], [12, 15], [20, 5]]);
  let t = startMs + R.int(1, 30) * 1000;
  const span = Math.max(endMs - startMs, MIN);
  const decisionIds = [];
  const push = (message, kind, extra = {}) => {
    let ts = new Date(t);
    const q = R.f();
    if (q < 0.03) ts = undefined; else if (q < 0.05) ts = null; else if (q < 0.07) ts = new Date(t - R.int(1, 60) * MIN); // out of order
    else if (q < 0.08) ts = 'garbage';
    const e = { message, timestamp: ts };
    if (kind) e.kind = kind;
    if (R.chance(0.05)) e.url = 'https://example.com/pr/1';
    if (opts.rootItemId && R.chance(0.3)) e.rootItemId = opts.rootItemId;
    Object.assign(e, extra);
    out.push(e);
    t += Math.max(1000, Math.floor(span / Math.max(n, 1) * R.f()));
  };
  if (R.chance(0.4)) push(`[started] session ${R.hex(6)} · tty ${R.int(1, 9)}${R.chance(0.6) ? ` · model ${R.pick(['model-frontier', 'model-mid', 'gpt-x'])}` : ''}`, 'status');
  for (let i = 0; i < n; i++) {
    const what = R.wpick([['hb', 40], ['evidence', 8], ['usage', 5], ['resources', 3], ['ticket', 4], ['parked', 4], ['decision', 8], ['answer', 5], ['withdrawn', 3], ['reversed', 2], ['assistant', 6], ['wake', 4], ['plain', 4]]);
    if (what === 'hb') push(R.pick(HEARTBEATS)(R), R.pick(['heartbeat', 'status', undefined, undefined]));
    else if (what === 'evidence') push(`[evidence] ${R.pick(['PR opened', 'doc', 'commit'])} · https://example.com/${R.hex(4)}${R.chance(0.5) ? ` · ${R.int(1, 4)} mentions` : ''}`, R.pick(['evidence', undefined]));
    else if (what === 'usage') push(`[usage] ${JSON.stringify({ harness: 'claude-code', model: R.pick(['model-frontier', 'model-mid']), effort: R.pick(['high', 'low']), inputTokens: R.int(100, 90000), outputTokens: R.int(10, 9000), cacheReadInputTokens: R.int(0, 50000), lane: R.pick(['subscription', 'api', 'openrouter', 'weird']) })}`, 'usage');
    else if (what === 'resources') push(`[resources] ${JSON.stringify({ peakRssBytes: R.int(1e6, 9e8), cpuCount: R.int(1, 16), loadAvg1: R.f() * 4 })}`, 'resources');
    else if (what === 'ticket') push(`[ticket] LIN-${R.int(100, 110)} ${R.pick(['started', 'done', 'blocked', 'refused', 'trimmed'])}${R.chance(0.5) ? ' — note' : ''}`, undefined);
    else if (what === 'parked') push(R.pick(['[working] confirming a scheduled wakeup', '[working · verifying] Not done yet — a scheduled wakeup still pending']), R.pick(['status', undefined]));
    else if (what === 'decision') {
      const id = R.chance(0.3) && decisionIds.length ? R.pick(decisionIds) : `d-${R.int(1, 4)}`;
      decisionIds.push(id);
      if (R.chance(0.5)) { const k = R.int(1, 3); for (let j = 0; j < k; j++) push(R.pick(['Considering options.', 'The tests fail on CI.', '']), 'assistant-text'); }
      push(decisionPayload(R, id), 'decision');
    } else if (what === 'answer') push(R.chance(0.85) ? JSON.stringify({ decision_id: decisionIds.length && R.chance(0.8) ? R.pick(decisionIds) : `d-${R.int(1, 4)}`, ...(R.chance(0.3) ? { outcome: R.pick(['dismissed', 'answered']) } : {}) }) : 'not-json', 'decision-answer');
    else if (what === 'withdrawn') push(R.chance(0.85) ? JSON.stringify({ decision_id: decisionIds.length ? R.pick(decisionIds) : 'd-1', reason: R.pick(['moot', '', 'superseded by 3 tools in 4s']) }) : '{bad', 'decision-withdrawn');
    else if (what === 'reversed') push(R.chance(0.9) ? JSON.stringify({ decision_id: decisionIds.length ? R.pick(decisionIds) : 'd-1' }) : '{}', 'decision-withdrawal-reversed');
    else if (what === 'assistant') push('Looking at the failing test.', 'assistant-text');
    else if (what === 'wake') push(R.pick(WAKES)(R), R.pick(['status', undefined]));
    else push(R.pick(['Bash', 'note to self', '']), undefined);
  }
  if (opts.terminal !== false && R.chance(opts.terminalP ?? 0.55)) push(opts.terminalMsg || R.pick(TERMINALS)(R), R.pick(['status', undefined]));
  if (R.chance(0.05)) push(R.pick(HEARTBEATS)(R), 'heartbeat'); // a beat after the terminal
  return out;
}

// Digest variants a history row can carry (LIN-3011 lean path).
function attachDigest(R, item, rawFeedback, dispatchedAtRaw) {
  const v = R.wpick([['fresh', 70], ['missing', 7], ['null', 4], ['stale', 7], ['legacy', 6], ['noVersion', 2], ['weird', 4]]);
  const fv = R.wpick([[0, 60], [R.int(1, 9), 35], [undefined, 5]]);
  const doc = { feedback: rawFeedback, dispatchedAt: dispatchedAtRaw instanceof Date ? dispatchedAtRaw : (typeof dispatchedAtRaw === 'string' ? dispatchedAtRaw : null) };
  if (v === 'missing') { if (fv !== undefined) item.feedbackVersion = fv; return v; }
  if (v === 'null') { item.feedbackVersion = fv ?? 0; item.feedbackDigest = null; return v; }
  const d = digestFeedback(doc, { now: NOW });
  d.version = fv ?? 0;
  if (v === 'stale') d.version = (fv ?? 0) + R.int(1, 3);
  if (v === 'noVersion') delete d.version;
  if (v === 'legacy') {
    delete d.answeredDecisions; delete d.withdrawal; delete d.withdrawalReversed;
    if (R.chance(0.5) && !d.answeredDecisionId) d.answeredDecisionId = `d-${R.int(1, 3)}`;
  }
  if (v === 'weird') {
    const w = R.int(0, 4);
    if (w === 0) delete d.telemetry;
    else if (w === 1) d.telemetry.metrics = 'nope';
    else if (w === 2) delete d.telemetry.runtime;
    else if (w === 3) { d.telemetry.ticketMarkers = [{ id: 'LIN-1', state: 'started' }]; d.parkedWait = { since: iso(NOW - HOUR), latest: iso(NOW) }; d.telemetry.toolPeak = R.int(1, 50); }
    else { d.telemetry.evidence = null; d.telemetry.model = 'm'; d.telemetry.usage = { inputTokens: 5 }; d.telemetry.resources = { cpuCount: 2 }; }
  }
  if (fv !== undefined) item.feedbackVersion = fv;
  item.feedbackDigest = d;
  return v;
}

const KINDS = [['implementation', 25], ['plan', 15], ['review', 15], ['breakdown', 5], ['custom', 8], ['close-out', 3], ['wake', 5]];
const TARGETS = [['cli', 50], ['web', 25], ['dash', 10], ['local', 10], [undefined, 5]];

/**
 * A workspace's dispatch history: issues (with a parent graph), autopilot
 * runs with stamped/unstamped workers, follow-up chains (stamped group ids,
 * legacy unstamped, straddles, dangling and cyclic), aborts, wakes, live
 * queue rows, out-of-window and malformed rows, plus agent-status entries.
 */
export function genWorld(R, opts = {}) {
  const prefix = R.chance(0.85) ? 'LIN' : 'HAR';
  const nIssues = opts.nIssues ?? R.int(1, 7);
  const issues = [];
  for (let i = 0; i < nIssues; i++) issues.push(`${prefix}-${100 + i * R.int(1, 3) + i}`);
  const parentOf = {};
  for (let i = 0; i < issues.length; i++) parentOf[issues[i]] = i > 0 && R.chance(0.5) ? issues[R.int(0, i - 1)] : null;
  if (R.chance(0.05) && issues.length > 1) parentOf[issues[0]] = issues[issues.length - 1]; // cycle
  const rows = []; // {item, raw, live}
  const ids = new Set();
  const newId = () => { let id; do { id = R.chance(0.1) ? `${R.hex(24)}` : `disp-${R.hex(6)}`; } while (ids.has(id)); ids.add(id); return id; };
  const horizonDays = opts.horizonDays ?? R.wpick([[3, 30], [12, 30], [29, 20], [40, 20]]);
  const nRows = opts.nRows ?? R.wpick([[2, 15], [5, 30], [10, 30], [20, 20], [40, 5]]);

  const makeRow = (fields) => {
    const id = fields.id || newId();
    const kind = fields.kind ?? R.wpick(KINDS);
    const issueIdentifier = 'issueIdentifier' in fields ? fields.issueIdentifier : R.pick(issues);
    const dispatchedMs = fields.dispatchedMs ?? (NOW - R.int(0, horizonDays * DAY));
    const live = fields.live ?? (dispatchedMs > NOW - 2 * HOUR ? R.chance(0.5) : R.chance(0.04));
    const target = 'target' in fields ? fields.target : R.wpick(TARGETS);
    const dispatchedAtRaw = fields.dispatchedAtRaw !== undefined ? fields.dispatchedAtRaw : tsShape(R, dispatchedMs);
    const item = {
      id,
      promptName: R.chance(0.95) ? (kind === 'autopilot' ? 'autopilot' : kind) : (R.chance(0.5) ? null : undefined),
      prompt: R.chance(0.9) ? `prompt for ${kind} ${issueIdentifier} ${R.hex(4)}` : null,
      issueId: R.chance(0.9) ? `uuid-${issueIdentifier}` : undefined,
      issueIdentifier,
      issueTitle: R.chance(0.9) ? `Title of ${issueIdentifier}` : null,
      issueUrl: R.chance(0.8) ? `https://linear.app/x/issue/${issueIdentifier}` : undefined,
      dispatchedAt: dispatchedAtRaw,
      dispatchedBy: R.chance(0.8) ? `acct-${R.int(1, 3)}` : null,
      trimHistory: [],
      sessionGroupId: fields.sessionGroupId ?? null,
      rootItemId: fields.rootItemId ?? null,
      kind,
      target,
      repo: R.chance(0.6) ? R.pick(['jkershaw/LinearViewer', 'org/other']) : null,
      model: R.chance(0.3) ? 'model-frontier' : null,
      followUpTo: fields.followUpTo ?? null,
      abort: fields.abort === true,
      abortTo: fields.abortTo ?? null,
      sessionId: fields.sessionId ?? null,
      maxTasks: fields.maxTasks ?? null,
    };
    if (R.chance(0.08)) item.issueSource = R.pick(['linear', 'github', 'jira']);
    if (R.chance(0.04)) item.bookkeeping = { at: iso(NOW - HOUR), by: 'fossil-pass', reason: R.pick(['handed-on', 'ticket-closed']) };
    let raw = null;
    const endMs = dispatchedMs + R.int(1, 240) * MIN;
    if (live) {
      item.workspace = { urlKey: 'ws' };
      item.expiresAt = iso(dispatchedMs + DAY);
      if (R.chance(0.05)) item.feedback = formatFeedbackEntries(genRawFeedback(R, dispatchedMs, endMs, { n: 2 }));
    } else {
      item.status = fields.status ?? R.wpick([['taken', 75], ['expired', 6], ['cancelled', 6], ['aborted', 4], [undefined, 3], ['queued', 2]]);
      const resolvedMs = R.chance(0.1) ? dispatchedMs - R.int(1, 60) * 1000 : dispatchedMs + R.int(1, 120) * 1000;
      item.resolvedAt = R.chance(0.9) ? tsShape(R, resolvedMs) : undefined;
      item.takenByTokenLabel = R.chance(0.6) ? 'consumer-1' : null;
      const rawFeedback = fields.rawFeedback ?? genRawFeedback(R, dispatchedMs, endMs, fields.feedbackOpts);
      if (rawFeedback.length > 0) item.feedback = formatFeedbackEntries(rawFeedback);
      const dv = attachDigest(R, item, rawFeedback, dispatchedAtRaw);
      raw = { _id: id, ...structuredClone({ ...item, feedback: undefined, feedbackDigest: undefined }), feedback: rawFeedback, dispatchedAt: typeof dispatchedAtRaw === 'string' && !Number.isNaN(Date.parse(dispatchedAtRaw)) ? new Date(dispatchedAtRaw) : dispatchedAtRaw };
      delete raw.id; delete raw.feedbackDigest;
      if (dv === 'missing' && R.chance(0.5)) delete raw.feedbackVersion;
    }
    rows.push({ item, raw, live });
    return item;
  };

  // Autopilot runs.
  const nRuns = R.wpick([[0, 35], [1, 45], [2, 20]]);
  for (let a = 0; a < nRuns; a++) {
    const general = R.chance(0.25);
    const startMs = NOW - R.int(0, horizonDays * DAY);
    const anchor = makeRow({ kind: 'autopilot', issueIdentifier: general ? (R.chance(0.8) ? null : '') : R.pick(issues), dispatchedMs: startMs, maxTasks: R.wpick([[R.int(1, 10), 70], [null, 15], [0, 5], ['5', 5], [2.5, 5]]), feedbackOpts: { terminalP: 0.5, n: R.int(0, 6) } });
    const nWorkers = R.int(0, 6);
    for (let w = 0; w < nWorkers; w++) {
      const stamped = R.chance(0.7);
      const descendants = issues.filter(i => parentOf[i] === anchor.issueIdentifier);
      makeRow({ issueIdentifier: R.chance(0.6) && descendants.length ? R.pick(descendants) : (R.chance(0.5) ? anchor.issueIdentifier || R.pick(issues) : R.pick(issues)), dispatchedMs: startMs + R.int(1, 300) * MIN, sessionId: stamped ? anchor.id : (R.chance(0.1) ? 'other-session' : null), sessionGroupId: stamped && R.chance(0.6) ? anchor.id : null });
    }
  }
  // Ordinary rows.
  for (let i = 0; i < nRows; i++) makeRow({});
  // Follow-up chains over session-target rows.
  const nChains = R.wpick([[0, 30], [1, 40], [3, 30]]);
  for (let c = 0; c < nChains; c++) {
    const pool = rows.filter(r => r.item.kind !== 'autopilot' && (r.item.target === 'cli' || r.item.target === 'web'));
    const root = pool.length && R.chance(0.9) ? R.pick(pool).item : { id: `aged-${R.hex(4)}`, issueIdentifier: R.pick(issues), sessionGroupId: null };
    let parent = root;
    const len = R.int(1, 4);
    let t = (Date.parse(root.dispatchedAt) || NOW - 2 * DAY) + R.int(1, 60) * MIN;
    for (let k = 0; k < len; k++) {
      const style = R.wpick([['stampedRoot', 45], ['stampedParent', 15], ['unstamped', 35], ['foreignGroup', 5]]);
      const groupId = style === 'stampedRoot' ? (root.sessionGroupId || root.id) : style === 'stampedParent' ? parent.id : style === 'foreignGroup' ? `grp-${R.hex(4)}` : null;
      const f = makeRow({ issueIdentifier: R.chance(0.85) ? root.issueIdentifier : R.pick(issues), followUpTo: R.chance(0.95) ? parent.id : `missing-${R.hex(4)}`, sessionGroupId: groupId, rootItemId: R.chance(0.7) ? (root.rootItemId || root.id) : null, dispatchedMs: Math.min(t, NOW), target: R.wpick([['cli', 60], ['web', 30], ['dash', 10]]), sessionId: R.chance(0.05) ? R.pick(rows).item.id : null });
      parent = f;
      t += R.int(1, 120) * MIN;
    }
    if (R.chance(0.04) && rows.length) { const r0 = R.pick(rows).item; r0.followUpTo = parent.id; } // cycle
  }
  // Aborts targeting a row.
  const nAborts = R.wpick([[0, 60], [1, 30], [2, 10]]);
  for (let k = 0; k < nAborts && rows.length; k++) {
    const target = R.pick(rows).item;
    const tMs = (Date.parse(target.dispatchedAt) || NOW - HOUR) + R.int(1, 90) * MIN;
    makeRow({ kind: R.pick(['custom', 'implementation']), issueIdentifier: R.chance(0.85) ? null : target.issueIdentifier, abort: true, abortTo: R.chance(0.95) ? target.id : 'nobody', dispatchedMs: Math.min(tMs, NOW), live: false, status: 'aborted', rawFeedback: [{ message: R.pick(['[aborted] Cancelled running session 3e626118 (EXECUTING).', '[skipped] human-continued session', '[done]']), timestamp: R.chance(0.95) ? new Date(Math.min(tMs + MIN, NOW)) : null, kind: 'status' }] });
  }
  // Wake rows (identifier-less legacy ones are dropped silently).
  if (R.chance(0.25)) makeRow({ kind: 'wake', issueIdentifier: R.chance(0.5) ? null : R.pick(issues) });
  // Duplicate id live+history, lineage roots.
  if (R.chance(0.05) && rows.length) { const src = R.pick(rows); const dup = structuredClone(src.item); rows.push({ item: dup, raw: null, live: !src.live }); }
  for (const r of rows) if (!r.item.rootItemId && R.chance(0.1)) r.item.rootItemId = R.pick(rows).item.id;

  const live = rows.filter(r => r.live).map(r => r.item);
  const history = rows.filter(r => !r.live).map(r => r.item);
  // Malformed rows.
  if (R.chance(0.12)) {
    const bad = R.pick([null, {}, { issueIdentifier: issues[0] }, { id: `bad-${R.hex(3)}`, kind: 'custom' }, { id: `bad-${R.hex(3)}`, issueIdentifier: issues[0], dispatchedAt: 'nope' }, { id: `bad-${R.hex(3)}`, issueIdentifier: issues[0] }, { id: 0, issueIdentifier: issues[0] }, undefined]);
    (R.chance(0.5) ? live : history).splice(R.int(0, 2), 0, bad);
  }
  // History order: the real store sorts by resolvedAt desc; some doubles don't.
  const historyOrdered = R.chance(0.6) ? [...history].sort((a, b) => String(b?.resolvedAt ?? '').localeCompare(String(a?.resolvedAt ?? ''))) : R.shuffle(history);

  // Agent-status entries.
  const status = [];
  const allItems = [...live, ...history].filter(x => x && x.id);
  const nStatus = R.wpick([[0, 20], [2, 30], [6, 30], [15, 20]]);
  for (let s = 0; s < nStatus && allItems.length; s++) {
    const it = R.pick(allItems);
    const base = Date.parse(it.dispatchedAt) || (it.dispatchedAt instanceof Date ? it.dispatchedAt.getTime() : NOW - HOUR);
    const tsMs = base + R.int(-5, 180) * MIN;
    const e = {
      id: `fmn-${R.hex(6)}`,
      taskIdentifier: R.wpick([[it.issueIdentifier, 80], [R.pick(issues), 10], [undefined, 5], ['free-form task', 5]]),
      action: R.wpick([['implementation', 30], ['plan', 20], ['review', 20], [undefined, 15], ['', 5], ['breakdown', 10]]),
      status: R.wpick([['completed', 35], ['failed', 10], ['blocked', 10], ['in_progress', 25], [undefined, 10], ['working', 10]]),
      summary: R.chance(0.8) ? R.pick(['Done.', 'Blocked on review', 'Working', '']) : undefined,
      timestamp: tsShape(R, Math.min(tsMs, NOW + R.int(0, 1) * HOUR)),
    };
    if (R.chance(0.3)) e.dispatchId = R.chance(0.9) ? it.id : 'stranger';
    if (R.chance(0.3)) e.tokenId = `tok-${R.int(1, 3)}`;
    if (R.chance(0.3)) e.tokenLabel = R.pick(['runner-a', 'consumer-1']);
    status.push(e);
  }
  if (R.chance(0.05)) status.push(null);
  status.sort((a, b) => String(b?.timestamp ?? '').localeCompare(String(a?.timestamp ?? '')));
  const raw = rows.filter(r => r.raw).map(r => r.raw);
  return { issues, parentOf, live, history: historyOrdered, status, raw };
}

/** Canonical issues (provider shape) for deriveIssueGraph. */
function genIssues(R, world) {
  const out = world.issues.map(identifier => ({ id: `uuid-${identifier}`, identifier: R.chance(0.95) ? identifier : undefined, title: `T ${identifier}` }));
  for (const iss of out) {
    const p = world.parentOf[iss.identifier];
    if (p && R.chance(0.9)) iss.parent = { id: `uuid-${p}` };
    else if (R.chance(0.1)) iss.parent = { id: 'uuid-outside' };
    else if (R.chance(0.1)) iss.parent = null;
  }
  if (R.chance(0.1)) out.push(null, { identifier: 'NOID-1' });
  if (R.chance(0.05)) out.push({ ...out[0] });
  return out;
}

function leanStrip(R, world) {
  // A lean history read excludes prompt+feedback (LIN-3011 projection).
  return world.history.map(h => {
    if (!h || R.chance(0.1)) return h;
    const c = { ...h }; delete c.prompt; delete c.feedback; return c;
  });
}

const nowVariant = (R) => R.wpick([[new Date(NOW_ISO), 85], [new Date(NOW + R.int(1, 48) * HOUR), 10], [new Date(NOW - 20 * DAY), 5]]);

function graphFrom(R, world) {
  const k = R.wpick([['graph', 60], ['null', 20], ['empty', 10], ['noParentOf', 10]]);
  if (k === 'graph') return { parentOf: { ...world.parentOf } };
  if (k === 'null') return null;
  if (k === 'empty') return { parentOf: {} };
  return {};
}

function worldSpec(R, world, extra = {}) {
  const modes = {};
  if (R.chance(0.15)) {
    const which = R.pick(['listItems', 'listHistory', 'listStatus', 'find', 'updateOne']);
    modes[which] = which === 'find' ? R.pick(['reject', 'drop-one']) : which === 'updateOne' ? R.pick(['reject', 'throw', 'rejectBare', 'rejectEmpty']) : R.pick(['sync', 'throw', 'reject', 'nonArray', 'undefined', 'null', 'noItems', 'itemsNotArray']);
  }
  return { kind: 'semantic', live: world.live, history: world.history, status: world.status, raw: world.raw, naive: R.chance(0.3), historyCollection: R.chance(0.5), modes, ...extra };
}

const deps = (extra = {}) => ({ dispatchStore: { $store: 'dispatchStore' }, agentStatusStore: { $store: 'agentStatusStore' }, ...extra });

// ── scenario families ─────────────────────────────────────────────────────
const FAMILIES = {
  buildLoops(R) {
    const world = genWorld(R);
    const lean = R.chance(0.4);
    const input = { liveItems: world.live, historyItems: lean ? leanStrip(R, world) : world.history, agentStatusEntries: world.status, now: nowVariant(R) };
    if (lean) input.lean = true; else if (R.chance(0.1)) input.lean = false;
    if (R.chance(0.15)) input.horizon = R.pick(['all', 'ALL', '30d']);
    for (const k of ['liveItems', 'historyItems', 'agentStatusEntries']) if (R.chance(0.04)) delete input[k];
    if (R.chance(0.03)) delete input.now;
    return { steps: [{ fn: '__internal._buildLoops', args: R.chance(0.01) ? [] : [input] }] };
  },
  sessionsChain(R) {
    const world = genWorld(R, { nRows: R.int(3, 25) });
    const lean = R.chance(0.4);
    const now = nowVariant(R);
    const input = { liveItems: world.live, historyItems: lean ? leanStrip(R, world) : world.history, agentStatusEntries: world.status, now, lean };
    const opts = { issueGraph: graphFrom(R, world) };
    if (R.chance(0.8)) opts.now = now;
    return { steps: [{ fn: '__internal._buildLoops', args: [input] }, { fn: '__internal._buildSessions', args: R.chance(0.03) ? [{ $step: 0 }] : [{ $step: 0 }, opts] }] };
  },
  sessionsHandBuilt(R) {
    // Loops shaped as consumers/fixtures hand-build them (some without the
    // build-time terminalCompletedAt, forcing the raw-feedback fallback).
    const world = genWorld(R, { nRows: R.int(2, 12) });
    const loops = [];
    for (const it of [...world.live, ...world.history]) {
      if (!it || !it.id) continue;
      const rawFb = R.chance(0.6) ? formatFeedbackEntries(genRawFeedback(R, NOW - DAY, NOW, { n: R.int(0, 4) })) : [];
      const l = {
        loopId: it.id, issueIdentifier: it.issueIdentifier ?? null, kind: it.kind ?? null, sessionId: it.sessionId, sessionGroupId: it.sessionGroupId, followUpTo: it.followUpTo,
        target: it.target, dispatchedAt: it.dispatchedAt, maxTasks: it.maxTasks, feedback: rawFb,
      };
      if (R.chance(0.6)) l.terminalCompletedAt = R.wpick([[iso(NOW - R.int(0, 3000) * MIN), 50], [null, 45], ['bad', 5]]);
      if (it.abort && R.chance(0.7)) l.abort = true;
      if (R.chance(0.6)) l.telemetry = { metrics: [], producedArtifacts: [], runtime: { ms: null, dispatchedAt: null, completedAt: null, crossCheck: null } };
      loops.push(l);
    }
    const opts = { issueGraph: graphFrom(R, world), now: nowVariant(R) };
    return { steps: [{ fn: '__internal._buildSessions', args: [R.shuffle(loops), opts] }] };
  },
  getLoopsForIssue(R) {
    const world = genWorld(R);
    const issue = R.wpick([[R.pick(world.issues), 90], ['', 4], [null, 3], ['LIN-9999', 3]]);
    const d = deps();
    if (R.chance(0.3)) d.horizon = R.pick(['all', 'all', 'nope']);
    if (R.chance(0.03)) delete d[R.pick(['dispatchStore', 'agentStatusStore'])];
    return { world: worldSpec(R, world), steps: [{ fn: 'getLoopsForIssue', args: [R.chance(0.97) ? 'ws' : '', issue, R.chance(0.98) ? d : undefined] }] };
  },
  getLoopsForWorkspace(R) {
    const world = genWorld(R);
    const d = deps();
    if (R.chance(0.5)) d.lean = R.chance(0.8);
    if (R.chance(0.03)) delete d.agentStatusStore;
    return { world: worldSpec(R, world), steps: [{ fn: 'getLoopsForWorkspace', args: [R.chance(0.97) ? 'ws' : null, R.chance(0.98) ? d : undefined] }] };
  },
  getSessionsForWorkspace(R) {
    const world = genWorld(R);
    const d = deps({ issueGraph: graphFrom(R, world) });
    if (R.chance(0.6)) d.lean = R.chance(0.8);
    if (R.chance(0.03)) delete d.dispatchStore;
    const env = R.chance(0.3) ? { OBSERVATION_FEED_TIMING: R.pick(['1', '0', 'true']) } : {};
    return { env, world: worldSpec(R, world), steps: [{ fn: 'getSessionsForWorkspace', args: [R.chance(0.97) ? 'ws' : '', d] }] };
  },
  getSessionsForIssues(R) {
    const world = genWorld(R);
    const ids = R.chance(0.9) ? R.shuffle(world.issues).slice(0, R.int(0, world.issues.length)) : null;
    if (ids && R.chance(0.2)) ids.push(ids[0] ?? 'LIN-1', '', null);
    const all = [...world.live, ...world.history].filter(Boolean);
    const anchors = all.filter(x => x.kind === 'autopilot');
    const extraItems = [];
    for (const a of anchors) if (R.chance(0.7)) extraItems.push({ ...a, status: world.live.includes(a) ? 'queued' : (a.status || 'taken') });
    if (R.chance(0.1)) extraItems.push(null, { id: null }, { id: `x-${R.hex(3)}`, kind: 'autopilot', status: 'queued', dispatchedAt: iso(NOW - HOUR) });
    const opts = {};
    if (R.chance(0.5)) opts.lean = R.chance(0.7);
    if (extraItems.length || R.chance(0.2)) opts.extraItems = extraItems;
    const args = ['ws', deps(), ids];
    if (R.chance(0.9)) args.push(opts);
    if (R.chance(0.02)) args[1] = {};
    return { world: worldSpec(R, world), steps: [{ fn: 'getSessionsForIssues', args }] };
  },
  fetchWorkspaceData(R) {
    const world = genWorld(R);
    const opts = {};
    if (R.chance(0.5)) opts.issueIdentifier = R.pick(world.issues);
    if (R.chance(0.5)) opts.lean = R.chance(0.8);
    if (R.chance(0.3)) opts.horizon = 'all';
    return { world: worldSpec(R, world, { historyCollection: R.chance(0.7) }), steps: [{ fn: '__internal._fetchWorkspaceData', args: ['ws', deps(), R.chance(0.9) ? opts : undefined] }] };
  },
  redigest(R) {
    const world = genWorld(R);
    const ids = R.chance(0.9) ? R.shuffle(world.raw.map(r => r._id)).slice(0, R.int(0, world.raw.length)) : R.pick([null, [], 'id']);
    if (Array.isArray(ids) && R.chance(0.2)) ids.push('vanished-1');
    const opts = R.wpick([[undefined, 50], [{ persist: false }, 25], [{ persist: true }, 25]]);
    const args = [ids, { $store: 'dispatchStore' }];
    if (opts) args.push(opts);
    return { world: worldSpec(R, world, { historyCollection: true }), steps: [{ fn: 'redigestHistoryRows', args }] };
  },
  small(R) {
    const world = genWorld(R, { nRows: R.int(1, 6) });
    const k = R.pick(['agentState', 'stage', 'match', 'hier', 'window', 'assemble', 'completedAt', 'firstRaised', 'issueGraph', 'reexports', 'decisionHelpers']);
    const fb = formatFeedbackEntries(genRawFeedback(R, NOW - DAY, NOW, { n: R.int(0, 10) }));
    if (k === 'agentState') return { steps: Array.from({ length: 4 }, () => ({ fn: '__internal._deriveAgentState', args: [R.pick(['live', 'history', undefined, 'x']), R.pick(['taken', 'expired', 'cancelled', null, 'aborted']), R.pick(['completed', 'failed', 'blocked', null, 'running', 'COMPLETED'])] })) };
    if (k === 'stage') return { steps: [{ fn: '__internal._deriveStage', args: [R.pick(['plan', '', null, undefined, 'review']), R.pick(['implementation', '', null, undefined])] }] };
    if (k === 'match') {
      const base = NOW - R.int(1, 50) * HOUR;
      const loop = { loopId: R.pick(['L1', 'L2']), _dispatchedAtDate: R.chance(0.9) ? new Date(base) : null, _upperDate: R.chance(0.6) ? new Date(base + R.int(0, 120) * MIN) : (R.chance(0.5) ? null : undefined) };
      const entries = Array.from({ length: R.int(0, 6) }, () => ({ id: `f-${R.hex(3)}`, dispatchId: R.wpick([[undefined, 60], ['L1', 25], ['L2', 10], ['', 5]]), timestamp: tsShape(R, base + R.int(-30, 200) * MIN), status: R.pick(['completed', 'blocked']) }));
      if (entries.length && R.chance(0.2)) entries.push({ ...entries[0], id: 'tie' });
      return { steps: [{ fn: '__internal._matchAgentStatusToLoop', args: [loop, R.chance(0.95) ? entries : null, new Date(NOW_ISO)] }] };
    }
    if (k === 'hier') {
      const g = graphFrom(R, world);
      const probes = [...world.issues, 'LIN-0', ''];
      return { steps: [{ fn: '__internal._hierarchyHelpers', args: [g], invoke: probes.flatMap(id => [{ method: 'descendantsOf', args: [id] }, { method: 'ancestorsOf', args: [id] }]) }] };
    }
    if (k === 'window') return { steps: [{ fn: '__internal._sessionWindow', args: [{ dispatchedAt: tsShape(R, NOW - DAY), ...(R.chance(0.5) ? { terminalCompletedAt: R.pick([iso(NOW - HOUR), null, 'bad']) } : { feedback: fb }) }, new Date(NOW_ISO)] }] };
    if (k === 'assemble') {
      const loops = Array.from({ length: R.int(0, 5) }, (_, i) => ({ loopId: `L${R.int(1, 9)}`, issueIdentifier: R.pick([...world.issues, null]), dispatchedAt: tsShape(R, NOW - R.int(1, 99) * HOUR), sessionId: R.pick(['S1', null, 'S2']), followUpTo: R.chance(0.2) ? 'L1' : null, abort: R.chance(0.1) || undefined, kind: i === 0 ? 'autopilot' : 'implementation', ...(R.chance(0.7) ? { terminalCompletedAt: R.pick([iso(NOW - R.int(1, 50) * HOUR), null]) } : { feedback: fb }), telemetry: R.chance(0.5) ? { metrics: [], producedArtifacts: [], runtime: {} } : undefined }));
      const anchor = R.chance(0.6) && loops.length ? { ...loops[0], maxTasks: R.pick([3, 0, null, '4', 10]) } : null;
      return { steps: [{ fn: '__internal._assembleSession', args: [R.pick(['S1', 'S2']), anchor, loops] }] };
    }
    if (k === 'completedAt') return { steps: [{ fn: '__internal._loopCompletedAt', args: [R.pick([null, undefined, { terminalCompletedAt: null }, { terminalCompletedAt: iso(NOW) }, { feedback: fb }, {}, { terminalCompletedAt: undefined, feedback: fb }])] }] };
    if (k === 'firstRaised') return { steps: [{ fn: 'firstRaisedAt', args: [R.chance(0.9) ? fb : null, R.pick(['d-1', 'd-2', '', null, 'd-9'])] }] };
    if (k === 'issueGraph') return { steps: [{ fn: 'deriveIssueGraph', args: [R.chance(0.95) ? genIssues(R, world) : R.pick([null, undefined, []])] }] };
    if (k === 'reexports') return { steps: ['isDecisionAnswerEntry', 'isDecisionLifecycleStampEntry', 'resolvedDecisionEvents'].map(fn => ({ fn, args: [fn === 'resolvedDecisionEvents' ? (R.chance(0.9) ? fb : 'x') : R.pick([...fb, null, { kind: 'decision-withdrawn' }])] })) };
    const idx = R.int(-1, fb.length);
    return { steps: [{ fn: '__internal._findLastDecision', args: [fb] }, { fn: '__internal._findDecisionAnswer', args: [R.chance(0.9) ? fb : null] }, { fn: '__internal.correlateDecisionCase', args: [fb, R.pick([idx, 1.5, '2', fb.findIndex(e => e.kind === 'decision')])] }] };
  },
  sequence(R) {
    // Repeated calls in ONE module instance: the warn-once state and any
    // other cross-call memory a rebuild might add.
    const world = genWorld(R);
    if (!world.live.some(x => !x || !x.id || !x.issueIdentifier)) world.live.push({ id: `bad-${R.hex(3)}`, kind: 'custom' }, { id: `w-${R.hex(3)}`, kind: 'wake' }, null);
    if (R.chance(0.5)) world.history.push({ id: `badh-${R.hex(3)}`, issueIdentifier: world.issues[0], dispatchedAt: 'nope' }, {});
    const input = { liveItems: world.live, historyItems: world.history, agentStatusEntries: world.status, now: new Date(NOW_ISO), lean: R.chance(0.3) };
    const n = R.int(2, 3);
    const steps = [];
    for (let i = 0; i < n; i++) {
      if (R.chance(0.7)) steps.push({ fn: '__internal._buildLoops', args: [input] });
      else steps.push({ fn: 'getLoopsForWorkspace', args: ['ws', deps({ lean: R.chance(0.5) })] });
    }
    return { world: worldSpec(R, world, { modes: {} }), steps };
  },
};

const WEIGHTS = [
  ['buildLoops', 30], ['sessionsChain', 16], ['sessionsHandBuilt', 6], ['getLoopsForIssue', 7], ['getLoopsForWorkspace', 8],
  ['getSessionsForWorkspace', 8], ['getSessionsForIssues', 8], ['fetchWorkspaceData', 4], ['redigest', 3], ['small', 7], ['sequence', 3],
];

export function generate(seed, index) {
  const R = rngFor(seed, 'gen', index);
  const family = R.wpick(WEIGHTS);
  const sc = FAMILIES[family](R);
  return { id: `gen:${index}`, tier: 'gen', family, env: sc.env || {}, world: sc.world || null, steps: sc.steps };
}
export const FAMILY_NAMES = Object.keys(FAMILIES);
