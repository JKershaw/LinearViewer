// rung6a target: lib/task-page-loader.js — generators, edge cases and the
// fake world, plugged into the shared replay kit (../../replay-kit).
//
// World: the two injected helpers are the REAL routes/dashboard.js
// `enrichLoop` / `deriveSessionWaiting` from the origin/main snapshot (calls
// recorded as pure: info, not differences); every other dependency is a
// recording fake — the tracker provider, brief/recap caches, readRunEvidence
// (a fake model, or the REAL lib/run-evidence.js one over a fake PR-state
// store), close-out events, readTaskRunFacts (fake, or the real default over a
// fake dispatch store), getLoopsForIssue (fake, or the real pipeline-loops
// default over fake dispatch/agent-status stores), and the loader's `now`.
import { Rng, recordDep, deliver } from '../../replay-kit/lib/gen-kit.mjs';
import { markDep } from '../../replay-kit/lib/canon.mjs';

const SNAP = new URL('../../replay-kit/snapshots/1f8010a0/', import.meta.url).href;
const dash = await import(`${SNAP}routes/dashboard.js`);
const { readRunEvidence: realReadRunEvidence } = await import(`${SNAP}lib/run-evidence.js`);
const { hashContext } = await import(`${SNAP}lib/brief-cache.js`);

const NOW_ISO = '2026-10-01T12:00:00.000Z';
const NOWMS = Date.parse(NOW_ISO);
const MIN = 60000; const HOUR = 3600000; const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();

// ---------------------------------------------------------------- world
export function createWorld(spec, io) {
  const w = {};
  w.enrichLoop = recordDep('enrichLoop', spec.badHelpers ? ((l) => l) : dash.enrichLoop, io, { pure: true });
  w.deriveSessionWaiting = recordDep('deriveSessionWaiting', dash.deriveSessionWaiting, io, { pure: true });
  if (spec.loops !== undefined) w.getLoopsForIssue = recordDep('getLoopsForIssue', (...a) => deliver(spec.loopsMode || 'promise', structuredClone(spec.loops), 'getLoopsForIssue'), io);
  if (spec.provider) {
    const p = spec.provider;
    w.provider = recordDep('provider', {
      fetchRecommendationContext: (scope, id, opts) => (p.mode === 'syncthrow' ? (() => { throw new Error('provider exploded'); })() : deliver(p.mode || 'promise', structuredClone(p.ctx), p.mode === 'rejectNotFound' ? id : 'fetchRecommendationContext')),
      fetchIssueComments: async () => [],
      fetchIssueFields: async () => null,
      fetchProjects: async () => ({ projects: [] }),
    }, io);
  }
  for (const k of ['brief', 'recap']) {
    const c = spec[`${k}Cache`];
    if (c) w[`${k}CacheStore`] = recordDep(`${k}CacheStore`, { get: () => deliver(c.mode || 'promise', structuredClone(c.doc), `${k}.get`), put: async () => {} }, io);
  }
  if (spec.evidence) {
    const e = spec.evidence;
    w.readRunEvidence = e.kind === 'real'
      ? recordDep('readRunEvidence', realReadRunEvidence, io)
      : recordDep('readRunEvidence', () => deliver(e.mode || 'promise', structuredClone(e.model), 'readRunEvidence'), io);
  }
  if (spec.prState) {
    const ps = spec.prState;
    w.prStateStore = recordDep('prStateStore', { now: () => NOWMS, readResult: (ref, now, auth) => deliver(ps.mode || 'promise', { result: structuredClone(ps.result), via: 'cache' }, 'readResult') }, io);
  }
  if (spec.closeOutEvents) w.closeOutEventsStore = recordDep('closeOutEventsStore', { listForIssue: () => deliver(spec.closeOutEvents.mode || 'promise', structuredClone(spec.closeOutEvents.rows), 'listForIssue') }, io);
  if (spec.runFacts) w.readTaskRunFacts = recordDep('readTaskRunFacts', () => deliver(spec.runFacts.mode || 'promise', structuredClone(spec.runFacts.result), 'readTaskRunFacts'), io);
  const ds = spec.dispatchStore || {};
  const dsImpl = {};
  if (ds.live) dsImpl.listItems = (urlKey, opts) => { const r = (ds.live || []).filter(x => !opts?.issueIdentifier || x.issueIdentifier === opts.issueIdentifier); return deliver(ds.mode || 'promise', structuredClone(r), 'listItems'); };
  if (ds.history) dsImpl.listHistory = (urlKey, opts) => { const r = (ds.history || []).filter(x => !opts?.issueIdentifier || x.issueIdentifier === opts.issueIdentifier); return deliver(ds.mode || 'promise', { items: structuredClone(r), total: r.length }, 'listHistory'); };
  if (ds.status) dsImpl.getItemStatus = (urlKey, id) => deliver('promise', structuredClone(ds.status[id] ?? null), 'getItemStatus');
  w.dispatchStore = recordDep('dispatchStore', dsImpl, io);
  w.agentStatusStore = recordDep('agentStatusStore', spec.agentStatus ? { listStatus: () => Promise.resolve(structuredClone(spec.agentStatus)) } : {}, io);
  w.now = recordDep('now', () => new Date(spec.nowIso || NOW_ISO), io);
  w.empty = markDep({}, 'empty');
  return w;
}

// ------------------------------------------------------------ generators
const KINDS = ['research', 'plan', 'implementation', 'implementation', 'review', 'review', 'close-out', 'autopilot', 'wake', 'custom', 'periodical', 'plan-review', 'triage', 'bug', 'look-into', 'breakdown', 'blocked'];
const ODD_KINDS = [null, undefined, '', 'mystery-stage', 'constructor', 'toString', '__proto__'];
const AGENT_STATES = ['running', 'running', 'waiting', 'complete', 'error', 'queued', 'idle', null];
const STATE_TYPES = ['started', 'started', 'unstarted', 'backlog', 'completed', 'canceled', 'triage', 'duplicate', null];

function timeish(rng, ms) {
  const r = rng.next();
  if (r < 0.85) return iso(ms);
  if (r < 0.9) return null;
  if (r < 0.93) return undefined;
  if (r < 0.96) return 'garbage';
  return new Date(ms);
}

function feedbackFor(rng, t) {
  const fb = [];
  const n = rng.weighted([[0, 3], [1, 3], [3, 3], [6, 1]]);
  for (let i = 0; i < n; i++) {
    t += rng.int(1, 90) * MIN;
    const m = rng.weighted([['plain', 4], ['blocked', 2], ['pending', 1], ['done', 2], ['failed', 1], ['aborted', 0.5], ['complete', 0.5], ['evidence', 1]]);
    const text = rng.pick(['Which DB should I use?', 'landed it', '   ', 'Need a decision:\nA or B?\nmore', 'x'.repeat(rng.int(150, 200)), 'q'.repeat(rng.int(158, 162)), 'shipped PR #12', '']);
    if (m === 'plain') fb.push({ message: `heartbeat ${rng.int(1, 99)}`, timestamp: iso(t) });
    else if (m === 'evidence') fb.push({ kind: 'evidence', message: '[evidence] https://github.com/acme/app/pull/7', timestamp: iso(t) });
    else fb.push({ message: `${rng.pick(['', ' ', '  '])}[${rng.chance(0.1) ? m.toUpperCase() : m}] ${text}`, timestamp: iso(t) });
  }
  return fb;
}

