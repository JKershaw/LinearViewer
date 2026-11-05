/**
 * LIN-4042 — Home offers no run on a finished task. The gather decides it: a finished task's action is the no-run decision
 * (`NO_RUN_ACTION`, LIN-4071), on the row record and on `/state`, and the browser paints no run from that decision alone.
 * Unfinished tasks and tasks with open subtasks keep their Run to PR.
 *
 * REWRITTEN (LIN-4070): the Done cases paint the body the real `/state` route returns (tests/fixtures/state-route.js).
 * REWRITTEN (LIN-4071): the browser's guard on the tracker word (`row.finished`) is gone; the stale-body cases now feed the
 * server's no-run decision, and a stale Run to PR body is not a case the browser can see, because the server decides it.
 * LIN-4048: the task page and Swipe paint a finished task as Home does (no runs-on, Change, quota or Go; a held run keeps
 * its box and Stop), and the task page's run slot repaints on the run poll. The LIN-4048 block at the end pins those.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../../lib/utils/html.js';
import { rowRecordOf } from '../../lib/task-board-view.js';
import { NO_RUN_ACTION } from '../../lib/task-state.js';
import { stateBodyOf, stateIssue } from '../fixtures/state-route.js';
import { loadWorld } from './helpers/client-world.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

// The state body, the way /state sends it (routes/task-page.js): the sessions block is the server's, tracker-free.
// `stateBody` may be a function, read on each /state call (a poll after the first read sees the next body, LIN-4048).
// `timers`, when given, collects the client's timers instead of running them: the run poll (10s) is fired by the test.
// `quota` is the GET /api/dispatch/quota body (LIN-4048 review): a free-tier caller's allowance, read at load.
function loadClient({ stateBody, timers = null, quota = null }) {
  const window = {
    escapeHtml: (x) => (x == null ? '' : escapeHtml(String(x))),
    stripCodeBlockWrapper: (x) => x,
    renderMarkdown: (x) => String(x == null ? '' : x),
    api: async (url) => {
      if (url.includes('/api/task/')) return typeof stateBody === 'function' ? stateBody() : stateBody;
      if (url.includes('/api/dispatch/quota')) return quota || {};
      if (url.includes('/api/task-mode/')) return { lastCopy: null };
      if (url.includes('/api/dispatch/preview')) return { kind: 'implementation', harness: 'claude-code', words: {}, sources: {}, group: null, description: '' };
      if (url.includes('/api/dispatch/decision-panel')) return { html: '', words: null, withoutEffort: [], targets: ['cli', 'web'], optionWords: { harness: {}, model: {} } };
      if (url.includes('/api/dispatch/presets')) return { presets: [] };
      return {};
    },
    ProxyToggle: { isActive: () => true, setActive() {}, maybeAppend: async (raw) => raw },
    renderDispatchDisclosure: () => '',
    readDispatchExecControls: () => ({ model: null, harness: null }),
    isPinnedToBottom: () => false,
    taskPageHref: () => '/workspace/acme/task/LIN-42',
    toast: () => {},
    dispatchPrompt: async () => ({ success: true, item: { id: 'd-1' } }),
    fetchAutopilotKickoff: async () => ({ prompt: 'PLAN PROMPT', promptName: 'Plan', kind: 'plan' }),
  };
  return loadWorld({
    window, scripts: ['prompt-section.js'],
    timers,
    globals: { fetch: async () => ({ ok: true, json: async () => ({}) }) },
  });
}

const HOME_ISSUE = { id: 'uuid-42', identifier: 'LIN-42', title: 'T', url: '', source: 'linear', stateType: 'started' };
const HOME = {
  // LIN-4104 D2: this file's workspace fills Run to PR (its tests are about that run); the filled rung is pinned in lin-4016.
  filledRung: 'pr',
  urlKey: 'acme', surface: 'home', dispatchEnabled: true, runSetup: false, hasAI: true, aiState: 'ok', isLocalhost: false,
  promptMeta: { plan: 'Plan', implementation: 'Build', research: 'Research', scoping: 'Scoping', review: 'Review' },
  stageWords: { plan: 'Plan', implementation: 'Build', research: 'Research', scoping: 'Scoping', review: 'Review' },
  defaultPromptKeys: ['look-into', 'research', 'plan', 'implementation'],
  morePromptKeys: ['review', 'scoping'],
  issue: HOME_ISSUE,
  row: rowRecordOf({ stateType: 'started' }),
};

// The server's decision for a task with nothing running: `action` is what `mainActionOf` chose from /state (tracker-free).
const stateWith = (sessions) => ({
  status: 'idle', live: false, headerHtml: '', stripHtml: '', homeStatusHtml: '',
  sessions: { count: 0, next: null, last: null, offered: null, excluded: [], queued: null, busy: false, action: null, canStop: false, running: null, ...sessions },
});

/** The `/state` body the server sends for a Done task (`LIN-42`) whose last stage failed, with `children` in its held tree. */
function doneBody({ children }) {
  const failed = {
    loopId: 'f1', lineageId: 'f1', issueIdentifier: 'LIN-42', kind: 'implementation', iteration: 1, source: 'history',
    historyStatus: 'resolved', agentState: 'failed', dispatchedAt: '2026-10-30T10:00:00.000Z', takenAt: '2026-10-30T10:01:00.000Z',
    resolvedAt: '2026-10-30T10:02:00.000Z', terminalStatus: 'failed', terminalCompletedAt: '2026-10-30T10:02:00.000Z',
    wakeMarker: 'pending', waitingMessage: null, feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] },
    followUpTo: null, bookkeeping: null,
  };
  return stateBodyOf({ issues: [stateIssue('LIN-42', 'completed'), ...children], loops: [failed], identifier: 'LIN-42' });
}

