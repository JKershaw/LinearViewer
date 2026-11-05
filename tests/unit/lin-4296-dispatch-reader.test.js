/**
 * LIN-4296 — production's `readDispatchExecControls` (public/common.js) reads what the disclosure's own `<select>`s hold.
 *
 * The run-quota and runner-link suites used to stub this reader, because the fake DOM did not model `<select>.value`. They
 * now run production's reader (LIN-4296), and this file is the witness for what it reads: an untouched disclosure reads no
 * harness and no model, and a harness and model chosen on the real controls are the ones dispatched. The swipe disclosure
 * passes `harnessDefault: ''` (public/prompt-section.js), so nothing is pre-selected.
 *
 * Runs in the shared client world (tests/unit/helpers/client-world.js), with the real dispatch disclosure.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from './helpers/client-world.js';
import { DISCLOSURE_SCRIPTS, disclosureWindowStubs } from './helpers/real-dispatch-disclosure.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

// The model select's sentinel "other…" option is labelled with the ellipsis; a real model is any other non-blank option.
const isRealModelOption = (o) => o.value !== '' && o.text !== 'other…';

async function mount() {
  const calls = { dispatch: [] };
  const world = loadWorld({
    window: disclosureWindowStubs(),
    scripts: DISCLOSURE_SCRIPTS,
    timers: [],
    globals: { fetch: async () => ({ ok: false, json: async () => ({}) }) },
  });
  // Set after load: common.js defines its own `window.api` when it loads, which would replace a stub passed in above.
  const { window } = world;
  window.api = async () => ({ prompt: 'TEMPLATE PROMPT', promptName: 'Template' });
  window.fetchAutopilotKickoff = async () => ({ prompt: 'AUTOPILOT PROMPT', promptName: 'Autopilot', kind: 'autopilot' });
  window.dispatchPrompt = async (args) => { calls.dispatch.push(args); return { item: { id: 'disp-1' } }; };
  window.ProxyToggle = { maybeAppend: async (raw) => raw };
  window.toast = () => {};
  const container = world.makeContainer();
  world.PromptSection.init(container, {
    urlKey: 'ws',
    issue: { id: 'issue-1', identifier: 'LIN-1' },
    hasAI: true,
    dispatchEnabled: true,
    runSetup: false,
    isLocalhost: false,
    customPrompts: [],
    defaultPromptKeys: ['implementation'],
    morePromptKeys: [],
    promptMeta: { implementation: 'Implementation' },
    row: { action: { kind: 'offer', container: false, step: null, why: 'the run control offers the three rungs' } },
  });
  // The disclosure is drawn once a prompt is generated (the same first press runner-link's mount makes).
  await container.click({ prompt: 'implementation' });
  await flush();
  return { container, calls, world };
}

describe('LIN-4296 — the dispatch reader reads the disclosure\'s own selects', () => {
  test('an untouched disclosure pre-selects no harness, and dispatches with no harness and no model', async () => {
    const { container, calls } = await mount();
    const panel = container.querySelector('.swipe-prompt-options');
    assert.ok(panel, 'precondition: the disclosure is drawn');
    assert.equal(panel.querySelector('.dispatch-exec-harness-select').value, '', 'the blank option is what the harness reads');
    await container.click({ action: 'dispatch', target: 'cli' });
    assert.equal(calls.dispatch.length, 1);
    assert.deepEqual([calls.dispatch[0].harness, calls.dispatch[0].model], [null, null]);
  });

  test('a harness and a model chosen on the disclosure\'s selects are the ones dispatched', async () => {
    const { container, calls } = await mount();
    const panel = container.querySelector('.swipe-prompt-options');
    const harness = panel.querySelector('.dispatch-exec-harness-select');
    const model = panel.querySelector('.dispatch-exec-model');
    harness.value = 'opencode';
    const pick = [...model.options].find(isRealModelOption);
    assert.ok(pick, 'precondition: the model select offers a real model to choose');
    model.value = pick.value;
    await container.click({ action: 'dispatch', target: 'cli' });
    assert.equal(calls.dispatch.length, 1);
    assert.deepEqual([calls.dispatch[0].harness, calls.dispatch[0].model], ['opencode', pick.value]);
  });

  // The end-to-end witness that the modelled `options` / `value` / `selectedIndex` / `dataset` surface is enough for production's
  // rebuild path (public/common.js rebuildDispatchModelOptions + updateDispatchModelHint), which no catalog fetch reaches here.
  test('rebuilding the model options keeps a prior model, keeps the blank and other… ends, and reads the hint without throwing', async () => {
    const { container, world } = await mount();
    const panel = container.querySelector('.swipe-prompt-options');
    const model = panel.querySelector('.dispatch-exec-model');
    const pick = [...model.options].find(isRealModelOption);
    assert.ok(pick, 'precondition: the model select offers a real model to choose');
    model.value = pick.value;
    assert.equal(model.value, pick.value, 'precondition: the pick took');
    world.run('rebuildDispatchModelOptions')(model, 'opencode');
    const opts = [...model.options];
    assert.equal(model.value, pick.value, 'the prior model survives the rebuild');
    assert.equal(opts[0].value, '', 'the blank option stays first');
    assert.equal(opts[opts.length - 1].text, 'other…', 'the other… sentinel stays last');
    assert.ok(opts.length > 2, 'the curated options sit between them');
    assert.ok(['', 'free'].includes(panel.querySelector('.dispatch-exec-model-hint').textContent), 'the hint reads from the selected option');
  });
});
