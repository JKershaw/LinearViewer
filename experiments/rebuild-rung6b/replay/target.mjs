// rung6b target: lib/kpi-stats.js — generators, edge cases, fake world and
// the privacy-leak scan, plugged into the shared replay kit (../../replay-kit).
//
// World: every collection is an in-memory MangoDB collection (the real
// MangoDB matcher/projection/aggregation engine over a private array, so the
// aggregation pipelines run for real), the same without aggregate() (the
// find fallback), or the unit tests' hand-rolled mock; any method can be made
// to throw/reject. Every call is recorded (`storeCalls`).
//
// Privacy: every non-label string field in the generated inputs carries a
// canary (`cnry-<field>-<hex>`). `inspect()` scans each collectKpiStats
// result (keys and values) for canaries, and for exact echoes of any non-label
// input string; a hit is a `privacy-leak` finding (top severity). Label fields
// (app-defined vocabulary that is allowed through): kind, endpoint, method,
// and the dbBackend option.
import { Rng, canary, CANARY_RE, recordDep, memCollection, stringsIn, deliver } from '../../replay-kit/lib/gen-kit.mjs';
import { sigPath } from '../../replay-kit/lib/canon.mjs';

export const LABEL_KEYS = new Set(['kind', 'endpoint', 'method', 'dbBackend', 'rung', 'surfaces']);
// Strings the module (or the milestone funnel it embeds) emits on its own: an
// input that happens to equal one is not an echo.
const APP_VOCAB = new Set(['other', 'orienting', 'deciding', 'acting', 'watching', 'reporting', 'unknown', 'no-signal', 'reached', 'not-reached', 'mongodb', 'mangodb', 'none']);
const LABEL_CANARY = /^cnry-(kind|endpoint|method|dbbackend)-/i;
const CANARY_ONE = new RegExp(CANARY_RE.source, 'i');
const COLLECTIONS = ['sessions', 'userPreferences', 'workspacePreferences', 'customPrompts', 'localIssues', 'dispatchQueue', 'dispatchHistory',
  'dispatchTokens', 'proxyTokens', 'proxyEvents', 'agentStatus', 'freeTier', 'recapCache', 'briefCache', 'reportHistory'];
const NOW_ISO = '2026-10-01T12:00:00.000Z';
const DAY = 86400000; const HOUR = 3600000;

// ---------------------------------------------------------------- world
export function createWorld(spec, io) {
  const w = {};
  const fail = (f) => f || {};
  for (const [name, c] of Object.entries(spec.collections || {})) {
    if (c === null) continue;
    w[name] = recordDep(name, memCollection(c.docs || [], { flavour: c.flavour, fail: fail(c.fail) }), io);
  }
  const f = spec.funnel;
  if (f) {
    if (f.dispatchQueue) w['funnel.dispatchQueue'] = recordDep('funnel.dispatchQueue', memCollection(f.dispatchQueue.docs, { flavour: f.dispatchQueue.flavour, fail: fail(f.dispatchQueue.fail) }), io);
    if (f.dispatchHistory) w['funnel.dispatchHistory'] = recordDep('funnel.dispatchHistory', memCollection(f.dispatchHistory.docs, { flavour: f.dispatchHistory.flavour, fail: fail(f.dispatchHistory.fail) }), io);
    if (f.accounts) {
      const accounts = f.accounts;
      w['funnel.accountStore'] = recordDep('funnel.accountStore', {
        collection: recordDep('funnel.accountStore.collection', memCollection(accounts.docs, { flavour: 'mango', fail: fail(accounts.fail) }), io),
        resolveCanonicalAccountId: async (id) => { if (accounts.canonFail && id === accounts.canonFail) throw new Error('canon read failed'); return accounts.canon[id] || id; },
      }, io);
    }
    if (f.edges) w['funnel.accountWorkspaceStore'] = recordDep('funnel.accountWorkspaceStore', { collection: recordDep('funnel.accountWorkspaceStore.collection', memCollection(f.edges.docs, { flavour: 'mango' }), io) }, io);
    if (f.funnelEvents) w['funnel.funnelEventStore'] = recordDep('funnel.funnelEventStore', { firstPerAccount: (q) => deliver(f.funnelEvents.mode || 'promise', f.funnelEvents.rows, 'firstPerAccount') }, io);
    if (f.taskMode) w['funnel.taskModeStore'] = recordDep('funnel.taskModeStore', { countByEntryRung: (q) => deliver(f.taskMode.mode || 'promise', f.taskMode.result, 'countByEntryRung') }, io);
  }
  return w;
}

/** Build the collectKpiStats args spec from a world spec. */
function collectArgs(spec, opts) {
  const collections = {};
  for (const n of COLLECTIONS) if (spec.collections[n] !== null && spec.collections[n] !== undefined) collections[n] = { $dep: n };
  const o = {};
  if (opts.now !== undefined) o.now = opts.now;
  if (opts.dbBackend !== undefined) o.dbBackend = opts.dbBackend;
  if (opts.funnel !== 'absent') {
    const f = spec.funnel || {};
    const d = {};
    if (f.dispatchQueue) d.dispatchQueue = { $dep: 'funnel.dispatchQueue' };
    if (f.dispatchHistory) d.dispatchHistory = { $dep: 'funnel.dispatchHistory' };
    if (f.accounts) d.accountStore = { $dep: 'funnel.accountStore' };
    if (f.edges) d.accountWorkspaceStore = { $dep: 'funnel.accountWorkspaceStore' };
    if (f.funnelEvents) d.funnelEventStore = { $dep: 'funnel.funnelEventStore' };
    if (f.taskMode) d.taskModeStore = { $dep: 'funnel.taskModeStore' };
    if (f.instrumentedSteps) d.instrumentedSteps = f.instrumentedSteps;
    o.milestoneFunnelDeps = d;
  }
  return opts.noOptions ? [collections] : [collections, o];
}

