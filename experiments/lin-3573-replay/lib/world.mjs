// The fake world one variant (old or new) runs in: the REAL routes/proxy.js composer
// (loaded once per variant through the resolve hook) over recording fakes whose
// behaviour is scripted per request by the generator. Both variants get the same
// script for the same request, so any difference in what they do is the routers'.
import express from 'express';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sanitize } from './util.mjs';

export const WS = 'acme-ws';
export const WS2 = 'beta-ws';
export const U = {
  team: '11111111-1111-4111-8111-111111111111',
  state: { done: '22222222-0000-4000-8000-000000000001', prog: '22222222-0000-4000-8000-000000000002', todo: '22222222-0000-4000-8000-000000000003', canceled: '22222222-0000-4000-8000-000000000004' },
  label: { bug: '33333333-0000-4000-8000-000000000001', feature: '33333333-0000-4000-8000-000000000002', dupeA: '33333333-0000-4000-8000-000000000003', dupeB: '33333333-0000-4000-8000-000000000004', other: '33333333-0000-4000-8000-000000000009' },
  project: { alpha: '44444444-0000-4000-8000-000000000001' },
  user: '55555555-0000-4000-8000-000000000001',
  issue: '66666666-0000-4000-8000-000000000001',
  issue2: '66666666-0000-4000-8000-000000000002',
  comment: '77777777-0000-4000-8000-000000000001',
  relation: '88888888-0000-4000-8000-000000000001',
};

const TOKENS = {
  'tok-rw': { tokenId: 't-rw', urlKey: WS, label: 'rw-label', scope: 'readWrite', createdBy: 'acct-1', grants: [], workspaceId: 'w1' },
  'tok-rw2': { tokenId: 't-rw2', urlKey: WS, label: 'rw2-label', scope: 'readWrite', createdBy: 'acct-2', grants: [], workspaceId: 'w1' },
  'tok-rw-orphan': { tokenId: 't-rwo', urlKey: WS, label: 'orphan-label', scope: 'readWrite', createdBy: null, grants: [], workspaceId: 'w1' },
  'tok-rw-bare': { tokenId: 't-rwb', urlKey: WS, label: null, scope: 'readWrite', createdBy: null, grants: [], workspaceId: null },
  'tok-read': { tokenId: 't-ro', urlKey: WS, label: 'ro-label', scope: 'read', createdBy: 'acct-1', grants: [], workspaceId: 'w1' },
  'tok-ws2': { tokenId: 't-ws2', urlKey: WS2, label: 'ws2-label', scope: 'readWrite', createdBy: 'acct-3', grants: [], workspaceId: 'w2' },
};

// ---- provider error shapes -------------------------------------------------
export function makeErr(code, libs) {
  const withStatus = (msg, status) => { const e = new Error(msg); e.response = { status }; return e; };
  switch (code) {
    case 'plain': return new Error('provider exploded');
    case 'e401': return withStatus('unauthorized', 401);
    case 'e403': return withStatus('forbidden', 403);
    case 'e404': return withStatus('not found', 404);
    case 'e429': return withStatus('slow down', 429);
    case 'e500': return withStatus('upstream broke', 500);
    case 'ext404': { const e = new Error('gql not found'); e.response = { errors: [{ extensions: { statusCode: 404 } }] }; return e; }
    case 'user400': { const e = new Error('invalid input'); e.response = { errors: [{ message: 'bad field', extensions: { userError: true } }] }; return e; }
    case 'timeout': { const e = new Error('timed out'); e.name = 'TimeoutError'; return e; }
    case 'abort': { const e = new Error('aborted'); e.name = 'AbortError'; return e; }
    case 'refres': return new libs.RefResolutionError('Jira refused: unrenderable content', { status: 422, candidates: [{ id: 'a', name: 'A' }] });
    case 'refres-nc': return new libs.RefResolutionError('no candidates here', { status: 409 });
    case 'partial': return new libs.PartialWriteError('Field write landed, confirmation re-read failed', { applied: ['title'], failed: 'stateId', status: 502, cause: new Error('re-read failed') });
    case 'partial0': return new libs.PartialWriteError('Nothing applied', { applied: [], failed: 'title' });
    default: throw new Error(`unknown error code ${code}`);
  }
}

