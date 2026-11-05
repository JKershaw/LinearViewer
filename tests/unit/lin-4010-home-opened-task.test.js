/**
 * LIN-4010: Home's opened task leads with its state and one clear next run.
 *
 * Server rules (one owner each): Plan review is a usual stage after Plan, so Home never offers Build over a review that
 * is due; a waiting task is a ruling or a park (`waitingFor`), and only a ruling needs you; a container's row and its
 * opened task run on the one subtask the selector defers to (`focus`), narrowed to where the selector would descend;
 * the state line and the offered step's reason come from the server.
 *
 * Client witnesses (the component, run in a sandbox like the other prompt-section tests): one run box holds the step,
 * why it is next, Run, then what it runs on; a running task names its state once, with Stop beside Watch; a new user's
 * Home says no "idle" or "No sessions yet"; a container's Run dispatches the subtask, and its opened task names it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { USUAL_STAGES, SPINE } from '../../lib/run-view.js';
import { buildRowStates, buildTaskPageModel, nextStepOf, waitingForOf, sessionSummaryOf } from '../../lib/task-page-loader.js';
import { buildInProgressCountParts } from '../../lib/task-board-view.js';
import { renderHomeStatus } from '../../lib/render-task-page.js';
import { loadWorld } from './helpers/prompt-section-world.js';

// LIN-4016: Home's pill reads the task's decided state. This helper reads the task's OWN facts; it equals the gather that
// `/state` sends (lib/home-row-states.js) only for a leaf, which is every fixture that uses it. A container's state is
// witnessed through the route (lin-4070-state-reads-gatherer.test.js), not here.
const stateOf = (model) => taskStateOf(taskFactsOf({ model, identifier: model.identifier, now: NOW }));
import { renderPage } from '../../lib/render.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
import { escapeHtml } from '../../lib/utils/html.js';
import { needsAPerson, taskStateOf, taskFactsOf } from '../../lib/task-state.js';
import { serverSessions, serverRow } from '../fixtures/task-decision.js';
import { stateBodyOf, stateIssue } from '../fixtures/state-route.js';

const NOW = new Date('2026-10-29T10:06:00.000Z');

// ─── fixtures ────────────────────────────────────────────────────────────────

function loop(over = {}) {
  return {
    loopId: 'l1', lineageId: 'l1', issueIdentifier: 'LIN-50', kind: 'implementation', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'running',
    dispatchedAt: '2026-10-29T10:00:00.000Z', takenAt: '2026-10-29T10:01:00.000Z', resolvedAt: '2026-10-29T10:01:00.000Z',
    terminalStatus: null, terminalCompletedAt: null, wakeMarker: 'pending', waitingMessage: null,
    feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null, bookkeeping: null,
    ...over,
  };
}
// A session that finished well: its stage is done and it is not running.
const doneLoop = (kind, over = {}) => loop({
  kind, agentState: 'done', terminalStatus: 'done', terminalCompletedAt: '2026-10-29T10:03:00.000Z',
  resolvedAt: '2026-10-29T10:03:00.000Z', historyStatus: 'resolved', ...over,
});
const failedLoop = (kind, over = {}) => loop({
  kind, agentState: 'failed', terminalStatus: 'failed', terminalCompletedAt: '2026-10-29T10:02:00.000Z',
  resolvedAt: '2026-10-29T10:02:00.000Z', historyStatus: 'resolved', ...over,
});
// A waiting session whose question is an open ruling (a structured decision, not a bare park).
const rulingLoop = (over = {}) => loop({
  wakeMarker: 'blocked', waitingMessage: '[blocked] which way?',
  feedback: [{ message: '[blocked] which way?', timestamp: '2026-10-29T10:05:00.000Z' }],
  decision: { decision_id: 'd-1', question: 'Which way?' }, decisionCase: [], answeredDecisions: [], withdrawal: null, ...over,
});
// A waiting session with no structured question: a park.
const parkLoop = (over = {}) => loop({
  loopId: 'park-1', lineageId: 'park-1',
  wakeMarker: 'blocked', waitingMessage: '[blocked] waiting on the vendor',
  feedback: [{ message: '[blocked] waiting on the vendor', timestamp: '2026-10-29T10:05:00.000Z' }], ...over,
});

const node = (identifier, stateType = 'started', children = [], extra = {}) => ({
  issue: { id: `id-${identifier}`, identifier, title: `Title ${identifier}`, state: { name: stateType, type: stateType }, ...extra },
  children,
  depth: 0,
});

function states({ roots, loops = {}, sessionsVisible = true }) {
  return buildRowStates({
    roots,
    loopsByIdentifier: new Map(Object.entries(loops)),
    enrichLoop,
    deriveSessionWaiting,
    now: NOW,
    sessionsVisible,
  });
}

// ─── the usual stages ────────────────────────────────────────────────────────

describe('LIN-4010 — Plan review is a usual stage, after Plan', () => {
  const sess = (kind, state, over = {}) => ({
    loopId: `${kind}-${state}`, kind, label: kind, state, open: false, endedAt: '2026-10-29T13:30:00.000Z',
    message: null, links: [], loop: { takenAt: '2026-10-29T13:00:00.000Z', dispatchedAt: '2026-10-29T13:00:00.000Z' }, ...over,
  });

  test('the usual order is research, plan, plan-review, then SPINE from Build on; SPINE itself is unchanged', () => {
    assert.deepEqual(USUAL_STAGES, ['research', 'plan', 'plan-review', 'implementation', 'review', 'close-out']);
    assert.deepEqual(SPINE, ['plan', 'implementation', 'review', 'close-out']);
  });

  // LIN-4103 beat 2: after Plan nothing has failed and nothing was undone, so no step is offered (no guessed Plan review).
  test('after Plan, Home offers nothing: no guessed Plan review (LIN-4103)', () => {
    assert.equal(nextStepOf([sess('plan', 'done')], 'started'), null);
  });

  test('a plan review that failed is offered again', () => {
    assert.deepEqual(nextStepOf([sess('plan', 'done'), sess('plan-review', 'failed')], 'started'),
      { kind: 'plan-review', label: 'Plan review', why: 'again', failed: true, reason: 'failed last time, so it runs again' });
  });

  // LIN-4103 beat 2: a succeeded plan review offers no guessed Build; nothing failed and nothing was undone.
  test('a plan review that succeeded offers nothing: no guessed Build (LIN-4103)', () => {
    assert.equal(nextStepOf([sess('plan', 'done'), sess('plan-review', 'done')], 'started'), null);
  });

  test('the offer says why, in the server\'s words', () => {
    assert.equal(nextStepOf([sess('plan', 'done')], 'started'), null, 'no offer after Plan, so no reason to give (LIN-4103)');
  });
});

// ─── ruling or park ──────────────────────────────────────────────────────────

describe('LIN-4010 — a waiting task is a ruling or a park', () => {
  test('a waiting session with an open ruling is "ruling"', () => {
    const model = buildTaskPageModel({ identifier: 'LIN-60', loops: [rulingLoop({ issueIdentifier: 'LIN-60' })], ctx: null, enrichLoop, deriveSessionWaiting, now: NOW });
    assert.equal(stateOf(model).state, 'needs-you', 'the gathered state is the wait');
    assert.equal(model.waitingFor, 'ruling');
  });

  test('a waiting session with no structured question is "parked"', () => {
    const model = buildTaskPageModel({ identifier: 'LIN-61', loops: [parkLoop({ issueIdentifier: 'LIN-61' })], ctx: null, enrichLoop, deriveSessionWaiting, now: NOW });
    assert.equal(stateOf(model).state, 'parked', 'the gathered state is the park');
    assert.equal(model.waitingFor, 'parked');
  });

  test('no waiting session: no waitingFor', () => {
    assert.equal(waitingForOf([{ state: 'running', loopId: 'a' }], new Set()), null);
  });

  test('the row: a ruling needs you, a park reads parked and is not counted in "needs you"', () => {
    const roots = [node('LIN-62'), node('LIN-63')];
    const s = states({ roots, loops: { 'LIN-62': [rulingLoop({ issueIdentifier: 'LIN-62' })], 'LIN-63': [parkLoop({ issueIdentifier: 'LIN-63' })] } });
    assert.equal(needsAPerson(s.get('LIN-62').state), true);
    assert.equal(needsAPerson(s.get('LIN-63').state), false);
    assert.equal(s.get('LIN-63').words, 'parked');
    assert.equal(s.get('LIN-63').tone, 'parked');
    // LIN-4024: the count line counts rulings (one open ruling here) and tasks that run or failed; a park is neither.
    const parts = buildInProgressCountParts(
      [{ projectName: 'P', roots }],
      s,
      { rulingCount: 1 },
    ).map((p) => p.text);
    assert.deepEqual(parts, ['1 waiting on you']);
  });

  test('a failed stage still needs a person, whatever the waiting word', () => {
    const s = states({ roots: [node('LIN-64')], loops: { 'LIN-64': [failedLoop('review', { issueIdentifier: 'LIN-64' })] } });
    assert.equal(needsAPerson(s.get('LIN-64').state), true);
    assert.equal(s.get('LIN-64').tone, 'failed');
  });
});

// ─── containers: the row and the opened task run on the same subtask ─────────

// LIN-4103: a container's row names no subtask and no next step. What the subtasks do (running, failed, needs you) is
// the row's; the step the seam would pick (`parentNextOf`) is still the prompt seed's and the descent's.
describe('LIN-4010 — a container\'s row says what its subtasks do, never a guessed next step (LIN-4103)', () => {
  const child = () => node('LIN-71', 'unstarted');

  test('an open child and nothing of the container\'s own: the row names no subtask and no step', () => {
    const parent = node('LIN-70', 'started', [child()]);
    const s = states({ roots: [parent] });
    assert.equal(s.get('LIN-70').words, null, 'the row does not name LIN-71 or a step on it (LIN-4103)');
    assert.equal(s.get('LIN-70').tone, 'quiet');
  });

  test('the container\'s own landed work with a todo child: the row says nothing, and names no subtask', () => {
    const parent = node('LIN-72', 'started', [child()]);
    const s = states({ roots: [parent], loops: { 'LIN-72': [doneLoop('plan', { issueIdentifier: 'LIN-72' }), doneLoop('implementation', { issueIdentifier: 'LIN-72' })] } });
    assert.equal(s.get('LIN-72').words, null, 'no guessed Review (LIN-4103)');
    assert.doesNotMatch(String(s.get('LIN-72').words), /LIN-71/);
  });

  test('a container whose own stage failed keeps its own failed row, no focus', () => {
    const parent = node('LIN-73', 'started', [child()]);
    const s = states({ roots: [parent], loops: { 'LIN-73': [doneLoop('plan', { issueIdentifier: 'LIN-73' }), failedLoop('plan-review', { issueIdentifier: 'LIN-73' })] } });
    assert.equal(s.get('LIN-73').words, 'Plan review failed');
  });

  test('a container with its own session running has no focus', () => {
    const parent = node('LIN-74', 'started', [child()]);
    const s = states({ roots: [parent], loops: { 'LIN-74': [loop({ issueIdentifier: 'LIN-74', kind: 'plan' })] } });
    assert.match(s.get('LIN-74').words, /^Plan running/);
  });

  test('a container whose children are all finished reads its own tracker state, not a child\'s', () => {
    const parent = node('LIN-75', 'started', [node('LIN-76', 'completed')]);
    const s = states({ roots: [parent] });
    assert.equal(s.get('LIN-75').words, null, 'the row names no subtask, finished or not (LIN-4103)');
  });

  test('a running child names its state on the container row', () => {
    const parent = node('LIN-77', 'started', [node('LIN-78', 'started')]);
    const s = states({ roots: [parent], loops: { 'LIN-78': [loop({ issueIdentifier: 'LIN-78', kind: 'plan' })] } });
    assert.match(s.get('LIN-77').words, /^Plan running/);
    assert.equal(s.get('LIN-77').running, true, 'the count line counts a container whose subtask runs');
  });
});

// ─── the state line ──────────────────────────────────────────────────────────

describe('LIN-4010 — Home\'s state is one line, with no "Harbour:" label', () => {
  // REWRITTEN (LIN-4070): the pill is read from the `/state` body the route sends, not from the model's own facts, so the
  // words a waiting task reads are the server's (the route reads the held set and the stored loops, as in production).
  test('a waiting task reads needs you or parked, by its ruling, in the words /state sends', async () => {
    const ruling = await stateBodyOf({ issues: [stateIssue('LIN-80', 'started')], loops: [rulingLoop({ issueIdentifier: 'LIN-80' })], identifier: 'LIN-80' });
    const park = await stateBodyOf({ issues: [stateIssue('LIN-81', 'started')], loops: [parkLoop({ issueIdentifier: 'LIN-81' })], identifier: 'LIN-81' });
    assert.equal(ruling.body.incomplete, undefined, 'the held set is complete');
    assert.match(ruling.body.homeStatusHtml, /data-testid="home-task-status-pill"[^>]*><span class="status-pill__dot" aria-hidden="true"><\/span>needs you</);
    assert.match(park.body.homeStatusHtml, />parked</);
  });

  test('no "Harbour:" label in Home\'s line; the task page keeps its own status', () => {
    const model = buildTaskPageModel({ identifier: 'LIN-82', loops: [], ctx: null, enrichLoop, deriveSessionWaiting, now: NOW });
    assert.equal(renderHomeStatus(model, { now: NOW, taskState: stateOf(model) }).includes('Harbour:'), false);
  });

  test('sessions.offered carries the reason the box says, for a failed step', () => {
    const model = buildTaskPageModel({ identifier: 'LIN-83', loops: [doneLoop('plan', { issueIdentifier: 'LIN-83' }), failedLoop('plan-review', { issueIdentifier: 'LIN-83' })], ctx: null, enrichLoop, deriveSessionWaiting, now: NOW });
    assert.equal(sessionSummaryOf(model).offered.reason, 'failed last time, so it runs again');
  });

  // LIN-4010 review (finding 1): a running task names its state once, in the running box, so Home's line is left out.
  test('a running task has no Home state line: the running box says it once', () => {
    const model = { status: 'running', sentence: 'Build running for 1s.', sentenceAt: null, sessions: [{ kind: 'implementation', state: 'running' }] };
    assert.equal(renderHomeStatus(model, { now: NOW, taskState: taskStateOf({ running: { words: 'Build running' } }) }), '');
  });

  // LIN-4010 review (finding 2), REWRITTEN (LIN-4106): an idle task's line is the task page's own sentence, the last run said
  // once. The separate "No session running." and the raw "Last:" clause are gone from Home.
  test('an idle task with sessions says the task page\'s sentence on Home; no "No session running." and no raw Last clause', () => {
    const model = {
      status: 'idle', sentence: 'Last run: Plan finished just now · the only run', sentenceAt: '2026-10-29T10:03:00.000Z',
      sessions: [{ kind: 'plan', state: 'done' }], waitingFor: null,
    };
    const html = renderHomeStatus(model, { now: NOW, taskState: taskStateOf({}) });
    assert.match(html, /data-testid="home-task-sentence"[^>]*>Last run: Plan finished just now · the only run</);
    assert.equal(html.includes('No session running'), false);
    assert.equal(html.includes('Last:'), false);
  });

  // LIN-4024 (items 9 and 20): "idle · No sessions yet." led the box and, on a parent with work under it, read as if
  // nothing was happening. The run box's "the next step for this task" is the one statement, so Home has no line here.
  test('an idle task with no sessions has no Home state line: the run box says the next step', () => {
    const model = { status: 'idle', sentence: 'No sessions yet.', sentenceAt: null, sessions: [], waitingFor: null };
    assert.equal(renderHomeStatus(model, { now: NOW, taskState: taskStateOf({}) }), '');
  });

  // LIN-4071 review ledger (M11): the parent's own idle line is withheld by the server when a subtask line (`attention`) is
  // set, and only then. This rule moved from the browser to `renderHomeStatus` in LIN-4071.
  describe('the parent\'s own idle line is withheld when a subtask needs attention (LIN-4024 / LIN-4071)', () => {
    const idleParent = (over = {}) => ({
      status: 'idle', sentence: 'No session running. Last: Plan done just now.', sentenceAt: '2026-10-29T10:03:00.000Z',
      sessions: [{ kind: 'plan', state: 'done' }], waitingFor: null, ...over,
    });
    const attention = { identifier: 'LIN-2', words: 'needs you' };
    const withAttention = { state: 'next', attention };

    test('own idle (no wait, not finished, no failed stage) with an attention line: nothing, the subtask line says it once', () => {
      assert.equal(renderHomeStatus(idleParent(), { now: NOW, taskState: withAttention }), '');
    });

    test('control: the same parent with no attention paints its idle pill', () => {
      assert.match(renderHomeStatus(idleParent(), { now: NOW, taskState: { state: 'next', attention: null } }), /data-testid="home-task-status-pill"[^>]*>.*idle/s);
    });

    test('a failed stage of its own still paints, beside the attention line', () => {
      const html = renderHomeStatus(idleParent({ nextStep: { failed: true } }), { now: NOW, taskState: withAttention });
      assert.match(html, /data-testid="home-task-status-pill"/);
    });

    test('a wait of its own still paints, beside the attention line', () => {
      const html = renderHomeStatus(idleParent({ waitingFor: { kind: 'ruling' } }), { now: NOW, taskState: withAttention });
      assert.match(html, /data-testid="home-task-status-pill"/);
    });
  });
});

// ─── a new user's Home ───────────────────────────────────────────────────────

describe('LIN-4010 — a new user\'s Home shows no "idle" or "No sessions yet"', () => {
  test('a copy-first viewer\'s rows read the tracker alone, and the page has neither words', () => {
    const roots = [node('LIN-90', 'started'), node('LIN-91', 'unstarted')];
    const rowStates = states({ roots, sessionsVisible: false });
    const html = renderPage(
      [{ project: { id: 'proj-1', name: 'Alpha', content: null }, incomplete: roots, completed: [], completedCount: 0 }],
      [{ projectName: 'Alpha', roots }],
      [],
      'Test',
      { urlKey: 'acme', workspace: { urlKey: 'acme', provider: 'linear' }, rowStates, featureFlags: {} },
    );
    assert.doesNotMatch(html, /\bidle\b/, 'no idle on the whole page');
    assert.doesNotMatch(html, /No sessions yet/, 'no "No sessions yet" on the whole page');
  });
});

// ─── the client: the run box, the running box, the container ─────────────────

function loadClient({ stateBody = null, previewBody = null, presetsBody = [], panelHtml = '', container = false } = {}) {
  // LIN-4016: the state body is the server's (its `sessions` carry the decision: queued, busy, action and canStop).
  if (stateBody && stateBody.sessions) stateBody = { ...stateBody, sessions: serverSessions(stateBody.sessions, { container }) };
  const calls = { api: [], dispatch: [], post: [] };
  const window = {
    escapeHtml: (x) => (x == null ? '' : escapeHtml(String(x))),
    stripCodeBlockWrapper: (x) => x,
    renderMarkdown: (x) => String(x == null ? '' : x),
    api: async (url, opts = {}) => {
      calls.api.push(url);
      if (opts.method === 'POST') calls.post.push({ url, body: JSON.parse(opts.body) });
      if (url.includes('/api/task/')) return stateBody;
      if (url.includes('/api/task-mode/')) return { lastCopy: null };
      if (url.includes('/api/dispatch/preview')) return previewBody;
      if (url.includes('/api/dispatch/decision-panel')) return { html: panelHtml, words: null, withoutEffort: [] };
      if (url.includes('/api/dispatch/presets')) return { presets: presetsBody };
      if (url.includes('/api/prompt/')) return { prompt: 'PROMPT', promptName: 'Plan' };
      return { success: true, item: { id: 'd-1' } };
    },
    taskPageHref: ({ identifier }) => `/workspace/acme/task/${identifier}`,
    dispatchPrompt: async (args) => { calls.dispatch.push(args); return { success: true, item: { id: 'd-1' } }; },
    ProxyToggle: { isActive: () => true, setActive() {}, maybeAppend: async (raw) => raw },
    renderDispatchDisclosure: () => '',
    readDispatchExecControls: () => ({ model: null, harness: null }),
    isPinnedToBottom: () => false,
    toast: () => {},
  };
  // The shared client world (tests/unit/helpers/prompt-section-world.js): the fake DOM, the vm, and the container's click and
  // key shims. This suite's own layer is the `window` stubs above.
  const world = loadWorld({ window, scripts: ['prompt-section.js'] });
  return { PromptSection: world.PromptSection, calls, makeContainer: world.makeContainer };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const HOME = {
  // LIN-4104 D2: this file's workspace fills Run to PR (its tests are about that run); the filled rung is pinned in lin-4016.
  filledRung: 'pr',
  urlKey: 'acme', surface: 'home', dispatchEnabled: true, runSetup: false, hasAI: true, aiState: 'ok', isLocalhost: false,
  promptMeta: { plan: 'Plan', implementation: 'implement', research: 'Research', scoping: 'Scoping', review: 'Review', 'plan-review': 'plan-review' },
  stageWords: { plan: 'Plan', implementation: 'Build', research: 'Research', scoping: 'Scoping', review: 'Review', 'plan-review': 'Plan review' },
  defaultPromptKeys: ['look-into', 'research', 'plan', 'implementation'],
  morePromptKeys: ['review', 'scoping', 'plan-review'],
  issue: { id: 'uuid-42', identifier: 'LIN-42', title: 'T', url: '', source: 'linear', stateType: 'started' },
  // LIN-4016: the row's decision record, as the server stamps it.
  row: serverRow({ stateType: 'started' }),
};
// LIN-4103 beat 2: the box's offer is a failed step (a fact), never a guessed "usually next" one.
const PLAN_NEXT = {
  count: 2,
  offered: { kind: 'plan-review', label: 'Plan review', why: 'again', failed: true, reason: 'failed last time, so it runs again' },
  last: { label: 'Plan', state: 'done', at: null }, running: null, busy: false, excluded: [],
};

describe('LIN-4010 — the client: one run box, the state once, a new user\'s line, a container\'s run', () => {
  test('the run box holds the step, why it is next, Run, then what it runs on, in that order', async () => {
    const { PromptSection, makeContainer } = loadClient({
      stateBody: { status: 'idle', live: false, homeStatusHtml: '<p>idle</p>', sessions: PLAN_NEXT },
      previewBody: { kind: 'plan-review', harness: 'claude-code', words: {}, sources: {}, group: null, description: 'Review the plan before anything is built on it.' },
    });
    const c = makeContainer();
    PromptSection.init(c, HOME);
    await flush(); await flush();
    const box = c.innerHTML.slice(c.innerHTML.indexOf('data-testid="opened-task-next-run"'));
    const at = (re) => box.search(re);
    const step = at(/opened-task-step-name[^"]*">Plan review/);
    const why = at(/failed last time, so it runs again/);
    const run = at(/data-testid="opened-task-go"/);
    const runsOn = at(/data-testid="opened-task-runs-on"/);
    assert.ok(step > 0 && why > step && run > why && runsOn > run, `order step ${step}, why ${why}, run ${run}, runs on ${runsOn}`);
    assert.match(box, /opened-task-step-what[^>]*>Review the plan before anything is built on it\./, 'the step says what it does');
  });

  test('a stage word is used for Another step, not the template name', async () => {
    const { PromptSection, makeContainer } = loadClient({ stateBody: { status: 'idle', live: false, sessions: PLAN_NEXT } });
    const c = makeContainer();
    PromptSection.init(c, { ...HOME });
    await flush();
    await c.click({ action: 'run-another' });
    await flush();
    await flush();
    assert.match(c.innerHTML, /data-testid="run-another-item"[^>]*>Build</);
    assert.doesNotMatch(c.innerHTML, />implement</);
  });

  test('a running task names its state once: the running box, Stop beside Watch, and no "Last" line', async () => {
    const running = { loopId: 'l1', kind: 'implementation', label: 'Build', state: 'running', since: '2026-10-29T10:00:00.000Z', target: 'cli' };
    const { PromptSection, makeContainer } = loadClient({
      stateBody: { status: 'running', live: true, homeStatusHtml: '<p>STATE-LINE</p>', sessions: { count: 2, next: { kind: 'review', label: 'Review' }, last: { label: 'Build', state: 'running', at: null }, running, offered: null, busy: true, excluded: [] } },
    });
    const c = makeContainer();
    PromptSection.init(c, HOME);
    await flush(); await flush();
    assert.match(c.innerHTML, /data-testid="run-stop"/, 'Stop is in the box');
    assert.match(c.innerHTML, /data-testid="opened-task-watch"/, 'Watch is in the box');
    assert.equal((c.innerHTML.match(/Running now/g) || []).length, 1);
    assert.equal(c.innerHTML.includes('opened-task-last'), false, 'no "Last" line while running');
    assert.equal(c.innerHTML.includes('Build running'), false, 'the state sentence is not restated');
  });

  test('a new user\'s opened task says the tracker word and no session words', async () => {
    const { PromptSection, makeContainer } = loadClient({ stateBody: { status: 'idle', live: false, homeStatusHtml: '<p>No sessions yet.</p>', sessions: { count: 0 } } });
    const c = makeContainer();
    PromptSection.init(c, { ...HOME, dispatchEnabled: false });
    await flush(); await flush();
    assert.match(c.innerHTML, /data-testid="opened-task-copy-state">In progress · No prompt copied from here yet\./);
    assert.equal(/idle|No sessions yet/.test(c.innerHTML), false);
  });

  // LIN-4024 (John, 29 Oct): a container's opened task runs on the container. Its one action is Run to PR, which starts
  // the autopilot on it; no subtask's stage is offered, read, or named from Home.
  test('a container: no stage step is offered, the state read is the container\'s own, and its one action is Run to PR', async () => {
    const { PromptSection, calls, makeContainer } = loadClient({
      container: true,
      stateBody: { status: 'idle', live: false, homeStatusHtml: '<p>idle</p>', sessions: { ...PLAN_NEXT, offered: { kind: 'research', label: 'Research', why: 'usual', failed: false, reason: 'the next step for this task' }, next: { kind: 'research', label: 'Research' } } },
      previewBody: { kind: 'research', harness: 'claude-code', words: {}, sources: {}, group: null },
    });
    const c = makeContainer();
    PromptSection.init(c, { ...HOME, row: serverRow({ container: true }) });
    await flush(); await flush();
    assert.ok(calls.api.some((u) => u.includes('/api/task/LIN-42/state?issueId=uuid-42')), 'the state read is the container\'s');
    assert.equal(calls.api.some((u) => u.includes('/api/task/LIN-99/')), false, 'no subtask is read');
    assert.equal(c.innerHTML.includes('opened-task-on'), false, 'the box names no subtask it runs on');
    assert.match(c.innerHTML, /data-action="go"[^>]*>Run to PR</, 'the one main action is Run to PR');
    assert.equal(c.innerHTML.includes('Run Research'), false, 'no stage step is the main action');
  });

  // LIN-4024 (item 9): a parent whose subtask needs you says that once. Its own idle line is its own loops only, so beside
  // "A subtask needs you" it said the task two ways while the row said needs you.
  // LIN-4071: the subtask line is `/state`'s `attention`; the parent's own idle line is the server's to leave out (it sends
  // no `homeStatusHtml` for an otherwise idle parent whose subtask needs attention), so the browser paints what it is sent.
  test('a container whose subtask needs you states that from /state\'s attention, and paints no own line the server withheld', async () => {
    const { PromptSection, makeContainer } = loadClient({
      stateBody: {
        status: 'idle', live: false, homeStatusHtml: '', sessions: PLAN_NEXT,
        attention: { identifier: 'LIN-99', title: 'Models rows', state: 'needs-you', lead: 'A subtask needs you', detail: '', words: 'A subtask needs you: LIN-99' },
      },
    });
    const c = makeContainer();
    PromptSection.init(c, { ...HOME, row: serverRow({ container: true }) });
    await flush(); await flush();
    assert.match(c.innerHTML, /data-testid="opened-task-needs-you">A subtask needs you: <span class="opened-task-needs-you-name">LIN-99 Models rows/);
    assert.equal(c.innerHTML.includes('OWN-IDLE-LINE'), false, 'the parent\'s own idle line is not shown beside it');
  });

  test('a container with no subtask waiting keeps its own line', async () => {
    const { PromptSection, makeContainer } = loadClient({
      stateBody: { status: 'idle', live: false, homeStatusHtml: '<p>OWN-IDLE-LINE</p>', sessions: PLAN_NEXT },
    });
    const c = makeContainer();
    PromptSection.init(c, { ...HOME, row: serverRow({ container: true }) });
    await flush(); await flush();
    assert.match(c.innerHTML, /OWN-IDLE-LINE/);
    assert.equal(c.innerHTML.includes('opened-task-needs-you'), false);
  });

  // LIN-4024 (look): a new user's one action is a solid "Write the prompt", and the step line has no stray leading dot.
  // LIN-4103 (Item 5): before the prompt is written, no stage is named on screen; the step line gives the reason only.
  test('copy-first: the Write the prompt button is the primary, and no stage is named before the prompt is written', async () => {
    const { PromptSection, makeContainer } = loadClient({ stateBody: { status: 'idle', live: false, homeStatusHtml: '<p>No sessions yet.</p>', sessions: { count: 0 } } });
    const c = makeContainer();
    PromptSection.init(c, { ...HOME, dispatchEnabled: false, issue: { ...HOME.issue, stateType: 'backlog' }, row: serverRow({ stateType: 'backlog' }) });
    await flush(); await flush();
    assert.match(c.innerHTML, /class="btn btn--primary opened-task-write" data-testid="opened-task-write"/);
    assert.match(c.innerHTML, /data-testid="opened-task-step">Write the prompt for this task\. The prompt says which step it is for\.<\/div>/);
    assert.doesNotMatch(c.innerHTML, /opened-task-step-name/, 'no stage name is drawn before the prompt is written');
  });

  // LIN-4024: a task waiting on a question shows the owner's card in the state block; no card when the server sends none.
  test('a waiting task shows its question card in the state block, and no slot when the server sends no card', async () => {
    const card = '<div class="sess-qcard" data-testid="session-question-card" data-url-key="acme"><p data-testid="session-question-card-question">Which key?</p></div>';
    const waiting = loadClient({ stateBody: { status: 'waiting', live: false, homeStatusHtml: '<p>needs you</p>', questionHtml: card, sessions: PLAN_NEXT } });
    const c = waiting.makeContainer();
    waiting.PromptSection.init(c, HOME);
    await flush(); await flush();
    assert.match(c.innerHTML, /data-question-slot(?:="")?>\s*<div class="sess-qcard" data-testid="session-question-card"/, 'the card is in its slot');
    assert.match(c.innerHTML, /data-testid="opened-task-state"/, 'the card sits in the state block');

    const quiet = loadClient({ stateBody: { status: 'idle', live: false, homeStatusHtml: '<p>idle</p>', questionHtml: '', sessions: PLAN_NEXT } });
    const d = quiet.makeContainer();
    quiet.PromptSection.init(d, HOME);
    await flush(); await flush();
    assert.equal(d.innerHTML.includes('data-question-slot'), false, 'no card, no slot');
  });

  test('Escape closes the Change drawer and returns focus to its Change button (witnessed by the close action)', async () => {
    const { PromptSection, makeContainer } = loadClient({
      stateBody: { status: 'idle', live: false, sessions: PLAN_NEXT },
      // The Change button is drawn in the Runs on line, which waits for a preview; without one the line reads "Working out".
      previewBody: { kind: 'plan-review', harness: 'claude-code', words: { model: 'Sonnet' }, sources: { model: 'job' }, group: null, stepLabel: 'Plan review' },
    });
    const c = makeContainer();
    PromptSection.init(c, HOME);
    await flush();
    await c.click({ action: 'change-run' });
    assert.match(c.innerHTML, /data-testid="run-change-panel"/, 'the drawer opened');
    await c.key('Escape');
    assert.equal(c.innerHTML.includes('data-testid="run-change-panel"'), false, 'Escape closed it');
  });

  // LIN-4010 review (finding 1): a running task's state is said once. Home's line is empty while it runs (the server
  // sends none), and the client must not fall back to the task page's sentence; the strip chip shows elapsed time only.
  test('a running task says its state once: no Home line, and the strip chip shows the elapsed time, not the word', async () => {
    const running = { loopId: 'l1', kind: 'implementation', label: 'Build', state: 'running', since: '2026-10-29T10:00:00.000Z', target: 'cli' };
    const { PromptSection, makeContainer } = loadClient({
      stateBody: {
        status: 'running', live: true, homeStatusHtml: '', headerHtml: '<p>Build running for 1s.</p>',
        stripHtml: '<li class="task-strip-chip"><span class="task-strip-name">Build</span> <span class="task-strip-state">1s<span class="task-strip-srword"> running</span></span></li>',
        sessions: { count: 1, next: { kind: 'review', label: 'Review' }, last: null, running, offered: null, busy: true, excluded: [] },
      },
    });
    const c = makeContainer();
    PromptSection.init(c, HOME);
    await flush(); await flush();
    assert.equal(c.innerHTML.includes('Build running for'), false, 'the state sentence is not restated');
    assert.equal(c.innerHTML.includes('task-status-pill'), false, 'no pill beside the running box');
    assert.match(c.innerHTML, /task-strip-state">1s<span class="task-strip-srword"> running<\/span>/);
    assert.equal((c.innerHTML.match(/Running now/g) || []).length, 1);
  });

  // LIN-4010 review (finding 5): Watch opens the task the running box runs on, not the container it sits under.
  test('a container\'s running box: Watch links to the container it runs on', async () => {
    const running = { loopId: 'l9', kind: 'research', label: 'Research', state: 'running', since: '2026-10-29T10:00:00.000Z', target: 'cli' };
    const { PromptSection, makeContainer } = loadClient({
      stateBody: { status: 'running', live: true, homeStatusHtml: '', headerHtml: '', sessions: { count: 1, running, next: null, last: null, offered: null, busy: true, excluded: [] } },
    });
    const c = makeContainer();
    PromptSection.init(c, { ...HOME, row: serverRow({ container: true }) });
    await flush(); await flush();
    assert.match(c.innerHTML, /href="\/workspace\/acme\/task\/LIN-42"[^>]*data-testid="opened-task-watch"/);
  });

  // LIN-4010 review (finding 4, a missing witness): Stop on a container is the subtask's Stop, not the parent's.
  test('Stop on a container posts the container it runs on', async () => {
    const running = { loopId: 'l9', kind: 'research', label: 'Research', state: 'running', since: '2026-10-29T10:00:00.000Z', target: 'cli' };
    const { PromptSection, calls, makeContainer } = loadClient({
      stateBody: { status: 'running', live: true, homeStatusHtml: '', headerHtml: '', sessions: { count: 1, running, next: null, last: null, offered: null, busy: true, excluded: [] } },
    });
    const c = makeContainer();
    PromptSection.init(c, { ...HOME, row: serverRow({ container: true }) });
    await flush(); await flush();
    await c.click({ action: 'stop-run' });
    await c.click({ action: 'stop-run-confirm' });
    await flush();
    assert.equal(calls.post.length, 1, 'one stop was posted');
    assert.equal(calls.post[0].body.abort, true);
    assert.equal(calls.post[0].body.issueIdentifier, 'LIN-42', 'the stop names the container');
    assert.equal(calls.post[0].body.issueId, 'uuid-42');
  });

  // LIN-4010 review (finding 3): Change is a choice. A default card and the saved presets are the choices; "Choose for
  // this run" reveals the existing decision panel, which stays in the drawer, hidden until it is asked for.
  test('Change is a choice: a default card, preset cards, and "Choose for this run" reveals the decision panel', async () => {
    const { PromptSection, makeContainer } = loadClient({
      stateBody: { status: 'idle', live: false, sessions: PLAN_NEXT },
      previewBody: { kind: 'plan-review', harness: 'claude-code', words: { model: 'Sonnet' }, sources: { model: 'job' }, group: null, stepLabel: 'Plan review' },
      presetsBody: [{ id: 'p1', name: 'Quick' }],
    });
    const c = makeContainer();
    PromptSection.init(c, HOME);
    await flush();
    await c.click({ action: 'change-run' });
    await flush();
    assert.match(c.innerHTML, /data-testid="run-default"[^>]*>[\s\S]*?Default for Plan review/);
    assert.match(c.innerHTML, /data-testid="run-preset"[^>]*>Quick</);
    assert.match(c.innerHTML, /data-testid="run-choose-panel"[^>]*hidden/, 'the decision panel is hidden until it is chosen');
    await c.click({ action: 'run-choose' });
    assert.doesNotMatch(c.innerHTML, /data-testid="run-choose-panel"[^>]*hidden/, 'choosing reveals the panel');
  });

  // LIN-4010 review (finding 3): a copy-first viewer's runner line is the view's own foot (inside the Home box), not a
  // line the server appends after the folds.
  test('the copy-first view carries the runner line as its foot', async () => {
    const { PromptSection, makeContainer } = loadClient({ stateBody: { status: 'idle', live: false, sessions: { count: 0 } } });
    const c = makeContainer();
    PromptSection.init(c, { ...HOME, dispatchEnabled: false });
    await flush(); await flush();
    assert.match(c.innerHTML, /data-testid="opened-task-runner-line"[^>]*>[\s\S]*Set up a runner/);
  });
  // LIN-4010 close-out (review: the opened-task surfaces class). Only Home changes layout: the task page's Change panel
  // keeps the Preset row and the decision panel open, with no cards and no "Choose for this run".
  test('the task surface\'s Change panel is unchanged: a Preset row, the decision panel visible, no cards, no choose toggle', async () => {
    const { PromptSection, makeContainer } = loadClient({
      stateBody: { status: 'idle', live: false, sessions: PLAN_NEXT },
      previewBody: { kind: 'plan-review', harness: 'claude-code', words: { model: 'Sonnet' }, sources: { model: 'job' }, group: null, stepLabel: 'Plan review' },
      presetsBody: [{ id: 'p1', name: 'Quick' }],
      panelHtml: '<div data-testid="decision-panel-body">DECISION PANEL</div>',
    });
    const c = makeContainer();
    PromptSection.init(c, { ...HOME, surface: 'task' });
    await flush(); await flush();
    await c.click({ action: 'change-run' });
    await flush(); await flush();
    const html = c.innerHTML;
    assert.match(html, /data-testid="run-change-panel"/, 'Change opened');
    assert.match(html, /<span class="opened-task-change-label">Preset<\/span><button class="btn opened-task-preset"[^>]*data-testid="run-preset">Quick</, 'the Preset row is there');
    assert.equal(html.includes('data-testid="run-default"'), false, 'no default card');
    assert.equal(html.includes('data-testid="run-cards"'), false, 'no cards');
    assert.equal(html.includes('data-testid="run-choose"'), false, 'no "Choose for this run" toggle');
    assert.equal(html.includes('data-testid="run-choose-panel"'), false, 'the panel is not wrapped in the choose container');
    assert.match(html, /DECISION PANEL/, 'the decision panel body is in the panel');
    assert.ok(html.indexOf('opened-task-preset') < html.indexOf('DECISION PANEL'), 'Preset row first, then the panel body');
    assert.ok(html.indexOf('DECISION PANEL') < html.indexOf('>Runs on<'), 'then Runs on');
    assert.doesNotMatch(html, /<[^>]*\bhidden\b[^>]*>[^<]*<div data-testid="decision-panel-body"/, 'the panel body is not inside a hidden element');
  });

});
