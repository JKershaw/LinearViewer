/**
 * LIN-4370 (LIN-4346 piece 4): code runs the look-first sequence (survey-task, then
 * survey-place, then scoping) at both recommendation seams.
 *
 * Witnesses, in the ticket's order:
 *   - the step choice: empty trail → survey-task; with its comment → survey-place; with both →
 *     scoping; a "Before you start" filing comment and no runs → survey-task;
 *   - each step attempted once: an ended Survey run with no comment moves on; a scoping run on
 *     record (ended with no record, queued, running, waiting) → the route returns nothing;
 *   - the hold: a person's comment after a Survey run holds until a run DISPATCHED after it; a
 *     comment posted mid-run still holds once that run ends; a Survey's own headed comment and a
 *     headed size ruling never hold;
 *   - every off-switch, and a resolved blocker that is not one; a run that ended `done` with an
 *     open `DECISION:` does not hold the route (verdict note 1: the engineering choice);
 *   - opposite Survey verdicts give the same route (advice, not a gate);
 *   - a pending record plus an answered ruling: the facts line and scoping's `when`;
 *   - the LIN-4348 shape gets scoping once nothing holds it;
 *   - parity across both seams, recommend-and-dispatch dispatching the code-routed step with no
 *     model call, the Survey reading by kind in GET /issues/{id}/cost, and the trace naming the
 *     route;
 *   - the LIN-4369 handoff: a scoping run's final message with builder notes never reaches the
 *     prompt of the stage after it, while the size record does.
 *
 * Run with: node --test tests/unit/lin-4370-look-first-route.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { lookFirstStep, lookFirstOff, holdingComment, isSurveyComment, LOOK_FIRST_STEPS } from '../../lib/recommendation-look-first.js';
import { getRecommendation, getRecommendationStream, setFetchImpl, setPromptTraceRecorder, buildSelectorArgs } from '../../lib/openrouter.js';
import { generatePrompt, PROMPT_TEMPLATES, deriveDispatchKind } from '../../lib/prompt-templates.js';
import { SURVEY_HEADINGS } from '../../lib/prompt-template-defs.js';
import { sealAsAsked } from '../../lib/as-asked.js';
import { stageRuns } from '../../lib/recent-runs.js';
import { buildRouterPrompt } from '../../lib/stage-router.js';
import { buildBriefMessages } from '../../lib/brief.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { stubLineageIdentity } from '../fixtures/lineage-identity.js';
import { PromptTraceStore } from '../../lib/prompt-trace-store.js';
import { NO_REQUEST_RECORDS, withDefaults } from '../fixtures/request-usage-loader.js';

afterEach(() => { setFetchImpl(null); setPromptTraceRecorder(null); });

const OPEN = { name: 'Todo', type: 'unstarted' };
const ASKED = sealAsAsked('Make the export button download a CSV.');
const RECORD = (decidedBy = 'the standing policy') => `\n\n## Size of the move\n\n**Size:** just the task\n**Why:** the export only needs the download, and nothing nearby binds on it.\n**Cuts:** none\n**Decided by:** ${decidedBy}`;
const leaf = (over = {}) => ({ identifier: 'T-1', title: 'Export CSV', description: ASKED, state: OPEN, labels: [], ...over });

const T = (hm) => `2026-11-08T${hm}:00.000Z`;
const comment = (at, body) => ({ user: 'John', createdAt: T(at), body });
const surveyTask = (at, verdict = 'Just drill: the change is small.') => comment(at, `${SURVEY_HEADINGS['survey-task']}: T-1 @ abc123def\n\n${verdict}`);
const surveyPlace = (at, verdict = 'The place is fine.') => comment(at, `${SURVEY_HEADINGS['survey-place']}: T-1 @ abc123def\n\n${verdict}`);
const person = (at, body = 'Hold this until the auth change lands.') => comment(at, body);
const sizeRuling = (at) => comment(at, "## Size of the move (the person's call)\n\nJust the task, please.");
// A run fact as loadRecentRuns' allRuns carries it.
const run = (stage, dispatched, outcome = 'done', ended = dispatched) => ({ stage, at: T(outcome === 'queued' || outcome === 'running' ? dispatched : ended), outcome, dispatchedAt: T(dispatched) });
const ctx = (comments = [], allRuns = [], over = {}) => ({ parent: null, siblings: [], project: null, children: [], comments, focusedChild: null, attachments: [], runs: [], allRuns, ...over });
const stepOf = (issue, context) => lookFirstStep(issue, context)?.step ?? null;

describe('step choice: survey-task, then survey-place, then scoping, each once', () => {
  test('an unsized leaf with an empty trail gets survey-task; with that comment, survey-place; with both, scoping', () => {
    assert.deepEqual(LOOK_FIRST_STEPS, ['survey-task', 'survey-place', 'scoping']);
    assert.equal(stepOf(leaf(), ctx()), 'survey-task');
    assert.equal(stepOf(leaf(), ctx([surveyTask('10:00')])), 'survey-place');
    assert.equal(stepOf(leaf(), ctx([surveyTask('10:00'), surveyPlace('10:30')])), 'scoping');
  });

  test('a "Before you start" comment and no runs gets survey-task (the LIN-4347/4350 shape)', () => {
    const filing = person('09:00', 'Before you start: read the area notes and LIN-4252 first.');
    assert.equal(stepOf(leaf(), ctx([filing])), 'survey-task');
    // Filing comments stay filing context once the sequence has started.
    assert.equal(stepOf(leaf(), ctx([filing, surveyTask('10:00')], [run('survey-task', '09:30')])), 'survey-place');
  });

  test('an ended survey-task run with no comment moves on, and is not sent again', () => {
    for (const outcome of ['done', 'failed', 'aborted', 'closed']) {
      assert.equal(stepOf(leaf(), ctx([], [run('survey-task', '10:00', outcome, '10:20')])), 'survey-place', outcome);
    }
  });

  test('a scoping run on record, whatever its outcome, and no record: the route returns nothing (falls through once)', () => {
    const surveys = [surveyTask('10:00'), surveyPlace('10:30')];
    for (const outcome of ['done', 'failed', 'queued', 'running']) {
      const runs = [run('survey-task', '09:50'), run('survey-place', '10:20'), run('scoping', '11:00', outcome, '11:20')];
      assert.equal(lookFirstStep(leaf(), ctx(surveys, runs)), null, outcome);
      assert.equal(lookFirstOff(leaf(), ctx(surveys, runs)), null, `${outcome}: the route applies, every step is attempted`);
    }
    // Waiting: the route is off before the step choice (the newest run waits on a person).
    const waiting = [run('survey-task', '09:50'), run('scoping', '11:00', 'waiting on a person', '11:20')];
    assert.equal(lookFirstStep(leaf(), ctx(surveys, waiting)), null);
  });

  test('Survey comments that say opposite things give the same route (advice, not a gate)', () => {
    const wrong = [surveyTask('10:00', 'This is the wrong work: the export belongs elsewhere.'), surveyPlace('10:30', 'Rebuild the whole area first.')];
    const drill = [surveyTask('10:00', 'Just drill.'), surveyPlace('10:30', 'Nothing to tidy.')];
    assert.equal(stepOf(leaf(), ctx(wrong)), 'scoping');
    assert.equal(stepOf(leaf(), ctx(drill)), 'scoping');
  });

  test('isSurveyComment reads the heading constant both Surveys post under, and only it', () => {
    assert.ok(isSurveyComment(surveyTask('10:00').body, 'survey-task'));
    assert.ok(!isSurveyComment(surveyTask('10:00').body, 'survey-place'));
    assert.ok(!isSurveyComment(`${SURVEY_HEADINGS['survey-task']}x: T-1`, 'survey-task'), 'a longer heading is another heading');
    assert.ok(!isSurveyComment('Survey open-0 looks fine', 'survey-task'), 'prose naming it is not the report');
  });
});

describe('the hold: a person\'s word after work started outranks the sequence', () => {
  test('a person\'s comment after a Survey run, with no later run, turns the route off; a later dispatched run releases it', () => {
    const comments = [surveyTask('10:00'), person('10:30')];
    const before = [run('survey-task', '09:40', 'done', '10:00')];
    assert.equal(stepOf(leaf(), ctx(comments, before)), null);
    assert.equal(lookFirstOff(leaf(), ctx(comments, before)), "a person's comment holds it");
    const after = [...before, run('research', '11:00', 'done', '11:30')];
    assert.equal(stepOf(leaf(), ctx(comments, after)), 'survey-place', 'resumes once a later run is dispatched');
  });

  test('a comment posted mid-run, then that run ends: still held (dispatch time, not end time)', () => {
    const comments = [person('10:10')];
    const midRun = [run('survey-task', '10:00', 'done', '10:30')];
    assert.equal(stepOf(leaf(), ctx(comments, midRun)), null);
    assert.ok(holdingComment(comments, midRun));
  });

  test('a Survey\'s own headed comment never holds, and neither does a headed size ruling', () => {
    const runs = [run('survey-task', '09:40', 'done', '10:00')];
    assert.equal(stepOf(leaf(), ctx([surveyTask('10:00')], runs)), 'survey-place');
    assert.equal(stepOf(leaf(), ctx([surveyTask('10:00'), sizeRuling('10:40')], runs)), 'survey-place');
  });

  test('the sequence starts at the earlier of the first run and the first Survey comment', () => {
    // A hand-run Survey with no run on record (comment only) starts it, so a later person's comment holds.
    assert.equal(stepOf(leaf(), ctx([surveyTask('10:00'), person('10:30')])), null);
    // Before the first Survey comment, a person's comment is filing context.
    assert.equal(stepOf(leaf(), ctx([person('09:30'), surveyTask('10:00')])), 'survey-place');
  });
});

describe('when the route is off', () => {
  const asOff = (issue, context, reason) => {
    assert.equal(lookFirstStep(issue, context), null, reason);
    assert.equal(lookFirstOff(issue, context), reason);
  };

  test('a plan, a PR, a size record, children, no As-asked block, completed or canceled, an open blocker, a waiting run, unknown runs', () => {
    asOff(leaf({ description: `${ASKED}\n\n## Implementation Plan\n\nThe plan.` }), ctx(), 'has a plan');
    asOff(leaf(), ctx([comment('10:00', '## Plan\n\nThe plan in a comment.')]), 'has a plan');
    asOff(leaf(), ctx([comment('10:00', 'Landed: https://github.com/o/r/pull/7')]), 'has a PR');
    asOff(leaf({ description: ASKED + RECORD() }), ctx(), 'size recorded');
    asOff(leaf({ description: ASKED + RECORD('pending a ruling') }), ctx(), 'size recorded');
    asOff(leaf(), ctx([], [], { children: [{ identifier: 'T-2', state: OPEN }] }), 'not a leaf');
    asOff(leaf({ description: 'Make the export button download a CSV.' }), ctx(), 'no As-asked block');
    asOff(leaf({ state: { name: 'Done', type: 'completed' } }), ctx(), 'completed or canceled');
    asOff(leaf({ state: { name: 'Canceled', type: 'canceled' } }), ctx(), 'completed or canceled');
    asOff(leaf({ blockedBy: [{ identifier: 'T-9', state: { name: 'In Progress', type: 'started' } }] }), ctx(), 'open blocker');
    asOff(leaf(), ctx([], [run('survey-task', '10:00', 'waiting on a person', '10:20')]), 'newest run waiting on a person');
    asOff(leaf(), ctx([], null), 'runs unknown');
  });

  test('a resolved blocker does not turn it off', () => {
    const issue = leaf({ blockedBy: [{ identifier: 'T-9', state: { name: 'Done', type: 'completed' } }, { identifier: 'T-8', state: { name: 'Canceled', type: 'canceled' } }] });
    assert.equal(stepOf(issue, ctx()), 'survey-task');
  });

  test('a breakdown child whose plan is its parent\'s still gets the sequence', () => {
    const parent = { identifier: 'T-0', description: '## Implementation Plan\n\nThe parent plan.' };
    assert.equal(stepOf(leaf(), ctx([], [], { parent })), 'survey-task');
  });

  test('verdict note 1: a run that ended done with an open DECISION: does not hold the route (the remaining steps proceed once each)', () => {
    const rows = [{ kind: 'research', status: 'taken', dispatchedAt: T('10:00'), feedback: [
      { message: '[working] started', timestamp: T('10:01') },
      { message: '[done] Research posted. DECISION: {"decision_id":"d1","question":"Export to S3 too?","options":[{"id":"y","label":"Yes"},{"id":"n","label":"No"}]}', timestamp: T('10:30') }
    ] }];
    const allRuns = stageRuns(rows);
    assert.equal(allRuns.at(-1).outcome, 'done', 'a DECISION: on the way to done does not read as waiting on a person');
    assert.equal(stepOf(leaf(), ctx([comment('10:30', '## Research\n\nFindings. DECISION: {"decision_id":"d1"}')], allRuns)), 'survey-task');
  });
});

describe('a pending record plus an answered ruling, and the in-flight shapes', () => {
  test('the facts line reads "pending a ruling" and scoping\'s `when` covers the answered ruling', () => {
    const issue = leaf({ description: ASKED + RECORD('pending a ruling') });
    const comments = [surveyTask('10:00'), surveyPlace('10:30'), comment('12:00', 'Err larger on this one.\n\n— Ruling recorded via Harbour')];
    const prompt = buildRouterPrompt(buildSelectorArgs(issue, ctx(comments)));
    assert.match(prompt, /- Size of the move: pending a ruling\n/);
    assert.match(PROMPT_TEMPLATES.scoping.route.when, /has answered the size ruling and the size of the move still reads pending a ruling/);
    assert.match(prompt, /- `scoping`: [^\n]*\n  When: [^\n]*has answered the size ruling and the size of the move still reads pending a ruling/);
    assert.equal(lookFirstStep(issue, ctx(comments)), null, 'the route stands aside: a record exists, so rule 1 and scoping\'s `when` carry it');
  });

  test('the LIN-4348 shape (Survey comments, a headed size comment, no record) is unsized and gets scoping once nothing holds it', () => {
    const runs = [run('survey-task', '09:00', 'done', '09:20'), run('survey-place', '09:30', 'done', '09:50')];
    const comments = [surveyTask('09:20'), surveyPlace('09:50'), sizeRuling('10:00')];
    assert.equal(stepOf(leaf(), ctx(comments, runs)), 'scoping');
    // A later plain person's comment (LIN-4348 had one at 10:15) holds it until another run is dispatched.
    const held = [...comments, person('10:15', 'Also cover the PDF export.')];
    assert.equal(stepOf(leaf(), ctx(held, runs)), null);
    assert.equal(stepOf(leaf(), ctx(held, [...runs, run('research', '11:00', 'done', '11:40')])), 'scoping');
  });
});

describe('both seams take the same code route, with no model call', () => {
  const noModel = () => setFetchImpl(async () => { throw new Error('the model must not be called on the look-first route'); });
  const cases = [
    ['survey-task', ctx()],
    ['survey-place', ctx([surveyTask('10:00')], [run('survey-task', '09:40', 'done', '10:00')])],
    ['scoping', ctx([surveyTask('10:00'), surveyPlace('10:30')], [run('survey-task', '09:40'), run('survey-place', '10:10')])]
  ];

  for (const [step, context] of cases) {
    test(`${step}: getRecommendation and getRecommendationStream give the same step and the generated stage prompt`, async () => {
      noModel();
      const traces = [];
      setPromptTraceRecorder((t) => { traces.push(t); });
      const buffered = await getRecommendation(leaf(), context, { apiKey: 'stub', model: 'x' });
      const events = [];
      const streamed = await getRecommendationStream(leaf(), context, { apiKey: 'stub', model: 'x' }, (type, data) => events.push([type, data]));
      for (const rec of [buffered, streamed]) {
        assert.equal(rec.codeRoute, 'look-first');
        assert.equal(rec.recommendedAction, step);
        assert.equal(deriveDispatchKind(rec.recommendedAction), step);
        assert.equal(rec.prompt, generatePrompt(step, leaf(), context).prompt);
      }
      assert.deepEqual(events.filter(([t]) => t === 'delta').map(([, d]) => d.section), ['reasoning', 'prompt']);
      assert.equal(events.filter(([t]) => t === 'delta').map(([, d]) => d.content)[1], buffered.prompt, 'the stream emits the whole prompt');
      assert.equal(events.at(-1)[0], 'done');
      assert.deepEqual(traces.map(t => [t.codeRoute, t.finishReason]), [['look-first', 'code-route'], ['look-first', 'code-route']], 'the trace names which route fired');
    });
  }

  test('the trace store keeps which code route fired (it used to drop the field)', async () => {
    const store = new PromptTraceStore();
    assert.equal((await store.record({ finishReason: 'code-route', codeRoute: 'look-first' })).codeRoute, 'look-first');
    assert.equal((await store.record({ finishReason: 'stop' })).codeRoute, null, 'a model-routed call names no code route');
  });

  test('the review loop bound still comes first, and keeps its own trace name', async () => {
    noModel();
    const rc = (at) => comment(at, '### Plan Review Verdict\n\nFinding.\n\n**Verdict: Request Changes.**');
    const rec = await getRecommendation(leaf(), ctx([rc('10:00'), rc('11:00'), rc('12:00')]), { apiKey: 'stub', model: 'x' });
    assert.equal(rec.codeRoute, 'blocked');
  });

  test('with the route off, the model is asked as before', async () => {
    const calls = [];
    setFetchImpl(async (url, opts = {}) => {
      calls.push(1);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '## Reasoning\n→ **plan**' }, finish_reason: 'stop' }], usage: { completion_tokens: 3 } }) };
    });
    const rec = await getRecommendation(leaf({ description: ASKED + RECORD() }), ctx(), { apiKey: 'stub', model: 'x' });
    assert.equal(calls.length, 1);
    assert.equal(rec.codeRoute, undefined);
    assert.equal(rec.recommendedAction, 'plan');
  });
});

// ── Wired: recommend-and-dispatch, the UI stream and the cost read ─────────────

const PROVIDER = 'lin4370-look-first-fake';
const ISSUES = {};
registerProvider({
  name: PROVIDER,
  ui: { write: true, comments: true, estimates: false, subtasks: true, displayName: 'Linear' },
  supports: () => true,
  async fetchRecommendationContext(_scope, id) { return ISSUES[id]; },
  async fetchIssueContext(_scope, id) { return ISSUES[id]; }
});
const setIssue = (issue, comments = []) => {
  const c = { issue: { id: `id-${issue.identifier}`, url: `https://example.test/${issue.identifier}`, createdAt: T('08:00'), ...issue }, parent: null, siblings: [], project: null, children: [], comments, focusedChild: null, attachments: [] };
  ISSUES[issue.identifier] = c;
  ISSUES[c.issue.id] = c;
};

const runStore = (rows) => ({
  listItems: async () => [],
  listHistory: async (urlKey, { issueIdentifier } = {}) => ({ items: rows.filter(r => r.issueIdentifier === issueIdentifier), total: rows.length })
});

function proxyApp({ rows = [], items = [] } = {}) {
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
      ...runStore(rows)
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }), checkRun: async () => ({ allowed: true, runsUsed: 0, limit: 10, remaining: 10, resetsAt: null }) }
  }));
  return app;
}

function uiApp({ rows = [] } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: req.params.urlKey, provider: PROVIDER, accessToken: 'ws-token' }; req.session = { openRouterApiKey: 'sk-test', features: {} }; next(); },
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    getOpenRouterSource: () => null,
    userPreferencesStore: {}, customPromptsStore: {}, recapCacheStore: {}, briefCacheStore: {}, reportHistoryStore: {}, agentStatusStore: {}, promptTraceStore: {},
    dispatchQueueStore: runStore(rows)
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

const doneRow = (kind, dispatched, ended, message = '[done] finished', over = {}) => ({
  id: `${kind}-${dispatched}`, kind, status: 'taken', issueIdentifier: 'LF-1', dispatchedAt: T(dispatched), rootItemId: `${kind}-${dispatched}`,
  feedback: [{ kind: 'progress', message: '[working] started', timestamp: T(dispatched) }, { kind: 'progress', message, timestamp: T(ended) }], ...over
});

describe('wired: recommend-and-dispatch dispatches the code-routed step, the UI stream shows the same one', () => {
  const noModel = () => setFetchImpl(async () => { throw new Error('the model must not be called on the look-first route'); });

  test('a fresh ticket: survey-task is dispatched with no model call, and the UI stream streams the same prompt', async () => {
    noModel();
    setIssue(leaf({ identifier: 'LF-1' }));
    const items = [];
    const { status, body } = await request(proxyApp({ items }), '/api/proxy/recommend-and-dispatch', { method: 'POST', body: { issueIdentifier: 'LF-1' } });
    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(body.kind, 'survey-task');
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, 'survey-task');
    const expected = generatePrompt('survey-task', ISSUES['LF-1'].issue, ISSUES['LF-1']).prompt;
    assert.ok(items[0].prompt.startsWith(expected.slice(0, 200)), 'the dispatched body is the survey-task prompt');

    const ui = await request(uiApp(), '/workspace/acme/api/recommend/LF-1/stream');
    assert.equal(ui.status, 200);
    assert.equal(streamedPrompt(ui.text), expected);
  });

  test('after an ended survey-task run with no comment, survey-place is dispatched; after both Surveys, scoping', async () => {
    noModel();
    setIssue(leaf({ identifier: 'LF-1' }));
    let items = [];
    let res = await request(proxyApp({ rows: [doneRow('survey-task', '10:00', '10:20')], items }), '/api/proxy/recommend-and-dispatch', { method: 'POST', body: { issueIdentifier: 'LF-1' } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(items[0].kind, 'survey-place');

    setIssue(leaf({ identifier: 'LF-1' }), [surveyTask('10:20'), surveyPlace('10:50')]);
    items = [];
    res = await request(proxyApp({ rows: [doneRow('survey-task', '10:00', '10:20'), doneRow('survey-place', '10:30', '10:50')], items }), '/api/proxy/recommend-and-dispatch', { method: 'POST', body: { issueIdentifier: 'LF-1' } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(items[0].kind, 'scoping');
  });

  test('a code-routed Survey dispatch shows by kind in GET /issues/{id}/cost', async () => {
    noModel();
    setIssue(leaf({ identifier: 'LF-1' }));
    const items = [];
    await request(proxyApp({ items }), '/api/proxy/recommend-and-dispatch', { method: 'POST', body: { issueIdentifier: 'LF-1' } });
    const [dispatched] = items;
    const ran = { ...dispatched, status: 'taken', rootItemId: dispatched.id, dispatchedAt: new Date(Date.now() - 3600000).toISOString(),
      feedback: [{ kind: 'usage', timestamp: new Date(Date.now() - 1800000).toISOString(), message: '[usage] {"model":"anthropic/claude-sonnet-5","costUsd":0.8}' }] };
    const { status, body } = await request(proxyApp({ rows: [ran] }), '/api/proxy/issues/LF-1/cost');
    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual(body.workerSessions.map(s => s.kind), ['survey-task']);
  });
});

describe('LIN-4369 handoff: scoping\'s final message never reaches the stage after it; the size record does', () => {
  const NOTES = 'NOTES FOR THE BUILDER: sweep these names in lib/export.js line 42, rename exportCsv to downloadCsv, and pin this test rule';

  test('the routing prompt and the dispatched prompt after scoping carry the record, not the final report', async () => {
    const description = ASKED + RECORD();
    setIssue(leaf({ identifier: 'LF-1', description }), [surveyTask('10:20'), surveyPlace('10:50')]);
    const rows = [
      doneRow('survey-task', '10:00', '10:20'),
      doneRow('survey-place', '10:30', '10:50'),
      doneRow('scoping', '11:00', '11:30', `[done] Recorded the size. ${NOTES}`)
    ];
    const seen = [];
    setFetchImpl(async (url, opts = {}) => {
      seen.push(JSON.parse(opts.body).messages[0].content);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '## Reasoning\n→ **plan**\n**Why now:** sized.' }, finish_reason: 'stop' }], usage: { completion_tokens: 3 } }) };
    });
    const items = [];
    const res = await request(proxyApp({ rows, items }), '/api/proxy/recommend-and-dispatch', { method: 'POST', body: { issueIdentifier: 'LF-1' } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(seen.length, 1, 'sized: the route stands aside and the selector decides');
    assert.equal(items[0].kind, 'plan');
    for (const [where, text] of [['routing prompt', seen[0]], ['dispatched prompt', items[0].prompt]]) {
      assert.ok(!text.includes('NOTES FOR THE BUILDER'), `${where} excludes scoping's final message`);
      assert.ok(!text.includes('exportCsv'), `${where} excludes its code names`);
    }
    // The next recommendation reads the record: in the ticket it sees and as a fact.
    assert.ok(seen[0].includes('**Size:** just the task'), 'the routing prompt carries the size record');
    assert.match(seen[0], /- Size of the move: chosen just the task \(by the standing policy\)\n/);
    assert.match(seen[0], /- scoping: done, 2026-11-08 11:30/, 'the selector sees that scoping ran, as a fact, not what it said');
    // A stage prompt never copies the description (it says to read the ticket, and points at the brief); the
    // brief it starts from is built from the ticket and its comments, so it carries the record and no run's message.
    assert.match(items[0].prompt, /does not restate LF-1's description/);
    assert.match(items[0].prompt, /Start from the distilled brief: GET [^\n]*\/api\/proxy\/brief\/LF-1/);
    const briefInput = buildBriefMessages(ISSUES['LF-1'].issue, { ...ISSUES['LF-1'], runs: stageRuns(rows), allRuns: stageRuns(rows) }).map(m => m.content).join('\n');
    assert.ok(briefInput.includes('**Size:** just the task'), 'the brief reads the size record');
    assert.ok(!briefInput.includes('NOTES FOR THE BUILDER'), 'the brief never reads a run\'s message');
  });

  test('a scoping run that wrote no record falls through to the selector once, and its notes stay out too', async () => {
    setIssue(leaf({ identifier: 'LF-1' }), [surveyTask('10:20'), surveyPlace('10:50')]);
    const rows = [doneRow('survey-task', '10:00', '10:20'), doneRow('survey-place', '10:30', '10:50'), doneRow('scoping', '11:00', '11:30', `[done] Every write refused. ${NOTES}`)];
    const seen = [];
    setFetchImpl(async (url, opts = {}) => {
      seen.push(JSON.parse(opts.body).messages[0].content);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '## Reasoning\n→ **research**\n**Why now:** unsized.' }, finish_reason: 'stop' }], usage: { completion_tokens: 3 } }) };
    });
    const items = [];
    await request(proxyApp({ rows, items }), '/api/proxy/recommend-and-dispatch', { method: 'POST', body: { issueIdentifier: 'LF-1' } });
    assert.equal(seen.length, 1, 'no second scoping: the selector is asked');
    assert.equal(items[0].kind, 'research');
    assert.ok(!seen[0].includes('NOTES FOR THE BUILDER') && !items[0].prompt.includes('NOTES FOR THE BUILDER'));
  });
});
