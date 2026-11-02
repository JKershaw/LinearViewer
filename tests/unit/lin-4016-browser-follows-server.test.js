/**
 * LIN-4016 W4 — the browser follows the server. The run control reads the decision the server sent (`sessions.action`,
 * `sessions.canStop`, `sessions.queued`, `sessions.busy`, and the row's record) and paints it. Each case feeds a
 * `/state` body whose decision contradicts what the old browser would have inferred from the other fields (an offered
 * step with no action; a running session that cannot be stopped; a finished row with a tracker type the old list did
 * not know; a queued session with no queued decision). If a copy of the rule came back, the contradiction would show.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { escapeHtml } from '../../lib/utils/html.js';
import { rowRecordOf, rowDataByNodeKey } from '../../lib/task-board-view.js';
import { nodeKey } from '../../lib/tree.js';
import { stateBodyOf, stateIssue, failedStageLoop } from '../fixtures/state-route.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/prompt-section.js'), 'utf8');
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeContainer() {
  const listeners = {};
  let html = '';
  let written = {};
  const markupValue = (testid) => {
    const tag = new RegExp(`<(input|select)\\b[^>]*data-testid="${testid}"[^>]*>`).exec(html);
    if (!tag) return undefined;
    if (tag[1] === 'input') return /\svalue="([^"]*)"/.exec(tag[0])?.[1] ?? '';
    const block = html.slice(tag.index, html.indexOf('</select>', tag.index));
    return /<option value="([^"]*)"[^>]*\sselected/.exec(block)?.[1] ?? '';
  };
  const panelRoot = {
    querySelector(sel) {
      const m = /^\[data-testid="([^"]+)"\]$/.exec(sel);
      if (!m || markupValue(m[1]) === undefined) return null;
      const testid = m[1];
      return {
        get value() { return testid in written ? written[testid] : markupValue(testid); },
        set value(v) { written[testid] = v; }
      };
    }
  };
  // The Change panel's summary is an element the page updates in place when a pick or a typed model changes it (LIN-3992),
  // so it reads and writes its own text in the markup, as a real element's textContent does.
  const summaryNode = {
    get textContent() { return /data-testid="run-will-use">([^<]*)</.exec(html)?.[1] ?? ''; },
    set textContent(v) { html = html.replace(/(data-testid="run-will-use">)[^<]*/, (_, open) => open + escapeHtml(v)); }
  };
  const container = {
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; written = {}; },
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {},
    getAttribute() { return null; },
    querySelector(sel) {
      if (sel === '[data-testid="run-will-use"]') return html.includes('data-testid="run-will-use"') ? summaryNode : null;
      return sel === '[data-decision-panel]' && html.includes('data-decision-panel') ? panelRoot : null;
    },
    contains() { return true; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    async click(dataset) {
      const btn = { dataset: { ...dataset }, disabled: false, textContent: '', classList: { add() {}, remove() {} }, closest: (sel) => (/^button/.test(sel) ? btn : null) };
      for (const fn of listeners.click || []) await fn({ target: btn });
      return btn;
    },
    async fire(type, target) {
      const el = { dataset: {}, closest: () => null, ...target };
      for (const fn of listeners[type] || []) await fn({ target: el });
    },
  };
  return container;
}

// The state body, the way /state sends it (routes/task-page.js): the sessions block is the server's, the row record too.
function loadClient({ stateBody, container = false }) {
  const calls = { api: [] };
  const window = {
    escapeHtml: (x) => (x == null ? '' : escapeHtml(String(x))),
    stripCodeBlockWrapper: (x) => x,
    renderMarkdown: (x) => String(x == null ? '' : x),
    api: async (url) => {
      calls.api.push(url);
      if (url.includes('/api/task/')) return typeof stateBody === 'function' ? stateBody() : stateBody;
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
  };
  const sandbox = {
    window, AbortController, URLSearchParams, TextDecoder, TextEncoder, Blob: class {}, URL,
    document: { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } },
    requestAnimationFrame: (cb) => { cb(); return 1; },
    setTimeout: (fn, ms) => { const t = globalThis.setTimeout(fn, ms); if (t && t.unref) t.unref(); return t; },
    clearTimeout,
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'prompt-section.js' });
  return { PromptSection: sandbox.window.PromptSection, calls, container };
}

