// LIN-3341 — "Go is one press".
//
// One press on the opened task starts the autopilot run: it fetches the
// kickoff (stopAt=pr) and dispatches it through the shared assemblers, then
// shows the task page's own started/running sentence. A reopened task reads the
// stored task-state endpoint once on mount, so a run already in progress shows
// the running/waiting line instead of a pressable Go (`live || waiting`).
//
// The client runs in the shared client world (tests/unit/helpers/client-world.js): the one fake DOM
// and one vm sandbox. A press is `container.click(dataset)`, which needs the button to be drawn, as a
// browser needs it. Assertions read the drawn markup (`innerHTML`, `querySelector`) and node identity:
// a node held before a press is kept (the same node, still attached) or rebuilt (detached).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from './helpers/client-world.js';

// Every element in the container outside `slotSelector`. A repaint that touches only that slot keeps all of them: the
// same node, still attached. A full render detaches them all.
function nodesOutside(container, slotSelector) {
  const out = [];
  const walk = (el) => {
    for (const child of el.children) {
      if (child.closest(slotSelector)) continue; // the slot and what it holds are not kept
      out.push(child);
      walk(child);
    }
  };
  walk(container);
  return out;
}

function loadPromptSection(overrides = {}) {
  const calls = { api: [], dispatch: [], kickoff: [], records: [], fetch: [] };
  const timers = [];

  const window = {
    escapeHtml: (s) => (s == null ? '' : String(s)),
    stripCodeBlockWrapper: (s) => s,
    renderMarkdown: (s) => String(s == null ? '' : s),
    taskPageHref: ({ urlKey, identifier } = {}) => (urlKey && identifier ? `/workspace/${urlKey}/task/${identifier}` : ''),
    readDispatchExecControls: overrides.readDispatchExecControls || (() => ({ model: null, harness: null })),
    renderDispatchDisclosure: () => '<div class="swipe-prompt-options"></div>',
    ProxyToggle: { maybeAppend: async (raw) => raw },
    isPinnedToBottom: () => false,
    toast: () => {},
    readSSEStream: overrides.readSSEStream,
  };
  window.api = async (url, opts) => {
    calls.api.push(url);
    if (String(url).includes('/api/dispatch/quota')) {
      calls.quotaReads = (calls.quotaReads || 0) + 1;
      // LIN-3267: a function yields the allowance at each read.
      return (typeof overrides.quota === 'function' ? overrides.quota() : overrides.quota) || null;
    }
    if (String(url).includes('/api/task/')) {
      if (overrides.stateApi) return overrides.stateApi(url, opts);
      return {};
    }
    if (overrides.templateApi) return overrides.templateApi(url, opts);
    return { prompt: 'TEMPLATE PROMPT', promptName: 'Template' };
  };
  window.fetchAutopilotKickoff = async (args) => {
    calls.kickoff.push(args);
    if (overrides.kickoff) return overrides.kickoff(args);
    return { prompt: 'AUTOPILOT PROMPT', promptName: 'Autopilot', kind: 'autopilot' };
  };
  window.dispatchPrompt = async (args) => {
    calls.dispatch.push(args);
    if (overrides.dispatch) return overrides.dispatch(args);
    return { item: { id: 'disp-1' } };
  };

  const world = loadWorld({
    window,
    scripts: ['prompt-section.js'],
    timers,
    globals: {
      fetch: async (url, opts) => {
        calls.fetch.push({ url, opts });
        if (String(url).includes('/api/task-mode')) { calls.records.push({ url, opts }); return { ok: true, json: async () => ({}) }; }
        if (String(url).includes('/stream')) return { ok: true };
        if (overrides.streamFetch) return overrides.streamFetch(url, opts);
        return { ok: false, status: 500, json: async () => ({}) };
      },
    },
  });

  const flush = () => new Promise((r) => setImmediate(r));
  async function runTimers() {
    const due = timers.filter((t) => !t.cancelled);
    for (const t of timers) t.cancelled = true;
    for (const t of due) t.fn();
    await flush();
    await flush();
  }
  return { PromptSection: world.PromptSection, window: world.window, calls, timers, flush, runTimers, makeContainer: world.makeContainer };
}

const ISSUE = { id: 'uuid-42', identifier: 'LIN-42', title: 'A task', source: 'linear' };

function baseOpts(extra = {}) {
  // LIN-3849: `runSetup` (the owner's "set up ›" rung) defaults to the old not-dispatch-enabled state.
  const o = {
    urlKey: 'ws',
    issue: ISSUE,
    surface: 'swipe',
    hasAI: true,
    aiState: 'ready',
    dispatchEnabled: true,
    isLocalhost: false,
    customPrompts: [],
    defaultPromptKeys: ['implementation'],
    morePromptKeys: [],
    promptMeta: { implementation: 'Implementation' },
    ...extra,
  };
  return { runSetup: !o.dispatchEnabled, ...o };
}