export function genLoops(rng, identifier, issueId, { n } = {}) {
  const loops = [];
  const count = n ?? rng.weighted([[0, 1.5], [1, 3], [2, 3], [4, 3], [7, 1.5], [12, 0.5]]);
  let t = NOWMS - rng.int(1, 40) * DAY;
  for (let i = 0; i < count; i++) {
    t += rng.int(5, 600) * MIN;
    const prev = loops.length ? loops[loops.length - 1] : null;
    const terminal = rng.weighted([[null, 4], ['done', 3], ['failed', 1], ['aborted', 0.5], ['skipped', 0.3], [undefined, 1]]);
    const kind = rng.chance(0.06) ? rng.pick(ODD_KINDS) : rng.pick(KINDS);
    const l = {
      loopId: rng.chance(0.97) ? `loop-${rng.hex(6)}` : (prev ? prev.loopId : 'loop-dup'),
      issueIdentifier: identifier,
      issueId: rng.chance(0.7) ? issueId : rng.pick([null, undefined, `uuid-${rng.hex(4)}`]),
      issueTitle: rng.chance(0.8) ? `Stored title ${rng.hex(3)}` : null,
      kind,
      iteration: i + 1,
      source: rng.pick(['history', 'history', 'live']),
      historyStatus: rng.pick(['taken', 'taken', 'taken', 'cancelled', 'expired', 'queued', null]),
      agentState: rng.pick(AGENT_STATES),
      dispatchedAt: timeish(rng, t),
      takenAt: rng.chance(0.75) ? timeish(rng, t + rng.int(0, 30) * MIN) : null,
      resolvedAt: rng.chance(0.6) ? timeish(rng, t + rng.int(0, 30) * MIN) : null,
      terminalStatus: terminal,
      terminalCompletedAt: terminal ? timeish(rng, t + rng.int(10, 300) * MIN) : (rng.chance(0.5) ? null : undefined),
      wakeMarker: rng.pick([null, null, 'blocked', 'pending', 'done', undefined]),
      waitingMessage: rng.chance(0.3) ? rng.pick(['[blocked] Which one?', 'Pick A or B', '', `[blocked] ${'q'.repeat(rng.int(158, 162))}`]) : null,
      agentSummary: rng.chance(0.5) ? rng.pick(['Did the thing.', '[done] summary text', '  ', 'Line one\nLine two']) : undefined,
      feedback: rng.chance(0.9) ? feedbackFor(rng, t) : rng.pick([undefined, null, 'oops']),
      telemetry: rng.chance(0.8) ? { producedArtifacts: rng.chance(0.85) ? rng.subset([{ url: 'https://github.com/acme/app/pull/41', label: 'PR' }, { url: 'HTTP://example.com/x' }, { url: 'ftp://x/y', label: 'ftp' }, { url: 5 }, null, { label: 'no url' }, { url: 'https://ci.example.com/run/9', label: '' }], 0.4) : 'nope' } : rng.pick([undefined, null]),
      followUpTo: prev && rng.chance(0.3) ? (rng.chance(0.9) ? rng.pick(loops).loopId : 'loop-unknown') : null,
    };
    for (const k of Object.keys(l)) if (l[k] === undefined && rng.chance(0.7)) delete l[k];
    if (rng.chance(0.06)) l.bookkeeping = rng.chance(0.8) ? { at: iso(t + HOUR), by: 'close-out' } : { by: 'x' };
    if (rng.chance(0.05)) l.completedAt = iso(t + 2 * HOUR);
    if (rng.chance(0.05)) { l.decision = { question: 'A or B?' }; l.decisionCase = [{ kind: 'x' }]; }
    loops.push(l);
  }
  return loops;
}

function ref(rng, prefix) {
  if (rng.chance(0.08)) return rng.pick([null, { title: 'no identifier' }, {}]);
  return { id: `${prefix}-${rng.hex(4)}`, identifier: `LIN-${rng.int(1, 999)}`, title: rng.chance(0.85) ? `${prefix} title` : '', state: rng.chance(0.9) ? { name: rng.pick(['Todo', 'In Progress', 'Done', 'Canceled', '']), type: rng.pick(STATE_TYPES) } : null };
}

const REVIEW_BODY = '## Review\n\nPR #41\n\n### What CI Did Not Prove\n- F1: the first claim\n- F2: the second claim\n\n**Verdict: Approve — conditional on close-out discharging the ledger.**';
export function genCtx(rng, identifier, issueId) {
  if (rng.chance(0.03)) return rng.pick([null, {}, { issue: null }]);
  const stateName = rng.pick(['In Progress', 'Done', 'Canceled', 'Todo', 'In Review']);
  const prUrl = `https://github.com/acme/app/pull/${rng.pick([41, 41, 42, 7])}`;
  const t0 = NOWMS - rng.int(1, 20) * DAY;
  const comments = [];
  const nC = rng.weighted([[0, 2], [1, 2], [3, 3], [6, 1]]);
  for (let i = 0; i < nC; i++) {
    const at = rng.chance(0.9) ? iso(t0 + i * HOUR + rng.int(0, 50) * MIN) : rng.pick([null, 'bad', undefined]);
    const body = rng.weighted([[`opened ${prUrl}`, 2], [REVIEW_BODY, 1.5], [`## Close-out\n\nAll items discharged; merged.\n\n### Ledger\n- F1: done\n\nSee ${prUrl}`, 1], ['## Close-out', 0.3], ['plain note', 2], ['', 0.5], ['   ', 0.3], [`also https://github.com/acme/other/pull/${rng.int(1, 9)}`, 0.5], [5, 0.2]]);
    const c = { id: `c${i}`, body, createdAt: at, user: rng.pick([{ name: 'Ada' }, { displayName: 'Dee' }, 'Bob', '  ', null, {}, 7, undefined]) };
    if (c.user === undefined) delete c.user;
    comments.push(c);
  }
  const issue = {
    id: rng.chance(0.85) ? issueId : rng.pick([null, undefined]),
    identifier: rng.chance(0.9) ? identifier : rng.pick([`LIN-${rng.int(1000, 1999)}`, null]),
    title: rng.chance(0.9) ? 'Build the task page' : rng.pick(['', null]),
    url: rng.chance(0.8) ? `https://linear.app/x/issue/${identifier}` : null,
    state: rng.chance(0.92) ? { name: rng.chance(0.9) ? stateName : '', type: rng.pick(STATE_TYPES) } : null,
    labels: rng.chance(0.85) ? rng.subset(['frontend', { name: 'backend' }, null, { color: 'x' }, '', 'bug'], 0.5) : rng.pick([undefined, 'labels', null]),
    blockedBy: rng.chance(0.8) ? Array.from({ length: rng.int(0, 3) }, () => ref(rng, 'blocker')) : rng.pick([undefined, null, 'x']),
    description: rng.pick(['A description', '  ', '', null, undefined, 42, '## Heading\nbody']),
    createdAt: rng.chance(0.9) ? iso(t0) : null,
    updatedAt: rng.chance(0.9) ? iso(t0 + DAY) : undefined,
  };
  for (const k of Object.keys(issue)) if (issue[k] === undefined) delete issue[k];
  const ctx = {
    issue,
    parent: rng.chance(0.6) ? ref(rng, 'parent') : rng.pick([null, undefined]),
    children: rng.chance(0.8) ? Array.from({ length: rng.int(0, 4) }, () => ref(rng, 'child')) : rng.pick([undefined, null, 'x']),
    comments: rng.chance(0.92) ? comments : rng.pick([undefined, null, 'x']),
    stateTransitions: rng.chance(0.8) ? rng.subset([{ createdAt: iso(t0 + 2 * DAY), toState: stateName }, { createdAt: iso(t0 + DAY), toState: stateName }, { createdAt: null, toState: stateName }, { createdAt: iso(t0), toState: 'Other' }, null], 0.6) : rng.pick([undefined, 'x']),
  };
  for (const k of Object.keys(ctx)) if (ctx[k] === undefined) delete ctx[k];
  return ctx;
}

