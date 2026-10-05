/**
 * Shared harness for the run share-link tests (LIN-3313, Phase 3 of LIN-2950):
 * `share-run-reader.test.js`, `share-run-refresh.test.js` and the run cases
 * in `share-route.test.js` / `share-owner-routes.test.js`.
 *
 * Everything below the share route is REAL except the edges: the run reader
 * (`createShareRunReader`), the dashboard router's `readRunExternal`, the real
 * `readRunEvidence`, the real PR-state store, the real guest projection,
 * renderer and scan. The edges are fakes that COUNT: the owner credential
 * (`resolveWorkspaceAccess`), the tracker provider (`fetchIssueComments`,
 * `fetchProjects`), GitHub (`githubFetch`), and the Mongo-only local half
 * (`loadRunLocal`, serving a session the test controls — so a test can add a
 * follow-up loop "between two probes").
 *
 * The clock is injected (`clock.t`, ms) into the reader and the store; the
 * share route itself keeps the real clock, so tests age a record by moving its
 * `snapshotAt`/`lastRefreshAttemptAt` back.
 */

import express from 'express';
import { createDashboardRoutes, sessionSettleState, sessionIsSettled, enrichLoop } from '../../routes/dashboard.js';
import { readRunEvidence } from '../../lib/run-evidence.js';
import { createPrStateStore } from '../../lib/pr-state-store.js';
import { createShareRunReader } from '../../lib/share-run-reader.js';
import { createShareRoutes } from '../../routes/share.js';
import { InMemoryRunSummaryCacheStore } from '../../lib/run-summary-cache.js';
import { InMemorySessionSummaryCacheStore } from '../../lib/session-summary-cache.js';
import { InMemoryRunParagraphStore } from '../../lib/run-paragraph-store.js';

export const URL_KEY = 'ws-1';
export const OWNER = 'acct-1';
export const SID = 'sess-share-1';
export const TOKEN = 'A'.repeat(43);
export const REPO = 'acme/widget';
export const PR_URL = `https://github.com/${REPO}/pull/12`;
const MIN = 60 * 1000;

/** A review comment with an open inside item and a discharged one (the ledger the F1 markers read). */
export const REVIEW_BODY = `## Review summary

### What CI Did Not Prove
| # | Claim | Scope | Discharge |
|---|---|---|---|
| L1 | the share route is exempt from auth | inside | run the e2e against a signed-out context |
| L2 | the golden is unchanged | inside | discharged by the golden test |

**Verdict: Approve**`;

export const DONE = { agentState: 'complete', terminalStatus: 'done' };
export const RUNNING = { agentState: 'running', terminalStatus: null };
export const MARKERLESS_COMPLETE = { agentState: 'complete', terminalStatus: null };

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

/** Counts every upstream GitHub GET `fetchPrStatus` makes (4 per read). */
export function githubStub(counts, pr) {
  return async (url) => {
    counts.github += 1;
    if (/\/repos\/[^/]+\/[^/]+$/.test(url)) return jsonResponse(200, { private: false });
    if (/\/pulls\/\d+$/.test(url)) return jsonResponse(200, { state: pr.state, merged: pr.merged, head: { ref: 'feature', sha: 'abc1234' }, base: { ref: 'main' }, mergeable: true });
    if (/\/check-runs$/.test(url)) return jsonResponse(200, { check_runs: [{ name: 'unit', conclusion: 'success' }] });
    if (/\/status$/.test(url)) return jsonResponse(200, { statuses: [] });
    return jsonResponse(404, {});
  };
}

/**
 * One loop of the controlled session, finished `endedAgoMin` minutes before
 * `clock.t` when `fields` is terminal with a marker.
 */