// ------------------------------------------------------------ generators
const KINDS = ['implementation', 'review', 'plan', 'plan-review', 'triage', 'autopilot', 'wake', 'custom', 'periodical', 'research', 'merge', 'close-out', 'test', 'docs'];
const ENDPOINTS = ['/api/proxy/stack', '/api/proxy/issues/:id', '/api/proxy/issues', '/api/proxy/issues/comments', '/api/proxy/brief/:id',
  '/api/proxy/recommend-and-dispatch', '/api/proxy/recommend', '/api/proxy/prompt/:id', '/api/proxy/autopilot/kickoff', '/api/proxy/foreman/playbook',
  '/api/proxy/dispatch', '/api/proxy/dispatch/:id', '/api/proxy/foreman/sessions', '/api/proxy/foreman/tasks', '/api/proxy/agent/status',
  '/api/proxy/foreman/status', '/api/proxy/workspace', '/api/proxy/projects', '/api/proxy/dispatchx', '/api/proxy/agent/statuses', ' /api/proxy/stack ', ''];
const METHODS = ['GET', 'GET', 'GET', 'POST', 'POST', 'PATCH', 'DELETE', 'get', 'post', 'PUT'];
const AGENT_STATUSES = ['completed', 'completed', 'failed', 'blocked', 'running', 'started', 'COMPLETED', 'Failed', 'other', 'OTHER', 'constructor', 'toString', '__proto__', 'hasOwnProperty', '', 42, null];
const HARNESSES = ['claude-code', 'claude-code', 'opencode', 'codex', null];
const LANES = ['subscription', 'api', 'openrouter', 'cash', null];

function timeVal(rng, ms, { allowWeird = true } = {}) {
  const r = rng.next();
  if (!allowWeird || r < 0.8) return new Date(ms);
  if (r < 0.88) return new Date(ms).toISOString();
  if (r < 0.92) return ms;
  if (r < 0.95) return null;
  if (r < 0.97) return undefined;
  return rng.pick(['garbage', '', 'not a date', '2026-13-45T99:00:00Z']);
}
function offsetMs(rng, nowMs) {
  // Mostly inside the 30-day window, some outside, some exactly on edges.
  const r = rng.next();
  const activityStart = Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate()) - 29 * DAY;
  if (r < 0.06) return rng.pick([activityStart, activityStart - 1, activityStart + 1, nowMs - 30 * DAY, nowMs - 30 * DAY - 1, nowMs - 28 * DAY, nowMs - 21 * DAY, nowMs - 14 * DAY, nowMs - 7 * DAY, nowMs, nowMs + 1, nowMs - 24 * HOUR, nowMs - 23 * HOUR - 1]);
  if (r < 0.14) return nowMs - rng.int(31, 60) * DAY - rng.int(0, 86399999);
  if (r < 0.17) return nowMs + rng.int(1, 3) * DAY;
  if (r < 0.40) return nowMs - rng.int(0, 86399999);
  return nowMs - rng.int(0, 29) * DAY - rng.int(0, 86399999);
}

function usageMessage(rng) {
  const p = {};
  if (rng.chance(0.9)) p.harness = rng.chance(0.15) ? canary(rng, 'usageHarness') : rng.pick(HARNESSES.filter(Boolean));
  if (rng.chance(0.8)) p.model = rng.chance(0.3) ? canary(rng, 'model') : rng.pick(['claude-opus-4', 'claude-sonnet-4', 'gpt-5']);
  if (rng.chance(0.7)) p.lane = rng.pick(LANES);
  for (const f of ['inputTokens', 'outputTokens', 'cacheCreationInputTokens', 'cacheCreation1hInputTokens', 'cacheReadInputTokens']) if (rng.chance(0.7)) p[f] = rng.int(0, 2_000_000);
  if (rng.chance(0.6)) p.costUsd = rng.chance(0.9) ? Math.round(rng.next() * 5000) / 100 : 'n/a';
  if (rng.chance(0.2)) p.effort = rng.pick(['low', 'high']);
  return rng.chance(0.05) ? '[usage] {broken json' : `[usage] ${JSON.stringify(p)}`;
}

function feedbackFor(rng, t0) {
  const fb = [];
  const n = rng.weighted([[0, 3], [1, 2], [2, 3], [4, 3], [8, 1]]);
  let t = t0;
  for (let i = 0; i < n; i++) {
    t += rng.int(1, 120) * 60000;
    const ts = rng.chance(0.85) ? new Date(t).toISOString() : timeVal(rng, t);
    const k = rng.weighted([['hb', 4], ['usage', 2], ['evidence', 1.2], ['ticket', 1], ['terminal', 2], ['assistant', 1]]);
    if (k === 'hb') fb.push({ message: `[heartbeat] ${canary(rng, 'feedbackText')} working`, timestamp: ts });
    else if (k === 'usage') fb.push({ kind: 'usage', message: usageMessage(rng), timestamp: ts });
    else if (k === 'evidence') { const url = rng.chance(0.6) ? `https://github.com/acme/app/pull/${rng.int(1, 999)}` : `https://example.com/${canary(rng, 'evidenceUrl')}`; fb.push({ kind: 'evidence', message: `[evidence] ${url}`, url, timestamp: ts }); }
    else if (k === 'ticket') fb.push({ message: `[ticket] LIN-${rng.int(1, 9999)} ${rng.pick(['started', 'done', 'blocked', 'refused', 'dissolved', 'trimmed', 'bogus'])}${rng.chance(0.5) ? ` — ${canary(rng, 'ticketOutcome')}` : ''}`, timestamp: ts });
    else if (k === 'terminal') fb.push({ message: `${rng.pick(['[done]', '[done]', '[complete]', '[failed]', '[aborted]', '[skipped]', '[ended·unconfirmed]', ' [DONE]'])} ${canary(rng, 'terminalText')}`, timestamp: ts });
    else fb.push({ kind: 'assistant-text', message: canary(rng, 'assistantText'), timestamp: ts });
  }
  return fb;
}