// ---- the provider fake -----------------------------------------------------
function makeProvider(v) {
  const S = () => v.ctx.script;
  const W = () => v.ctx.script.world || {};
  const id = (p) => `${p}-${v.ctx.idx}`;
  const run = async (method, args, dflt) => {
    v.record('provider', method, ...args);
    let beh = S().p?.[method];
    if (Array.isArray(beh)) { const n = (v.ctx.counts[method] = (v.ctx.counts[method] || 0) + 1); beh = beh[Math.min(n, beh.length) - 1]; }
    if (beh === undefined || beh === 'ok') return typeof dflt === 'function' ? dflt() : dflt;
    if (beh === 'null') return null;
    if (beh === 'false') return { success: false };
    if (beh === 'undef') return undefined;
    if (beh === 'bare') return { id: 'bare' };               // object without a `success` key
    if (beh === 'falsey-detail') return { success: false, error: 'rejected upstream' };
    if (beh && typeof beh === 'object' && beh.throw) throw makeErr(beh.throw, v.libs);
    if (beh && typeof beh === 'object' && 'val' in beh) return beh.val;
    throw new Error(`bad behaviour ${JSON.stringify(beh)} for ${method}`);
  };
  const issueShape = (extra = {}) => ({ id: U.issue, identifier: 'LIN-7', title: 'An issue', state: { name: 'Todo', type: 'unstarted' }, team: { id: U.team }, labels: { nodes: [{ id: U.label.bug, name: 'bug' }] }, ...extra });
  const t = {
    name: 'fake',
    ui: null,
    supports: (m) => { v.record('provider', 'supports', m); return !(S().unsupported || []).includes(m); },
    createFields: () => S().createFields ?? ['teamId'],
    apiWriteFields: () => S().writable ?? ['projectId', 'stateId', 'assigneeId', 'parentId', 'cycleId', 'priority'],
    fetchTeams: (token) => run('fetchTeams', [token], () => [{ id: U.team, key: 'LIN', name: 'Linear Team' }, { id: '11111111-1111-4111-8111-222222222222', key: 'OPS', name: 'Ops' }, { id: '11111111-1111-4111-8111-333333333333', key: 'dup', name: 'Dup' }, { id: '11111111-1111-4111-8111-444444444444', key: 'DUP', name: 'Other' }]),
    states: (token, teamId) => run('states', [token, teamId], () => [{ id: U.state.done, name: 'Done', type: 'completed' }, { id: U.state.prog, name: 'In Progress', type: 'started' }, { id: U.state.todo, name: 'Todo', type: 'unstarted' }, { id: U.state.canceled, name: 'Canceled', type: 'canceled' }]),
    labels: (token, teamId) => run('labels', [token, teamId], () => [{ id: U.label.bug, name: 'bug' }, { id: U.label.feature, name: 'Feature' }, { id: U.label.dupeA, name: 'dupe' }, { id: U.label.dupeB, name: 'Dupe' }]),
    fetchProjectsList: (token) => run('fetchProjectsList', [token], () => [{ id: U.project.alpha, name: 'Alpha' }, { id: 'proj-2', name: 'Beta' }]),
    createIssue: (token, input) => run('createIssue', [token, input], () => ({ success: true, issue: issueShape({ id: id('new-issue'), identifier: 'LIN-8', team: { id: U.team, key: 'LIN' } }) })),
    issueWriteGuard: (token, issueId) => run('issueWriteGuard', [token, issueId], () => ({ id: U.issue, state: { type: 'started' }, team: W().noTeam ? undefined : { id: U.team }, description: W().desc ?? 'plain description', comments: { nodes: W().comments ?? [] }, ...(W().trashed ? { trashed: true } : {}) })),
    updateIssue: (token, issueId, input) => run('updateIssue', [token, issueId, input], () => ({ success: true, issue: issueShape({ id: issueId, description: input?.description }) })),
    issueDescription: (token, issueId) => run('issueDescription', [token, issueId], () => ({ id: U.issue, description: 'current' in W() ? W().current : 'Existing description', ...(W().trashed ? { trashed: true } : {}) })),
    issueLabels: (token, issueId) => run('issueLabels', [token, issueId], () => ({ id: U.issue, labels: ('labels' in W() && W().labels === null) ? undefined : { nodes: W().labels ?? [{ id: U.label.bug, name: 'bug' }] }, ...(W().trashed ? { trashed: true } : {}) })),
    updateIssueLabels: (token, issueId, ids) => run('updateIssueLabels', [token, issueId, ids], () => ({ success: true, issue: issueShape({ id: issueId, labels: { nodes: ids.map(i => ({ id: i, name: 'l' })) } }) })),
    createComment: (token, issueId, body) => run('createComment', [token, issueId, body], () => ({ success: true, comment: { id: id('comment'), body } })),
    deleteComment: (token, commentId) => run('deleteComment', [token, commentId], () => ({ success: true })),
    updateComment: (token, commentId, body) => run('updateComment', [token, commentId, body], () => ({ success: true, comment: { id: commentId, body } })),
    uploadFile: (token, bytes, meta) => run('uploadFile', [token, bytes, meta], () => `https://assets.example/${v.ctx.idx}.png`),
    createRelation: (token, issueId, rel) => run('createRelation', [token, issueId, rel], () => ({ success: true, issueRelation: { id: id('relation'), type: rel.type } })),
    deleteRelation: (token, relationId) => run('deleteRelation', [token, relationId], () => ({ success: true })),
    fetchIssueContext: (token, issueId) => run('fetchIssueContext', [token, issueId], () => ({ identifier: 'LIN-7', state: { type: 'completed' } })),
  };
  return new Proxy(t, {
    get(target, prop) {
      if (typeof prop === 'string' && (S().missing || []).includes(prop)) return undefined;
      return target[prop];
    },
  });
}