async function paint(stateBody, opts = {}, quota = null) {
  const world = loadClient({ stateBody, quota });
  const c = world.makeContainer();
  world.PromptSection.init(c, { ...HOME, ...opts });
  await flush(); await flush(); await flush();
  return c.innerHTML;
}

const RUN_TO_PR = { kind: 'offer', why: 'no stage step is offered, so the run takes it to PR' };
const PLAN_OFFER = { kind: 'plan', label: 'Plan', why: 'usual', failed: false, reason: 'usually next after Research' };
// LIN-4071: a finished task's action is the gatherer's no-run decision (`kind: 'none'`), not a client guard on the tracker word.
const NO_RUN = NO_RUN_ACTION;
const DONE_ROW = () => rowRecordOf({ stateType: 'completed', decided: { action: NO_RUN } });

describe('LIN-4042 — a finished task on Home offers no run', () => {
  test('a Done task paints no Run to PR button, from the body the server really sends (its action is null)', async () => {
    const { body } = await doneBody({ children: [] });
    assert.equal(body.sessions.action.kind, 'none', 'the server decides the no-run action for a finished task (LIN-4042)');
    const html = await paint(body, { row: DONE_ROW() });
    assert.doesNotMatch(html, /Run to PR/, 'a finished task has nothing to run');
    assert.doesNotMatch(html, /data-action="go"/, 'no go button on a finished task');
    assert.doesNotMatch(html, /data-testid="opened-task-runs-on"/, 'no runs-on line, so no Change for a run');
  });

  test('a Done task whose body carries the no-run decision paints no Run to PR button', async () => {
    const html = await paint(stateWith({ action: NO_RUN }), { row: DONE_ROW() });
    assert.doesNotMatch(html, /Run to PR/, 'a finished task has nothing to run');
    assert.doesNotMatch(html, /data-action="go"/, 'no go button on a finished task');
    assert.doesNotMatch(html, /data-testid="opened-task-runs-on"/, 'no runs-on line, so no Change for a run');
  });

  test('a Done task keeps the Another step list, with its steps counted as left out (LIN-3833 ruling f9fa6bd7)', async () => {
    const html = await paint(stateWith({ action: RUN_TO_PR }), { row: DONE_ROW() });
    assert.match(html, /data-testid="run-another"/);
  });

  test('a Done task offers no stage step either, even when a stale step is offered (the no-run decision wins)', async () => {
    const html = await paint(stateWith({ offered: PLAN_OFFER, action: NO_RUN }), { row: DONE_ROW() });
    assert.doesNotMatch(html, /data-action="run-step-next"/);
  });

  test('an unfinished task whose server action is Run to PR keeps its Run to PR button', async () => {
    const html = await paint(stateWith({ action: RUN_TO_PR }), { row: rowRecordOf({ stateType: 'started' }) });
    assert.match(html, /data-action="go"[^>]*>Run to PR</);
  });

  test('a task with open subtasks (a container) keeps its Run to PR button', async () => {
    const html = await paint(stateWith({ action: RUN_TO_PR }), { row: rowRecordOf({ stateType: 'started', container: true }) });
    assert.match(html, /data-action="go"[^>]*>Run to PR</);
  });

  // Close-out of the review ledger (items 1 and 2): the change's own claims, pinned.
  test('a Done task with a running run keeps its running box and Stop (the early return needs !active)', async () => {
    const running = { loopId: 'loop-1', kind: 'implementation', label: 'Build', state: 'running', since: '2026-10-30T10:00:00.000Z', target: 'local' };
    const html = await paint(stateWith({ running, busy: true, action: null, canStop: true }), { row: DONE_ROW() });
    assert.match(html, /data-testid="opened-task-running"/);
    assert.match(html, /data-testid="run-stop"/);
  });

  test('a Done task with a queued run keeps its queued box', async () => {
    const queued = { loopId: 'q-1', kind: 'implementation', label: 'Build', state: 'queued', target: 'cli' };
    const html = await paint(stateWith({ running: queued, queued, busy: true, action: null, canStop: true }), { row: DONE_ROW() });
    assert.match(html, /data-testid="opened-task-queued"/);
  });

  test('a finished container (Done parent with an open subtask) offers no run, from the server body (LIN-4042 review ledger 2)', async () => {
    const { body } = await doneBody({ children: [stateIssue('LIN-43', 'unstarted', { parent: 'LIN-42' })] });
    assert.equal(body.sessions.action.kind, 'none', 'a finished container offers no run on /state');
    const html = await paint(body, { row: DONE_ROW() });
    assert.doesNotMatch(html, /data-action="go"/);
    assert.doesNotMatch(html, /Run to PR/);
  });

  test('a finished container whose body carries the no-run decision paints no run (ledger 2)', async () => {
    const html = await paint(stateWith({ action: NO_RUN }), { row: DONE_ROW() });
    assert.doesNotMatch(html, /data-action="go"/);
    assert.doesNotMatch(html, /Run to PR/);
  });
});