function digestFor(rng, row) {
  const r = rng.next();
  const fb = row.feedback || [];
  const terminal = [...fb].reverse().find(e => /^\s*\[(done|complete|failed|aborted|skipped)\]/i.test(e.message || ''));
  const usage = [...fb].reverse().find(e => e.kind === 'usage');
  const fresh = () => ({
    version: row.feedbackVersion ?? 0, count: fb.length,
    kpiTerminalEntry: terminal ? { message: terminal.message, timestamp: terminal.timestamp } : undefined,
    kpiUsageEntry: usage ? { message: usage.message, timestamp: usage.timestamp, kind: 'usage' } : undefined,
    kpiEvidenceCount: fb.filter(e => e.kind === 'evidence').length,
    kpiTicketMarkerEntries: fb.filter(e => /^\s*\[ticket\]/i.test(e.message || '')).map(e => ({ message: e.message, timestamp: e.timestamp })),
  });
  if (r < 0.45) { row.feedbackVersion = rng.int(1, 9); row.feedbackDigest = fresh(); for (const k of Object.keys(row.feedbackDigest)) if (row.feedbackDigest[k] === undefined) delete row.feedbackDigest[k]; }
  else if (r < 0.55) { row.feedbackVersion = rng.int(2, 9); row.feedbackDigest = { ...fresh(), version: row.feedbackVersion - 1, count: 999 }; } // stale
  else if (r < 0.60) { row.feedbackDigest = { count: 77, kpiEvidenceCount: 5 }; } // no version
  else if (r < 0.63) { row.feedbackVersion = null; row.feedbackDigest = { version: 0, count: 3, kpiEvidenceCount: 1 }; } // null fv vs 0
  else if (r < 0.65) { row.feedbackDigest = 'not-an-object'; }
  else if (r < 0.68) { row.feedbackVersion = 3; row.feedbackDigest = { version: 3, count: 12, kpiTerminalEntry: { message: '[failed] digest says failed' }, kpiEvidenceCount: 2 }; } // fresh but disagrees with feedback
  // else legacy: no digest
}

function genDispatchRows(rng, nowMs, ws, isQueue) {
  const rows = [];
  const n = rng.weighted([[0, 2], [2, 3], [6, 4], [14, 3], [30, 1]]);
  for (let i = 0; i < n; i++) {
    const id = rng.chance(0.9) ? `${rng.hex(24)}` : rng.int(1, 99999);
    const t = offsetMs(rng, nowMs);
    const parent = rows.length && rng.chance(0.35) ? rng.pick(rows) : null;
    const row = {
      _id: id,
      urlKey: rng.chance(0.95) ? rng.pick(ws) : rng.pick([null, '', 42]),
      kind: rng.chance(0.08) ? rng.pick([canary(rng, 'kind'), '  ', '', null, ` ${rng.pick(KINDS)} `]) : rng.pick(KINDS),
      dispatchedAt: timeVal(rng, t),
      status: isQueue ? rng.pick(['queued', 'pending', 'taken']) : rng.pick(['taken', 'taken', 'taken', 'expired', 'cancelled', 'archived']),
      prompt: `${canary(rng, 'prompt')} please build it`,
      issueIdentifier: rng.chance(0.85) ? canary(rng, 'issueIdentifier') : null,
      issueTitle: canary(rng, 'issueTitle'),
      dispatchedBy: rng.chance(0.8) ? canary(rng, 'accountId') : null,
      sessionId: rng.chance(0.4) ? canary(rng, 'sessionId') : undefined,
      bootstrapToken: canary(rng, 'bootstrapToken'),
    };
    if (row.sessionId === undefined) delete row.sessionId;
    if (rng.chance(0.85)) row.rootItemId = parent && rng.chance(0.8) ? (parent.rootItemId ?? String(parent._id)) : String(id);
    if (parent && rng.chance(0.7)) row.followUpTo = String(parent._id);
    if (!isQueue) {
      if (row.status === 'taken' && rng.chance(0.9)) row.resolvedAt = timeVal(rng, t + rng.int(-5, 600) * 60000);
      else if (rng.chance(0.4)) row.resolvedAt = timeVal(rng, t + rng.int(0, 600) * 60000);
      if (rng.chance(0.9)) row.feedback = feedbackFor(rng, t);
      else if (rng.chance(0.5)) row.feedback = rng.chance(0.9) ? null : rng.pick(['not-an-array', { message: '[done] single object' }]);
      if (rng.chance(0.7)) row.harness = rng.chance(0.1) ? canary(rng, 'harness') : rng.pick(HARNESSES);
      if (Array.isArray(row.feedback) && rng.chance(0.9)) digestFor(rng, row);
      if (rng.chance(0.08) && rows.length) {
        const target = rng.pick(rows);
        row.abort = true; row.abortTo = String(target._id);
        row.feedback = [{ message: rng.pick(['[aborted] by operator', '[skipped] human present', '[aborted]']), timestamp: new Date(t + 3600000).toISOString() }];
        delete row.feedbackDigest;
      }
    } else if (rng.chance(0.1)) row.feedback = feedbackFor(rng, t);
    if (rng.chance(0.15)) row.summary = canary(rng, 'summary');
    rows.push(row);
  }
  return rows;
}

function flavourFor(rng, name) {
  const f = rng.weighted([['mango', 5], ['mango-noagg', 2], ['mock', 2.5], ['mock-naive', 0.5]]);
  // Real proxy-events docs hold Date timestamps; the aggregate path rejects a string one (as real Mongo does).
  return f;
}

