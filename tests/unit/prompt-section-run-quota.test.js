// LIN-3239 — the Go ladder shows the caller's own run allowance before Go and
// disables ONLY the run rungs at zero. Copy and ✦ generation stay enabled:
// prompts are unlimited, so the run state never leaks into the prompt controls.
//
// The allowance is read from S1's GET /api/dispatch/quota at load, only when
// the caller marks the workspace free-tier. It runs in the shared client world
// (tests/unit/helpers/client-world.js), with the real dispatch disclosure from public/common.js.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from './helpers/client-world.js';
import { harnessModelsBlock } from '../../lib/model-routing-harnesses.js';

const flush = () => new Promise((r) => setImmediate(r));

const RUN_LIMIT_TITLE = 'daily run limit reached \u00b7 resets at midnight UTC';

// The fake DOM models the named entities a browser decodes only from a short table, and it throws on the rest. The real
// dispatch disclosure (public/common.js) emits two of the others: an em dash in the blank option and an ellipsis in its
// other text. Both are decoded here, the way a browser decodes them, before the markup reaches the fake. Any other entity
// still throws.
function browserMarkup(html) {
  return html.replace(/&mdash;/g, '\u2014').replace(/&hellip;/g, '\u2026');
}

// Every element in the container outside `slotSelector`, in document order. A slot repaint keeps all of them: the same
// nodes, still attached. A full render detaches them all.
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

// The client world: the real public/common.js (the dispatch disclosure and its exec controls come from it) and
// public/prompt-section.js. The stubs this suite names are set after load, so they replace common.js's own definitions.
function loadPromptSection({ quota, dispatch } = {}) {
  const calls = { api: [], dispatch: [], order: [], readers: [] };
  const timers = [];
  const world = loadWorld({
    window: {
      __HARNESS_MODELS__: harnessModelsBlock(),
      location: { pathname: '/workspace/ws/swipe' },
    },
    scripts: ['common.js', 'prompt-section.js'],
    timers,
    globals: {
      // This suite's own default: an unstubbed read answers `ok: false`. The shared default (`ok: true`) would hide that branch.
      fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    },
  });
  const { window } = world;
  window.api = async (url) => {
    calls.api.push(url);
    if (String(url).endsWith('/api/dispatch/quota')) {
      calls.order.push('quota');
      // LIN-3267: a function yields the allowance at each read.
      return typeof quota === 'function' ? quota() : quota;
    }
    return { prompt: 'TEMPLATE PROMPT', promptName: 'Template' };
  };
  window.fetchAutopilotKickoff = async () => ({ prompt: 'AUTOPILOT PROMPT', promptName: 'Autopilot', kind: 'autopilot' });
  window.dispatchPrompt = async (args) => {
    calls.dispatch.push(args);
    calls.order.push('dispatch');
    if (dispatch) return dispatch(args);
    return { item: { id: 'disp-1' } };
  };
  window.ProxyToggle = {
    maybeAppend: async (raw, urlKey, opts) => (opts && opts.force ? `${raw}\n\n## Workspace API access` : raw),
  };
  window.toast = () => {};
  // The disclosure is production's own. Its markup gets the browser's entity decode before the fake parses it.
  const realDisclosure = window.renderDispatchDisclosure;
  window.renderDispatchDisclosure = (opts) => browserMarkup(realDisclosure(opts));
  // The reader is stubbed: production's reads the values of the harness and model `<select>`s, which the fake does not
  // model. The stub records the scope it is handed, so a test can check which element a press passes it.
  window.readDispatchExecControls = (scopeEl) => {
    calls.readers.push(scopeEl);
    return { model: null, harness: null };
  };

  // Fire every collected timer once (the 2s button restore, the re-read after it), then let reads settle.
  async function runTimers() {
    const due = timers.splice(0).filter((t) => !t.cancelled);
    for (const t of due) t.fn();
    await flush();
    await flush();
  }
  return { PromptSection: window.PromptSection, window, calls, timers, runTimers, makeContainer: world.makeContainer };
}

const ISSUE = { id: 'uuid-42', identifier: 'LIN-42', title: 'A task' };