// ---- rulings stores -------------------------------------------------------
function mockCollection() {
  const docs = [];
  const eq = (dv, qv) => {
    if (qv && typeof qv === 'object' && Array.isArray(qv.$in)) return qv.$in.includes(dv);
    if (qv && typeof qv === 'object' && '$ne' in qv) return dv !== qv.$ne;
    return dv === qv;
  };
  const matches = (doc, q) => {
    if (q._id !== undefined && doc._id !== q._id) return false;
    for (const k of ['urlKey', 'issueId']) if (q[k] !== undefined && !eq(doc[k], q[k])) return false;
    if (q.outcome !== undefined && !eq(doc.outcome ?? null, q.outcome)) return false;
    if (q.decision !== undefined && !eq(doc.decision ?? null, q.decision)) return false;
    return true;
  };
  return {
    _docs: docs,
    async findOne(q) { return docs.find(d => matches(d, q)) || null; },
    find(q = {}) { const r = docs.filter(d => matches(d, q)); return { async toArray() { return r.slice(); } }; },
    async deleteMany() { return { deletedCount: 0 }; },
    async updateOne(q, update, opts = {}) {
      const i = docs.findIndex(d => matches(d, q));
      if (i >= 0) { Object.assign(docs[i], update.$set || {}); return { matchedCount: 1 }; }
      if (opts.upsert) { docs.push({ ...(update.$set || {}) }); return { matchedCount: 0 }; }
      return { matchedCount: 0 };
    },
  };
}

function iso(ms) { return new Date(ms).toISOString(); }