export function buildWorld(rng, nowMs, { failRate = 0.004 } = {}) {
  const ws = Array.from({ length: rng.int(1, 5) }, () => canary(rng, 'urlKey'));
  const C = {};
  const addFail = (c, methods) => { if (rng.chance(failRate)) c.fail = { [rng.pick(methods)]: rng.pick(['reject', 'throw', 'rejectBare']) }; return c; };
  const t = () => offsetMs(rng, nowMs);
  C.sessions = { docs: Array.from({ length: rng.int(0, 6) }, () => ({ _id: canary(rng, 'sessionKey'), expires: timeVal(rng, rng.chance(0.5) ? nowMs + rng.int(-2, 30) * DAY : rng.pick([nowMs, nowMs + 1, nowMs - 1])), session: { email: `${canary(rng, 'email')}@example.com`, token: canary(rng, 'oauthToken'), workspaces: [{ urlKey: rng.pick(ws) }] } })) };
  C.userPreferences = { docs: Array.from({ length: rng.int(0, 5) }, () => ({ _id: `${canary(rng, 'email')}@example.com`, theme: rng.pick(['dark', 'light']) })) };
  C.workspacePreferences = { docs: Array.from({ length: rng.int(0, 4) }, () => ({ _id: rng.chance(0.9) ? rng.pick(ws) : canary(rng, 'urlKey'), defaultPrompt: canary(rng, 'prefText') })) };
  C.customPrompts = { docs: Array.from({ length: rng.int(0, 4) }, () => ({ _id: rng.hex(24), urlKey: rng.pick([...ws, null]), name: canary(rng, 'promptName'), text: canary(rng, 'promptText') })) };
  C.localIssues = { docs: Array.from({ length: rng.int(0, 6) }, () => ({ _id: canary(rng, 'localId'), kind: rng.pick(['issue', 'issue', 'project', 'comment', canary(rng, 'kind')]), urlKey: rng.pick(ws), title: canary(rng, 'title'), description: canary(rng, 'description') })) };
  C.dispatchQueue = { docs: genDispatchRows(rng, nowMs, ws, true) };
  C.dispatchHistory = { docs: genDispatchRows(rng, nowMs, ws, false) };
  // Agent-status docs: some joined to dispatch ids.
  const ids = [...C.dispatchQueue.docs, ...C.dispatchHistory.docs].map(d => d._id);
  C.agentStatus = { docs: Array.from({ length: rng.int(0, 10) }, () => ({ dispatchId: ids.length && rng.chance(0.75) ? (rng.chance(0.85) ? String(rng.pick(ids)) : rng.pick(ids)) : rng.pick([null, undefined, canary(rng, 'dispatchId')]), status: rng.chance(0.06) ? canary(rng, 'agentStatus') : rng.pick(AGENT_STATUSES), timestamp: timeVal(rng, t()), urlKey: rng.pick(ws), summary: canary(rng, 'agentSummary'), metrics: { note: canary(rng, 'metrics') } })) };
  C.dispatchTokens = { docs: Array.from({ length: rng.int(0, 3) }, () => ({ _id: canary(rng, 'dispatchToken'), urlKey: rng.pick(ws) })) };
  C.proxyTokens = { docs: Array.from({ length: rng.int(0, 3) }, () => ({ _id: canary(rng, 'proxyToken'), urlKey: rng.pick(ws), label: canary(rng, 'tokenLabel') })) };
  C.proxyEvents = { docs: [] };
  const nEv = rng.weighted([[0, 2], [5, 3], [20, 4], [60, 2]]);
  const epPool = rng.chance(0.3) ? [...ENDPOINTS, ...Array.from({ length: 6 }, (_, i) => `/api/proxy/extra-${i}`)] : ENDPOINTS;
  for (let i = 0; i < nEv; i++) {
    const ms = rng.chance(0.4) ? nowMs - rng.int(0, 26 * HOUR) : t();
    C.proxyEvents.docs.push({
      method: rng.chance(0.05) ? rng.pick([undefined, null, 7]) : rng.pick(METHODS),
      endpoint: rng.chance(0.04) ? rng.pick([undefined, null, 12, canary(rng, 'endpoint')]) : rng.pick(epPool),
      status: rng.chance(0.9) ? rng.pick([200, 200, 201, 204, 302, 304, 400, 401, 404, 429, 500, 502, 503]) : rng.pick(['200', '404', 99, 100, 'abc', null, undefined]),
      timestamp: rng.chance(0.97) ? new Date(ms) : (rng.chance(0.85) ? rng.pick([null, undefined]) : timeVal(rng, ms)),
      urlKey: rng.chance(0.9) ? rng.pick(ws) : rng.pick([null, '']),
      ip: canary(rng, 'ip'), body: { secret: canary(rng, 'requestBody') },
    });
  }
  C.freeTier = { docs: Array.from({ length: rng.int(0, 6) }, () => rng.chance(0.75)
    ? { urlKey: rng.chance(0.9) ? rng.pick(ws) : rng.pick([null, '']), date: rng.chance(0.9) ? new Date(nowMs - rng.int(-1, 9) * DAY).toISOString().slice(0, 10) : rng.pick(['2026-1-1', 'yesterday', 20261001, null]), count: rng.chance(0.85) ? rng.int(0, 12) : rng.pick([undefined, null, 0]) }
    : { urlKey: null, hour: new Date(nowMs - rng.int(0, 48) * HOUR).toISOString().slice(0, 13), count: rng.int(0, 9) }) };
  C.recapCache = { docs: Array.from({ length: rng.int(0, 3) }, () => ({ _id: `${rng.pick(ws)}:${canary(rng, 'issueId')}`, recap: canary(rng, 'recapText') })) };
  C.briefCache = { docs: Array.from({ length: rng.int(0, 3) }, () => ({ _id: `${rng.pick(ws)}:${canary(rng, 'issueId')}`, brief: canary(rng, 'briefText') })) };
  C.reportHistory = { docs: Array.from({ length: rng.int(0, 4) }, () => ({ _id: rng.hex(24), urlKey: rng.chance(0.9) ? rng.pick(ws) : null, report: canary(rng, 'reportText'), createdAt: timeVal(rng, t()) })) };
  for (const n of COLLECTIONS) {
    C[n].flavour = flavourFor(rng, n);
    addFail(C[n], C[n].flavour === 'mango' ? ['find', 'countDocuments', 'aggregate', 'toArray'] : ['find', 'countDocuments', 'toArray']);
  }
  return { ws, C, ids };
}

function genFunnel(rng, C, nowMs) {
  const r = rng.next();
  if (r < 0.35) return {};
  const f = {};
  if (rng.chance(0.8)) f.dispatchQueue = { docs: rng.chance(0.7) ? C.dispatchQueue.docs : [], flavour: rng.pick(['mango', 'mock']) };
  if (rng.chance(0.8)) f.dispatchHistory = { docs: rng.chance(0.7) ? C.dispatchHistory.docs : [], flavour: rng.pick(['mango', 'mock']) };
  const accts = [...new Set([...C.dispatchQueue.docs, ...C.dispatchHistory.docs].map(d => d.dispatchedBy).filter(Boolean))];
  if (rng.chance(0.6)) {
    const extra = Array.from({ length: rng.int(0, 3) }, () => canary(rng, 'accountId'));
    const all = [...accts, ...extra];
    const canon = {};
    for (const a of all) if (rng.chance(0.2) && all.length > 1) canon[a] = rng.pick(all);
    f.accounts = { docs: all.map(a => ({ _id: a, email: `${canary(rng, 'email')}@x.io`, createdAt: new Date(offsetMs(rng, nowMs)) })), canon, canonFail: rng.chance(0.1) && all.length ? rng.pick(all) : null };
    if (rng.chance(0.05)) f.accounts.fail = { toArray: 'reject' };
  }
  if (rng.chance(0.5)) f.edges = { docs: Array.from({ length: rng.int(0, 4) }, () => ({ accountId: accts.length ? rng.pick(accts) : canary(rng, 'accountId'), urlKey: canary(rng, 'urlKey'), createdAt: new Date(offsetMs(rng, nowMs)) })) };
  if (rng.chance(0.5)) f.funnelEvents = { rows: accts.slice(0, rng.int(0, 3)).map(a => ({ accountId: a })), mode: rng.chance(0.15) ? 'reject' : 'promise' };
  if (rng.chance(0.5)) f.taskMode = { result: { total: rng.int(0, 9), byRung: [{ rung: 'plan', entries: rng.int(0, 5), notReady: rng.int(0, 2) }], coverage: { surfaces: ['go'] } }, mode: rng.chance(0.05) ? 'reject' : 'promise' };
  if (rng.chance(0.15)) f.instrumentedSteps = rng.pick([[], ['merge-clicked'], ['login', 'merge-clicked']]);
  return f;
}