function briefBody(rng) {
  return rng.weighted([
    ['## Current\n\nBuilding the page now.\n\n### Detail\nmore\n\n## Next\n- x', 3],
    ['## Current\n_None._\n## Next\nx', 1], ['## Current   \n\n- none\n', 0.5], ['## current\nlower case heading\n##Next', 0.5],
    ['# Title\n## Next\nno current', 1], ['## Current\n', 0.5], ['', 0.3], ['## Current\nline\n## \nafter empty heading', 0.4],
    ['##\tCurrent\t\ntabbed', 0.3], ['## Current\n- _none._', 0.3],
  ]);
}
function cacheDoc(rng, ctx, field) {
  if (rng.chance(0.25)) return null;
  const doc = { [field]: rng.chance(0.95) ? briefBody(rng) : '', model: rng.pick(['m1', null, undefined]), generatedAt: rng.pick([iso(NOWMS - HOUR), null]) };
  if (doc.model === undefined) delete doc.model;
  let h = 'stale-hash';
  try { h = ctx && ctx.issue ? hashContext(ctx) : 'x'; } catch { /* odd ctx */ }
  doc.inputHash = rng.chance(0.6) ? h : rng.pick(['stale-hash', undefined]);
  return doc;
}

function evidenceModel(rng, prUrl) {
  if (rng.chance(0.1)) return rng.pick([null, {}, { closeOut: null }]);
  const status = rng.pick(['ready', 'ready', 'merged', 'merged', 'partial', 'not-ready', 'unknown', 'no-pr', 'closed', 'multiple-prs']);
  const pr = rng.chance(0.85) ? { number: rng.pick([41, 42, null, '41', 0]), ...(rng.chance(0.7) ? { url: prUrl } : {}) } : null;
  return {
    issueIdentifier: 'X',
    state: rng.chance(0.8) ? { status: 'open', pr: rng.chance(0.8) ? { number: 41, url: rng.chance(0.85) ? prUrl : null, headSha: rng.pick(['abc1234', null, undefined]) } : null } : undefined,
    evidence: { asked: 'q', done: null },
    closeOut: rng.chance(0.9) ? { status, pr, message: 'm', urlKey: 'acme' } : undefined,
  };
}

function loaderWorld(rng, identifier, issueId, { defaults = false } = {}) {
  const ctx = genCtx(rng, identifier, issueId);
  const prUrl = 'https://github.com/acme/app/pull/41';
  const spec = { nowIso: rng.pick([NOW_ISO, NOW_ISO, '2027-01-02T03:04:05.000Z']), badHelpers: rng.chance(0.01) };
  spec.provider = { ctx, mode: rng.weighted([['promise', 90], ['rejectNotFound', 3], ['reject', 3], ['syncthrow', 1], ['rejectBare', 1]]) };
  const canonical = ctx && ctx.issue && ctx.issue.identifier ? ctx.issue.identifier : identifier;
  if (!defaults) {
    spec.loops = genLoops(rng, canonical, issueId);
    spec.loopsMode = rng.chance(0.02) ? 'reject' : 'promise';
  }
  if (rng.chance(0.85)) spec.briefCache = { doc: cacheDoc(rng, ctx, 'brief'), mode: rng.chance(0.05) ? 'reject' : 'promise' };
  if (rng.chance(0.85)) spec.recapCache = { doc: cacheDoc(rng, ctx, 'recap'), mode: rng.chance(0.05) ? 'reject' : 'promise' };
  const ev = rng.weighted([['fake', 5], ['real', 3], ['none', 1.5]]);
  if (ev === 'fake') spec.evidence = { kind: 'fake', model: evidenceModel(rng, prUrl), mode: rng.chance(0.05) ? rng.pick(['reject', 'throw']) : 'promise' };
  if (ev === 'real') spec.evidence = { kind: 'real' };
  if (ev === 'real' || rng.chance(0.4)) spec.prState = { result: rng.pick([{ readable: true, state: 'open', merged: false, head: { sha: 'abc1234' }, checks: [] }, { readable: true, state: 'closed', merged: true, head: { sha: 'abc1234' }, checks: [{ name: 'ci', conclusion: 'success' }] }, { readable: false }]), mode: rng.chance(0.03) ? 'reject' : 'promise' };
  if (rng.chance(0.6)) spec.closeOutEvents = { rows: rng.subset([{ by: 'press', prUrl, merged: true }, { by: 'close-out', prUrl: 'https://github.com/acme/app/pull/42' }, { by: 'person', prUrl, merged: true }, { by: 'person', prUrl, merged: false }, { by: 'person', prUrl: 5 }, { by: 'press', prUrl: 'https://github.com/acme/other/pull/41', merged: true }], 0.4), mode: rng.chance(0.05) ? 'reject' : 'promise' };
  if (!defaults && rng.chance(0.7)) spec.runFacts = { result: rng.pick([{ stopAt: null, variant: 'unknown' }, { stopAt: 'pr', variant: 'standard' }, { stopAt: 'pr', variant: 'stepper' }]), mode: rng.chance(0.03) ? 'reject' : 'promise' };
  if (defaults || !spec.runFacts) {
    const rows = (spec.loops || genLoops(rng, canonical, issueId, { n: rng.int(0, 5) })).map((l, i) => historyRow(rng, l, i, canonical));
    spec.dispatchStore = { live: rows.filter(r => r._live), history: rows.filter(r => !r._live), status: rows.length && rng.chance(0.5) ? { [rows[0].sessionId || 'sess-1']: { stopAt: 'pr', kind: 'autopilot', variant: rng.pick(['stepper', 'standard']) } } : {}, mode: rng.chance(0.03) ? 'reject' : 'promise' };
    if (defaults) spec.agentStatus = rows.filter(() => rng.chance(0.4)).map(r => ({ dispatchId: r.id, status: rng.pick(['completed', 'blocked', 'running', 'failed']), timestamp: r.dispatchedAt, summary: 'agent says hi', urlKey: 'acme' }));
  }
  return spec;
}

function historyRow(rng, l, i, identifier) {
  const t = typeof l.dispatchedAt === 'string' && !Number.isNaN(Date.parse(l.dispatchedAt)) ? l.dispatchedAt : iso(NOWMS - (10 - i) * HOUR);
  const row = {
    id: l.loopId, _id: l.loopId, issueIdentifier: identifier, issueId: l.issueId ?? null, issueTitle: l.issueTitle ?? null, kind: l.kind ?? 'implementation',
    dispatchedAt: t, status: rng.pick(['taken', 'taken', 'expired', 'cancelled']), resolvedAt: l.resolvedAt ?? null,
    feedback: Array.isArray(l.feedback) ? l.feedback : [], followUpTo: l.followUpTo ?? null, rootItemId: l.loopId, prompt: 'p',
    stopAt: rng.chance(0.2) ? 'pr' : undefined, sessionId: rng.chance(0.3) ? 'sess-1' : undefined,
  };
  if (rng.chance(0.15)) { row._live = true; row.status = 'queued'; }
  for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k];
  return row;
}