/** Rulings worlds: what dispatchQueueStore.listHistory/listItems and shelvedRulingsStore return. */
export function rulingsWorld(name, now) {
  const t = iso(now);
  const old = iso(now - 7 * 3600e3);
  const item = (id, ident, feedback, extra = {}) => ({ id, issueIdentifier: ident, issueTitle: `Title ${ident}`, promptName: 'implementation', prompt: 'p', dispatchedAt: t, resolvedAt: t, status: 'taken', feedback, ...extra });
  const dec = (decisionId, extra = {}) => ({ kind: 'decision', message: JSON.stringify({ decision_id: decisionId, question: 'Proceed?', ...extra }), timestamp: t });
  const blocked = { message: '[blocked] need a decision', timestamp: t };
  const answer = (decisionId, extra = {}) => ({ kind: 'decision-answer', message: JSON.stringify({ decision_id: decisionId, ...extra }), timestamp: t });
  const W = { history: [], live: [], shelved: [] };
  switch (name) {
    case 'empty': break;
    case 'basic':
      W.history = [item('loop-1', 'LIN-1', [blocked, dec('d-1')])];
      break;
    case 'options':
      W.history = [
        item('loop-1', 'LIN-1', [blocked, dec('d-1')]),
        item('loop-2', 'LIN-2', [blocked, dec('d-opt', { options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] })]),
        item('loop-3', 'LIN-3', [blocked, dec('d-noopt', { options: [] })]),
      ];
      break;
    case 'resolved':
      W.history = [
        item('ans-1', 'LIN-1', [blocked, dec('d-answered'), answer('d-answered')]),
        item('dis-1', 'LIN-1', [blocked, dec('d-dismissed'), answer('d-dismissed', { outcome: 'dismissed' })]),
        item('wd-1', 'LIN-2', [blocked, dec('d-withdrawn'), { kind: 'decision-withdrawn', message: JSON.stringify({ decision_id: 'd-withdrawn', reason: 'no longer relevant' }), timestamp: t }]),
        item('open-1', 'LIN-3', [blocked, dec('d-open', { options: [{ id: 'x', label: 'X' }] })]),
        item('sib-1', 'LIN-9', [answer('d-open')], { rootItemId: 'ans-1' }),
      ];
      break;
    case 'shared':
      // one decision_id raised by two loops (LIN-2756)
      W.history = [item('review-loop', 'LIN-1', [blocked, dec('d-shared', { options: [{ id: 'a', label: 'A' }] })]), item('closeout-loop', 'LIN-1', [blocked, dec('d-shared', { options: [{ id: 'a', label: 'A' }] })])];
      break;
    case 'live':
      W.history = [item('loop-gone', 'LIN-50', [dec('d-gone', { on_answer: { effect: 'dispatch' } }), { message: '[done] shipped it', timestamp: old }], { dispatchedAt: old, resolvedAt: old })];
      W.live = [{ id: 'loop-live', issueIdentifier: 'LIN-50', issueTitle: 'T', promptName: 'plan', prompt: 'p', dispatchedAt: t }];
      break;
    case 'shelved':
      W.history = [item('root-shelf', 'LIN-1', [blocked, dec('d-shelf'), answer('d-shelf')]), item('loop-2', 'LIN-2', [blocked, dec('d-2')])];
      W.shelved = [{ urlKey: WS, decisionId: 'd-shelf', decisionLoopId: 'root-shelf', reason: 'waiting', shelvedAt: t, resurfaceAt: iso(now + 86400e3), lapseCount: 0 }, { urlKey: WS, decisionId: 'd-2', reason: 'later', shelvedAt: t, resurfaceAt: iso(now + 86400e3), lapseCount: 1 }];
      break;
    case 'many':
      W.history = Array.from({ length: 8 }, (_, i) => item(`loop-${i}`, `LIN-${i + 1}`, [blocked, dec(`d-${i}`, i % 2 ? { options: [{ id: 'a', label: 'A' }] } : {})]));
      break;
    default: throw new Error(`unknown rulings world ${name}`);
  }
  return W;
}