function pickNow(rng) {
  const r = rng.next();
  if (r < 0.45) return { arg: undefined, ms: Date.parse(NOW_ISO) };
  if (r < 0.75) return { arg: new Date(NOW_ISO), ms: Date.parse(NOW_ISO) };
  const iso = rng.pick(['2026-10-01T00:00:00.000Z', '2026-09-30T23:59:59.999Z', '2026-06-10T12:00:00.000Z', '2026-10-08T06:00:00.000Z', '2026-10-09T05:59:59.999Z', '2026-03-01T00:30:00.000Z', '2026-12-31T23:00:00.000Z']);
  return { arg: new Date(iso), ms: Date.parse(iso) };
}

export function generate(seed, index) {
  const rng = new Rng(seed, 'gen', index);
  const id = `gen:${index}`;
  const fam = rng.weighted([['collect', 80], ['loadHistory', 8], ['categorize', 7], ['sequence', 5]]);
  if (fam === 'categorize') {
    const steps = Array.from({ length: rng.int(1, 4) }, () => ({ fn: 'categorizeProxyEvent', args: [rng.chance(0.9) ? rng.pick([...METHODS, 'Get', 'OPTIONS', '']) : rng.pick([undefined, null, 3, {}]), rng.chance(0.9) ? rng.pick([...ENDPOINTS, '/api/proxy/foreman/statusx', '/api/proxy/recommendations', 'api/proxy/dispatch', '/API/PROXY/DISPATCH']) : rng.pick([undefined, null, 5, ['x']])] }));
    return { id, tier: 'gen', family: fam, world: null, steps };
  }
  const now = pickNow(rng);
  const { C } = buildWorld(rng, now.ms);
  if (fam === 'loadHistory') {
    const since = rng.pick([undefined, new Date(now.ms - 30 * DAY), new Date(now.ms - 2 * DAY), null]);
    const world = { collections: { dispatchHistory: C.dispatchHistory } };
    return { id, tier: 'gen', family: fam, world, steps: [{ fn: 'loadDispatchHistory', args: since === undefined && rng.chance(0.5) ? [{ $dep: 'dispatchHistory' }] : [{ $dep: 'dispatchHistory' }, { since }] }] };
  }
  const world = { collections: C, funnel: genFunnel(rng, C, now.ms) };
  const opts = { now: now.arg, dbBackend: rng.weighted([[undefined, 3], ['mongodb', 2], ['mangodb', 2], [null, 1]]), funnel: rng.chance(0.02) ? 'absent' : 'present' };
  const steps = [{ fn: 'collectKpiStats', args: collectArgs(world, opts) }];
  if (fam === 'sequence') steps.push({ fn: 'collectKpiStats', args: collectArgs(world, { ...opts, now: rng.chance(0.5) ? opts.now : new Date(now.ms + rng.int(1, 48) * HOUR) }) });
  return { id, tier: 'gen', family: fam, world, steps };
}

// ------------------------------------------------------------ edge cases
const EMPTY = () => Object.fromEntries(COLLECTIONS.map(n => [n, { docs: [], flavour: 'mock' }]));
const NOWMS = Date.parse(NOW_ISO);
const at = (ms) => new Date(ms);
const activityStart = Date.parse('2026-09-02T00:00:00.000Z'); // midnight of activityDays[0] for NOW_ISO