const DEP_NAMES = ['dispatchStore', 'agentStatusStore', 'briefCacheStore', 'recapCacheStore', 'readRunEvidence', 'prStateStore', 'closeOutEventsStore', 'readTaskRunFacts', 'getLoopsForIssue'];
function factoryArgs(rng, spec, world) {
  const a = { enrichLoop: { $dep: 'enrichLoop' }, deriveSessionWaiting: { $dep: 'deriveSessionWaiting' }, now: { $dep: 'now' } };
  a.dispatchStore = { $dep: 'dispatchStore' };
  a.agentStatusStore = { $dep: 'agentStatusStore' };
  if (spec.briefCache) a.briefCacheStore = { $dep: 'briefCacheStore' };
  if (spec.recapCache) a.recapCacheStore = { $dep: 'recapCacheStore' };
  if (spec.evidence) a.readRunEvidence = { $dep: 'readRunEvidence' };
  if (spec.prState) a.prStateStore = { $dep: 'prStateStore' };
  if (spec.closeOutEvents) a.closeOutEventsStore = { $dep: 'closeOutEventsStore' };
  if (spec.runFacts) a.readTaskRunFacts = { $dep: 'readTaskRunFacts' };
  if (spec.loops !== undefined) a.getLoopsForIssue = { $dep: 'getLoopsForIssue' };
  if (rng.chance(0.15)) delete a.now; // default clock (frozen)
  void DEP_NAMES; void world;
  return a;
}

function accessArg(rng) {
  const r = rng.next();
  if (r < 0.03) return null;
  if (r < 0.05) return { callScope: 'x' };
  if (r < 0.06) return undefined;
  return { provider: { $dep: 'provider' }, callScope: rng.pick([{ repo: 'acme/app', token: 'tok-1' }, { repo: 'ACME/APP', token: 'tok-2' }, { repo: 'other/x', token: 't' }, 'scope-string', null, { repo: 'acme/app', token: '' }]) };
}

function smallStep(rng) {
  const f = rng.pick(['stageLabel', 'fmtWhen', 'isNotFoundError', 'sessionMessage', 'guessStages', 'briefCurrentSection', 'buildTaskStages', 'deriveReadyHeader', 'deriveHeader']);
  const sessions = () => Array.from({ length: rng.int(0, 6) }, (_, i) => {
    const kind = rng.chance(0.08) ? rng.pick(ODD_KINDS) : rng.pick(KINDS);
    const t = NOWMS - rng.int(1, 30) * DAY + i * HOUR;
    return { loopId: `l${i}`, kind, state: rng.pick(['running', 'queued', 'waiting', 'done', 'failed', 'continued', 'closed', 'cancelled', 'expired', 'aborted']), endedAt: rng.chance(0.6) ? iso(t + HOUR) : rng.pick([null, 'bad']), loop: { takenAt: rng.chance(0.5) ? iso(t + MIN) : null, dispatchedAt: rng.chance(0.8) ? iso(t) : null } };
  });
  switch (f) {
    case 'stageLabel': return { fn: f, args: [rng.chance(0.85) ? rng.pick([...KINDS, ...ODD_KINDS, 'look_into', 'Implementation']) : rng.pick([5, true])] };
    case 'fmtWhen': return { fn: f, args: rng.chance(0.2) ? [rng.pick([iso(NOWMS - rng.int(0, 900) * DAY), null, 'garbage', 0, NOWMS])] : [rng.pick([iso(NOWMS - rng.int(0, 900) * DAY + rng.int(0, DAY)), new Date(NOWMS - rng.int(0, 900) * DAY), '', null, 'garbage', 1700000000000, '2025-12-31T23:59:59.999Z', '2026-01-01T00:00:00.000Z']), new Date(rng.pick([NOWMS, Date.parse('2027-01-01T00:00:00Z'), Date.parse('2025-06-01T00:00:00Z')]))] };
    case 'isNotFoundError': return { fn: f, args: [rng.pick([new Error('Issue not found: LIN-1'), new Error('NOT FOUND'), new Error('boom'), { message: 'x not found' }, 'not found', null, undefined, { message: 5 }])] };
    case 'sessionMessage': { const l = genLoops(rng, 'LIN-1', 'u')[0] || { feedback: [] }; return { fn: f, args: [l, rng.pick(['waiting', 'running', 'done', 'continued', 'queued'])] }; }
    case 'guessStages': return { fn: f, args: rng.chance(0.1) ? [rng.pick([null, 'x', undefined])] : [sessions(), rng.pick([null, undefined, 'completed', 'canceled', 'started', 'duplicate'])] };
    case 'briefCurrentSection': return { fn: f, args: [rng.chance(0.85) ? briefBody(rng) : rng.pick([null, 5, undefined])] };
    case 'buildTaskStages': return { fn: f, args: rng.chance(0.08) ? [rng.pick([null, 'x'])] : [sessions(), rng.chance(0.7) ? { trackerType: rng.pick([null, 'completed', 'canceled', 'started']) } : undefined] };
    case 'deriveReadyHeader': return { fn: f, args: [rng.chance(0.9) ? { status: rng.pick(['ready', 'merged', 'ready']), pr: rng.pick([{ number: 41 }, { number: 0 }, { number: null }, null, {}, { number: '7' }]) } : rng.pick([null, undefined])] };
    default: return { fn: f, args: rng.chance(0.05) ? [] : [{ sessions: sessions(), waiting: rng.pick([{ waiting: true, message: '[blocked] Which DB?\nmore' }, { waiting: true, message: null }, { waiting: true, message: `  ${'y'.repeat(rng.int(158, 162))}` }, { waiting: true, message: `[blocked] ${'w'.repeat(rng.int(158, 162))}\nmore` }, { waiting: false, message: 'x' }, undefined, null]), tracker: rng.pick([null, undefined, { state: { type: 'completed' }, finishedAt: iso(NOWMS - DAY) }, { state: { type: 'canceled' }, finishedAt: null }, { state: { type: 'started' } }, { state: null }]), closeOut: rng.pick([null, undefined, { status: 'ready', pr: { number: 41 } }, { status: 'merged', pr: { number: 41 } }]), now: rng.chance(0.7) ? new Date(NOWMS) : undefined }] };
  }
}