function baseOpts(extra = {}) {
  // LIN-3849: `runSetup` (the owner's "set up ›" rung) defaults to the old not-dispatch-enabled state.
  const o = {
    urlKey: 'ws',
    issue: ISSUE,
    surface: 'swipe',
    hasAI: true,
    aiState: 'ready',
    freeTier: true,
    dispatchEnabled: true,
    isLocalhost: false,
    customPrompts: [],
    defaultPromptKeys: ['implementation'],
    morePromptKeys: [],
    promptMeta: { implementation: 'Implementation' },
    // LIN-4040 close-out (review A): the run-step rung is enabled only while the card's offer says `offer`.
    row: { action: { kind: 'offer', container: false, step: null, why: 'the run control offers the three rungs' } },
    ...extra,
  };
  return { runSetup: !o.dispatchEnabled, ...o };
}

async function mountIdle(extra, loadOpts) {
  const loaded = loadPromptSection(loadOpts);
  const container = loaded.makeContainer();
  loaded.PromptSection.init(container, baseOpts(extra));
  await flush();
  await flush();
  return { ...loaded, container };
}

async function mountFresh(extra, loadOpts) {
  const m = await mountIdle(extra, loadOpts);
  await m.container.click({ prompt: 'implementation' });
  await flush();
  await flush();
  return m;
}

function tagFor(html, rung) {
  const m = html.match(new RegExp(`<button[^>]*data-rung="${rung}"[^>]*>`));
  return m ? m[0] : null;
}

const QUOTA_FULL = { limited: true, runsUsed: 3, limit: 10, remaining: 7, resetsAt: '2026-10-03T00:00:00.000Z' };
const QUOTA_ZERO = { limited: true, runsUsed: 10, limit: 10, remaining: 0, resetsAt: '2026-10-03T00:00:00.000Z' };

describe('LIN-3239 — ladder run allowance', () => {
  test('N>0: Go shows "N of <limit> runs left today" and Go + run this step are ready', async () => {
    const m = await mountFresh({}, { quota: QUOTA_FULL });
    const html = m.container.innerHTML;

    assert.match(html, /data-testid="opened-task-run-quota"/, 'the allowance is shown');
    assert.match(html, /data-runs-remaining="7"/, 'remaining comes from the response, never hard-coded');
    assert.match(html, /data-runs-limit="10"/, 'the limit comes from the response');
    assert.match(html, /7 of 10 runs left today/, 'the human-readable allowance');

    assert.match(tagFor(html, 'run-step') || '', /data-action="run-step"/, 'run this step is ready');
    // LIN-3341: Go replaced the run-task rung; it stays a ready run-task entry.
    assert.match(html, /data-rung="run-task"[^>]*data-action="go"/, 'Go is the ready run-task entry');
  });

  test('N=0: only Go and run this step are disabled, with the run-limit reason', async () => {
    const m = await mountFresh({}, { quota: QUOTA_ZERO });
    const html = m.container.innerHTML;

    assert.match(html, /0 of 10 runs left today/);

    const runStep = tagFor(html, 'run-step');
    assert.match(runStep, /disabled/, 'run this step is disabled at zero');
    assert.match(runStep, /daily run limit reached/, 'the reason is the run limit');
    assert.doesNotMatch(runStep, /data-action="run-step"/, 'no ready handler at zero');

    const go = html.match(/<button[^>]*data-testid="opened-task-go"[^>]*>/);
    assert.ok(go, 'Go is rendered');
    assert.match(go[0], /disabled/, 'Go is disabled at zero');
    assert.match(go[0], /daily run limit reached/, 'the reason is the run limit');
    assert.doesNotMatch(go[0], /data-action="go"/, 'no ready handler at zero');
  });

  test('N=0: ✦ next step stays enabled (prompts are unlimited)', async () => {
    const m = await mountIdle({}, { quota: QUOTA_ZERO });
    const goTag = m.container.innerHTML.match(/<button[^>]*data-testid="opened-task-next-step"[^>]*>/);
    assert.ok(goTag, 'the ✦ next step is rendered');
    assert.doesNotMatch(goTag[0], / disabled/, 'the ✦ next step is NOT disabled by the run limit');
  });

  test('N=0: the idle copy rung still asks for a prompt, never the run limit', async () => {
    const m = await mountIdle({}, { quota: QUOTA_ZERO });
    const copy = tagFor(m.container.innerHTML, 'copy');
    assert.ok(copy, 'the idle copy rung is rendered');
    assert.match(copy, /data-setup-needs="prompt"/, 'copy is gated on a prompt, not the run limit');
    assert.doesNotMatch(copy, /daily run limit reached/, 'the run limit never leaks into copy');
  });

  test('unreadable counts (runsUsed null) show no allowance and gate nothing', async () => {
    const m = await mountFresh({}, { quota: { limited: true, runsUsed: null, limit: 10, remaining: 0, resetsAt: null } });
    const html = m.container.innerHTML;
    assert.doesNotMatch(html, /data-testid="opened-task-run-quota"/, 'no fabricated allowance');
    assert.match(tagFor(html, 'run-step') || '', /data-action="run-step"/, 'run this step stays ready');
    assert.match(html, /data-rung="run-task"[^>]*data-action="go"/, 'Go stays ready');
  });

  test('not free tier: no quota read is made and the ladder is unchanged', async () => {
    const m = await mountFresh({ freeTier: false }, { quota: QUOTA_ZERO });
    assert.equal(m.calls.api.some((u) => String(u).endsWith('/api/dispatch/quota')), false, 'no quota read when not free tier');
    assert.doesNotMatch(m.container.innerHTML, /data-testid="opened-task-run-quota"/);
    assert.match(tagFor(m.container.innerHTML, 'run-step') || '', /data-action="run-step"/);
  });
});