export function loopAt(clock, loopId, fields = {}, { startedAgoMin = 40, endedAgoMin = 20 } = {}) {
  const terminal = fields.terminalStatus != null;
  return {
    loopId,
    sessionId: loopId === SID ? undefined : SID,
    issueIdentifier: 'LIN-1',
    issueTitle: loopId === SID ? 'Shared run task' : `Step ${loopId}`,
    kind: loopId === SID ? 'autopilot' : 'implementation',
    iteration: 1,
    dispatchedAt: new Date(clock.t - startedAgoMin * MIN).toISOString(),
    terminalCompletedAt: terminal ? new Date(clock.t - endedAgoMin * MIN).toISOString() : null,
    resolvedAt: fields.agentState === 'complete' || fields.agentState === 'error'
      ? new Date(clock.t - endedAgoMin * MIN).toISOString()
      : null,
    feedback: [],
    telemetry: { runtime: { ms: 60000 }, model: 'claude-opus-4-8', ticketWalk: [] },
    ...fields
  };
}

/** An anchored run: the anchor plus one worker, both done 20 minutes ago. */
export function settledSession(clock) {
  return {
    sessionId: SID,
    seedIssue: 'LIN-1',
    tasksTouched: ['LIN-1'],
    dispatchedAt: new Date(clock.t - 40 * MIN).toISOString(),
    completedAt: new Date(clock.t - 20 * MIN).toISOString(),
    loops: [loopAt(clock, SID, DONE), loopAt(clock, 'w1', DONE)]
  };
}

function quietDashboardRouter({ provider, runProposalsStore, readRunEvidenceImpl }) {
  return createDashboardRoutes({
    workspaceFromUrl: (req, res, next) => next(),
    dispatchQueueStore: { async listItems() { return []; }, async listHistory() { return { items: [] }; } },
    agentStatusStore: { async listStatus() { return { items: [] }; } },
    runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
    sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
    runParagraphStore: new InMemoryRunParagraphStore(),
    freeTierStore: { async tryUse() { return { allowed: true }; } },
    getWorkspaceAccessToken: async () => 'token',
    fetchIssueContext: async () => ({}),
    fetchWorkspaceIssues: async () => [],
    getOpenRouterSource: () => 'env',
    getDeployInfo: () => ({}),
    readRunEvidence: readRunEvidenceImpl,
    runProposalsStore,
    prState: {
      resolveProvider: () => ({ provider, callScope: 'scope' }),
      loadRun: async () => ({ issueIdentifier: 'LIN-1', evidenceUrls: [] })
    }
  });
}

/**
 * Build the harness. `state.session` is what the local half returns (null →
 * the run is gone); `state.paragraph` the stored paragraph record;
 * `state.pr` the PR GitHub reports; `state.localThrows` makes the local half throw.
 * `readRunEvidenceImpl` replaces the dashboard router's reader (a capturing
 * one, say); the default is the real `readRunEvidence`.
 */