async function mount(overrides = {}, extra = {}, loadOverrides = {}) {
  const h = loadPromptSection({ ...overrides, ...loadOverrides });
  const container = h.makeContainer();
  h.PromptSection.init(container, baseOpts(extra));
  await h.flush();
  await h.flush();
  return { ...h, container };
}

describe('LIN-3341 — Go is one press', () => {
  test('one press: one kickoff (stopAt=pr) and one dispatch with the full payload', async () => {
    const m = await mount();
    assert.match(m.container.innerHTML, /data-rung="run-task"[^>]*data-action="go"/, 'Go is ready');
    await m.container.click({ action: 'go', rung: 'run-task' });
    await m.flush();
    await m.flush();

    assert.equal(m.calls.kickoff.length, 1, 'exactly one kickoff fetch');
    assert.equal(m.calls.kickoff[0].stopAt, 'pr', 'the kickoff is bounded to the PR');
    assert.equal(m.calls.dispatch.length, 1, 'exactly one dispatch POST');
    const d = m.calls.dispatch[0];
    assert.equal(d.kind, 'autopilot');
    assert.equal(d.entryRung, 'run-task');
    assert.equal(d.stopAt, 'pr');
    assert.equal(d.variant, 'standard');
    assert.equal(d.proxyForce, true);
    assert.equal(d.target, 'cli');
    assert.equal(d.surface, 'swipe');
    // LIN-3833 (Q1): no harness is forced on the client; the server settles a blank one for an opened-task run.
    assert.equal(d.harness, null, 'an untouched panel sends no harness (was claude-code, LIN-3211)');
    assert.match(m.container.innerHTML, /data-testid="opened-task-started"/, 'the started line is shown');
    assert.match(m.container.innerHTML, /href="\/workspace\/ws\/task\/LIN-42"[^>]*data-testid="opened-task-started-link"/, 'with a task-page link');
  });

  test('a double press makes one dispatch', async () => {
    // The first press is held in `starting` until its kickoff answers: that is the window a second press could land in.
    let releaseKickoff;
    const kickoffHeld = new Promise((r) => { releaseKickoff = r; });
    const m = await mount({ kickoff: () => kickoffHeld });
    await m.container.click({ action: 'go', rung: 'run-task' });
    await m.flush();
    // A starting Go is drawn disabled and is not pressable, so a second press has no control to land on.
    assert.equal(m.container.querySelector('[data-testid="opened-task-go"][data-action="go"]'), null, 'no pressable Go while the press is starting');
    const starting = m.container.querySelector('[data-testid="opened-task-go"]');
    assert.ok(starting && starting.hasAttribute('disabled'), 'the starting Go is drawn disabled');
    releaseKickoff({ prompt: 'AUTOPILOT PROMPT', promptName: 'Autopilot', kind: 'autopilot' });
    await m.flush();
    await m.flush();
    await m.flush();
    assert.equal(m.calls.dispatch.length, 1, 'the second press is ignored');
  });

  test('a non-blank panel harness is sent, never null', async () => {
    // The press reads the disclosure drawn on the card (startRun looks up `.swipe-prompt-options`), so the reader gets that node.
    const panels = [];
    const m = await mount({}, {}, { readDispatchExecControls: (panel) => { panels.push(panel); return { model: 'openai/gpt-5.4-mini', harness: 'opencode' }; } });
    await m.container.click({ prompt: 'implementation' });
    await m.flush();
    const card = m.container.querySelector('.swipe-prompt-options');
    assert.ok(card, 'the fresh prompt draws its disclosure');
    await m.container.click({ action: 'go', rung: 'run-task' });
    await m.flush();
    assert.equal(panels.at(-1), card, 'the press hands the reader the disclosure drawn on the card');
    assert.equal(m.calls.dispatch[0].harness, 'opencode');
    assert.equal(m.calls.dispatch[0].model, 'openai/gpt-5.4-mini');
  });

  test('Go is present in idle, generating, fresh and error', async () => {
    // idle
    const idle = await mount();
    assert.match(idle.container.innerHTML, /data-testid="opened-task-go"/);

    // generating: click ✦ next step with a stream that never settles. The click
    // handler reaches fetchPrompt's first await synchronously, so the phase is
    // already `generating` when it returns.
    const genH = loadPromptSection({ readSSEStream: () => new Promise(() => {}) });
    const genC = genH.makeContainer();
    genH.PromptSection.init(genC, baseOpts());
    await genC.click({ prompt: '__ai__' });
    assert.match(genC.innerHTML, /data-testid="opened-task-go"/, 'Go shows while generating');

    // fresh: a template result
    const fresh = await mount();
    await fresh.container.click({ prompt: 'implementation' });
    await fresh.flush();
    assert.match(fresh.container.innerHTML, /data-testid="opened-task-go"/, 'Go shows in fresh');

    // error: the template fetch throws
    const err = await mount({}, {}, { templateApi: async () => { throw new Error('boom'); } });
    await err.container.click({ prompt: 'implementation' });
    await err.flush();
    assert.match(err.container.innerHTML, /recap-error/, 'error phase rendered');
    assert.match(err.container.innerHTML, /data-testid="opened-task-go"/, 'Go shows in error');
  });

  test('a Go press during the ✦ stream does not rebuild the prompt body (N4)', async () => {
    const m = await mount({}, {}, { readSSEStream: () => new Promise(() => {}) });
    await m.container.click({ prompt: '__ai__' });
    await m.flush();
    // The streamed body is held before the press. Everything outside the Go slot is held too.
    const body = m.container.querySelector('[data-prompt-body]');
    assert.ok(body, 'the streamed prompt body is drawn');
    const kept = nodesOutside(m.container, '[data-go-slot]');
    await m.container.click({ action: 'go', rung: 'run-task' });
    await m.flush();
    // Everything outside the Go slot is still the same attached node — above all the streamed
    // [data-prompt-body], which a full render would have rebuilt (N4).
    assert.equal(m.container.querySelector('[data-prompt-body]'), body, 'the streamed body is the same node');
    for (const el of kept) assert.ok(el.isConnected, `only the Go slot was repainted: <${el.localName}> outside it was rebuilt`);
  });

  test('LIN-4247: a complete idle reply ends the run: Go returns, the started line goes, polling stops', async () => {
    // The ended reply is complete and carries `sessions` with nothing busy, as the server sends it.
    const idleReply = { live: false, status: 'idle', headerHtml: '<div class="task-status"><p class="task-sentence">No session running.</p></div>', sessions: { busy: false, action: { kind: 'offer' } } };
    const queue = [
      { live: false, status: 'idle', headerHtml: '<div class="task-status"><p class="task-sentence">No sessions yet.</p></div>' }, // mount read
      { live: false, status: 'idle', headerHtml: '<div class="task-status"><p class="task-sentence">No sessions yet.</p></div>' }, // press-time read (LIN-3446)
      { live: true, status: 'running', headerHtml: '<div class="task-status"><p class="task-sentence">Autopilot running since 12:00.</p></div>', sessions: { busy: true, action: { kind: 'busy' } } }, // first poll
      idleReply // second poll: the run has ended
    ];
    const m = await mount({}, {}, { stateApi: async () => queue.shift() || idleReply });
    await m.container.click({ action: 'go', rung: 'run-task' });
    await m.flush();
    await m.runTimers(); // first poll
    assert.match(m.container.innerHTML, /Autopilot running since 12:00\./, 'the state header sentence is painted');
    assert.match(m.container.innerHTML, /data-go-status="running"/, 'status is running');
    await m.runTimers(); // second poll: the run has ended
    assert.doesNotMatch(m.container.innerHTML, /data-testid="opened-task-started"/, 'the started line is gone');
    assert.doesNotMatch(m.container.innerHTML, /data-go-status=/, 'the Go slot is no longer started or running');
    assert.match(m.container.innerHTML, /data-testid="opened-task-go"/, 'Go returns');
    const active = m.timers.filter((t) => !t.cancelled).length;
    assert.equal(active, 0, 'polling stops once the run has ended');
  });

  // LIN-4247: the state replies in order; the last one repeats once the list is spent.
  function repliesOf(...list) {
    const q = [...list];
    return async () => (q.length > 1 ? q.shift() : q[0]);
  }
  const NOT_YET = { live: false, status: 'idle', headerHtml: '<div class="task-status"><p class="task-sentence">No sessions yet.</p></div>' };
  const LIVE = { live: true, status: 'running', headerHtml: '<div class="task-status"><p class="task-sentence">Autopilot running.</p></div>', sessions: { busy: true, action: { kind: 'busy' } } };

  test('LIN-4247: an incomplete reply is not an end: Go stays out and the poll goes on', async () => {
    // `incomplete` carries no live or status (routes/task-page.js), and sessions.busy is set, as the server sends it.
    const incomplete = { incomplete: 'cold', sessions: { busy: true, action: null } };
    const m = await mount({}, {}, { stateApi: repliesOf(NOT_YET, NOT_YET, incomplete) });
    await m.container.click({ action: 'go', rung: 'run-task' });
    await m.flush();
    await m.runTimers(); // the incomplete poll
    assert.match(m.container.innerHTML, /data-go-status="(started|running)"/, 'the started line stays');
    assert.doesNotMatch(m.container.innerHTML, /data-testid="opened-task-go"/, 'no Go while the state is not known');
    assert.equal(m.timers.filter((t) => !t.cancelled).length, 1, 'a poll is scheduled');
  });

  test('LIN-4247: a merely incomplete reply, with no sessions at all, is never an end on its own', async () => {
    // The rule must not lean on `sessions.busy`: an incomplete reply alone keeps the run started and the poll going.
    const bare = { incomplete: 'cold' };
    const m = await mount({}, {}, { stateApi: repliesOf(NOT_YET, NOT_YET, bare) });
    await m.container.click({ action: 'go', rung: 'run-task' });
    await m.flush();
    await m.runTimers();
    assert.match(m.container.innerHTML, /data-go-status="(started|running)"/, 'the started line stays');
    assert.doesNotMatch(m.container.innerHTML, /data-testid="opened-task-go"/, 'no Go on an incomplete reply');
    assert.equal(m.timers.filter((t) => !t.cancelled).length, 1, 'a poll is scheduled');
  });

  test('LIN-4247: a complete reply that is still busy (a subtask runs) is not an end', async () => {
    // live is false, but a subtask runs: the offer is `busy`. Go must not return, or a second press could start a second run.
    const busy = { live: false, status: 'idle', headerHtml: '<div class="task-status"><p class="task-sentence">A subtask runs.</p></div>', sessions: { busy: true, action: { kind: 'busy', identifier: 'LIN-43' } } };
    const m = await mount({}, {}, { stateApi: repliesOf(NOT_YET, NOT_YET, busy) });
    await m.container.click({ action: 'go', rung: 'run-task' });
    await m.flush();
    await m.runTimers();
    assert.match(m.container.innerHTML, /data-go-status="running"/, 'the started line stays');
    assert.doesNotMatch(m.container.innerHTML, /data-testid="opened-task-go"/, 'no Go while a subtask runs');
    assert.equal(m.timers.filter((t) => !t.cancelled).length, 1, 'a poll is scheduled');
  });

  test('LIN-4247: a finished task draws neither Go nor the started line when its run ends', async () => {
    // The server's `none` offer is the only decider: the ended reply carries it, and Go stays out.
    const finished = { live: false, status: 'done', headerHtml: '<div class="task-status"><p class="task-sentence">Done.</p></div>', sessions: { busy: false, action: { kind: 'none' } } };
    const m = await mount({}, {}, { stateApi: repliesOf(NOT_YET, NOT_YET, LIVE, finished) });
    await m.container.click({ action: 'go', rung: 'run-task' });
    await m.flush();
    await m.runTimers(); // live
    await m.runTimers(); // the run ended on a finished task
    assert.doesNotMatch(m.container.innerHTML, /data-testid="opened-task-go"/, 'no Go on a finished task');
    assert.doesNotMatch(m.container.innerHTML, /data-testid="opened-task-started"/, 'no started line');
    assert.doesNotMatch(m.container.innerHTML, /data-go-status=/, 'the Go slot is not started or running');
    assert.equal(m.timers.filter((t) => !t.cancelled).length, 0, 'polling stops');
  });

  test('LIN-4247: a poll read that lands after a Stop restarted the run does not end the newer run', async () => {
    // The poll read is held open; a Stop in the meantime restarts the poll with a new Go state. The held read is complete and
    // says the run ended, but it is stale: it was taken before that Stop, so it must not reset Go.
    const RUNNING_WITH_SESSION = { ...LIVE, sessions: { busy: true, action: { kind: 'busy' }, running: { loopId: 'loop-1', target: 'cli' }, canStop: true } };
    const ended = { live: false, status: 'idle', headerHtml: '<div class="task-status"><p class="task-sentence">Ended.</p></div>', sessions: { busy: false, action: { kind: 'offer' } } };
    // The idle reply a task with a runnable offer sends: the task page draws Go only when `sessions.action` is an offer.
    const OFFER = { ...NOT_YET, sessions: { busy: false, action: { kind: 'offer' } } };
    let held = null;
    let reads = 0;
    const stateApi = async () => {
      reads += 1;
      if (reads <= 2) return OFFER;   // mount, press
      if (reads === 3) return RUNNING_WITH_SESSION; // first poll
      return new Promise((resolve) => { held = resolve; }); // second poll: held open
    };
    // The task page surface: Stop is its run control (handleRunAction returns early on Swipe). This file's workspace fills
    // Run to PR, so the task page's primary control is the Go this test presses (without it that page's primary is Next step).
    const m = await mount({}, { surface: 'task', filledRung: 'pr' }, { stateApi });
    await m.container.click({ action: 'go', rung: 'run-task' });
    await m.flush();
    await m.runTimers(); // first poll: live, the session is known
    await m.runTimers(); // second poll: its read is now held
    assert.equal(typeof held, 'function', 'the second poll read is in flight');
    // Stop is a two-step press in the drawn markup: Stop opens the confirm, and only the confirm stops the run.
    await m.container.click({ action: 'stop-run' });
    await m.container.click({ action: 'stop-run-confirm' }); // Stop restarts the poll
    await m.flush();
    assert.match(m.container.innerHTML, /data-go-status="running"/, 'the run is still shown as running after Stop');
    held(ended);
    await m.flush();
    await m.flush();
    assert.match(m.container.innerHTML, /data-go-status="running"/, 'the stale read did not reset Go');
    assert.doesNotMatch(m.container.innerHTML, /data-testid="opened-task-go"/, 'no Go from the stale read');
  });

  test('a 201 no-runner warning adds our plain-words line with the runner link', async () => {
    const m = await mount({ dispatch: async () => ({ item: { id: 'd' }, warning: 'no consumer' }) });
    await m.container.click({ action: 'go', rung: 'run-task' });
    await m.flush();
    assert.match(m.container.innerHTML, /Nothing is listening for this run yet\./);
    assert.match(m.container.innerHTML, /href="\/workspace\/ws\/runner"/);
  });

  test('refusals branch on err.body.code', async () => {
    const dup = await mount({ dispatch: async () => { const e = new Error('dup'); e.status = 409; e.body = { code: 'DUPLICATE_DISPATCH' }; throw e; } });
    await dup.container.click({ action: 'go', rung: 'run-task' });
    await dup.flush();
    // LIN-3446: a duplicate refusal means a run IS live — no pressable Go, the
    // slot is in the running/watch state, and the poll is running.
    assert.doesNotMatch(dup.container.innerHTML, /data-testid="opened-task-go"/, 'no pressable Go after a duplicate refusal');
    assert.doesNotMatch(dup.container.innerHTML, /data-action="go"/, 'no Go action after a duplicate refusal');
    assert.match(dup.container.innerHTML, /data-go-status="running"/, 'the slot is in the running state');
    assert.match(dup.container.innerHTML, /href="\/workspace\/ws\/task\/LIN-42"[^>]*data-testid="opened-task-started-link"/, 'with the watch link');
    assert.equal(dup.timers.filter((t) => !t.cancelled).length, 1, 'the poll is running');
    // (d) a second press after the refusal cannot send a second dispatch: no drawn Go is left to press.
    assert.equal(dup.container.querySelector('[data-testid="opened-task-go"][data-action="go"]'), null, 'no pressable Go to press again');
    assert.equal(dup.calls.dispatch.length, 1, 'no second dispatch after the refusal');

    // LIN-3494: every other refusal shows the server's own reason, then the link.
    const refuse = async (status, body, message) => {
      const m = await mount({ dispatch: async () => { const e = new Error(message || String(status)); e.status = status; e.body = body; throw e; } });
      await m.container.click({ action: 'go', rung: 'run-task' });
      await m.flush();
      return m.container.innerHTML;
    };
    const LINK = /href="\/workspace\/ws\/runner">run on my machine ›<\/a>/;

    const limitReason = 'Daily run limit reached (10 of 10 today). Resets at midnight UTC.';
    const limited = await refuse(429, { code: 'RUN_LIMIT_REACHED', error: limitReason });
    assert.ok(limited.includes(limitReason), 'the server\u2019s run-limit reason is shown');
    assert.match(limited, LINK);
    assert.doesNotMatch(limited, /used today\u2019s runs/);

    // Witness: an arbitrary reason is shown exactly, then the link (escaping is
    // window.escapeHtml's job; the harness stubs it as identity).
    const arbitrary = await refuse(503, { error: 'Zebras are loose today' });
    assert.ok(arbitrary.includes('Zebras are loose today'), 'the reason is shown exactly');
    assert.match(arbitrary, LINK);
    assert.doesNotMatch(arbitrary, /Couldn\u2019t start the run/);

    // A code-less 503 (proxyAttachFailed) shows its reason, not the run limit.
    const nolimit = await refuse(503, { error: 'Proxy attach failed' });
    assert.ok(nolimit.includes('Proxy attach failed'));
    assert.match(nolimit, LINK);
    assert.doesNotMatch(nolimit, /used today\u2019s runs/);

    // RUN_LIMIT_UNVERIFIED (a 503 WITH a code) shows the server's reason too.
    const unverified = await refuse(503, { code: 'RUN_LIMIT_UNVERIFIED', error: 'Could not verify the run limit' });
    assert.ok(unverified.includes('Could not verify the run limit'));
    assert.match(unverified, LINK);
    // Reader order: body.error, else body.message, else error.message.
    assert.ok((await refuse(500, { message: 'from message' }, 'thrown')).includes('from message'));
    const both = await refuse(500, { error: 'from error', message: 'from message' }, 'thrown');
    assert.ok(both.includes('from error'), 'body.error wins over body.message');
    assert.ok(!both.includes('from message'));
    assert.ok((await refuse(0, null, 'Failed to fetch')).includes('Failed to fetch'), 'a network error shows the Error message');

    // Nothing at all: just the link, no fixed sentence.
    const empty = await refuse(500, {}, '');
    assert.match(empty, LINK);
    assert.doesNotMatch(empty, /Couldn\u2019t start the run/);
  });

  test('a not-set-up Go press records intent and dispatches nothing', async () => {
    const m = await mount({}, { dispatchEnabled: false });
    assert.match(m.container.innerHTML, /data-rung="run-task"[^>]*data-action="setup"/, 'Go shows ○ set up');
    await m.container.click({ action: 'setup', setupNeeds: 'dispatch', rung: 'run-task' });
    await m.flush();
    assert.match(m.container.innerHTML, /Go needs the dispatch runner set up/, 'the notice names Go, not the run-step rung');
    assert.doesNotMatch(m.container.innerHTML, /running this step needs the dispatch runner set up/);
    assert.equal(m.calls.dispatch.length, 0, 'nothing dispatched');
    assert.equal(m.calls.kickoff.length, 0, 'no kickoff');
    assert.equal(m.calls.records.length, 1, 'the press is recorded');
    assert.equal(m.calls.records[0].opts.body.includes('"rung":"run-task"'), true);
    assert.equal(m.calls.records[0].opts.body.includes('"ready":false'), true);
  });

  describe('LIN-3267 — Go re-reads the run quota after the press settles', () => {
    const Q = (remaining) => ({ limited: true, runsUsed: 10 - remaining, limit: 10, remaining });
    const seq = (...qs) => { let i = 0; return () => qs[Math.min(i++, qs.length - 1)]; };
    const goTag = (m) => m.container.innerHTML.match(/<button[^>]*data-testid="opened-task-go"[^>]*>/)[0];

    test('a successful Go press shows the re-read allowance and disables Go at zero', async () => {
      const m = await mount({}, { freeTier: true }, { quota: seq(Q(1), Q(0)) });
      assert.match(m.container.innerHTML, /1 of 10 runs left today/);
      await m.container.click({ action: 'go', rung: 'run-task' });
      await m.flush();
      await m.flush();
      assert.equal(m.calls.quotaReads, 2, 'one load read, one post-press read');
      assert.match(m.container.innerHTML, /0 of 10 runs left today/);
    });

    test('a Go press repaints only the Go and ladder slots, never the whole container', async () => {
      const m = await mount({}, { freeTier: true }, { quota: seq(Q(1), Q(0)) });
      // The ✦ next-step button sits outside the Go and ladder slots. A full render would rebuild it, so holding it proves the
      // press did not run one. Every other element outside those two slots is held the same way.
      const next = m.container.querySelector('[data-testid="opened-task-next-step"]');
      assert.ok(next, 'the ✦ next-step button is drawn outside the Go and ladder slots');
      const kept = nodesOutside(m.container, '[data-go-slot], [data-ladder-slot]');
      await m.container.click({ action: 'go', rung: 'run-task' });
      await m.flush();
      await m.flush();
      assert.equal(m.container.querySelector('[data-testid="opened-task-next-step"]'), next, 'the next-step button is the same node: no whole-container write after the press');
      for (const el of kept) assert.ok(el.isConnected, `only the Go and ladder slots were repainted: <${el.localName}> outside them was rebuilt`);
      assert.match(m.container.innerHTML, /0 of 10 runs left today/);
      assert.ok(m.container.querySelector('[data-ladder-slot]'), 'the ladder slot is still there');
    });

    test('a RUN_LIMIT_REACHED 429 leaves Go exhausted via the quota read', async () => {
      const dispatch = async () => { const e = new Error('429'); e.status = 429; e.body = { code: 'RUN_LIMIT_REACHED' }; throw e; };
      const m = await mount({ dispatch }, { freeTier: true }, { quota: seq(Q(1), Q(0)) });
      await m.container.click({ action: 'go', rung: 'run-task' });
      await m.flush();
      await m.flush();
      assert.match(goTag(m), /disabled/);
      assert.match(goTag(m), /daily run limit reached/);
      assert.match(m.container.innerHTML, /0 of 10 runs left today/);
    });
  });

  test('a run-limited Go is disabled while ✦ next step stays enabled', async () => {
    const m = await mount({}, { freeTier: true }, { quota: { limited: true, runsUsed: 10, limit: 10, remaining: 0 } });
    await m.flush();
    const go = m.container.innerHTML.match(/<button[^>]*data-testid="opened-task-go"[^>]*>/);
    assert.ok(go);
    assert.match(go[0], /disabled/);
    assert.match(go[0], /daily run limit reached/);
    const next = m.container.innerHTML.match(/<button[^>]*data-testid="opened-task-next-step"[^>]*>/);
    assert.ok(next);
    assert.doesNotMatch(next[0], / disabled/);
  });

  describe('mount-time live check', () => {
    test('live:true shows the running line and no Go, with zero dispatch POSTs', async () => {
      const m = await mount({}, {}, { stateApi: async () => ({ live: true, status: 'running', headerHtml: '<div class="task-status"><p class="task-sentence">Autopilot queued, waiting for a worker.</p></div>' }) });
      assert.match(m.container.innerHTML, /data-testid="opened-task-started"/);
      assert.match(m.container.innerHTML, /Autopilot queued, waiting for a worker\./);
      assert.doesNotMatch(m.container.innerHTML, /data-testid="opened-task-go"/);
      assert.equal(m.calls.dispatch.length, 0);
    });

    test('live:false leaves Go ready', async () => {
      const m = await mount({}, {}, { stateApi: async () => ({ live: false, status: 'idle', headerHtml: '<div class="task-status"><p class="task-sentence">No sessions yet.</p></div>' }) });
      assert.match(m.container.innerHTML, /data-rung="run-task"[^>]*data-action="go"/);
      assert.doesNotMatch(m.container.innerHTML, /data-testid="opened-task-started"/);
    });

    test('a failed read leaves Go ready', async () => {
      const m = await mount({}, {}, { stateApi: async () => { throw new Error('offline'); } });
      assert.match(m.container.innerHTML, /data-rung="run-task"[^>]*data-action="go"/);
    });

    test('waiting (live:false, status:waiting) counts as in progress — no Go, zero POSTs (round-3 1A)', async () => {
      const m = await mount({}, {}, { stateApi: async () => ({ live: false, status: 'waiting', headerHtml: '<div class="task-status"><p class="task-sentence">Waiting for your answer.</p></div>' }) });
      assert.doesNotMatch(m.container.innerHTML, /data-testid="opened-task-go"/, 'Go is suppressed while waiting');
      assert.match(m.container.innerHTML, /Waiting for your answer\./);
      assert.equal(m.calls.dispatch.length, 0);
    });

    test('no Go read when Go is not set up, and no read at all when urlKey/identifier is missing or window.api is absent', async () => {
      // LIN-3833: the one mount read also paints the state block for every viewer, so a viewer with no
      // dispatch still reads once. What is gated is Go: no Go button and no press-time dispatch.
      const notReady = await mount({}, { dispatchEnabled: false });
      assert.equal(notReady.calls.dispatch.length, 0);
      assert.equal(notReady.calls.api.filter((u) => String(u).includes('/api/task/')).length, 1, 'one display read, and no Go read');

      const noKey = loadPromptSection();
      noKey.PromptSection.init(noKey.makeContainer(), baseOpts({ urlKey: '' }));
      await noKey.flush();
      assert.equal(noKey.calls.api.some((u) => String(u).includes('/api/task/')), false, 'no urlKey → no read');

      const noIdent = loadPromptSection();
      noIdent.PromptSection.init(noIdent.makeContainer(), baseOpts({ issue: { id: 'uuid-42' } }));
      await noIdent.flush();
      assert.equal(noIdent.calls.api.some((u) => String(u).includes('/api/task/')), false, 'no identifier → no read');

      const noApi = loadPromptSection();
      delete noApi.window.api;
      const c = noApi.makeContainer();
      noApi.PromptSection.init(c, baseOpts());
      await noApi.flush();
      assert.match(c.innerHTML, /data-rung="run-task"[^>]*data-action="go"/, 'Go still renders without window.api');
    });

    test('a result landing after destroy is a no-op', async () => {
      let resolveState;
      const deferred = new Promise((r) => { resolveState = r; });
      const h = loadPromptSection({ stateApi: () => deferred });
      const c = h.makeContainer();
      const ret = h.PromptSection.init(c, baseOpts());
      ret.destroy();
      const beforeLate = c.innerHTML;
      resolveState({ live: true, status: 'running', headerHtml: '<div>x</div>' });
      await h.flush();
      assert.equal(c.innerHTML, beforeLate, 'a late read writes nothing to the container');
      assert.doesNotMatch(c.innerHTML, /data-testid="opened-task-started"/, 'the post-destroy read does not paint');
      assert.match(c.innerHTML, /data-rung="run-task"[^>]*data-action="go"/, 'the pre-destroy render is untouched');
    });

    // LIN-3446: the press reads the state afresh; the mount read is not trusted.
    const IDLE = { live: false, status: 'idle', headerHtml: '<div class="task-status"><p class="task-sentence">No sessions yet.</p></div>' };
    const stateReads = (m) => m.calls.api.filter((u) => String(u).includes('/api/task/')).length;

    test('mount says idle, press-time read says live: no dispatch, running line, poll started', async () => {
      const queue = [IDLE, { live: true, status: 'running', headerHtml: '<div class="task-status"><p class="task-sentence">Autopilot running since 09:00.</p></div>' }];
      const m = await mount({}, {}, { stateApi: async () => queue.shift() || IDLE });
      assert.match(m.container.innerHTML, /data-action="go"/, 'Go rendered from the idle mount read');
      await m.container.click({ action: 'go', rung: 'run-task' });
      await m.flush();
      await m.flush();
      assert.equal(m.calls.dispatch.length, 0, 'no dispatch');
      assert.equal(m.calls.kickoff.length, 0, 'no kickoff');
      assert.doesNotMatch(m.container.innerHTML, /data-action="go"/);
      assert.match(m.container.innerHTML, /Autopilot running since 09:00\./);
      assert.equal(m.timers.filter((t) => !t.cancelled).length, 1, 'the poll is running');
    });

    test('mount says idle, press-time read says waiting: no dispatch, running line', async () => {
      const queue = [IDLE, { live: false, status: 'waiting', headerHtml: '<div class="task-status"><p class="task-sentence">Waiting for your answer.</p></div>' }];
      const m = await mount({}, {}, { stateApi: async () => queue.shift() || IDLE });
      await m.container.click({ action: 'go', rung: 'run-task' });
      await m.flush();
      await m.flush();
      assert.equal(m.calls.dispatch.length, 0, 'no dispatch');
      assert.doesNotMatch(m.container.innerHTML, /data-action="go"/);
      assert.match(m.container.innerHTML, /Waiting for your answer\./);
      assert.equal(m.timers.filter((t) => !t.cancelled).length, 1, 'the poll is running');
    });

    test('a press reads the state again even when the mount read already resolved', async () => {
      const m = await mount({}, {}, { stateApi: async () => IDLE });
      const before = stateReads(m);
      await m.container.click({ action: 'go', rung: 'run-task' });
      await m.flush();
      await m.flush();
      assert.equal(stateReads(m), before + 1, 'one fresh read at press time');
      assert.equal(m.calls.dispatch.length, 1, 'idle at press time still dispatches once');
    });

    test('a failed press-time read proceeds: the read is best-effort, the server duplicate guard stays the backstop', async () => {
      let n = 0;
      const m = await mount({}, {}, { stateApi: async () => { n += 1; if (n > 1) throw new Error('offline'); return IDLE; } });
      await m.container.click({ action: 'go', rung: 'run-task' });
      await m.flush();
      await m.flush();
      assert.equal(m.calls.dispatch.length, 1, 'a failed read is not a block');
      assert.match(m.container.innerHTML, /data-testid="opened-task-started"/);
    });

    test('a press while the read is in flight waits, then dispatches when the read is not live', async () => {
      let resolveState;
      const deferred = new Promise((r) => { resolveState = r; });
      const m = await mount({}, {}, { stateApi: () => deferred });
      await m.container.click({ action: 'go', rung: 'run-task' });
      assert.equal(m.calls.dispatch.length, 0, 'dispatch waits for the read');
      resolveState({ live: false, status: 'idle', headerHtml: '<div>x</div>' });
      await m.flush();
      await m.flush();
      await m.flush();
      assert.equal(m.calls.dispatch.length, 1, 'the press proceeds once the read says not-live');
    });

    test('a press while the read is in flight paints the running line and starts the poll when live (round-3 1B)', async () => {
      let resolveState;
      const deferred = new Promise((r) => { resolveState = r; });
      const m = await mount({}, {}, { stateApi: () => deferred });
      await m.container.click({ action: 'go', rung: 'run-task' });
      resolveState({ live: true, status: 'running', headerHtml: '<div class="task-status"><p class="task-sentence">Autopilot running since 09:00.</p></div>' });
      await m.flush();
      await m.flush();
      await m.flush();
      assert.equal(m.calls.dispatch.length, 0, 'no second run is started');
      assert.match(m.container.innerHTML, /Autopilot running since 09:00\./, 'the running line is painted, not stuck on starting');
      assert.equal(m.timers.filter((t) => !t.cancelled).length, 1, 'the poll is running');
    });
  });
});
