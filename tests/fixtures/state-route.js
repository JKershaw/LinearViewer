/**
 * LIN-4070 — the private `/state` route, driven as the server drives it, for the pinned split tests.
 *
 * `stateBodyOf` builds the real route (`createTaskPageRoutes`) over the real loader, with the held set (`heldTaskFacts`)
 * and the stored loops, and calls its `/workspace/:urlKey/api/task/:identifier/state` handler. It returns the JSON body the
 * browser gets, so a test asserts what the server decides, not what a helper computes. No refresh is wired (`refreshTaskFacts`
 * is null): a poll never starts one here, and a test that needs a refresh drives `createTaskFactsRefresh` itself.
 */

import { createTaskPageLoader } from '../../lib/task-page-loader.js';
import { createTaskPageRoutes } from '../../routes/task-page.js';
import { enrichLoop, deriveSessionWaiting, deriveSessionDecisions } from '../../routes/dashboard.js';
import { heldTaskFacts, heldLoaderDeps } from './held-task-facts.js';
import { findRouteLayer } from '../unit/lib/route-layer.js';

export const STATE_URL_KEY = 'acme';
export const STATE_NOW = new Date('2026-10-31T12:00:00.000Z');

/**
 * The `/state` body for `identifier`, read over a complete held set of `issues` written at `writtenAt`.
 *
 * @param {{issues: Array<Object>, loops?: Array<Object>, identifier: string, writtenAt?: Date, readAt?: Date}} args
 * @returns {Promise<{status: number, body: Object}>}
 */
export async function stateBodyOf({ issues, loops = [], identifier, writtenAt = STATE_NOW, readAt = STATE_NOW }) {
  const holder = heldTaskFacts({ urlKey: STATE_URL_KEY, issues, now: writtenAt, readAt });
  const loader = createTaskPageLoader({
    dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting, deriveSessionDecisions,
    getLoopsForIssue: async (_urlKey, id) => loops.filter((l) => l.issueIdentifier === id),
    getLoopsForIssues: async (_urlKey, ids) => loops.filter((l) => ids.includes(l.issueIdentifier)),
    now: () => readAt,
    ...heldLoaderDeps(holder),
  });
  const router = createTaskPageRoutes({
    workspaceFromUrl: (req, res, next) => next(), getOpenRouterSource: () => 'env', getDeployInfo: () => ({}),
    loader, workspaceOwnerCheck: async () => ({ status: 'owner' }), taskFacts: holder, refreshTaskFacts: null, now: () => readAt,
  });
  const layer = findRouteLayer(router, 'get', '/workspace/:urlKey/api/task/:identifier/state');
  const req = {
    session: { workspaces: [], features: {}, accountId: 'acct-1' }, workspace: { urlKey: STATE_URL_KEY, id: 'ws-1' },
    params: { urlKey: STATE_URL_KEY, identifier }, query: {}, get: () => 'localhost',
  };
  const res = {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send() { return this; }, set() { return this; },
  };
  await layer.route.stack[layer.route.stack.length - 1].handle(req, res, (err) => { if (err) throw err; });
  return { status: res.statusCode, body: res.body };
}

/** A failed implementation stage on `identifier`, dispatched inside the read window (a last stage that failed). */
export function failedStageLoop(identifier, { loopId = 'f1' } = {}) {
  return {
    loopId, lineageId: loopId, issueIdentifier: identifier, kind: 'implementation', iteration: 1, source: 'history',
    historyStatus: 'resolved', agentState: 'failed', dispatchedAt: '2026-10-30T10:00:00.000Z', takenAt: '2026-10-30T10:01:00.000Z',
    resolvedAt: '2026-10-30T10:02:00.000Z', terminalStatus: 'failed', terminalCompletedAt: '2026-10-30T10:02:00.000Z',
    wakeMarker: 'pending', waitingMessage: null, feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] },
    followUpTo: null, bookkeeping: null,
  };
}

/** A tracker issue for the held set (`{id, identifier, title, state: {type}, parent?}`). */
export function stateIssue(identifier, type, { parent = null } = {}) {
  return { id: `id-${identifier}`, identifier, title: `Task ${identifier}`, state: { name: type, type }, parent: parent ? { id: `id-${parent}` } : null, project: { id: 'p1', name: 'Main' }, assignee: null };
}