export function createRunHarness({ clock = { t: Date.now() }, prStateStoreOptions = {}, readRunEvidenceImpl = readRunEvidence } = {}) {
  const counts = { github: 0, comments: 0, fetchProjects: 0, access: 0, local: 0, proposals: 0 };
  const state = {
    session: null,
    paragraph: null,
    pr: { state: 'open', merged: false },
    comments: [
      { id: 'c-pr', body: `Opened the pull request: ${PR_URL}`, createdAt: '2026-07-01T10:00:00Z', user: 'Runner' },
      { id: 'c-review', body: REVIEW_BODY, createdAt: '2026-07-02T10:00:00Z', user: 'Reviewer' }
    ],
    access: { token: 'owner-token', scope: 'owner-scope', reason: 'ok', provider: 'linear' },
    localThrows: false
  };
  state.session = settledSession(clock);

  const provider = {
    async fetchIssueComments() { counts.comments += 1; return state.comments; },
    async fetchProjects() { counts.fetchProjects += 1; return { projects: [{ id: 'p1', name: 'P', content: `repo=${REPO}` }], issues: [] }; }
  };
  // Any proposals read would count here (the reader must make none).
  const runProposalsStore = new Proxy({}, { get: () => async () => { counts.proposals += 1; return []; } });
  const router = quietDashboardRouter({ provider, runProposalsStore, readRunEvidenceImpl });

  const prStateStore = createPrStateStore({
    cache: new Map(),
    now: () => clock.t,
    githubFetch: githubStub(counts, new Proxy({}, { get: (_, k) => state.pr[k] })),
    ...prStateStoreOptions
  });

  const calls = { access: [], local: [], external: [] };
  const reader = createShareRunReader({
    resolveWorkspaceAccess: async (urlKey, ownerAccountId) => {
      counts.access += 1;
      calls.access.push([urlKey, ownerAccountId]);
      return { ...state.access };
    },
    getProviderForWorkspace: () => provider,
    loadRunLocal: async (urlKey, sessionId) => {
      counts.local += 1;
      calls.local.push([urlKey, sessionId]);
      if (state.localThrows) throw new Error('mongo down');
      if (urlKey !== URL_KEY || sessionId !== SID || !state.session) return null;
      return { session: structuredClone(state.session), paragraph: state.paragraph, anchorIssueTitle: 'Shared run task' };
    },
    readRunExternal: async (workspace, session, opts) => {
      calls.external.push({ workspace, opts });
      return router.runLoader.readRunExternal(workspace, session, opts);
    },
    prStateStore,
    sessionSettleState,
    sessionIsSettled,
    enrichLoop,
    now: () => clock.t
  });

  return { clock, counts, state, calls, reader, router, prStateStore, provider };
}

/** A fake share store over one in-memory record, recording every saveSnapshot. */
export function makeShareStore(record) {
  const calls = { getByToken: 0, saveSnapshot: [], create: [] };
  const store = {
    record,
    calls,
    saveThrows: false,
    async getByToken() {
      calls.getByToken++;
      return store.record ? structuredClone(store.record) : null;
    },
    async saveSnapshot(tokenHash, snapshot, { at = new Date() } = {}) {
      calls.saveSnapshot.push({ tokenHash, snapshot, at });
      if (store.saveThrows) throw new Error('store write down');
      if (!store.record) return false;
      store.record.lastRefreshAttemptAt = at;
      if (snapshot != null) {
        store.record.snapshot = structuredClone(snapshot);
        store.record.snapshotAt = at;
      }
      return true;
    }
  };
  return store;
}

/** A run share record (fresh unless aged). */
export function runRecord(overrides = {}) {
  return {
    _id: 'hash-run',
    tokenHash: 'hash-run',
    urlKey: URL_KEY,
    workspaceId: 'ws-uuid-1',
    ownerAccountId: OWNER,
    subject: { type: 'run', kind: 'run', id: SID },
    includeDescriptions: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    revokedAt: null,
    snapshot: null,
    snapshotAt: null,
    lastRefreshAttemptAt: null,
    ...overrides
  };
}

/** Move a record's refresh stamps back so the next GET is a due refresh. */
export function age(store, ms = 2 * MIN) {
  const at = new Date(Date.now() - ms);
  if (store.record.snapshotAt) store.record.snapshotAt = at;
  store.record.lastRefreshAttemptAt = at;
}

export function buildShareApp({ store, harness, readOwnerIssues = async () => ({ reason: 'ok', issues: [] }), withTimeout = (p) => p, ...rest }) {
  const app = express();
  app.use(createShareRoutes({
    shareStore: store,
    readOwnerIssues,
    readOwnerRun: harness ? harness.reader.readOwnerRun : undefined,
    probeRun: harness ? harness.reader.probeRun : undefined,
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
    withTimeout,
    readLimiter: (req, res, next) => next(),
    ...rest
  }));
  return app;
}

/** GET a path on an app bound to 127.0.0.1 (LIN-2023). */
export async function request(app, path) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { signal: AbortSignal.timeout(5000) });
    const body = await res.text();
    return { status: res.status, headers: res.headers, body };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

/** Reset the edge counters (between a seeding refresh and the step under test). */
export function resetCounts(counts) {
  for (const k of Object.keys(counts)) counts[k] = 0;
}
