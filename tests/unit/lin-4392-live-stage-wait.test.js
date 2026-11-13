/**
 * LIN-4392: recommend-and-dispatch must not start a second, different stage beside a live one.
 *
 * One rule, the live-stage wait (lib/run-live-wait.js), runs first in
 * lib/openrouter.js codeRouteOf, before the review loop bound, the look-first sequence and the
 * stage selector. While any stage run on the ticket is queued or running, every recommendation
 * surface answers wait: recommend-and-dispatch refuses 409 STAGE_IN_FLIGHT naming the live
 * dispatch, GET /recommend and the task page carry `liveWait`, and no model is asked.
 *
 * Witnesses (the plan's W1-W13), all through the real handlers on the live path, with a
 * selector that would pick `implementation` if asked (so a pre-fix run shows the second stage
 * being enqueued, not a mock error):
 *   - W1/W2: a non-look-first leaf with a silent running `plan`, or a queued `review`: 409,
 *     the body names the row, nothing enqueued, the selector never asked;
 *   - W12: a same-kind live `plan` older than the duplicate guard's five-minute window: 409;
 *   - W3: only live `autopilot` and `custom` rows: the selector decides, 201;
 *   - W4: the `kind` override still dispatches; W5: `force` skips the wait (an ordinary ticket,
 *     and a look-first ticket, whose unforced call still waits); W6: a set `followUpTo` skips it;
 *   - W7: GET /recommend, the workspace buffered GET, the leaf stream and a parent's
 *     descending stream all show the wait, with no prompt;
 *   - W8: the wait beats an exhausted review-loop bound (no `blocked` beside a live plan-review);
 *   - W9: a parent with a live run waits, and its child is never fetched;
 *   - W10: a failed run read stands the wait aside; W11: aborting the wedged row frees the ticket;
 *   - W13: the instructions name the shared code, imported, and not the retired one;
 *   - LIN-4459, over a real store: a stage parked `[pending]` whose ci-wake or held-wake follow-up
 *     ends `[blocked]` or `[skipped]` is not live; a census keeps the wait defined in
 *     lib/run-live-wait.js alone;
 *   - the predicate over real dispatch rows: newest live named; ended, waiting, aborted and
 *     non-stage rows never count.
 *
 * Run with: node --test tests/unit/lin-4392-live-stage-wait.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import express from 'express';
import { setFetchImpl, setPromptTraceRecorder } from '../../lib/openrouter.js';
import { newestLiveRun, liveWaitOf, liveWaitRefusal, STAGE_IN_FLIGHT_CODE, RUNNING } from '../../lib/run-live-wait.js';
import { stageRuns, loadRecentRuns, WAITING_ON_A_PERSON } from '../../lib/recent-runs.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { buildInstructions } from '../../lib/proxy-instructions.js';
import { sealAsAsked } from '../../lib/as-asked.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { stubLineageIdentity } from '../fixtures/lineage-identity.js';
import { NO_REQUEST_RECORDS, withDefaults } from '../fixtures/request-usage-loader.js';

afterEach(() => { setFetchImpl(null); setPromptTraceRecorder(null); });

const OPEN = { name: 'Todo', type: 'unstarted' };
const T = (hm) => `2026-11-08T${hm}:00.000Z`;
const PLANNED = 'Make the export button download a CSV.\n\n## Implementation Plan\n\n1. Add the route.\n2. Wire the button.';
const ASKED = sealAsAsked('Make the export button download a CSV.');

// ── Fixtures: one provider, a dispatch store over rows, and the two apps ──────

const PROVIDER = 'lin4392-live-wait-fake';
const ISSUES = {};
const fetched = [];
registerProvider({
  name: PROVIDER,
  ui: { write: true, comments: true, estimates: false, subtasks: true, displayName: 'Linear' },
  supports: () => true,
  async fetchRecommendationContext(_scope, id) { fetched.push(id); return ISSUES[id]; },
  async fetchIssueContext(_scope, id) { fetched.push(id); return ISSUES[id]; }
});
const setIssue = (issue, { comments = [], children = [] } = {}) => {
  const c = { issue: { id: `id-${issue.identifier}`, url: `https://example.test/${issue.identifier}`, createdAt: T('08:00'), state: OPEN, labels: [], ...issue },
    parent: null, siblings: [], project: null, children, comments, focusedChild: children[0] || null, attachments: [] };
  ISSUES[issue.identifier] = c;
  ISSUES[c.issue.id] = c;
};
const leaf = (identifier = 'LW-1', description = PLANNED) => setIssue({ identifier, title: 'Export CSV', description });

const runStore = (rows, live = [], { failRead = false } = {}) => ({
  listItems: async (urlKey, { issueIdentifier } = {}) => {
    if (failRead) throw new Error('store down');
    return live.filter(r => r.issueIdentifier === issueIdentifier);
  },
  listHistory: async (urlKey, { issueIdentifier } = {}) => {
    if (failRead) throw new Error('store down');
    const items = rows.filter(r => r.issueIdentifier === issueIdentifier);
    return { items, total: items.length };
  }
});

function proxyApp({ rows = [], items = [], live = [], failRead = false } = {}) {
  const app = express();
  app.use(express.json());
  app.use(withDefaults(createProxyRoutes, 0, { requestUsageLoader: NO_REQUEST_RECORDS })({
    proxyTokenStore: { createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }), validateToken: async () => ({ grants: ['dispatch'], workspaceId: 'ws-acme', tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }) },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'live-access-token', reason: 'ok', provider: PROVIDER }),
    getWorkspaceAccessToken: async () => 'live-access-token',
    getWorkspaceOpenRouterKey: async () => 'sk-test-key',
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      addItem: async (urlKey, item) => { const row = { _id: `disp-${items.length + 1}`, id: `disp-${items.length + 1}`, dispatchedAt: T('13:00'), ...item }; items.push(row); return row; },
      lineageIdentityRows: stubLineageIdentity(() => rows),
      // A follow-up beat reads the anchor's grant declaration (W6); none is declared here.
      getGrantDeclaration: async () => ({ state: 'none' }),
      ...runStore(rows, live, { failRead })
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }), checkRun: async () => ({ allowed: true, runsUsed: 0, limit: 10, remaining: 10, resetsAt: null }) }
  }));
  return app;
}

function uiApp({ rows = [], live = [] } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: req.params.urlKey, provider: PROVIDER, accessToken: 'ws-token' }; req.session = { openRouterApiKey: 'sk-test', features: {} }; next(); },
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    getOpenRouterSource: () => null,
    userPreferencesStore: {}, customPromptsStore: {}, recapCacheStore: {}, briefCacheStore: {}, reportHistoryStore: {}, agentStatusStore: {}, promptTraceStore: {},
    dispatchQueueStore: runStore(rows, live)
  }));
  return app;
}

async function request(app, path, { method = 'GET', body } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method, headers: { Authorization: 'Bearer anything' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed, text };
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
}

const streamedPrompt = (text) => text.split('\n\n').filter(Boolean).map(block => {
  const data = block.split('\n').find(l => l.startsWith('data: '));
  return data ? JSON.parse(data.slice(6)) : null;
}).filter(d => d?.section === 'prompt').map(d => d.content).join('');

// A selector that would pick `implementation` (or defer, on a container), counting each ask.
function selector(reply = '## Reasoning\nThe plan is approved.\n→ **implementation**\n**Why now:** planned.') {
  const asks = [];
  setFetchImpl(async (url, opts = {}) => {
    asks.push(JSON.parse(opts.body).messages[0].content);
    return { ok: true, json: async () => ({ choices: [{ message: { content: reply }, finish_reason: 'stop' }], usage: { completion_tokens: 3 } }) };
  });
  return asks;
}

// Dispatch rows as the store formats them.
const silentRow = (kind, dispatched, issueIdentifier = 'LW-1', over = {}) => ({ id: `${kind}-${dispatched}`, kind, status: 'taken', issueIdentifier, dispatchedAt: T(dispatched), rootItemId: `${kind}-${dispatched}`,
  feedback: [{ kind: 'progress', message: '[working] started', timestamp: T(dispatched) }], ...over });
const queuedRow = (kind, dispatched, issueIdentifier = 'LW-1') => ({ id: `${kind}-${dispatched}`, kind, status: 'pending', issueIdentifier, dispatchedAt: T(dispatched) });
const endedRow = (kind, dispatched, ended, message = '[done] finished', issueIdentifier = 'LW-1') => ({ id: `${kind}-${dispatched}`, kind, status: 'taken', issueIdentifier, dispatchedAt: T(dispatched), rootItemId: `${kind}-${dispatched}`,
  feedback: [{ kind: 'progress', message: '[working] started', timestamp: T(dispatched) }, { kind: 'progress', message, timestamp: T(ended) }] });

const recommendAndDispatch = (opts, body = { issueIdentifier: 'LW-1' }) => request(proxyApp(opts), '/api/proxy/recommend-and-dispatch', { method: 'POST', body });

// ── The predicate ─────────────────────────────────────────────────────────────

describe('the predicate: the newest live stage run, from real dispatch rows', () => {
  test('names the newest live run; ended, waiting, aborted and non-stage rows never count', () => {
    const abort = { id: 'abort-1', kind: 'custom', abort: true, abortTo: 'review-10:30', status: 'taken', issueIdentifier: 'LW-1', dispatchedAt: T('10:40'),
      feedback: [{ kind: 'progress', message: '[aborted] cancelled', timestamp: T('10:41') }] };
    const rows = [
      endedRow('research', '09:00', '09:30'),
      silentRow('plan', '10:00'),
      queuedRow('implementation', '10:20'),
      silentRow('review', '10:30'),
      abort,
      endedRow('triage', '10:50', '11:00', '[blocked] needs a person'),
      silentRow('autopilot', '11:10'),
      silentRow('custom', '11:20'),
      queuedRow('autopilot', '11:30')
    ];
    const runs = stageRuns(rows);
    const live = newestLiveRun(runs);
    assert.equal(live.stage, 'implementation', 'the newest live stage run; the aborted review and the waiting triage are not live');
    assert.equal(live.id, 'implementation-10:20');
    assert.deepEqual(liveWaitOf(runs).wait, { kind: 'implementation', id: 'implementation-10:20', dispatchedAt: T('10:20'), outcome: 'queued' });
  });

  test('no live stage run, or runs unknown: no wait', () => {
    assert.equal(liveWaitOf(stageRuns([endedRow('plan', '10:00', '10:30'), silentRow('autopilot', '11:00'), silentRow('custom', '11:05')])), null);
    assert.equal(liveWaitOf(null), null, 'a failed run read stands the wait aside');
    assert.equal(liveWaitOf(undefined), null);
  });

  test('the refusal names kind, outcome and id, says to adopt it, and never mentions force or a look-first step', () => {
    const r = liveWaitRefusal({ kind: 'plan', id: 'p-1', dispatchedAt: T('10:00'), outcome: 'running' }, 'LW-1');
    assert.equal(r.code, STAGE_IN_FLIGHT_CODE);
    assert.deepEqual([r.id, r.kind, r.outcome, r.issueIdentifier], ['p-1', 'plan', 'running', 'LW-1']);
    assert.match(r.error, /plan run running \(dispatch p-1\)/);
    assert.match(r.error, /Adopt and watch/);
    assert.match(r.error, /abort it/);
    assert.doesNotMatch(r.error, /force|look-first|counts as attempted/i);
  });
});

// ── recommend-and-dispatch ────────────────────────────────────────────────────

describe('wired: recommend-and-dispatch sends no stage beside a live one (acceptance 1 and 4)', () => {
  test('W1: a planned leaf with a silent running plan: 409 STAGE_IN_FLIGHT naming it, nothing enqueued, no model call', async () => {
    leaf();
    const asks = selector();
    const items = [];
    const res = await recommendAndDispatch({ rows: [silentRow('plan', '10:00')], items });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, STAGE_IN_FLIGHT_CODE);
    assert.equal(res.body.id, 'plan-10:00');
    assert.equal(res.body.kind, 'plan');
    assert.equal(res.body.outcome, 'running');
    assert.equal(res.body.issueIdentifier, 'LW-1');
    assert.equal(items.length, 0, 'no implementation row beside the live plan');
    assert.equal(asks.length, 0, 'the selector is never asked');
  });

  test('W2: a queued review: the same 409, outcome queued', async () => {
    leaf();
    const asks = selector();
    const items = [];
    const res = await recommendAndDispatch({ live: [queuedRow('review', '10:00')], items });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, STAGE_IN_FLIGHT_CODE);
    assert.deepEqual([res.body.kind, res.body.outcome, res.body.id], ['review', 'queued', 'review-10:00']);
    assert.equal(items.length, 0);
    assert.equal(asks.length, 0);
  });

  test('W12: a same-kind live plan sent days ago, past the duplicate guard\'s window: still 409', async () => {
    leaf();
    const asks = selector('## Reasoning\n→ **plan**\n**Why now:** replan.');
    const items = [];
    const res = await recommendAndDispatch({ rows: [silentRow('plan', '10:00')], items });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.kind, 'plan');
    assert.equal(items.length, 0);
    assert.equal(asks.length, 0);
  });

  test('W3 (guard): only live autopilot and custom rows: they do not hold the ticket, the selector decides', async () => {
    leaf();
    const asks = selector();
    const items = [];
    const res = await recommendAndDispatch({ rows: [silentRow('autopilot', '10:00'), silentRow('custom', '10:05')], live: [queuedRow('autopilot', '10:10')], items });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(asks.length, 1);
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, 'implementation');
  });

  test('W8: a live plan-review beats an exhausted review loop: wait, not blocked', async () => {
    const rc = (at) => ({ user: 'John', createdAt: T(at), body: '### Plan Review Verdict\n\nFinding.\n\n**Verdict: Request Changes.**' });
    setIssue({ identifier: 'LW-1', title: 'Export CSV', description: PLANNED }, { comments: [rc('09:00'), rc('09:30'), rc('10:00')] });
    const asks = selector();
    const items = [];
    const res = await recommendAndDispatch({ rows: [silentRow('plan-review', '10:30')], items });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.kind, 'plan-review');
    assert.equal(items.length, 0, 'no blocked row beside the live plan-review');
    assert.equal(asks.length, 0);
  });

  test('W9: a parent with a live breakdown waits on its own row; the descent never fetches the child', async () => {
    leaf('LW-C');
    const childRef = { id: 'id-LW-C', identifier: 'LW-C', title: 'Export CSV', state: OPEN };
    setIssue({ identifier: 'LW-P', title: 'Export container', description: 'Container body.' }, { children: [childRef] });
    const asks = selector('## Reasoning\nA container.\n→ **defer**\n**DeferTo:** LW-C');
    fetched.length = 0;
    const items = [];
    const res = await recommendAndDispatch({ rows: [silentRow('breakdown', '10:00', 'LW-P')], items }, { issueIdentifier: 'LW-P' });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.issueIdentifier, 'LW-P');
    assert.equal(res.body.id, 'breakdown-10:00');
    assert.ok(!fetched.includes('LW-C') && !fetched.includes('id-LW-C'), `the child is never fetched (fetched: ${fetched.join(', ')})`);
    assert.equal(items.length, 0);
    assert.equal(asks.length, 0);
  });

  test('W10 (guard): a failed run read stands the wait aside; the selector decides', async () => {
    leaf();
    const asks = selector();
    const items = [];
    const res = await recommendAndDispatch({ rows: [silentRow('plan', '10:00')], items, failRead: true });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(asks.length, 1);
    assert.equal(items[0].kind, 'implementation');
  });

  test('W11 (guard): once the wedged row is aborted, the next call dispatches', async () => {
    leaf();
    const asks = selector();
    const abort = { id: 'abort-1', kind: 'custom', abort: true, abortTo: 'plan-10:00', status: 'taken', issueIdentifier: 'LW-1', dispatchedAt: T('11:05'),
      feedback: [{ kind: 'progress', message: '[aborted] cancelled by the orchestrator', timestamp: T('11:06') }] };
    const items = [];
    const res = await recommendAndDispatch({ rows: [silentRow('plan', '10:00'), abort], items });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(asks.length, 1);
    assert.equal(items[0].kind, 'implementation');
  });
});

describe('wired: the operator\'s escapes still dispatch (acceptance 2)', () => {
  test('W4 (guard): the kind override is not refused', async () => {
    leaf();
    const asks = selector();
    const items = [];
    const res = await recommendAndDispatch({ rows: [silentRow('plan', '10:00')], items }, { issueIdentifier: 'LW-1', kind: 'implementation' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(items[0].kind, 'implementation');
    assert.equal(asks.length, 0, 'the override never asks the selector');
  });

  test('W5: force skips the wait on an ordinary ticket: the selector decides, 201', async () => {
    leaf();
    const asks = selector();
    const items = [];
    const res = await recommendAndDispatch({ rows: [silentRow('plan', '10:00')], items }, { issueIdentifier: 'LW-1', force: true });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(asks.length, 1);
    assert.equal(items[0].kind, 'implementation');
    assert.equal(items[0].force, true);
  });

  test('W5: on a look-first ticket, force sends the next step beside the live one; without force it still waits', async () => {
    setIssue({ identifier: 'LW-1', title: 'Export CSV', description: ASKED });
    const asks = selector();
    const rows = [silentRow('survey-task', '10:00')];
    let items = [];
    let res = await recommendAndDispatch({ rows, items }, { issueIdentifier: 'LW-1', force: true });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(items[0].kind, 'survey-place', 'the live survey-task counts as attempted');
    items = [];
    res = await recommendAndDispatch({ rows, items });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, STAGE_IN_FLIGHT_CODE);
    assert.equal(res.body.kind, 'survey-task');
    assert.equal(items.length, 0);
    assert.equal(asks.length, 0, 'the look-first route needs no model either way');
  });

  test('W6: a set followUpTo skips the wait (a beat resumes a session, often the live one)', async () => {
    leaf();
    const asks = selector();
    const items = [];
    const LIVE = '11111111-2222-4333-8444-555555555555';
    const res = await recommendAndDispatch({ rows: [silentRow('plan', '10:00', 'LW-1', { id: LIVE, rootItemId: LIVE })], items }, { issueIdentifier: 'LW-1', followUpTo: LIVE });
    assert.notEqual(res.body?.code, STAGE_IN_FLIGHT_CODE, JSON.stringify(res.body));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(asks.length, 1);
    assert.equal(items[0].followUpTo, LIVE);
  });
});

// ── The read surfaces agree (the lin4392-wait-surfaces ruling) ────────────────

describe('wired W7: every read surface shows the wait, with no prompt and no model call', () => {
  const WAIT = { kind: 'plan', id: 'plan-10:00', dispatchedAt: T('10:00'), outcome: 'running' };
  const rows = [silentRow('plan', '10:00')];

  test('GET /api/proxy/issues/:id/recommend: 200, prompt, recommendedAction and kind null, liveWait naming the row', async () => {
    leaf();
    const asks = selector();
    const res = await request(proxyApp({ rows }), '/api/proxy/issues/LW-1/recommend');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.prompt, null);
    assert.equal(res.body.recommendedAction, null);
    assert.equal(res.body.kind, null);
    assert.deepEqual(res.body.liveWait, WAIT);
    assert.equal(asks.length, 0);
  });

  test('the workspace buffered GET carries liveWait', async () => {
    leaf();
    const asks = selector();
    const res = await request(uiApp({ rows }), '/workspace/acme/api/recommend/LW-1');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.prompt, null);
    assert.deepEqual(res.body.liveWait, WAIT);
    assert.equal(asks.length, 0);
  });

  test('the leaf stream emits the refusal and streams no prompt', async () => {
    leaf();
    const asks = selector();
    const ui = await request(uiApp({ rows }), '/workspace/acme/api/recommend/LW-1/stream');
    assert.equal(ui.status, 200);
    assert.equal(streamedPrompt(ui.text), '');
    assert.match(ui.text, /event: error/);
    assert.match(ui.text, new RegExp(STAGE_IN_FLIGHT_CODE));
    assert.match(ui.text, /plan-10:00/);
    assert.equal(asks.length, 0);
  });

  test('a parent\'s descending stream stops at the parent\'s live row and emits the refusal', async () => {
    leaf('LW-C');
    const childRef = { id: 'id-LW-C', identifier: 'LW-C', title: 'Export CSV', state: OPEN };
    setIssue({ identifier: 'LW-P', title: 'Export container', description: 'Container body.' }, { children: [childRef] });
    const asks = selector('## Reasoning\nA container.\n→ **defer**\n**DeferTo:** LW-C');
    fetched.length = 0;
    const ui = await request(uiApp({ rows: [silentRow('breakdown', '10:00', 'LW-P')] }), '/workspace/acme/api/recommend/LW-P/stream');
    assert.equal(ui.status, 200);
    assert.equal(streamedPrompt(ui.text), '');
    assert.match(ui.text, /event: error/);
    assert.match(ui.text, new RegExp(STAGE_IN_FLIGHT_CODE));
    assert.match(ui.text, /breakdown-10:00/);
    assert.doesNotMatch(ui.text, /did not resolve/);
    assert.ok(!fetched.includes('LW-C') && !fetched.includes('id-LW-C'), 'the child is never fetched');
    assert.equal(asks.length, 0);
  });
});

// ── W13: the instructions ─────────────────────────────────────────────────────

describe('W13: the agent instructions name the shared code, imported, and not the retired one', () => {
  test('rendered: STAGE_IN_FLIGHT and liveWait present; LOOK_FIRST_IN_FLIGHT and lookFirstWait gone', () => {
    const text = buildInstructions({ baseUrl: 'https://example.test', scope: 'readWrite', grants: ['dispatch'] });
    assert.ok(text.includes(`"code": "${STAGE_IN_FLIGHT_CODE}"`), 'the 409 body names the shared code');
    assert.ok(text.includes('"liveWait"'));
    assert.ok(!/LOOK_FIRST_IN_FLIGHT|lookFirstWait/.test(text));
    assert.match(text, /force.*also skips/s, 'the force bullet says it skips the wait, beside its warning');
  });

  test('source: the code is interpolated from lib/run-live-wait.js, never retyped', () => {
    const src = readFileSync(new URL('../../lib/proxy-instructions.js', import.meta.url), 'utf8');
    assert.match(src, /import \{ STAGE_IN_FLIGHT_CODE \} from '\.\/run-live-wait\.js'/);
    assert.equal((src.match(/STAGE_IN_FLIGHT(?!_CODE)/g) || []).length, 0, 'no hand-spelled STAGE_IN_FLIGHT');
  });
});

// ── LIN-4459: a stage parked [pending] ends with its lineage ──────────────────
// Rows here are the real store's: a DispatchQueueStore over the Mango harness, written through
// addItem / takeItem / addFeedback, so the rootItemId, followUpTo, heldWakeFor and entry tags are
// the ones production writes. The stage's own row reads running while parked; its follow-up
// (a ci-wake `custom` row, or a held-wake holder) can end the lineage on a person's word.

describe('LIN-4459: a stage parked [pending] is not live once its lineage ends blocked or skipped', () => {
  const harness = createMangoTmpdir('lin-4459-');
  const U = 'ws-lin-4459';
  const ISSUE = 'LIN-4459';
  let store;

  before(() => harness.connect());
  after(() => harness.close());
  beforeEach(() => {
    const db = harness.freshDb();
    store = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: db.collection('dispatch-history'), ttl: 86400 });
  });

  // A taken stage, optionally parked [pending]; then an optional follow-up of it, taken and
  // ending with `follow.message`, tagged with the stage's lineage as the runner tags its entries.
  async function lineage({ park = '[pending] waiting on a reviewer', follow = null } = {}) {
    const stage = await store.addItem(U, { prompt: 'p', promptName: 'implementation', kind: 'implementation', issueIdentifier: ISSUE, dispatchedBy: 'acct', target: 'cli' });
    await store.takeItem(stage._id, U);
    if (park) await store.addFeedback(stage._id, U, { message: park }, null);
    if (follow) {
      const row = await store.addItem(U, {
        prompt: 'f', promptName: follow.kind, kind: follow.kind, issueIdentifier: ISSUE, dispatchedBy: 'acct', target: 'cli',
        followUpTo: stage._id, rootItemId: stage._id, ...(follow.heldWakeFor ? { heldWakeFor: stage._id } : {})
      });
      await store.takeItem(row._id, U);
      await store.addFeedback(row._id, U, { message: follow.message, rootItemId: stage._id }, null);
    }
    return stage._id;
  }

  const runsOf = async () => (await loadRecentRuns(store, U, ISSUE)).allRuns;
  const stageOf = (runs, id) => runs.find(r => r.id === id);

  test('LIN-4459 witness (blocked): a parked stage whose ci-wake follow-up ends [blocked] is not live', async () => {
    const stage = await lineage({ follow: { kind: 'custom', message: '[blocked] need a human' } });
    const runs = await runsOf();
    assert.equal(stageOf(runs, stage).outcome, WAITING_ON_A_PERSON, JSON.stringify(runs));
    assert.equal(liveWaitOf(runs), null, 'the ticket does not wait on a stage its lineage ended');
  });

  test('LIN-4459 witness (skipped): a parked stage whose held-wake holder ends [skipped] is not live', async () => {
    const stage = await lineage({ follow: { kind: 'leftover', message: '[skipped] the runner refused a cascade', heldWakeFor: true } });
    const runs = await runsOf();
    assert.equal(stageOf(runs, stage).outcome, 'skipped', JSON.stringify(runs));
    assert.equal(liveWaitOf(runs), null);
  });

  test('control: a parked stage whose follow-up is parked too stays live, and the wait names it', async () => {
    const stage = await lineage({ follow: { kind: 'custom', message: '[pending] still waiting on the PR' } });
    const runs = await runsOf();
    assert.equal(stageOf(runs, stage).outcome, RUNNING);
    assert.equal(liveWaitOf(runs).wait.id, stage);
  });

  test('control: a parked stage with no follow-up stays live', async () => {
    const stage = await lineage({});
    assert.equal(liveWaitOf(await runsOf()).wait.id, stage);
  });

  test('control: a stage NOT parked is judged by its own row only, as before (a follow-up block does not end it)', async () => {
    const stage = await lineage({ park: null, follow: { kind: 'custom', message: '[blocked] need a human' } });
    assert.equal(liveWaitOf(await runsOf()).wait.id, stage);
  });
});

describe('LIN-4459: the live-stage wait is defined once, in lib/run-live-wait.js', () => {
  const NAMES = ['liveWaitOf', 'liveWaitRefusal', 'STAGE_IN_FLIGHT_CODE', 'newestLiveRun', 'isLiveRun'];
  const SCANNED = ['lib', 'routes', 'tests', 'scripts'];
  const files = (dir) => readdirSync(new URL(`../../${dir}`, import.meta.url), { recursive: true })
    .filter(f => /\.(m?js)$/.test(f))
    .map(f => `${dir}/${f}`);
  const sources = [...SCANNED.flatMap(files), 'server.js'].map(path => [path, readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')]);

  test('census: each name is defined (exported) in exactly one file, lib/run-live-wait.js', () => {
    for (const name of NAMES) {
      const definers = sources.filter(([, src]) => new RegExp(`export\\s+(const|function)\\s+${name}\\b`).test(src)).map(([path]) => path);
      assert.deepEqual(definers, ['lib/run-live-wait.js'], `${name} is defined in ${definers.join(', ')}`);
    }
  });

  test('census: the retired module is spelled nowhere in code, tests or the server entry', () => {
    // This file names the retired path in the census itself, so it is the one file left out.
    const hits = sources.filter(([path, src]) => path !== 'tests/unit/lin-4392-live-stage-wait.test.js' && src.includes('recommendation-live-wait')).map(([path]) => path);
    assert.deepEqual(hits, []);
  });
});