const HOME_ISSUE = { id: 'uuid-42', identifier: 'LIN-42', title: 'T', url: '', source: 'linear', stateType: 'started' };
const HOME = {
  urlKey: 'acme', surface: 'home', dispatchEnabled: true, runSetup: false, hasAI: true, aiState: 'ok', isLocalhost: false,
  promptMeta: { plan: 'Plan', implementation: 'Build', research: 'Research', scoping: 'Scoping', review: 'Review' },
  stageWords: { plan: 'Plan', implementation: 'Build', research: 'Research', scoping: 'Scoping', review: 'Review' },
  defaultPromptKeys: ['look-into', 'research', 'plan', 'implementation'],
  morePromptKeys: ['review', 'scoping'],
  issue: HOME_ISSUE,
  row: rowRecordOf({ stateType: 'started' }),
};

// A state body whose sessions say what the server decided: `running`, `queued`, `busy`, `action`, `canStop` as given.
const stateWith = (sessions) => ({
  status: 'idle', live: false, headerHtml: '', stripHtml: '', homeStatusHtml: '',
  sessions: { count: 1, next: null, last: null, offered: null, excluded: [], queued: null, busy: false, action: null, canStop: false, running: null, ...sessions },
});

async function paint(stateBody, opts = {}) {
  const { PromptSection } = loadClient({ stateBody, container: !!opts.row?.container });
  const c = makeContainer();
  PromptSection.init(c, { ...HOME, ...opts });
  await flush(); await flush(); await flush();
  return c.innerHTML;
}

const PLAN_OFFER = { kind: 'plan', label: 'Plan', why: 'usual', failed: false, reason: 'usually next after Research' };

describe('LIN-4016 W4 — the run control paints the server\'s decision', () => {
  test('an offered step with action null (busy on the server): no step button and no Run to PR, whatever the offer says', async () => {
    const html = await paint(stateWith({ offered: PLAN_OFFER, action: null, busy: true }));
    assert.doesNotMatch(html, /data-action="run-step-next"/, 'busy offers no step button');
    assert.doesNotMatch(html, /Run to PR/, 'busy offers no Run to PR');
  });

  test('the server\'s step action is the main button, even with no offer field', async () => {
    const html = await paint(stateWith({ offered: PLAN_OFFER, action: { kind: 'offer', step: PLAN_OFFER, why: PLAN_OFFER.reason } }));
    assert.match(html, /data-action="run-step-next"[^>]*>Run Plan</);
  });

  test('a container: the server\'s run-to-pr action is Run to PR and no stage step, even when an offer is set', async () => {
    const html = await paint(stateWith({ offered: PLAN_OFFER, action: { kind: 'offer', why: 'a container runs to PR' } }), { row: rowRecordOf({ stateType: 'started', container: true }), filledRung: 'pr' });
    assert.match(html, /data-action="go"[^>]*>Run to PR</);
    assert.doesNotMatch(html, /run-step-next/);
  });

  test('a running session whose canStop is false has no Stop, whatever its target', async () => {
    const running = { loopId: 'loop-1', kind: 'implementation', label: 'Build', state: 'running', since: '2026-10-30T10:00:00.000Z', target: 'cli' };
    const html = await paint(stateWith({ running, busy: true, action: null, canStop: false }));
    assert.doesNotMatch(html, /data-testid="run-stop"/, 'the server says this run cannot be stopped from here');
  });

  test('a running session whose canStop is true has Stop', async () => {
    const running = { loopId: 'loop-1', kind: 'implementation', label: 'Build', state: 'running', since: '2026-10-30T10:00:00.000Z', target: 'local' };
    const html = await paint(stateWith({ running, busy: true, action: null, canStop: true }));
    assert.match(html, /data-testid="run-stop"/);
  });

  test('a queued run (the server\'s queued) reads queued with Undo, and never as running', async () => {
    const queued = { loopId: 'q-1', kind: 'implementation', label: 'Build', state: 'queued', target: 'cli' };
    const html = await paint(stateWith({ running: queued, queued, busy: true, action: null, canStop: true }));
    assert.match(html, /data-testid="opened-task-queued"/);
    assert.doesNotMatch(html, /data-testid="opened-task-running"/);
  });

  test('the row record is the one lookup: every Home row carries it, keyed by node key', () => {
    const node = (identifier, children = []) => ({ issue: { id: `id-${identifier}`, identifier, title: identifier, source: 'linear', state: { name: 'started', type: 'started' } }, children });
    const parent = node('LIN-P', [node('LIN-C')]);
    const byKey = rowDataByNodeKey({ urlKey: 'acme', inProgressTrees: [{ roots: [parent] }], rowStates: new Map() });
    // LIN-4071: the record carries the gatherer's action and copy words; the container fact is the gather's (LIN-4039 pins it).
    assert.ok('action' in byKey[nodeKey(parent.issue)], 'the record carries the action field');
    assert.equal(Object.keys(byKey).length, 2, 'a record for every row, leaves included');
  });
});