// ---- boot one variant ------------------------------------------------------
export async function bootVariant(label, { repo, libs, clock, copies, exportName }) {
  const v = { label, ctx: null, rec: null, libs, servers: {} };
  v.record = (ch, op, ...args) => { v.rec?.calls.push({ ch, op, args: sanitize(args) }); };
  const S = () => v.ctx.script;

  const taskCollection = mockCollection();
  const suggestionCollection = mockCollection();
  const taskStoreReal = new libs.TaskDecisionsStore({ collection: taskCollection });
  const suggestReal = new libs.DismissalSuggestionsStore({ collection: suggestionCollection });
  const feedCacheReal = libs.createSessionsFeedCache({ now: () => clock.t });
  v.taskStoreReal = taskStoreReal;
  v.taskCollection = taskCollection;
  v.resetCache = () => feedCacheReal.clear();

  const withDigests = (items) => (items || []).map(item => {
    if (!item || 'feedbackDigest' in item || 'feedbackVersion' in item) return item;
    const digest = libs.digestFeedback({ feedback: item.feedback, dispatchedAt: item.dispatchedAt }, { now: clock.t });
    digest.version = 0;
    return { ...item, feedbackVersion: 0, feedbackDigest: digest };
  });
  const rworld = () => S().rworld || { history: [], live: [], shelved: [] };

  const registry = {
    markSuspect: (fp, o) => v.record('registry', 'markSuspect', fp, o),
    witnessAccepted: (fp, ts) => v.record('registry', 'witnessAccepted', fp, ts),
    isSuspect: () => !!S().registry?.suspect,
    isPastByteIdenticalThreshold: () => !!S().registry?.past,
    isSuperseded: () => !!S().registry?.superseded,
  };

  const provider = makeProvider(v);

  const depsBase = () => ({
    proxyTokenStore: {
      validateToken: async (token) => { if (token === 'tok-throws') throw new Error('token store down'); return TOKENS[token] || null; },
      describeRejectionCause: async (token) => {
        if (token === 'tok-expired') return { state: 'expired', urlKey: WS, expiresAt: new Date(clock.t - 1000).toISOString() };
        if (token === 'tok-consumed') return { state: 'consumed', urlKey: WS };
        return null;
      },
      listTokens: async () => [],
    },
    proxyEventStore: {
      recordEvent: async (e) => { v.record('event', 'recordEvent', e); },
      listEvents: async () => ({ events: [], total: 0 }),
      listCredentialHealth: async () => ({ tokens: [] }),
      listSelfCredentialHealth: async () => ({ occupancy: {}, workspaceAccess: {} }),
      listSelfCredentialTrail: async () => ({ windowMs: 900000, items: [] }),
    },
    resolveWorkspaceAccess: async (urlKey, owner, opts) => {
      v.record('access', 'resolveWorkspaceAccess', urlKey, owner, { source: opts?.source });
      let a = S().access || 'ok';
      if (S().accessSeq) { const n = (v.ctx.counts.access = (v.ctx.counts.access || 0) + 1); a = S().accessSeq[Math.min(n, S().accessSeq.length) - 1]; }
      if (a === 'throw') throw new Error('workspace store down');
      if (a.startsWith('none')) return { token: null, reason: a.split(':')[1] || 'session_expired', provider: 'linear' };
      const exp = S().expires || 'future';
      return {
        token: `tok-for-${urlKey}`,
        scope: S().scope === 'obj' ? { token: `tok-for-${urlKey}`, repo: 'o/r' } : undefined,
        reason: 'ok',
        provider: 'linear',
        source: 'connection',
        expiresAt: exp === 'future' ? clock.t + 3600e3 : exp === 'past' ? clock.t - 1000 : undefined,
        credentialFingerprint: S().fp === false ? undefined : `fp-${urlKey}`,
      };
    },
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: { listStatus: async (...a) => { v.record('agentStatus', 'listStatus', ...a); return { items: [] }; } },
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    taskSnapshotStore: { list: async () => ({ items: [], total: 0 }), diffLatest: async () => ({ changed: false }) },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider,
    rejectedCredentialRegistry: registry,
    workspaceHaltStore: { getWorkspaceHalt: async () => null, setWorkspaceHalt: async () => {}, clearWorkspaceHalt: async () => {} },
    livenessAlarmStore: { list: async () => [], listOpenWorkspaceKeys: async () => [] },
    dispatchQueueStore: {
      listItems: async (urlKey, opts) => { v.record('dispatch', 'listItems', urlKey, opts); if (S().rfail === 'dispatch') throw new Error('dispatch store down'); return withDigests(urlKey === WS ? rworld().live : []); },
      listHistory: async (urlKey, opts) => { v.record('dispatch', 'listHistory', urlKey, opts); if (S().rfail === 'dispatch') throw new Error('dispatch store down'); return { items: withDigests(urlKey === WS ? rworld().history : []) }; },
      getItemStatus: async () => null, pollAvailable: async () => [], takeItem: async () => null, addFeedback: async () => null,
    },
    dispatchTokenStore: { listTokens: async () => [] },
  });

  const full = () => ({
    ...depsBase(),
    harbourCommentsStore: { record: async (a) => { v.record('ledger', 'record', a); if (S().ledger === 'throw') throw new Error('ledger down'); } },
    onTicketWrite: async (arg) => {
      v.record('closer', 'onTicketWrite', { urlKey: arg.urlKey, written: arg.written });
      const mode = S().closer || 'ok';
      if (mode === 'throw') throw new Error('closer failed');
      if (mode === 'throw-bare') throw '';                        // a rejection with no .message
      if (mode === 'ok') await arg.readBack();
    },
    taskDecisionsStore: {
      listUnansweredForWorkspaces: async (keys) => { v.record('taskDecisions', 'listUnansweredForWorkspaces', keys); if (S().rfail === 'tasks') throw new Error('task store down'); return taskStoreReal.listUnansweredForWorkspaces(keys); },
      listNewestScanPerTask: async (keys) => { v.record('taskDecisions', 'listNewestScanPerTask', keys); return taskStoreReal.listNewestScanPerTask(keys); },
    },
    shelvedRulingsStore: { listForWorkspaces: async (keys) => { v.record('shelved', 'listForWorkspaces', keys); return keys.includes(WS) ? rworld().shelved : []; } },
    dismissalSuggestionsStore: {
      suggest: async (arg) => {
        v.record('suggestions', 'suggest', arg);
        const m = S().suggest;
        if (m === 'null') return null;
        if (m === 'throw') throw new Error('suggestion store down');
        return suggestReal.suggest(arg);
      },
      listForWorkspaces: async (keys) => { v.record('suggestions', 'listForWorkspaces', keys); if (S().rfail === 'suggestions') throw new Error('suggestions read failed'); return suggestReal.listForWorkspaces(keys); },
    },
    sessionsFeedCache: {
      keyFor: (...a) => { const k = feedCacheReal.keyFor(...a); v.record('cache', 'keyFor', ...a, k); return k; },
      get: (key, producer) => { v.record('cache', 'get', key); return feedCacheReal.get(key, producer); },
      clear: (...a) => { v.record('cache', 'clear', ...a); return feedCacheReal.clear(...a); },
      peek: (k) => feedCacheReal.peek(k),
    },
  });

  // "Bare" deployment: none of the optional stores wired (what routes/proxy.js defaults to).
  const bare = () => ({ ...depsBase() });

  const mountAll = async () => {
    const mod = await import(pathToFileURL(path.join(repo, 'routes/proxy.js')).href + `?variant=${label}`);
    v.composer = mod;
    for (const [mode, mkDeps] of [['full', full], ['bare', bare]]) {
      const app = express();
      app.use((req, res, next) => { v.ctx.res = res; next(); });
      app.use(express.json({ limit: '250kb' }));
      app.use(mod.createProxyRoutes(mkDeps()));
      // server.js's final four-argument handler (LIN-608/LIN-1158), reproduced here.
      // eslint-disable-next-line no-unused-vars
      app.use((err, req, res, next) => {
        if (res.headersSent) return res.destroy();
        const clientStatus = libs.clientErrorStatus(err);
        if (clientStatus !== null) {
          console.warn('Client request error:', req.method, req.originalUrl, '-', clientStatus, err?.type || err?.message);
          return libs.jsonError(res, clientStatus, libs.clientErrorMessage(clientStatus, err));
        }
        console.error('Unhandled route error:', req.method, req.originalUrl, '-', err?.stack || err);
        return libs.serverError.json(res, 'Internal server error');
      });
      v.servers[mode] = await new Promise((resolve) => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => resolve(s)); });
    }
  };
  await mountAll();
  v.port = (mode) => v.servers[mode].address().port;
  v.close = () => Promise.all(Object.values(v.servers).map(s => new Promise(r => s.close(r))));
  return v;
}