export function generate(seed, index) {
  const rng = new Rng(seed, 'gen', index);
  const id = `gen:${index}`;
  const fam = rng.weighted([['model', 38], ['load', 34], ['state', 8], ['defaults', 6], ['small', 14]]);
  const identifier = rng.chance(0.9) ? `LIN-${rng.int(1, 999)}` : rng.pick(['11111111-2222-3333-4444-555555555555', '', null]);
  const issueId = rng.chance(0.85) ? `uuid-${rng.hex(8)}` : null;
  if (fam === 'small') return { id, tier: 'gen', family: fam, world: null, steps: Array.from({ length: rng.int(1, 3) }, () => smallStep(rng)) };
  if (fam === 'model') {
    const ctx = rng.chance(0.75) ? genCtx(rng, identifier, issueId) : null;
    const world = { badHelpers: rng.chance(0.01) };
    const input = { identifier, loops: genLoops(rng, identifier, issueId), ctx, enrichLoop: { $dep: 'enrichLoop' }, deriveSessionWaiting: { $dep: 'deriveSessionWaiting' } };
    if (rng.chance(0.6)) input.brief = cacheDoc(rng, ctx, 'brief');
    if (rng.chance(0.6)) input.recap = cacheDoc(rng, ctx, 'recap');
    if (rng.chance(0.4)) input.contextMiss = rng.pick([null, { brief: 'stale' }, { recap: 'unverifiable', brief: null }, {}]);
    if (rng.chance(0.6)) input.evidence = evidenceModel(rng, 'https://github.com/acme/app/pull/41');
    if (rng.chance(0.5)) input.issueId = rng.pick([issueId, null, 'other-id']);
    if (rng.chance(0.75)) input.now = new Date(rng.pick([NOWMS, Date.parse('2027-02-01T00:00:00Z')]));
    if (rng.chance(0.03)) input.loops = rng.pick([undefined, null, 'x']);
    if (input.loops === undefined) delete input.loops;
    if (rng.chance(0.01)) delete input.enrichLoop;
    return { id, tier: 'gen', family: fam, world, steps: [{ fn: 'buildTaskPageModel', args: [input] }] };
  }
  const spec = loaderWorld(rng, identifier, issueId, { defaults: fam === 'defaults' });
  const steps = [{ fn: 'createTaskPageLoader', args: [factoryArgs(rng, spec)] }];
  const urlKey = rng.pick(['acme', 'acme', 'acme', '', null]);
  if (fam === 'state') steps.push({ fn: '$0.loadTaskState', args: [{ urlKey, identifier, ...(rng.chance(0.5) ? { issueId: rng.pick([issueId, null, 'x']) } : {}) }] });
  else {
    const a = { urlKey, identifier, access: accessArg(rng) };
    if (a.access === undefined) delete a.access;
    if (rng.chance(0.5)) a.viewerIsOwner = rng.chance(0.6);
    if (rng.chance(0.5)) a.runnerReady = rng.chance(0.6);
    steps.push({ fn: '$0.loadTaskPage', args: [a] });
    if (rng.chance(0.15)) steps.push({ fn: '$0.loadTaskState', args: [{ urlKey, identifier }] });
  }
  return { id, tier: 'gen', family: fam, world: spec, steps };
}