// LIN-4071 review ledger (M10, M5): the step guard now reads the gatherer's `action` (`container`, `kind: 'none'`), not the
// retired row fields, so the new consumer needs its own witness. A step is "chosen for this run" by picking one in
// Another step (`run-pick`); a container or a finished task must still offer no stage step for it.
describe('LIN-4071 — runStepOfState offers no stage step for a container or a finished task, whatever step was chosen', () => {
  const CONTAINER_ACTION = { kind: 'offer', why: 'a container runs to PR', container: true };

  // A step is chosen on a leaf, where Another step draws it. The task then finishes while a Go run is live: the run poll
  // reads the finished body, and the chosen step must not come back as a stage step or a Go. A finished task draws no
  // pickable step on its own, so the pick happens first.
  async function pickThenFinish(opts, finished) {
    let current = stateWith({ action: RUN_TO_PR });
    const timers = [];
    const world = loadClient({ stateBody: () => current, timers });
    const c = world.makeContainer();
    world.PromptSection.init(c, { ...HOME, ...opts });
    await flush(); await flush(); await flush();
    await c.click({ action: 'run-another' });
    await flush(); await flush();
    await c.click({ action: 'run-pick', kind: 'plan', label: 'Plan' });
    await flush(); await flush(); await flush();
    await c.click({ action: 'go' });
    await flush(); await flush(); await flush();
    current = finished;
    const poll = timers.find((t) => t.ms === 10000 && !t.cancelled && !t.fired);
    assert.ok(poll, 'a run poll is armed while the run is live');
    poll.fired = true;
    poll.fn();
    await flush(); await flush(); await flush();
    return c.innerHTML;
  }

  async function paintAndPick(stateBody, opts) {
    const world = loadClient({ stateBody });
    const c = world.makeContainer();
    world.PromptSection.init(c, { ...HOME, ...opts });
    await flush(); await flush(); await flush();
    // The reader opens Another step, then picks a step from the list it draws.
    await c.click({ action: 'run-another' });
    await flush(); await flush();
    await c.click({ action: 'run-pick', kind: 'plan', label: 'Plan' });
    await flush(); await flush(); await flush();
    return c.innerHTML;
  }

  test('control: a leaf whose action is Run to PR does take the chosen step (the pick reaches the step line and Go)', async () => {
    const html = await paintAndPick(stateWith({ action: RUN_TO_PR }), { row: rowRecordOf({ stateType: 'started' }) });
    assert.match(html, /opened-task-step-name[^>]*>Plan</, 'the chosen stage step is the step line');
    assert.match(html, /data-action="run-step-next"[^>]*>Run Plan</, 'and Go runs it');
  });

  test('a container (action.container) with a step chosen for this run paints no stage step; Go runs Run to PR', async () => {
    const html = await paintAndPick(stateWith({ action: CONTAINER_ACTION, offered: PLAN_OFFER }), { row: { ...rowRecordOf({ stateType: 'started' }), action: CONTAINER_ACTION } });
    assert.doesNotMatch(html, /opened-task-step-name[^>]*>Plan</, 'no stage step line for a container');
    assert.doesNotMatch(html, /data-action="run-step-next"/, 'Go is not the stage step');
    assert.match(html, /data-action="go"[^>]*>Run to PR</, 'Go runs Run to PR');
  });

  test('a finished task (action.kind none) with a step chosen paints no stage step line and no Go', async () => {
    const html = await pickThenFinish({ row: rowRecordOf({ stateType: 'started' }) }, stateWith({ action: NO_RUN, offered: PLAN_OFFER }));
    assert.doesNotMatch(html, /data-testid="opened-task-step"/, 'the step line is empty');
    assert.doesNotMatch(html, /data-action="run-step-next"/);
    assert.doesNotMatch(html, /data-action="go"/);
  });

  // M5: on the task page the run slot has no early return for a finished task (that one is Home's), so the `kind: 'none'`
  // check in `runStepOfState` is what keeps a chosen step from becoming a "Run Plan" button on a finished task.
  test('task page: a finished task (action.kind none) with a step chosen offers no stage step and no Go', async () => {
    const html = await pickThenFinish({ surface: 'task', row: rowRecordOf({ stateType: 'started' }) }, stateWith({ action: NO_RUN, offered: PLAN_OFFER }));
    assert.doesNotMatch(html, /data-action="run-step-next"/, 'no Run Plan on a finished task');
    assert.doesNotMatch(html, /data-action="go"/);
    assert.doesNotMatch(html, /opened-task-step-name[^>]*>Plan</, 'the chosen step is not the step line');
  });

  test('before the first /state reply, a container row record alone offers no stage step', async () => {
    const world = loadClient({ stateBody: new Promise(() => {}) });
    const c = world.makeContainer();
    world.PromptSection.init(c, { ...HOME, row: { ...rowRecordOf({ stateType: 'started' }), action: CONTAINER_ACTION } });
    await flush();
    assert.doesNotMatch(c.innerHTML, /data-action="run-step-next"/);
  });
});