export function edgeCases() {
  const E = [];
  const add = (family, world, steps, extra = {}) => E.push({ id: `edge:${E.length}`, tier: 'edge', family, world, steps, ...extra });
  const collect = (C, opts = {}, funnel = {}) => { const w = { collections: C, funnel }; return [w, [{ fn: 'collectKpiStats', args: collectArgs(w, { now: new Date(NOW_ISO), ...opts }) }]]; };
  const withC = (over, flavour = 'mock') => { const C = EMPTY(); for (const [k, v] of Object.entries(over)) C[k] = { docs: v, flavour }; return C; };
  const both = (family, over, opts = {}, funnel = {}) => { for (const fl of ['mock', 'mango', 'mango-noagg']) add(`${family}:${fl}`, ...collect(withC(over, fl), opts, funnel)); };

  add('empty', ...collect(EMPTY()));
  add('empty-default-now', ...collect(EMPTY(), { now: undefined }));
  add('empty-dbBackend', ...collect(EMPTY(), { dbBackend: 'mangodb' }));
  add('no-funnel-deps', ...collect(EMPTY(), { funnel: 'absent' }));
  add('no-options', ...collect(EMPTY(), { noOptions: true }));
  { const C = EMPTY(); delete C.sessions; add('missing-collection', ...collect(C)); }
  { const C = EMPTY(); C.briefCache = null; add('null-collection', ...collect(C)); }
  for (const [name, m] of [['proxyEvents', 'aggregate'], ['dispatchHistory', 'aggregate'], ['sessions', 'find'], ['userPreferences', 'countDocuments'], ['agentStatus', 'toArray'], ['proxyEvents', 'toArray'], ['dispatchHistory', 'toArray']]) {
    for (const mode of ['reject', 'throw', 'rejectBare']) { const C = EMPTY(); for (const n of COLLECTIONS) C[n].flavour = 'mango'; C[name].fail = { [m]: mode }; add(`fail:${name}.${m}:${mode}`, ...collect(C)); }
  }
  // Window boundaries (activity window anchored to midnight of activityDays[0]).
  const disp = (ms, extra = {}) => ({ _id: `d${ms}`, urlKey: 'cnry-urlkey-aaaa01', kind: 'implementation', dispatchedAt: at(ms), status: 'taken', ...extra });
  both('activity-window-edges', { dispatchHistory: [disp(activityStart), disp(activityStart - 1), disp(NOWMS - 30 * DAY), disp(NOWMS), disp(NOWMS + 1)], dispatchQueue: [disp(activityStart + 5, { status: 'queued' })] });
  both('agent-status-window', { agentStatus: [{ dispatchId: 'x', status: 'completed', timestamp: at(activityStart) }, { dispatchId: 'x', status: 'failed', timestamp: at(activityStart - 1) }, { status: 'constructor', timestamp: at(NOWMS) }, { status: 'other', timestamp: at(NOWMS) }, { status: 'OTHER', timestamp: at(NOWMS) }, { status: '__proto__', timestamp: at(NOWMS) }, { status: 7, timestamp: at(NOWMS) }] });
  // Outcome lineages: windows and weekly buckets.
  const term = (m, ms) => [{ message: m, timestamp: new Date(ms + 60000).toISOString() }];
  both('outcome-weeks', { dispatchHistory: [
    disp(NOWMS - 28 * DAY, { rootItemId: 'r1', feedback: term('[done] a', NOWMS - 28 * DAY) }),
    disp(NOWMS - 28 * DAY - 1, { rootItemId: 'r2', feedback: term('[failed] b', NOWMS - 28 * DAY) }),
    disp(NOWMS - 21 * DAY, { rootItemId: 'r3', feedback: term('[aborted] c', NOWMS - 21 * DAY) }),
    disp(NOWMS - 7 * DAY, { rootItemId: 'r4', feedback: term('[skipped] d', NOWMS - 7 * DAY) }),
    disp(NOWMS - 30 * DAY, { rootItemId: 'r5', feedback: term('[done] e', NOWMS - 30 * DAY) }),
    disp(NOWMS - 30 * DAY - 1, { rootItemId: 'r6', feedback: term('[done] f', NOWMS - 30 * DAY) }),
    disp(NOWMS - 2 * DAY, { rootItemId: 'r7' }),
    disp(NOWMS - 1 * DAY, { rootItemId: 'r7', followUpTo: `d${NOWMS - 2 * DAY}`, feedback: term('[done] g', NOWMS - DAY) }),
    disp(NOWMS - 3 * DAY, { _id: 'abort1', abort: true, abortTo: `d${NOWMS - 2 * DAY}`, feedback: term('[aborted] h', NOWMS - 3 * DAY) }),
  ] });
  // Proxy bins: status classes, methods, endpoints, hours.
  const ev = (ms, method, endpoint, status, urlKey = 'cnry-urlkey-bbbb02') => ({ method, endpoint, status, timestamp: at(ms), urlKey });
  both('proxy-bins', { proxyEvents: [
    ev(NOWMS, 'GET', '/api/proxy/stack', 200), ev(NOWMS - 23 * HOUR, 'get', '/api/proxy/stack', '200'), ev(NOWMS - 24 * HOUR, 'POST', '/api/proxy/dispatch', 99),
    ev(NOWMS - 25 * HOUR, 'POST', '/api/proxy/dispatch', 100), ev(NOWMS, 'PATCH', '/api/proxy/issues/:id', 399), ev(NOWMS, 'PATCH', '/api/proxy/issues/:id', 400),
    ev(NOWMS, 'DELETE', '  ', 499), ev(NOWMS, undefined, undefined, 500), ev(activityStart, 'GET', '/api/proxy/agent/status', 'abc'), ev(activityStart - 1, 'POST', '/api/proxy/agent/status', 201),
    ev(NOWMS - 40 * DAY, 'GET', '/api/proxy/old', 200), ev(NOWMS, 'POST', '/api/proxy/foreman/status', 503, null), ev(NOWMS, 'GET', '/api/proxy/foreman/tasks', 204, ''),
  ] });
  // Top lists: ties, > 8, > 5 day kinds, blank kinds.
  const many = []; const kinds = ['b', 'a', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  kinds.forEach((k, i) => { for (let j = 0; j <= (i % 3); j++) many.push(disp(NOWMS - (i + j) * HOUR, { _id: `k${i}-${j}`, kind: `kind-${k}` })); });
  many.push(disp(NOWMS, { _id: 'blank', kind: '   ' }), disp(NOWMS, { _id: 'nk', kind: null }), disp(NOWMS, { _id: 'num', kind: 5 }), disp(NOWMS, { _id: 'trim', kind: ' kind-a ' }));
  both('top-kinds', { dispatchHistory: many });
  const evs = []; for (let i = 0; i < 11; i++) for (let j = 0; j <= i % 2; j++) evs.push(ev(NOWMS - (i * 3 + j) * HOUR, 'GET', `/api/proxy/e${String.fromCharCode(107 - i)}`, 200));
  both('top-endpoints', { proxyEvents: evs });
  // Busiest-day ties, median even/odd, negative waits, readsPerWrite.
  both('busiest-median', { dispatchHistory: [
    disp(NOWMS - 2 * DAY, { resolvedAt: at(NOWMS - 2 * DAY + 600000) }), disp(NOWMS - 3 * DAY, { _id: 'm2', resolvedAt: at(NOWMS - 3 * DAY + 60000) }),
    disp(NOWMS - 4 * DAY, { _id: 'm3', resolvedAt: at(NOWMS - 4 * DAY - 60000) }), disp(NOWMS - 5 * DAY, { _id: 'm4', resolvedAt: null }), disp(NOWMS - 6 * DAY, { _id: 'm5', status: 'expired', resolvedAt: at(NOWMS) }),
    disp(NOWMS - 7 * DAY, { _id: 'm6', resolvedAt: at(NOWMS - 7 * DAY + 90000) }),
  ], agentStatus: [{ dispatchId: `d${NOWMS - 2 * DAY}`, status: 'completed', timestamp: at(NOWMS - 3 * DAY) }, { dispatchId: `d${NOWMS - 2 * DAY}`, status: 'COMPLETED', timestamp: at(NOWMS - 40 * DAY) }, { dispatchId: 'm2', status: 'failed', timestamp: at(NOWMS - 3 * DAY) }],
  proxyEvents: [ev(NOWMS - 3 * DAY, 'GET', '/api/proxy/stack', 200), ev(NOWMS - 3 * DAY, 'GET', '/api/proxy/stack', 200)] });
  both('reads-only', { proxyEvents: [ev(NOWMS, 'GET', '/api/proxy/stack', 200)] });
  both('writes-ratio', { proxyEvents: [ev(NOWMS, 'GET', '/a', 200), ev(NOWMS, 'GET', '/a', 200), ev(NOWMS, 'POST', '/b', 200), ev(NOWMS, 'PUT', '/b', 200), ev(NOWMS, 'GET', '/a', 200), ev(NOWMS, 'GET', '/a', 200), ev(NOWMS, 'GET', '/a', 200)] });
  // Free tier, sessions, workspace union, counts.
  both('free-tier', { freeTier: [{ urlKey: 'w', date: '2026-10-01', count: 3 }, { urlKey: 'w', date: '2026-09-25', count: 2 }, { urlKey: 'w', date: '2026-09-24', count: 9 }, { urlKey: null, date: '2026-10-01', count: 5 }, { urlKey: 'w', date: '2026-10-1', count: 5 }, { urlKey: 'w', date: '2026-09-30' }, { urlKey: 'w', date: 20261001, count: 1 }, { urlKey: null, hour: '2026-10-01T11', count: 4 }] });
  both('sessions-expiry', { sessions: [{ _id: 's1', expires: at(NOWMS) }, { _id: 's2', expires: at(NOWMS + 1) }, { _id: 's3', expires: 'garbage' }, { _id: 's4' }, { _id: 's5', expires: new Date(NOWMS + DAY).toISOString() }, { _id: 's6', expires: NOWMS + 5 }] });
  both('workspace-union', { workspacePreferences: [{ _id: 'cnry-urlkey-0001aa' }, { _id: '' }, { _id: 5 }], customPrompts: [{ urlKey: 'cnry-urlkey-0002aa' }, { urlKey: 'cnry-urlkey-0001aa' }], reportHistory: [{ urlKey: 'cnry-urlkey-0003aa' }, { urlKey: null }], freeTier: [{ urlKey: 'cnry-urlkey-0004aa', date: 'x' }], agentStatus: [{ urlKey: 'cnry-urlkey-0005aa', timestamp: at(NOWMS - 40 * DAY) }], localIssues: [{ kind: 'issue' }, { kind: 'issue' }, { kind: 'project' }, { kind: 'Issue' }], recapCache: [{}, {}], briefCache: [{}], dispatchTokens: [{}], proxyTokens: [{}, {}], userPreferences: [{}, {}, {}] });
  // Digest variants on the aggregate path (and the same rows on the find paths).
  const fb = [{ message: 'hb', timestamp: 't' }, { kind: 'usage', message: '[usage] {"harness":"opencode","lane":"api","inputTokens":10,"costUsd":1.5}', timestamp: 'u' }, { kind: 'evidence', message: '[evidence] https://github.com/a/b/pull/1', url: 'https://github.com/a/b/pull/1' }, { message: '[ticket] LIN-42 done — shipped' }, { message: '[done] ok', timestamp: new Date(NOWMS - DAY).toISOString() }];
  const dg = (i, extra) => disp(NOWMS - (i + 1) * DAY, { _id: `dg${i}`, rootItemId: `dg${i}`, feedback: fb, ...extra });
  both('digest-variants', { dispatchHistory: [
    dg(0, {}), dg(1, { feedbackVersion: 2, feedbackDigest: { version: 2, count: 9, kpiTerminalEntry: { message: '[failed] x' }, kpiEvidenceCount: 4, kpiTicketMarkerEntries: [] } }),
    dg(2, { feedbackVersion: 3, feedbackDigest: { version: 2, count: 9 } }), dg(3, { feedbackDigest: { count: 9 } }), dg(4, { feedbackVersion: null, feedbackDigest: { version: 0, count: 9 } }),
    dg(5, { feedbackDigest: { version: 0, count: 9 } }), dg(6, { feedbackDigest: 'str' }), dg(7, { feedback: [] }), dg(8, { feedback: undefined, feedbackCount: 3 }),
  ] });
  // loadDispatchHistory direct (with/without since, agg/find).
  for (const fl of ['mango', 'mango-noagg', 'mock']) {
    const docs = [dg(0, {}), dg(1, { feedbackVersion: 1, feedbackDigest: { version: 1, count: 2 } }), disp(NOWMS - 40 * DAY, { _id: 'old' })];
    add(`loadHistory:${fl}`, { collections: { dispatchHistory: { docs, flavour: fl } } }, [{ fn: 'loadDispatchHistory', args: [{ $dep: 'dispatchHistory' }] }]);
    add(`loadHistory-since:${fl}`, { collections: { dispatchHistory: { docs, flavour: fl } } }, [{ fn: 'loadDispatchHistory', args: [{ $dep: 'dispatchHistory' }, { since: new Date(NOWMS - 30 * DAY) }] }]);
    add(`loadHistory-fail:${fl}`, { collections: { dispatchHistory: { docs, flavour: fl, fail: { toArray: 'reject' } } } }, [{ fn: 'loadDispatchHistory', args: [{ $dep: 'dispatchHistory' }, {}] }]);
  }
  add('loadHistory-noopts-undefined', { collections: { dispatchHistory: { docs: [], flavour: 'mango' } } }, [{ fn: 'loadDispatchHistory', args: [{ $dep: 'dispatchHistory' }, undefined] }]);
  add('loadHistory-null', null, [{ fn: 'loadDispatchHistory', args: [null] }]);
  // categorizeProxyEvent table.
  const cat = [['GET', '/api/proxy/agent/status'], ['POST', '/api/proxy/agent/status'], ['post', '/api/proxy/foreman/status/x'], ['GET', '/api/proxy/foreman/sessions'], ['POST', '/api/proxy/foreman/tasks'],
    ['GET', '/api/proxy/dispatch'], ['POST', '/api/proxy/dispatchy'], ['GET', '/api/proxy/recommend'], ['GET', '/api/proxy/prompt'], ['DELETE', '/api/proxy/autopilot'], ['GET', '/api/proxy/foreman/playbook'],
    ['GET', '/x'], ['POST', '/x'], [undefined, undefined], [null, '/api/proxy/dispatch'], [5, 7], ['get', '/api/proxy/agent/status'], ['', '/api/proxy/dispatch'], ['GET', ' /api/proxy/dispatch']];
  add('categorize-table', null, cat.map(a => ({ fn: 'categorizeProxyEvent', args: a })));
  add('categorize-noargs', null, [{ fn: 'categorizeProxyEvent', args: [] }]);
  // Milestone funnel deps: pass-through, rejection propagation, merge-click swallow.
  const D = [disp(NOWMS - DAY, { _id: 'f1', dispatchedBy: 'cnry-accountid-f00001', feedback: [{ kind: 'evidence', url: 'https://github.com/a/b/pull/9' }] })];
  add('funnel-full', ...collect(withC({ dispatchHistory: D }, 'mango'), {}, { dispatchQueue: { docs: [], flavour: 'mango' }, dispatchHistory: { docs: D, flavour: 'mango' }, accounts: { docs: [{ _id: 'cnry-accountid-f00001', createdAt: at(NOWMS - DAY) }], canon: {} }, edges: { docs: [{ accountId: 'cnry-accountid-f00001', createdAt: at(NOWMS) }] }, funnelEvents: { rows: [{ accountId: 'cnry-accountid-f00001' }] }, taskMode: { result: { total: 1, byRung: [], coverage: { surfaces: [] } } } }));
  add('funnel-dep-rejects', ...collect(EMPTY(), {}, { taskMode: { result: null, mode: 'reject' } }));
  add('funnel-merge-click-rejects', ...collect(EMPTY(), {}, { funnelEvents: { rows: [], mode: 'reject' } }));
  add('funnel-uninstrumented', ...collect(EMPTY(), {}, { funnelEvents: { rows: [{ accountId: 'a' }] }, instrumentedSteps: [] }));
  // Sequence: two calls in one module instance.
  { const C = withC({ dispatchHistory: [disp(NOWMS - DAY)] }, 'mango'); const w = { collections: C, funnel: {} }; add('sequence', w, [{ fn: 'collectKpiStats', args: collectArgs(w, { now: new Date(NOWMS) }) }, { fn: 'collectKpiStats', args: collectArgs(w, { now: new Date(NOWMS + 2 * DAY) }) }]); }
  // now at day boundaries.
  for (const iso of ['2026-10-01T00:00:00.000Z', '2026-09-30T23:59:59.999Z']) {
    const ms = Date.parse(iso);
    add(`now-boundary:${iso}`, ...collect(withC({ dispatchHistory: [disp(ms - 29 * DAY), disp(ms - 30 * DAY + 1), disp(ms - 23 * HOUR)], proxyEvents: [ev(ms - 23 * HOUR, 'GET', '/a', 200), ev(ms - 24 * HOUR + 1, 'GET', '/a', 200)] }, 'mango'), { now: new Date(ms) }));
  }
  // Privacy-shaped inputs: label-looking urlKeys, PR urls, emails in everything.
  both('privacy-shapes', { dispatchHistory: [disp(NOWMS - DAY, { urlKey: 'implementation', kind: 'implementation', issueIdentifier: 'cnry-issueidentifier-abc123', harness: 'cnry-harness-abc123', feedback: [{ kind: 'usage', message: '[usage] {"harness":"cnry-usageharness-abc123","model":"cnry-model-abc123","lane":"api","inputTokens":5,"costUsd":2}' }, { message: '[done] cnry-terminaltext-abc123' }, { message: '[ticket] LIN-77 done — cnry-ticketoutcome-abc123' }] })],
    sessions: [{ _id: 'cnry-sessionkey-abc123', expires: at(NOWMS + DAY), session: { email: 'cnry-email-abc123@x.io' } }] });
  return E;
}

// ------------------------------------------------------- privacy scan
const DATEISH = /^\d{4}-\d{2}-\d{2}(T\d{2}(:\d{2}(:\d{2}(\.\d{3})?)?Z?)?)?$/;
function inputStrings(scenario, args, depStrings) {
  const out = new Map();
  const keep = (p, s) => {
    if (String(p).endsWith('.<key>') || APP_VOCAB.has(s)) return; // schema field names / app vocabulary
    const key = String(p).split('.').pop().replace(/\[\d+\]$/, '');
    if (LABEL_KEYS.has(key) || LABEL_CANARY.test(s)) return;
    if (s.length < 4 || DATEISH.test(s) || /^-?\d+(\.\d+)?$/.test(s)) return;
    if (!out.has(s)) out.set(s, p);
  };
  if (scenario.world) for (const { path, s } of stringsIn(scenario.world)) keep(path, s);
  for (const { path, s } of stringsIn(args)) keep(path, s);
  for (const { path, s } of depStrings || []) keep(path, s);
  return out;
}

/** Strings that some input carries in a LABEL field (an equal non-label string is a coincidence, not an echo). */
function labelStrings(scenario, args, depStrings) {
  const out = new Set();
  const take = (p, s) => { if (LABEL_KEYS.has(String(p).split('.').pop().replace(/\[\d+\]$/, ''))) out.add(s.trim()); };
  if (scenario.world) for (const { path, s } of stringsIn(scenario.world)) take(path, s);
  for (const { path, s } of stringsIn(args)) take(path, s);
  for (const { path, s } of depStrings || []) take(path, s);
  return out;
}

/** Privacy scan of one collectKpiStats result (both tiers). */
export function inspect({ scenario, step, obs, result, args }) {
  if (!String(step.fn).startsWith('collectKpiStats') || (obs.mode !== 'return' && obs.mode !== 'resolve')) return null;
  const findings = [];
  const outs = stringsIn(result);
  for (const { path, s } of outs) {
    for (const m of s.match(CANARY_RE) || []) {
      if (LABEL_CANARY.test(m)) continue;
      const field = m.split('-')[1];
      findings.push({ kind: 'privacy-leak', sig: `privacy-leak canary:${field} at ${sigPath(path)}`, sample: s.slice(0, 120) });
    }
  }
  const ins = inputStrings(scenario, args, obs.depStrings);
  const labels = labelStrings(scenario, args, obs.depStrings);
  for (const { path, s } of outs) {
    if (path.endsWith('.<key>')) continue; // object keys are app vocabulary; canaries in keys are caught above
    if (ins.has(s) && !labels.has(s) && !CANARY_ONE.test(s)) findings.push({ kind: 'privacy-leak', sig: `privacy-leak echo:${String(ins.get(s)).replace(/\[\d+\]/g, '[]').slice(0, 60)} at ${sigPath(path)}`, sample: s.slice(0, 120) });
  }
  const seen = new Set();
  return findings.filter(f => (seen.has(f.sig) ? false : seen.add(f.sig))).slice(0, 20);
}