// ------------------------------------------------------------ edge cases
export function edgeCases() {
  const E = [];
  const add = (family, world, steps) => E.push({ id: `edge:${E.length}`, tier: 'edge', family, world, steps });
  const L = (over = {}) => ({ loopId: over.loopId || 'loop-a', issueIdentifier: 'LIN-50', issueId: 'u-1', issueTitle: 'Stored', kind: 'implementation', source: 'history', historyStatus: 'taken', agentState: 'running', dispatchedAt: '2026-09-30T10:00:00.000Z', takenAt: '2026-09-30T10:01:00.000Z', resolvedAt: '2026-09-30T10:01:00.000Z', terminalStatus: null, terminalCompletedAt: null, wakeMarker: null, waitingMessage: null, feedback: [], telemetry: { producedArtifacts: [] }, followUpTo: null, ...over });
  const model = (input, world = {}) => add('model', world, [{ fn: 'buildTaskPageModel', args: [{ identifier: 'LIN-50', enrichLoop: { $dep: 'enrichLoop' }, deriveSessionWaiting: { $dep: 'deriveSessionWaiting' }, now: new Date(NOWMS), ...input }] }]);
  const ctx = (over = {}, issueOver = {}) => ({ issue: { id: 'u-1', identifier: 'LIN-50', title: 'T', url: 'https://l/x', state: { name: 'In Progress', type: 'started' }, labels: [], blockedBy: [], createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z', ...issueOver }, parent: null, children: [], comments: [], stateTransitions: [], ...over });
  // Session state machine.
  model({ loops: [] });
  model({ loops: [], ctx: ctx() });
  model({ loops: [L({ agentState: 'queued' })] });
  model({ loops: [L({ agentState: 'queued', loopId: 'a' }), L({ loopId: 'b', followUpTo: 'a', dispatchedAt: '2026-09-30T11:00:00.000Z' })] });
  model({ loops: [L({ loopId: 'a', wakeMarker: 'blocked', waitingMessage: '[blocked] Q?', feedback: [{ message: '[blocked] Q?' }] }), L({ loopId: 'b', followUpTo: 'a', dispatchedAt: '2026-09-30T12:00:00.000Z' })] });
  model({ loops: [L({ loopId: 'a', followUpTo: 'a' })] });
  model({ loops: [L({ loopId: 'a' }), L({ loopId: 'b', followUpTo: 'a', dispatchedAt: null }), L({ loopId: 'c', followUpTo: 'a', dispatchedAt: '2026-09-30T13:00:00.000Z' })] });
  model({ loops: [L({ terminalStatus: 'done', terminalCompletedAt: '2026-09-30T11:00:00.000Z', feedback: [{ message: '[done] landed' }] })] });
  model({ loops: [L({ bookkeeping: { at: '2026-09-30T12:00:00.000Z' } })] });
  model({ loops: [L({ bookkeeping: {} , completedAt: null, resolvedAt: null})] });
  for (const hs of ['cancelled', 'expired']) model({ loops: [L({ historyStatus: hs })] });
  for (const as of ['complete', 'error', 'waiting', 'idle', null]) model({ loops: [L({ agentState: as })] });
  model({ loops: [L({ terminalStatus: undefined, feedback: [{ message: '[failed] boom', timestamp: '2026-09-30T11:00:00.000Z' }] })] });
  model({ loops: [L({ terminalStatus: 'done', terminalCompletedAt: null, completedAt: null, resolvedAt: null })] });
  model({ loops: [L({ wakeMarker: 'blocked', feedback: [{ message: '[blocked] Which DB?' }], agentSummary: 'summary' })] });
  model({ loops: [L({ agentState: 'complete', feedback: [{ message: '[blocked] stale question' }], agentSummary: 'closing line' })] });
  model({ loops: [L({ feedback: [{ message: '[pending] waiting on CI' }] })] });
  model({ loops: [L({ agentSummary: '[done]   ' })] });
  model({ loops: [L({ telemetry: { producedArtifacts: [{ url: 'https://a/1', label: '' }, { url: 'HTTPS://B/2' }, { url: 'javascript:alert(1)' }, null, { url: 'https://c/3', label: 'C' }] } })] });
  // Header sentence ladder.
  model({ loops: [L()], ctx: ctx({ stateTransitions: [{ toState: 'Done', createdAt: '2026-09-30T00:00:00.000Z' }] }, { state: { name: 'Done', type: 'completed' } }) });
  model({ loops: [L()], ctx: ctx({ stateTransitions: [{ toState: 'Canceled', createdAt: '2025-09-30T00:00:00.000Z' }] }, { state: { name: 'Canceled', type: 'canceled' } }) });
  model({ loops: [L({ terminalStatus: 'done' })], ctx: ctx({}, { state: { name: 'Done', type: 'completed' } }) });
  model({ loops: [L({ terminalStatus: 'done', terminalCompletedAt: '2026-09-30T11:00:00.000Z' })], evidence: { closeOut: { status: 'ready', pr: { number: 41 } }, state: { pr: { headSha: 'abc', url: 'u' } } }, ctx: ctx() });
  model({ loops: [L({ terminalStatus: 'done', terminalCompletedAt: '2026-09-30T11:00:00.000Z' })], evidence: { closeOut: { status: 'ready', pr: { number: 41 } } }, ctx: null });
  model({ loops: [L({ kind: 'review', takenAt: null, dispatchedAt: null })] });
  model({ loops: [L({ terminalStatus: 'done', terminalCompletedAt: 'garbage' })] });
  // Stage folding.
  const seq = (kinds) => kinds.map((k, i) => L({ loopId: `s${i}`, kind: k, dispatchedAt: iso(NOWMS - (10 - i) * HOUR), takenAt: null, terminalStatus: i < kinds.length - 1 ? 'done' : null, terminalCompletedAt: i < kinds.length - 1 ? iso(NOWMS - (10 - i) * HOUR + 30 * MIN) : null }));
  model({ loops: seq(['autopilot', 'implementation', 'wake', 'implementation', 'review', 'custom']) });
  model({ loops: seq(['autopilot', 'wake', 'periodical']) });
  model({ loops: seq(['review', 'implementation', 'research']) });
  model({ loops: seq(['plan-review', 'triage']) });
  model({ loops: seq(['implementation', 'autopilot']), ctx: ctx({}, { state: { name: 'Done', type: 'completed' } }) });
  model({ loops: seq(['constructor', '__proto__', 'toString', 'mystery']) });
  model({ loops: [L({ kind: 5 })] });
  // Tracker shapes.
  model({ loops: [], ctx: ctx({ parent: { identifier: 'LIN-0', title: '', state: { name: '', type: '' } }, children: [{ identifier: 'LIN-9', state: null }, null, { title: 'x' }], comments: [{ body: 'A', user: { name: 'Ada' } }, { body: 'B', user: 'Bob ' }, { body: 'C', user: '  ' }, { body: 'D', user: { displayName: 'Dee' } }, { body: '  ' }, { body: 5 }, null, { body: 'E', user: 7 }], stateTransitions: [null, { toState: 'In Progress' }, { toState: 'In Progress', createdAt: '2026-09-29T00:00:00.000Z' }] }, { labels: ['a', { name: 'b' }, null, { color: 1 }, ''], blockedBy: [{ identifier: 'LIN-1', title: 'B', state: { name: 'Done', type: 'completed' } }, {}], description: '  ' }) });
  model({ loops: [], ctx: ctx({}, { identifier: null, title: null, id: null, state: null, labels: 'x', blockedBy: 'x', description: 5, url: null }), issueId: 'given' });
  model({ loops: [L({ issueId: null }), L({ loopId: 'b', issueId: 'from-loop' }), L({ loopId: 'c', issueId: null })], ctx: null });
  model({ loops: [], ctx: { issue: null } });
  model({ loops: 'not-an-array' });
  model({ loops: [L()], brief: { brief: '## Current\nNow.\n## Next\nx', model: 'm', generatedAt: 't' }, recap: { recap: 'R' }, contextMiss: { brief: 'stale', recap: null } });
  model({ loops: [L()], brief: { brief: '' }, recap: { model: 'm' }, contextMiss: {} });
  add('model-missing-helpers', null, [{ fn: 'buildTaskPageModel', args: [{ identifier: 'LIN-1', loops: [L()] }] }]);
  add('model-missing-helpers-empty', null, [{ fn: 'buildTaskPageModel', args: [{ identifier: 'LIN-1', loops: [] }] }]);
  add('model-no-arg', null, [{ fn: 'buildTaskPageModel', args: [] }]);
  // Loader paths.
  const prUrl = 'https://github.com/acme/app/pull/41';
  const base = (over = {}) => ({ provider: { ctx: ctx({ comments: [{ body: `opened ${prUrl}`, createdAt: '2026-09-30T00:00:00.000Z' }] }) }, loops: [L({ terminalStatus: 'done', terminalCompletedAt: '2026-09-30T11:00:00.000Z' })], briefCache: { doc: null }, recapCache: { doc: null }, ...over });
  const loadSteps = (spec, args = {}, fArgs = {}) => {
    const f = { enrichLoop: { $dep: 'enrichLoop' }, deriveSessionWaiting: { $dep: 'deriveSessionWaiting' }, now: { $dep: 'now' }, dispatchStore: { $dep: 'dispatchStore' }, agentStatusStore: { $dep: 'agentStatusStore' } };
    if (spec.briefCache) f.briefCacheStore = { $dep: 'briefCacheStore' };
    if (spec.recapCache) f.recapCacheStore = { $dep: 'recapCacheStore' };
    if (spec.evidence) f.readRunEvidence = { $dep: 'readRunEvidence' };
    if (spec.prState) f.prStateStore = { $dep: 'prStateStore' };
    if (spec.closeOutEvents) f.closeOutEventsStore = { $dep: 'closeOutEventsStore' };
    if (spec.runFacts) f.readTaskRunFacts = { $dep: 'readTaskRunFacts' };
    if (spec.loops !== undefined) f.getLoopsForIssue = { $dep: 'getLoopsForIssue' };
    return [{ fn: 'createTaskPageLoader', args: [{ ...f, ...fArgs }] }, { fn: '$0.loadTaskPage', args: [{ urlKey: 'acme', identifier: 'LIN-50', access: { provider: { $dep: 'provider' }, callScope: { repo: 'acme/app', token: 'tok' } }, ...args }] }];
  };
  const load = (family, spec, args, fArgs) => add(family, spec, loadSteps(spec, args, fArgs));
  load('load-basic', base());
  for (const mode of ['rejectNotFound', 'reject', 'syncthrow', 'rejectBare']) load(`load-provider-${mode}`, base({ provider: { ctx: null, mode } }));
  load('load-null-ctx', base({ provider: { ctx: null } }));
  load('load-ctx-no-issue', base({ provider: { ctx: { issue: null } } }));
  load('load-no-access', base(), { access: null });
  load('load-access-no-provider', base(), { access: { callScope: 'x' } });
  load('load-uuid-open', base({ provider: { ctx: ctx({}, { identifier: 'LIN-77' }) } }), { identifier: '11111111-2222-3333-4444-555555555555' });
  load('load-issue-no-identifier', base({ provider: { ctx: ctx({}, { identifier: null, id: null, title: null }) } }));
  load('load-loops-reject', base({ loopsMode: 'reject' }));
  // Brief/recap verification (LIN-3373).
  const c0 = ctx({ children: [{ identifier: 'LIN-9', state: { type: 'completed' } }] });
  const c1 = ctx({ children: [{ identifier: 'LIN-9', state: { type: 'started' } }] }, { state: { name: 'Done', type: 'completed' } });
  const c2 = ctx({ children: [{ identifier: 'LIN-9', state: { type: 'started' } }] });
  const safeHash = (c) => { try { return hashContext(c); } catch { return 'unhashable'; } };
  const doc = (c, field, good) => ({ [field]: '## Current\nNow.\n', model: 'm', generatedAt: 'g', inputHash: good ? safeHash(c) : 'stale' });
  for (const [name, c] of [['exact', c0], ['finished-open-children', c1], ['inexact-open', c2], ['no-children', ctx({ children: 'x' })]]) {
    for (const good of [true, false]) load(`load-cache-${name}-${good ? 'match' : 'stale'}`, base({ provider: { ctx: c }, briefCache: { doc: doc(c, 'brief', good) }, recapCache: { doc: doc(c, 'recap', !good) } }));
  }
  load('load-cache-reject', base({ briefCache: { doc: null, mode: 'reject' }, recapCache: { doc: null, mode: 'reject' } }));
  load('load-cache-absent', base({ briefCache: undefined, recapCache: undefined }));
  load('load-no-issueId', base({ provider: { ctx: ctx({}, { id: null }) }, loops: [L({ issueId: null })], briefCache: { doc: { brief: 'x' } } }));
  // Evidence: fake models, real reader, merged-by.
  const ready = { closeOut: { status: 'ready', pr: { number: 41, url: prUrl } }, state: { pr: { headSha: 'abc', url: prUrl } } };
  load('load-evidence-ready', base({ evidence: { kind: 'fake', model: ready } }));
  load('load-evidence-reject', base({ evidence: { kind: 'fake', model: null, mode: 'reject' } }));
  load('load-evidence-throw', base({ evidence: { kind: 'fake', model: null, mode: 'throw' } }));
  const merged = (pr) => ({ closeOut: { status: 'merged', pr }, state: { pr: { headSha: 'abc', url: prUrl } } });
  const evRows = [{ by: 'press', prUrl, merged: true }];
  load('load-merged-press', base({ evidence: { kind: 'fake', model: merged({ number: 41, url: prUrl }) }, closeOutEvents: { rows: evRows } }));
  load('load-merged-closeout-by-number', base({ evidence: { kind: 'fake', model: merged({ number: 41 }) }, closeOutEvents: { rows: [{ by: 'close-out', prUrl }] } }));
  load('load-merged-person', base({ evidence: { kind: 'fake', model: { closeOut: { status: 'partial', pr: { number: 41, url: prUrl } } } }, closeOutEvents: { rows: [{ by: 'person', prUrl, merged: true }, { by: 'press', prUrl: 'https://github.com/acme/app/pull/42' }] } }));
  load('load-merged-person-unmerged', base({ evidence: { kind: 'fake', model: merged({ number: 41, url: prUrl }) }, closeOutEvents: { rows: [{ by: 'person', prUrl, merged: false }] } }));
  load('load-merged-events-reject', base({ evidence: { kind: 'fake', model: merged({ number: 41, url: prUrl }) }, closeOutEvents: { rows: null, mode: 'reject' } }));
  load('load-merged-events-nonarray', base({ evidence: { kind: 'fake', model: merged({ number: 41, url: prUrl }) }, closeOutEvents: { rows: 'x' } }));
  load('load-merged-no-pr', base({ evidence: { kind: 'fake', model: merged(null) }, closeOutEvents: { rows: evRows } }));
  load('load-merged-no-store', base({ evidence: { kind: 'fake', model: merged({ number: 41, url: prUrl }) } }));
  load('load-closeout-summary', base({ provider: { ctx: ctx({ comments: [{ body: REVIEW_BODY, createdAt: '2026-09-29T00:00:00.000Z' }, { body: '## Close-out\n\nAll done.\n\n## Ledger\n- x', createdAt: '2026-09-30T00:00:00.000Z' }] }) }, evidence: { kind: 'fake', model: merged({ number: 41, url: prUrl }) }, closeOutEvents: { rows: evRows } }));
  for (const scope of [{ repo: 'acme/app', token: 'tok' }, { repo: 'ACME/App', token: 'tok' }, { repo: 'x/y', token: 'tok' }, 'str']) {
    load(`load-real-evidence-${typeof scope === 'string' ? scope : scope.repo}`, base({ evidence: { kind: 'real' }, prState: { result: { readable: true, state: 'open', merged: false, head: { sha: 'abc1234' }, checks: [] } } }), { access: { provider: { $dep: 'provider' }, callScope: scope }, viewerIsOwner: true, runnerReady: true });
  }
  load('load-real-evidence-no-urlKey', base({ evidence: { kind: 'real' }, prState: { result: { readable: true, state: 'closed', merged: true, head: { sha: 'abc' }, checks: [] } } }), { urlKey: '' });
  load('load-real-evidence-prstate-reject', base({ evidence: { kind: 'real' }, prState: { result: null, mode: 'reject' } }));
  load('load-real-evidence-no-pr', base({ provider: { ctx: ctx({ comments: [] }) }, evidence: { kind: 'real' } }));
  // Run facts.
  load('load-runfacts-fake', base({ runFacts: { result: { stopAt: 'pr', variant: 'stepper' } }, evidence: { kind: 'real' }, prState: { result: { readable: true, state: 'open', merged: false, head: { sha: 'a' }, checks: [] } } }));
  load('load-runfacts-reject', base({ runFacts: { result: null, mode: 'reject' } }));
  load('load-runfacts-real', base({ dispatchStore: { live: [{ id: 'q1', issueIdentifier: 'LIN-50', kind: 'autopilot', variant: 'stepper', sessionId: 's1' }], history: [{ id: 'h1', issueIdentifier: 'LIN-50', stopAt: 'pr', sessionId: 's1' }], status: { s1: { stopAt: 'pr', variant: 'standard' } } } }));
  load('load-runfacts-real-hop', base({ dispatchStore: { live: [], history: [{ id: 'h1', issueIdentifier: 'LIN-50', sessionId: 's1' }, { id: 'h2', issueIdentifier: 'LIN-50', sessionId: 's2' }], status: { s1: null, s2: { stopAt: 'pr', kind: 'autopilot', variant: 'stepper' } } } }));
  // Factory guards, defaults, state endpoint.
  add('factory-no-helpers', null, [{ fn: 'createTaskPageLoader', args: [{}] }]);
  add('factory-no-arg', null, [{ fn: 'createTaskPageLoader', args: [] }]);
  add('factory-one-helper', { }, [{ fn: 'createTaskPageLoader', args: [{ enrichLoop: { $dep: 'enrichLoop' } }] }]);
  const st = (spec, args) => add('state', spec, [{ fn: 'createTaskPageLoader', args: [{ enrichLoop: { $dep: 'enrichLoop' }, deriveSessionWaiting: { $dep: 'deriveSessionWaiting' }, now: { $dep: 'now' }, getLoopsForIssue: { $dep: 'getLoopsForIssue' }, dispatchStore: { $dep: 'dispatchStore' }, agentStatusStore: { $dep: 'agentStatusStore' } }] }, { fn: '$0.loadTaskState', args: [args] }]);
  st({ loops: [L({ issueId: 'from-loop' })] }, { urlKey: 'acme', identifier: 'LIN-50' });
  st({ loops: [L({ issueId: 'from-loop' })] }, { urlKey: 'acme', identifier: 'LIN-50', issueId: 'given' });
  st({ loops: [] }, { urlKey: 'acme', identifier: 'LIN-50' });
  st({ loops: null, loopsMode: 'reject' }, { urlKey: 'acme', identifier: 'LIN-50' });
  // Real getLoopsForIssue default (pipeline-loops over fake stores).
  const hist = [{ _id: 'h1', id: 'h1', issueIdentifier: 'LIN-50', kind: 'implementation', dispatchedAt: '2026-08-01T10:00:00.000Z', status: 'taken', resolvedAt: '2026-08-01T10:05:00.000Z', feedback: [{ message: '[done] landed', timestamp: '2026-08-01T11:00:00.000Z' }], rootItemId: 'h1', prompt: 'p' }, { _id: 'h2', id: 'h2', issueIdentifier: 'LIN-50', kind: 'review', dispatchedAt: '2026-09-30T10:00:00.000Z', status: 'taken', feedback: [{ message: '[blocked] Which?', timestamp: '2026-09-30T10:30:00.000Z' }], rootItemId: 'h2', followUpTo: null, prompt: 'p' }];
  const defaults = { provider: { ctx: ctx() }, dispatchStore: { live: [{ id: 'q1', _id: 'q1', issueIdentifier: 'LIN-50', kind: 'implementation', dispatchedAt: '2026-10-01T11:00:00.000Z', status: 'queued' }], history: hist, status: {} }, agentStatus: [{ dispatchId: 'h2', status: 'blocked', timestamp: '2026-09-30T10:31:00.000Z', summary: 'need input' }] };
  add('defaults-real-loops', defaults, [{ fn: 'createTaskPageLoader', args: [{ enrichLoop: { $dep: 'enrichLoop' }, deriveSessionWaiting: { $dep: 'deriveSessionWaiting' }, dispatchStore: { $dep: 'dispatchStore' }, agentStatusStore: { $dep: 'agentStatusStore' } }] }, { fn: '$0.loadTaskPage', args: [{ urlKey: 'acme', identifier: 'LIN-50', access: { provider: { $dep: 'provider' }, callScope: null } }] }, { fn: '$0.loadTaskState', args: [{ urlKey: 'acme', identifier: 'LIN-50' }] }]);
  add('defaults-no-stores', { provider: { ctx: ctx() } }, [{ fn: 'createTaskPageLoader', args: [{ enrichLoop: { $dep: 'enrichLoop' }, deriveSessionWaiting: { $dep: 'deriveSessionWaiting' } }] }, { fn: '$0.loadTaskPage', args: [{ urlKey: 'acme', identifier: 'LIN-50', access: { provider: { $dep: 'provider' } } }] }]);
  add('defaults-state-empty-urlKey', defaults, [{ fn: 'createTaskPageLoader', args: [{ enrichLoop: { $dep: 'enrichLoop' }, deriveSessionWaiting: { $dep: 'deriveSessionWaiting' }, dispatchStore: { $dep: 'dispatchStore' }, agentStatusStore: { $dep: 'agentStatusStore' } }] }, { fn: '$0.loadTaskState', args: [{ urlKey: '', identifier: 'LIN-50' }] }]);
  // Small exports: exact tables.
  const small = [
    ['stageLabel', [['implementation'], ['look-into'], ['mystery'], [null], [''], ['constructor'], ['__proto__'], ['hasOwnProperty'], [undefined]]],
    ['fmtWhen', [['2026-10-06T14:02:00.000Z', new Date('2026-10-06T00:00:00Z')], ['2025-12-31T23:59:00.000Z', new Date('2026-01-01T00:00:00Z')], ['2026-01-05T03:04:00.000Z'], [new Date('2026-02-03T04:05:06Z')], [0], [''], ['nope'], [1759320000000, new Date(NOWMS)], [null]]],
    ['isNotFoundError', [[new Error('Issue not found: LIN-9')], [new Error('Not Found')], [new Error('nope')], [null], [{ message: 'NOT FOUND here' }], ['not found'], [{}]]],
    ['briefCurrentSection', [['## Current\nA\n### Sub\nB\n## Next\nC'], ['## Current\n_None._'], ['## Current\n- None'], ['## Current\nnone.'], ['## CURRENT  \nx'], ['## Currently\nx'], ['## Current\n\n\n'], [''], [null], [7], ['## Current\nA\n##Next\nB\n## Next\nC']]],
    ['guessStages', [[[]], [[{ kind: 'implementation' }]], [[{ kind: 'review' }, { kind: 'implementation' }]], [[{ kind: 'triage' }]], [[{ kind: 'close-out' }]], [[{ kind: 'review' }], 'completed'], [[{ kind: 'review' }], 'canceled'], [[{ kind: 'review' }], 'started'], [null], [[null, { kind: 'plan' }]]]],
    ['deriveReadyHeader', [[{ status: 'ready', pr: { number: 41 } }], [{ status: 'ready', pr: { number: 0 } }], [{ status: 'ready', pr: { number: null } }], [{ status: 'ready', pr: {} }], [{ status: 'ready' }], [{ status: 'merged', pr: { number: 1 } }], [null], [undefined]]],
    ['deriveHeader', [[], [{}], [{ sessions: [], waiting: { waiting: true, message: null } }], [{ sessions: [], waiting: { waiting: true, message: '[blocked]  \n  Real question here\nmore' } }], [{ sessions: [], waiting: { waiting: true, message: 'z'.repeat(161) } }], [{ sessions: [], waiting: { waiting: true, message: 'z'.repeat(160) } }], [{ sessions: [], tracker: { state: { type: 'completed' }, finishedAt: '2026-09-30T08:00:00.000Z' }, now: new Date(NOWMS) }], [{ sessions: [], tracker: { state: { type: 'canceled' }, finishedAt: 'bad' } }], [{ sessions: [{ kind: 'review', state: 'queued', loop: {} }, { kind: 'implementation', state: 'running', loop: { dispatchedAt: '2026-09-30T08:00:00.000Z' } }] }], [{ sessions: [{ kind: 'review', state: 'queued', loop: {} }], closeOut: { status: 'ready', pr: { number: 3 } } }], [{ sessions: [{ kind: 'review', state: 'done', endedAt: null, loop: {} }] }], [{ sessions: [{ kind: 'review', state: 'done', endedAt: '2026-09-30T08:00:00.000Z', loop: {} }], closeOut: { status: 'ready', pr: { number: 3 } } }]]],
    ['buildTaskStages', [[[]], [null], [[{ loopId: 'a', kind: 'autopilot', state: 'done', endedAt: 'x', loop: {} }]], [[{ loopId: 'a', kind: 'implementation', state: 'failed', endedAt: '2026-09-30T08:00:00.000Z', loop: { takenAt: '2026-09-30T09:00:00.000Z' } }]], [[{ loopId: 'a', kind: 'implementation', state: 'done', endedAt: '2026-09-30T10:00:00.000Z', loop: { dispatchedAt: '2026-09-30T08:00:00.000Z' } }, { loopId: 'b', kind: 'wake', state: 'done', loop: {} }, { loopId: 'c', kind: 'implementation', state: 'running', endedAt: null, loop: {} }], { trackerType: 'completed' }]]],
  ];
  for (const [fn, calls] of small) add(`small:${fn}`, null, calls.map(a => ({ fn, args: a })));
  add('sessionMessage-table', null, [
    { fn: 'sessionMessage', args: [{ feedback: [{ message: '[blocked] Q?' }], agentSummary: 'S' }, 'waiting'] },
    { fn: 'sessionMessage', args: [{ feedback: [{ message: '[blocked] Q?' }], agentSummary: 'S' }, 'running'] },
    { fn: 'sessionMessage', args: [{ feedback: [{ message: '[blocked] Q?' }] }, 'done'] },
    { fn: 'sessionMessage', args: [{ feedback: [{ message: '[done]' }], agentSummary: 'S' }, 'done'] },
    { fn: 'sessionMessage', args: [{ feedback: [{ message: '[done] [done] twice' }] }, 'done'] },
    { fn: 'sessionMessage', args: [{ feedback: 'x', agentSummary: 5 }, 'done'] },
    { fn: 'sessionMessage', args: [{}, 'done'] },
  ]);
  return E;
}