// LIN-3267 — the allowance is re-read after a ladder press settles, through the
// same read that populates the ladder at load.
describe('LIN-3267 — re-read the run quota after a ladder press', () => {
  const seq = (...qs) => { let i = 0; return () => qs[Math.min(i++, qs.length - 1)]; };
  const Q = (remaining) => ({ limited: true, runsUsed: 10 - remaining, limit: 10, remaining, resetsAt: null });
  // The re-read runs in the 2s restore timer (after ✓/err and the guard), so a
  // settled press includes firing that timer.
  const press = async (m) => { await m.container.click({ action: 'run-step', target: 'cli' }); await flush(); await flush(); await m.runTimers(); };

  test('after a successful run-step press the count and rungs show the re-read quota', async () => {
    const m = await mountFresh({}, { quota: seq(Q(1), Q(0)) });
    assert.match(m.container.innerHTML, /1 of 10 runs left today/);
    assert.match(tagFor(m.container.innerHTML, 'run-step'), /data-action="run-step"/);
    await press(m);
    assert.equal(m.calls.dispatch.length, 1);
    assert.match(m.container.innerHTML, /0 of 10 runs left today/, 'count tracks the press');
    assert.match(tagFor(m.container.innerHTML, 'run-step'), /disabled/, 'run this step is disabled at zero');
    assert.match(tagFor(m.container.innerHTML, 'run-task'), /disabled/, 'Go is disabled at zero');
  });

  test('a RUN_LIMIT_REACHED 429 on a run-step press leaves the ladder exhausted', async () => {
    const dispatch = async () => { const e = new Error('limit'); e.status = 429; e.body = { code: 'RUN_LIMIT_REACHED' }; throw e; };
    const m = await mountFresh({}, { quota: seq(Q(1), Q(0)), dispatch });
    await press(m);
    assert.match(m.container.innerHTML, /0 of 10 runs left today/);
    assert.match(tagFor(m.container.innerHTML, 'run-step'), new RegExp(`disabled[^>]*${RUN_LIMIT_TITLE}`));
  });

  test('the quota is re-read after the press settles, never before or during it', async () => {
    const m = await mountFresh({}, { quota: seq(Q(5), Q(4)) });
    assert.deepEqual(m.calls.order, ['quota'], 'only the load read before the press');
    await press(m);
    assert.deepEqual(m.calls.order, ['quota', 'dispatch', 'quota']);
  });

  test('a failed re-read keeps the last known allowance', async () => {
    let n = 0;
    const m = await mountFresh({}, { quota: () => { if (n++ === 0) return Q(5); throw new Error('down'); } });
    await press(m);
    assert.match(m.container.innerHTML, /5 of 10 runs left today/);
  });

  test('not free tier: a press makes no quota read', async () => {
    const m = await mountFresh({ freeTier: false }, { quota: Q(5) });
    await press(m);
    assert.equal(m.calls.order.filter((x) => x === 'quota').length, 0);
  });

  // Slot repaint vs full rebuild: the nodes outside the Go and ladder slots must all stay attached through the press, the
  // ✓ feedback, the restore and the re-read. A post-press refresh that calls render() detaches them.
  // After the re-read the run rung has no action at zero, so it is found again by its rung, not by its action.
  // `disabledAfterRestore`: the run rung is disabled at zero by the run limit, so only the dispatch button's `disabled` shows
  // the guard lifting; the run rung's disabled state after the restore is checked against the run-limit reason instead.
  for (const [name, dataset, selector, afterSelector, disabledAfterRestore] of [
    ['a run-step press', { action: 'run-step', target: 'cli' }, 'button[data-action="run-step"][data-target="cli"]', 'button[data-rung="run-step"]', true],
    ['a Dispatch-panel dispatch press', { action: 'dispatch', target: 'cli' }, 'button[data-action="dispatch"][data-target="cli"]', 'button[data-action="dispatch"][data-target="cli"]', false],
  ]) {
    test(`${name} makes no whole-container write and the button keeps ✓ + disabled until the restore`, async () => {
      const m = await mountFresh({}, { quota: seq(Q(1), Q(0)) });
      const btn = m.container.querySelector(selector);
      assert.ok(btn, 'precondition: the control is drawn');
      const label = btn.textContent;
      const panel = m.container.querySelector('.swipe-prompt-options');
      const kept = nodesOutside(m.container, '[data-go-slot], [data-ladder-slot]');
      assert.equal(await m.container.click(dataset), btn, 'the press lands on the drawn control');
      await flush();
      await flush();
      assert.equal(btn.textContent, '\u2713', 'the ✓ feedback is shown');
      assert.equal(btn.disabled, true, 'the double-press guard is held');
      assert.deepEqual(m.calls.order, ['quota', 'dispatch'], 'no quota read before the restore');
      assert.match(m.container.innerHTML, /1 of 10 runs left today/, 'the count is untouched until the restore');
      assert.equal(m.calls.readers.at(-1), panel, 'the press hands the reader the drawn disclosure panel');
      await m.runTimers();
      const after = m.container.querySelector(afterSelector);
      // At zero the run rung also carries the run-limit reason, so the label is checked as a prefix; the ✓ is gone.
      assert.ok(after.textContent.startsWith(label) && !after.textContent.includes('\u2713'), 'the restore puts the label back');
      assert.equal(after.disabled, disabledAfterRestore, 'the restore lifts the guard');
      if (disabledAfterRestore) assert.match(after.outerHTML, new RegExp(RUN_LIMIT_TITLE), 'disabled by the run limit, not the guard');
      assert.deepEqual(m.calls.order, ['quota', 'dispatch', 'quota'], 'the re-read follows the restore');
      assert.ok(kept.every((node) => node.isConnected), 'no whole-container write at any point');
      assert.match(m.container.innerHTML, /0 of 10 runs left today/, 'the count still tracks the press');
      assert.match(tagFor(m.container.innerHTML, 'run-step'), /disabled/, 'the run rung is disabled at zero');
      assert.match(tagFor(m.container.innerHTML, 'run-task'), /disabled/, 'Go is disabled at zero');
    });
  }

  test('a 429 run-step press keeps err + disabled until the restore, then exhausts the ladder without a full write', async () => {
    const dispatch = async () => { const e = new Error('limit'); e.status = 429; e.body = { code: 'RUN_LIMIT_REACHED' }; throw e; };
    const m = await mountFresh({}, { quota: seq(Q(1), Q(0)), dispatch });
    const kept = nodesOutside(m.container, '[data-go-slot], [data-ladder-slot]');
    const btn = await m.container.click({ action: 'run-step', target: 'cli' });
    await flush();
    await flush();
    assert.equal(btn.textContent, 'err');
    assert.equal(btn.disabled, true);
    assert.deepEqual(m.calls.order, ['quota', 'dispatch']);
    await m.runTimers();
    assert.ok(kept.every((node) => node.isConnected), 'no whole-container write');
    assert.match(m.container.innerHTML, /0 of 10 runs left today/);
    assert.match(tagFor(m.container.innerHTML, 'run-step'), new RegExp(`disabled[^>]*${RUN_LIMIT_TITLE}`));
  });
});