// LIN-4048: the task page (`surface: 'task'`) and Swipe paint a finished task the way Home does. Each case runs the real
// `/state` body through the vm client; the run poll is captured (not run on a timer) so the repaint cases can fire it.
describe('LIN-4048 — a finished task on the task page and Swipe shows no run chrome, and a held run keeps its box', () => {
  const RUNNING = { loopId: 'loop-1', kind: 'implementation', label: 'Build', state: 'running', since: '2026-10-30T10:00:00.000Z', target: 'cli' };
  const QUEUED = { loopId: 'q-1', kind: 'implementation', label: 'Build', state: 'queued', target: 'cli' };
  // A `/state` body for a Done task with a run held: the server's `none` decision plus the live run (spike B, LIN-4048).
  const doneHeld = (sessions) => ({ ...stateWith({ action: NO_RUN, busy: true, canStop: true, ...sessions }), status: 'running', live: true });
  const TASK = { surface: 'task' };

  // Paint the mount, then deliver the poll's next /state body and repaint. Returns both HTML snapshots.
  async function mountThenPoll({ first, next, opts = {} }) {
    const timers = [];
    let current = first;
    const world = loadClient({ stateBody: () => current, timers });
    const c = world.makeContainer();
    world.PromptSection.init(c, { ...HOME, ...opts });
    await flush(); await flush(); await flush();
    const before = c.innerHTML;
    current = next;
    const poll = timers.find((t) => t.ms === 10000 && !t.cancelled && !t.fired);
    assert.ok(poll, 'a run poll is armed while a run is live');
    poll.fired = true;
    poll.fn();
    await flush(); await flush(); await flush();
    return { before, after: c.innerHTML };
  }

  describe('the task page, a finished task with nothing running', () => {
    test('no runs-on line, no Change, no quota and no Go; the Another step list stays', async () => {
      const html = await paint(stateWith({ action: NO_RUN }), { ...TASK, row: DONE_ROW() });
      assert.doesNotMatch(html, /data-testid="opened-task-runs-on"/, 'a run that cannot happen names no runs-on line');
      assert.doesNotMatch(html, /data-testid="run-change"/, 'no Change for a run that cannot happen');
      assert.doesNotMatch(html, /data-testid="opened-task-run-quota"/, 'the allowance names no run beside nothing');
      assert.doesNotMatch(html, /data-action="go"/);
      assert.match(html, /data-testid="run-another"/, 'the plain finished page keeps Another step');
    });
  });

  describe('the task page, a finished task with a run held', () => {
    test('a running run keeps its running box and Stop, with no runs-on, Change, quota or Go', async () => {
      const html = await paint(doneHeld({ running: RUNNING }), { ...TASK, row: DONE_ROW() });
      assert.match(html, /data-testid="opened-task-running"/);
      assert.match(html, /data-testid="run-stop"/);
      assert.doesNotMatch(html, /data-testid="opened-task-runs-on"/);
      assert.doesNotMatch(html, /data-testid="run-change"/);
      assert.doesNotMatch(html, /data-testid="opened-task-run-quota"/);
      assert.doesNotMatch(html, /data-action="go"/, 'the guard: a finished task with a live run offers no Go');
      assert.doesNotMatch(html, /data-action="run-step-next"/);
    });

    test('a queued run keeps its queued box and Undo, with no runs-on', async () => {
      const html = await paint(doneHeld({ queued: QUEUED, running: QUEUED }), { ...TASK, row: DONE_ROW() });
      assert.match(html, /data-testid="opened-task-queued"/);
      assert.match(html, /data-testid="run-undo"/);
      assert.doesNotMatch(html, /data-testid="opened-task-runs-on"/);
    });
  });

  describe('the task page repaints its run slot on the run poll', () => {
    test('a Done task whose held run ends drops its Stop and runs-on without a reload', async () => {
      const { before, after } = await mountThenPoll({
        first: doneHeld({ running: RUNNING }),
        next: stateWith({ action: NO_RUN }),
        opts: { ...TASK, row: DONE_ROW() },
      });
      assert.match(before, /data-testid="run-stop"/, 'precondition: the held run shows its Stop');
      assert.doesNotMatch(after, /data-testid="run-stop"/, 'the stale Stop goes when the run ends');
      assert.doesNotMatch(after, /data-testid="opened-task-running"/);
      assert.doesNotMatch(after, /data-testid="opened-task-runs-on"/);
    });

    test('an unfinished task whose run ends drops its Stop without a reload', async () => {
      const { before, after } = await mountThenPoll({
        first: { ...stateWith({ running: RUNNING, busy: true, canStop: true, action: null }), status: 'running', live: true },
        next: stateWith({ action: RUN_TO_PR }),
        opts: { ...TASK, row: rowRecordOf({ stateType: 'started' }) },
      });
      assert.match(before, /data-testid="run-stop"/, 'precondition: the run shows its Stop');
      assert.doesNotMatch(after, /data-testid="run-stop"/, 'the stale Stop goes when the run ends');
    });
  });

  describe('Swipe, a finished row', () => {
    test('a Done row with the no-run decision offers no Go', async () => {
      const html = await paint(stateWith({ action: NO_RUN }), { surface: 'swipe', row: DONE_ROW() });
      assert.doesNotMatch(html, /data-action="go"/, 'Swipe must not offer a Go that would spend a run on a finished row');
    });

    test('control: a row with a Run to PR offer keeps its Go on Swipe', async () => {
      const html = await paint(stateWith({ action: RUN_TO_PR }), { surface: 'swipe', row: rowRecordOf({ stateType: 'started' }) });
      assert.match(html, /data-action="go"/);
    });
  });
});