/** Seed task-bound decision rows (real TaskDecisionsStore) so the rulings read has task-bound input. */
export async function seedTaskDecisions(v, clock) {
  const store = v.taskStoreReal;
  const H1 = 'a'.repeat(64); const H2 = 'b'.repeat(64); const H3 = 'c'.repeat(64);
  const a = await store.recordScan({ urlKey: WS, issueId: '99999999-0000-4000-8000-000000000001', issueIdentifier: 'LIN-300', inputHash: H1, decision: { decision_id: 'scan_99999999_open0000001', question: 'Task question?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], free_text: false } });
  const older = await store.recordScan({ urlKey: WS, issueId: '99999999-0000-4000-8000-000000000002', issueIdentifier: 'LIN-301', inputHash: H2, decision: { decision_id: 'scan_99999999_older000002', question: 'Old?', options: [{ id: 'a', label: 'A' }], free_text: false } });
  const newer = await store.recordScan({ urlKey: WS, issueId: '99999999-0000-4000-8000-000000000002', issueIdentifier: 'LIN-301', inputHash: H3, decision: { decision_id: 'scan_99999999_newer000003', question: 'New?', options: [{ id: 'a', label: 'A' }], free_text: false } });
  const docs = store.collection?._docs;
  void a; void older; void newer; void docs; void clock;
  await store.markOutcome({ urlKey: WS, issueId: '99999999-0000-4000-8000-000000000002', id: newer.id, outcome: 'self-resolved', outcomeReason: 'superseded', outcomeBasisHash: 'basis' });
}