// The opened task agrees with its row when the row is decided by the tracker (done): /state has no tracker, so for a
// finished task whose last stage failed it says failed, and the browser paints the row's own word instead.
describe('LIN-4016 — the opened task agrees with its row (finished, and a failed subtask)', () => {
  const FAILED_PILL = '<div class="task-status task-status--home" data-testid="home-task-status"><span class="status-pill status-pill--error task-status-pill" data-testid="home-task-status-pill"><span class="status-pill__dot" aria-hidden="true"></span>failed</span></div>';

  // REWRITTEN (LIN-4070): the body was fabricated with a failed pill, which the server no longer sends for a Done task (the
  // gather words it done, D2). The body is now the one `/state` returns for a Done task whose last stage failed.
  test('a finished row whose last stage failed: the server words it done, the box paints done, and offers no stage', async () => {
    const { body } = await stateBodyOf({ issues: [stateIssue('LIN-42', 'completed')], loops: [failedStageLoop('LIN-42')], identifier: 'LIN-42' });
    assert.match(body.homeStatusHtml, /status-pill--done/, 'the server words a finished task done (LIN-4070 D2)');
    assert.doesNotMatch(body.homeStatusHtml, /status-pill--error/);
    assert.equal(body.sessions.action.kind, 'none', 'a finished task offers no action (LIN-4042): the no-run decision');
    const row = rowRecordOf({ stateType: 'completed', decided: { action: body.sessions.action } });
    const html = await paint(body, { row });
    assert.match(html, /status-pill--done task-status-pill" data-testid="home-task-status-pill"><span class="status-pill__dot" aria-hidden="true"><\/span>done</);
    assert.doesNotMatch(html, /status-pill--error/, 'no failed pill beside a done row');
    assert.doesNotMatch(html, /data-action="run-step-next"/, 'a finished task offers no stage step');
  });

  test('a finished row with no decided word keeps /state\'s own line (the record carries no state word: /state says it, LIN-4071)', async () => {
    const row = rowRecordOf({ stateType: 'completed' });
    assert.equal('stateWord' in row, false, 'the record carries no state word');
    const html = await paint({ ...stateWith({}), homeStatusHtml: FAILED_PILL }, { row });
    assert.match(html, /status-pill--error/);
  });

  test('a parent whose subtask failed names it as failed, and does not say it needs a person', async () => {
    // LIN-4071: the subtask line is `/state`'s `attention` (the gather's words); the browser builds the link from the task's source.
    const attention = { identifier: 'C-9', title: null, state: 'failed', lead: 'A subtask failed', detail: ' · Build failed', words: 'A subtask failed: C-9 · Build failed' };
    const html = await paint({ ...stateWith({}), attention }, { row: rowRecordOf({ stateType: 'started' }) });
    assert.match(html, /A subtask failed: <span class="opened-task-needs-you-name">C-9<\/span> · Build failed/);
    assert.doesNotMatch(html, /needs you/);
  });
});

// LIN-4069 (piece A of LIN-4068), review ledger item 2: before the first `/state` reply the opened box has no sessions, so
// `mainActionOf` takes the row record's action (the gatherer's decision). No other test drove this fallback: ignoring
// `opts.row.action` left all 488 tests that load prompt-section green (review mutation M4).
describe('LIN-4069 — before the first /state reply the run control takes the row record\'s action', () => {
  // `/state` never answers: the box is painted from the row record alone.
  const PENDING = new Promise(() => {});

  test('the row\'s run-to-pr action shows Run to PR with no sessions yet', async () => {
    const row = rowRecordOf({ stateType: 'started', decided: { state: 'next', action: { kind: 'offer', why: 'a container runs to PR' } } });
    assert.deepEqual(row.action, { kind: 'offer', why: 'a container runs to PR' });
    const html = await paint(PENDING, { row, filledRung: 'pr' });
    assert.match(html, /data-action="go"[^>]*>Run to PR</);
  });

  test('a row whose action is null (busy subtree, or finished) shows no run before /state replies', async () => {
    const row = rowRecordOf({ stateType: 'started', decided: { state: 'running', action: null } });
    assert.equal(row.action, null);
    const html = await paint(PENDING, { row });
    assert.doesNotMatch(html, /Run to PR/);
    assert.doesNotMatch(html, /run-step-next/);
    assert.doesNotMatch(html, /data-action="go"/);
  });

  test('once /state replies, its sessions.action wins over the row\'s (the row only fills the gap before the reply)', async () => {
    const row = rowRecordOf({ stateType: 'started', decided: { state: 'next', action: { kind: 'offer', why: 'row' } } });
    const html = await paint(stateWith({ offered: PLAN_OFFER, action: null, busy: true }), { row });
    assert.doesNotMatch(html, /Run to PR/, 'the server\'s busy decision removes the row\'s offer');
  });
});

describe('LIN-4104 D1 — the browser draws the offer kind and names no run for answer-first or busy', () => {
  test('answer-first (a question needs you): no Go, no Run to PR and no step button, whatever the offer says', async () => {
    const html = await paint(stateWith({ offered: PLAN_OFFER, busy: true, action: { kind: 'answer-first', identifiers: ['LIN-42'], why: 'a question needs you before a run is offered' } }));
    assert.doesNotMatch(html, /data-action="go"/, 'no Go while a question is open');
    assert.doesNotMatch(html, /data-action="run-step-next"/, 'no step button while a question is open');
    assert.doesNotMatch(html, /Run to PR/);
  });

  test('busy with the run named (kind busy): no Go and no step button, the run line is the box\'s', async () => {
    const html = await paint(stateWith({ offered: PLAN_OFFER, busy: true, action: { kind: 'busy', identifier: 'LIN-42', words: 'Build running', why: 'x' } }));
    assert.doesNotMatch(html, /data-action="go"/);
    assert.doesNotMatch(html, /data-action="run-step-next"/);
  });
});

// LIN-4104 D2: the filled run button follows the viewer's last dispatch on this workspace (`filledRung`, read once per
// page load). Next step is the filled default for a workspace with no prior dispatch; Run to Done is drawn disabled until
// its kickoff lands (D4); a failed stage still names its step (LIN-3968).
describe('LIN-4104 D2 — the filled run button follows the last dispatch on this workspace', () => {
  const OFFER = { kind: 'offer', container: false, step: null, why: 'the run control offers the three rungs' };

  test('filled pr (the last dispatch was a Run to PR): the primary button is Run to PR', async () => {
    const html = await paint(stateWith({ action: OFFER }), { filledRung: 'pr' });
    assert.match(html, /data-testid="opened-task-go"[^>]*data-action="go"[^>]*>Run to PR</, 'Run to PR is the primary');
    assert.match(html, /data-filled-rung="pr"/, 'the button says which rung it fills');
  });

  test('a new workspace with no prior dispatch (filledRung next-step): the primary button is Next step', async () => {
    const html = await paint(stateWith({ action: OFFER }), { filledRung: 'next-step' });
    assert.match(html, /data-testid="opened-task-go"[^>]*data-filled-rung="next-step"[^>]*>Next step</, 'Next step is the primary');
    assert.doesNotMatch(html, /data-testid="opened-task-go"[^>]*>Run to PR</, 'Run to PR is not the primary');
  });

  test('an unset filledRung is a workspace with no prior dispatch: Next step, the same as next-step', async () => {
    const html = await paint(stateWith({ action: OFFER }));
    assert.match(html, /data-testid="opened-task-go"[^>]*data-filled-rung="next-step"[^>]*>Next step</);
  });

  test('filled done (the last dispatch was a Run to Done): Run to Done is the primary and starts the no-stop kickoff (D4), and Run to PR stays available', async () => {
    const html = await paint(stateWith({ action: OFFER }), { filledRung: 'done' });
    assert.match(html, /data-testid="opened-task-go"[^>]*data-action="go-done"[^>]*data-filled-rung="done"[^>]*>Run to Done</, 'Run to Done is the primary');
    assert.doesNotMatch(html, /data-filled-rung="done"[^>]*disabled/, 'and it is enabled');
    assert.match(html, /data-testid="opened-task-run-to-pr"[^>]*data-action="go"[^>]*>Run to PR</, 'Run to PR is still offered beside it');
  });

  // LIN-4104 review finding 1: every offer draws all three rungs in trust order, and only the filled one is primary.
  for (const filledRung of ['next-step', 'pr', 'done']) {
    test(`filled ${filledRung}: all three rungs are drawn in trust order, and only the filled one is primary`, async () => {
      const html = await paint(stateWith({ action: OFFER }), { filledRung });
      // Whole button elements (opening tag and label), so the label is seen with its tag.
      const tags = [...html.matchAll(/<button\b[^>]*>[^<]*<\/button>/g)].map((m) => m[0]);
      const rungTag = (name) => tags.find((tag) => tag.endsWith(`>${name}</button>`));
      const names = ['Next step', 'Run to PR', 'Run to Done'];
      const drawn = names.map((n) => tags.findIndex((tag) => tag.endsWith(`>${n}</button>`)));
      drawn.forEach((at, i) => assert.ok(at >= 0, `${names[i]} is drawn`));
      assert.deepEqual(drawn, [...drawn].sort((a, b) => a - b), 'in trust order: Next step, Run to PR, Run to Done');
      const primaries = tags.filter((tag) => /\bbtn--primary\b/.test(tag) && /data-testid="opened-task-go"/.test(tag));
      assert.equal(primaries.length, 1, 'exactly one primary');
      assert.match(primaries[0], new RegExp(`data-filled-rung="${filledRung}"`), 'the primary is the filled rung');
      for (const n of names) {
        const tag = rungTag(n);
        if (!tag.includes(`data-filled-rung="${filledRung}"`)) assert.match(tag, /btn--quiet/, `${n} is quiet when it is not the filled rung`);
      }
    });
  }

  test('a failed stage keeps its step as the primary and still draws all three rungs beside it (LIN-3968, finding 1)', async () => {
    const html = await paint(stateWith({ offered: PLAN_OFFER, action: { ...OFFER, step: PLAN_OFFER } }), { filledRung: 'done' });
    assert.match(html, /data-testid="opened-task-go"[^>]*data-action="run-step-next"[^>]*>Run Plan</);
    assert.match(html, />Next step</);
    assert.match(html, /data-testid="opened-task-run-to-pr"[^>]*>Run to PR</);
    assert.match(html, /data-testid="opened-task-run-to-done"[^>]*>Run to Done</);
  });

  test('a failed stage still names its step as the primary, whatever the filled rung (LIN-3968)', async () => {
    const html = await paint(stateWith({ offered: PLAN_OFFER, action: { ...OFFER, step: PLAN_OFFER } }), { filledRung: 'next-step' });
    assert.match(html, /data-testid="opened-task-go"[^>]*data-action="run-step-next"[^>]*>Run Plan</);
  });

  test('Another step is a run-step, so the dispatch it records fills Next step: the rung fills next-step on the next load', async () => {
    // The server records a run-step as next-step (lin-4104-reach.test.js); the page then paints the Next step primary.
    const html = await paint(stateWith({ action: OFFER }), { filledRung: 'next-step' });
    assert.match(html, /data-filled-rung="next-step"/);
  });
});

// LIN-4104 review finding 2: a step run from Another step re-reads the offer before it fetches or dispatches the step.
describe('LIN-4104 review finding 2 — a step picked from Another step is refused when its offer is stale', () => {
  test('a stale press of the picked step fetches no prompt, dispatches nothing, and says a run started', async () => {
    const OFFER_LEAF = { kind: 'offer', container: false, step: null, why: 'the run control offers the three rungs' };
    const BUSY = { busy: true, action: { kind: 'busy', identifier: 'LIN-43', words: 'Build running', why: 'x' } };
    // The page renders the offer; the server answers busy on every read after the pick (a run started since the render).
    let serverBusy = false;
    const body = () => stateWith({ action: serverBusy ? BUSY.action : OFFER_LEAF, ...(serverBusy ? { busy: true } : {}) });
    const { PromptSection, calls } = loadClient({ stateBody: body });
    const c = makeContainer();
    PromptSection.init(c, { ...HOME, filledRung: 'pr' });
    await flush(); await flush(); await flush();
    await c.click({ action: 'run-another' });
    await flush(); await flush(); await flush();
    await c.click({ action: 'run-pick', kind: 'implementation', label: 'Build' });
    await flush(); await flush(); await flush();
    assert.match(c.innerHTML, /data-action="run-step-next"/, 'the picked step is the primary');
    serverBusy = true;
    calls.api.length = 0;
    await c.click({ action: 'run-step-next' });
    await flush(); await flush(); await flush();
    assert.equal(calls.api.some((u) => u.includes('/api/prompt/')), false, 'no prompt is fetched on a stale press');
    assert.match(c.innerHTML, /A run started on this task while you were choosing/, 'a plain refusal says nothing was started');
  });
});

// LIN-4104 D4 (the corrective from beat 3): Another step re-reads the offer at its press. A run that started between the
// render and the press makes the offer no longer an offer, so the list does not open, and the press says so in plain words.
describe('LIN-4104 D4 — Another step re-reads the offer at its press', () => {
  test('a run starts between render and Another step: the list does not open, and a plain refusal says nothing was started', async () => {
    const body = stateWith({ action: { kind: 'offer', container: false, step: null, why: 'the run control offers the three rungs' } });
    const { PromptSection } = loadClient({ stateBody: body });
    const c = makeContainer();
    PromptSection.init(c, { ...HOME, filledRung: 'pr' });
    await flush(); await flush(); await flush();
    assert.doesNotMatch(c.innerHTML, /data-testid="run-another-item"/, 'the list is closed on the render');
    // A subtask's run starts after the render: the container's offer is now busy.
    body.sessions = { ...body.sessions, busy: true, action: { kind: 'busy', identifier: 'LIN-43', words: 'Build running', why: 'x' } };
    await c.click({ action: 'run-another' });
    await flush(); await flush(); await flush();
    assert.doesNotMatch(c.innerHTML, /data-testid="run-another-item"/, 'the list does not open on a stale offer');
    assert.match(c.innerHTML, /A run started on this task while you were choosing/, 'a plain refusal says nothing was started');
  });
});