// LIN-4048 review (findings 1-3): the first pass pinned the Go and quota cases with `doesNotMatch(data-action="go")`, which
// the disabled limit button (no data-action) and the setup button slipped past. These cases pin the rendered button itself,
// with a free-tier caller whose quota is read, so the quota branches are reachable.
describe('LIN-4048 review — a finished task draws no Go, limit Go, setup Go, quota or Change, whatever the allowance', () => {
  const FREE = { freeTier: true };
  const TASK = { surface: 'task' };
  const RUNNING = { loopId: 'loop-1', kind: 'implementation', label: 'Build', state: 'running', since: '2026-10-30T10:00:00.000Z', target: 'cli' };
  const quotaOf = (remaining) => ({ limited: true, runsUsed: 10 - remaining, remaining, limit: 10 });

  test('task page, Done, nothing held, quota spent: no disabled limit Go and no Go of any kind', async () => {
    const html = await paint(stateWith({ action: NO_RUN }), { ...TASK, ...FREE, row: DONE_ROW() }, quotaOf(0));
    assert.doesNotMatch(html, /data-testid="opened-task-go"/, 'a finished task has no Go, not even a disabled "limit reached" one');
    assert.doesNotMatch(html, /daily run limit reached/);
    assert.match(html, /data-testid="run-another"/, 'the plain finished page keeps Another step');
  });

  test('swipe, Done row, quota spent: no disabled limit Go', async () => {
    const html = await paint(stateWith({ action: NO_RUN }), { surface: 'swipe', ...FREE, row: DONE_ROW() }, quotaOf(0));
    assert.doesNotMatch(html, /data-testid="opened-task-go"/, 'Swipe must not show a disabled Go on a finished row');
  });

  test('swipe, Done row, no dispatch but a set-up owner: no "set up" Go on a finished row', async () => {
    const html = await paint(stateWith({ action: NO_RUN }), { surface: 'swipe', dispatchEnabled: false, runSetup: true, row: DONE_ROW() });
    assert.doesNotMatch(html, /data-testid="opened-task-go"/, 'a finished row offers no set-up Go either');
  });

  test('task page, Done, nothing held, quota remaining: no quota span beside nothing', async () => {
    const html = await paint(stateWith({ action: NO_RUN }), { ...TASK, ...FREE, row: DONE_ROW() }, quotaOf(3));
    assert.doesNotMatch(html, /data-testid="opened-task-run-quota"/, 'the allowance names no run on a finished task');
  });

  test('control: an unfinished task with quota remaining keeps its Go and the quota span', async () => {
    const html = await paint(stateWith({ action: RUN_TO_PR }), { ...TASK, ...FREE, row: rowRecordOf({ stateType: 'started' }) }, quotaOf(3));
    assert.match(html, /data-testid="opened-task-run-quota"[^>]*>3 of 10 runs left today</);
    assert.match(html, /data-action="go"[^>]*>Run to PR</);
  });

  test('control: an unfinished task with quota spent keeps its disabled limit Go (the rung the server gates)', async () => {
    const html = await paint(stateWith({ action: RUN_TO_PR }), { ...TASK, ...FREE, row: rowRecordOf({ stateType: 'started' }) }, quotaOf(0));
    assert.match(html, /data-testid="opened-task-go"[^>]*disabled/);
  });

  test('the Change panel closes when a held run ends and the Done body arrives (Change was open on the run)', async () => {
    const timers = [];
    let current = { ...stateWith({ running: RUNNING, busy: true, canStop: true, action: null }), status: 'running', live: true };
    const world = loadClient({ stateBody: () => current, timers });
    const c = world.makeContainer();
    world.PromptSection.init(c, { ...HOME, ...TASK, row: rowRecordOf({ stateType: 'started' }) });
    await flush(); await flush(); await flush();
    await c.click({ action: 'change-run' });
    await flush(); await flush(); await flush();
    assert.match(c.innerHTML, /data-testid="run-change-panel"/, 'precondition: Change is open on the held run');
    current = stateWith({ action: NO_RUN });
    const poll = timers.find((t) => t.ms === 10000 && !t.cancelled && !t.fired);
    assert.ok(poll, 'a run poll is armed while a run is live');
    poll.fired = true;
    poll.fn();
    await flush(); await flush(); await flush();
    assert.doesNotMatch(c.innerHTML, /data-testid="run-change-panel"/, 'no Change panel for a run that can no longer happen');
    assert.doesNotMatch(c.innerHTML, /data-testid="opened-task-running"/);
  });
});
