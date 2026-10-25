/**
 * LIN-3962: the one decision panel (lib/components/decision-panel.js). Server-rendered, pure, and holding
 * nothing specific to Models or Home: it takes a job's numbers, the choices and the current value, and writes
 * the same structure whichever page asks. Both pages' names and attributes are supplied by the caller.
 *
 * Witnesses: the numbers come first, then harness, model, effort; effort offers only "follow" and the
 * DISPATCH_EFFORT_LEVELS set, and a stored value outside it is shown and kept; effort is hidden where the
 * harness in force takes none, blank harness included; the Models and Home panels are the same structure
 * for the same inputs; unpriced spend never reads $0; suggestions belong to one harness.
 *
 * Run with: node --test tests/unit/decision-panel.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decisionPanel, decisionSuggestions } from '../../lib/components/decision-panel.js';
import { DISPATCH_EFFORT_LEVELS } from '../../lib/dispatch-validation.js';
import { typicalByModel } from '../../lib/model-routing-spend.js';

const NUMBERS = { testid: 'models-spend-bug', heading: 'Last 30 days', runs: 2, priced: 2, unpriced: 0, noTelemetry: 0, spendUsd: 1.5, typicalUsd: 0.75, share: 0.5 };
const LISTS = {
  'claude-code': [{ id: 'sonnet', label: 'sonnet', free: false }],
  opencode: [{ id: 'openai/gpt-5.5', label: 'GPT-5.5', free: false }],
  any: [{ id: 'sonnet', label: 'sonnet', free: false }, { id: 'openai/gpt-5.5', label: 'GPT-5.5', free: false }]
};
const SUGGEST = {
  'claude-code': [{ id: 'sonnet', name: 'Sonnet', reason: 'A mid-size Claude model', price: 'price unknown', typical: '$0.75 a run' }],
  opencode: [{ id: 'openai/gpt-5.5', name: 'GPT-5.5', reason: 'OpenAI model', price: '$5 / $30 per 1M tokens', typical: null }]
};

// The Models caller: named fields, the page's own testids. Home's caller: no names, run-* testids.
const modelsNames = {
  nameOf: (f) => `c__job__agent-session__bug__${f}`,
  fieldAttrs: (f) => `data-models-field="${f}"`
};
const homeNames = {
  nameOf: () => undefined,
  fieldAttrs: (f) => `data-testid="run-${f}"`
};

function panel(over = {}) {
  return decisionPanel({
    testid: 'models-panel-job-agent-session-bug',
    numbers: NUMBERS,
    harness: { value: 'claude-code', inForce: 'claude-code', follow: 'Follow Make (claude-code)' },
    model: { value: 'sonnet', follow: 'Follow Make (sonnet)', lists: LISTS, suggestions: SUGGEST },
    effort: { value: 'high', follow: 'Follow Make (none)' },
    ...modelsNames,
    ...over
  });
}

describe('the panel\'s order: the job\'s numbers first, then harness, model and effort', () => {
  test('the numbers block comes before every choice', () => {
    const html = panel();
    const at = (s) => html.indexOf(s);
    assert.ok(at('models-spend-bug') > -1, 'numbers rendered');
    assert.ok(at('models-spend-bug') < at('name="c__job__agent-session__bug__harness"'));
    assert.ok(at('name="c__job__agent-session__bug__harness"') < at('name="c__job__agent-session__bug__model"'));
    assert.ok(at('name="c__job__agent-session__bug__model"') < at('name="c__job__agent-session__bug__effort"'));
  });

  test('the harness choices are labelled by what they run, not by their bare ids', () => {
    const html = panel();
    assert.match(html, />Claude Code</);
    assert.match(html, />opencode through OpenRouter</);
  });
});

describe('effort is a fixed set: follow, then DISPATCH_EFFORT_LEVELS', () => {
  test('the options are exactly the follow choice and the authority\'s levels', () => {
    const html = panel({ effort: { value: null, follow: 'Follow Make (none)' } });
    const effortSelect = html.slice(html.indexOf('name="c__job__agent-session__bug__effort"'));
    const options = [...effortSelect.slice(0, effortSelect.indexOf('</select>')).matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(options, ['', ...DISPATCH_EFFORT_LEVELS]);
  });

  test('a stored effort outside the set is shown as itself, selected, and kept', () => {
    const html = panel({ effort: { value: 'turbo', follow: 'Follow Make (none)' } });
    assert.match(html, /<option value="turbo" selected>turbo<\/option>/);
  });

  test('effort is hidden where the harness in force takes none, and shown elsewhere', () => {
    const opencode = panel({ harness: { value: 'opencode', inForce: 'opencode', follow: 'Follow Make (opencode)' } });
    assert.match(opencode, /data-decision-effort hidden/);
    const claude = panel();
    assert.doesNotMatch(claude, /data-decision-effort hidden/);
  });

  test('a blank harness judges effort by the harness in force: opencode in force hides effort', () => {
    const html = panel({ harness: { value: null, inForce: 'opencode', follow: 'As Settings sets it: opencode' } });
    assert.match(html, /data-decision-effort hidden/, 'the bug the research found: blank harness showed effort');
    assert.match(html, /data-harness-in-force="opencode"/);
  });

  test('without effort on the panel, no effort control is written at all', () => {
    assert.doesNotMatch(panel({ withEffort: false }), /data-decision-field="effort"/);
  });
});

describe('the same inputs give the same structure on both pages', () => {
  // Strip what a caller names: field names, testids and the page's own field attributes. What is left is the structure.
  const structure = (html) => html
    .replace(/\s(name|data-testid|data-models-field|id|list)="[^"]*"/g, '')
    .replace(/<datalist\s*>/g, '<datalist>');

  test('Models\' and Home\'s panels are one structure once names and testids are stripped', () => {
    const models = panel({ ...modelsNames });
    const home = panel({ ...homeNames, testid: 'run-change-panel' });
    assert.equal(structure(models), structure(home));
  });

  test('Home\'s fields carry no name attribute, so the form has nothing to post', () => {
    assert.doesNotMatch(panel(homeNames), /\sname="/);
  });
});

describe('the numbers block', () => {
  test('priced spend is shown to the cent, with its typical run', () => {
    const html = panel();
    assert.match(html, /\$1\.50 · typical \$0\.75 a run/);
  });

  test('a typical or total under half a cent reads <$0.01, never $0.00', () => {
    const html = panel({ numbers: { ...NUMBERS, spendUsd: 0.003, typicalUsd: 0.003 } });
    assert.match(html, /&lt;\$0\.01 · typical &lt;\$0\.01 a run/);
    assert.doesNotMatch(html, /\$0\.00/);
  });

  test('the spend bar has its words on the page, not only in aria-label', () => {
    const html = panel();
    assert.match(html, /<p class="decision-panel-heading">50% of all priced spend in 30 days<\/p>/);
    assert.match(html, /<progress class="settings-spend-bar"[^>]*aria-label="50% of all priced spend in 30 days"/);
  });

  test('a job with no priced runs shows unknown, never $0', () => {
    const html = panel({ numbers: { ...NUMBERS, runs: 2, priced: 0, unpriced: 1, noTelemetry: 1, spendUsd: 0, typicalUsd: null, share: null } });
    assert.match(html, /data-testid="models-spend-bug"[\s\S]*?unknown/);
    assert.doesNotMatch(html, /\$0\.00/);
    assert.match(html, /0 of 2 runs priced, 1 unpriced, 1 with no usage reported/);
  });

  test('no runs says so, and no numbers are invented', () => {
    const html = panel({ numbers: { ...NUMBERS, runs: 0, priced: 0, unpriced: 0, noTelemetry: 0, spendUsd: 0, typicalUsd: null, share: null } });
    assert.match(html, /no runs in 30 days/);
  });

  test('the numbers are optional: a caller with none gets no numbers block', () => {
    assert.doesNotMatch(panel({ numbers: null }), /decision-panel-numbers/);
  });
});

describe('suggested models belong to the harness in force', () => {
  test('the rows for the other harness are hidden, and each row names its reason and price', () => {
    const html = panel();
    assert.match(html, /data-decision-harness="claude-code"[^>]*>/);
    assert.match(html, /data-decision-harness="opencode"[^>]*hidden/);
    assert.match(html, /A mid-size Claude model/);
    assert.match(html, /price unknown/);
  });

  test('a suggestion\'s price and typical cost sit in their own line, apart from its reason', () => {
    const html = panel();
    assert.match(html, /<span class="decision-panel-reason">A mid-size Claude model<\/span>\s*<span class="decision-panel-costs">\s*<span class="decision-panel-price">price unknown<\/span>\s*<span class="decision-panel-typical">\$0\.75 a run<\/span>/);
  });

  test('the search list is one datalist per harness, and the input starts on the harness in force', () => {
    const html = panel({ harness: { value: 'opencode', inForce: 'opencode', follow: 'Follow Make' } });
    assert.match(html, /<datalist[^>]*data-decision-list="opencode"/);
    assert.match(html, /<datalist[^>]*data-decision-list="claude-code"/);
    assert.match(html, /<datalist[^>]*data-decision-list="any"/);
    const modelInput = html.slice(html.indexOf('data-decision-field="model"') - 200, html.indexOf('data-decision-field="model"') + 200);
    assert.match(modelInput, /list="[^"]*opencode"/);
  });

  test('a suggestion pick is a button that sets the input, never a submit', () => {
    const html = panel();
    assert.match(html, /<button type="button" class="decision-panel-pick" data-decision-pick="sonnet"/);
  });
});

describe('escaping and the auto-switch rule', () => {
  test('a stored value is escaped into its attribute', () => {
    const html = panel({ model: { value: 'x" onmouseover="alert(1)', follow: 'Follow', lists: LISTS, suggestions: SUGGEST } });
    assert.doesNotMatch(html, /onmouseover="alert/);
    assert.match(html, /&quot;/);
  });

  test('the OpenRouter-only auto-switch is written only where the caller asks for it (Models)', () => {
    assert.match(panel({ autoSwitch: true }), /data-decision-autoswitch/);
    assert.doesNotMatch(panel({ autoSwitch: false }), /data-decision-autoswitch/);
  });
});

describe('decisionSuggestions: what a suggested row says, from the job\'s own runs', () => {
  const rows = (...r) => typicalByModel(r, { job: 'implementation' });
  const taken = (model, costUsd) => ({
    id: `${model}-${costUsd}`, status: 'taken', kind: 'implementation', dispatchedAt: '2026-10-20T10:00:00Z', rootItemId: undefined,
    feedback: [{ kind: 'usage', timestamp: '2026-10-20T10:01:00Z', message: `[usage] ${JSON.stringify(costUsd === undefined ? { model } : { model, costUsd })}` }]
  });

  test('an alias that ran as exactly one model shows that model, with its typical cost', () => {
    const [opus] = decisionSuggestions({ harness: 'claude-code', typicals: rows(taken('claude-opus-5', 2), taken('claude-opus-5', 4)) }).filter((s) => s.id === 'opus');
    assert.match(opus.name, /^Opus · ran as claude-opus-5$/);
    assert.equal(opus.typical, '$3.00 a run');
  });

  test('an alias the job never ran shows its family and "price unknown", and no cost', () => {
    const [opus] = decisionSuggestions({ harness: 'claude-code', typicals: [] }).filter((s) => s.id === 'opus');
    assert.equal(opus.name, 'Opus');
    assert.equal(opus.price, 'price unknown');
    assert.equal(opus.typical, null);
  });

  test('an alias with two reported models of its family shows no per-model cost, never a guessed one', () => {
    const [opus] = decisionSuggestions({ harness: 'claude-code', typicals: rows(taken('claude-opus-4-1', 1), taken('claude-opus-5', 3)) }).filter((s) => s.id === 'opus');
    assert.equal(opus.typical, null);
    assert.equal(opus.name, 'Opus');
  });

  test('the opencode suggestions are full ids, and their cost matches the exact model only', () => {
    const list = decisionSuggestions({ harness: 'opencode', typicals: rows(taken('openai/gpt-5.5', 0.2)) });
    assert.ok(list.length > 0 && list.every((s) => s.id.includes('/')));
    assert.equal(list.find((s) => s.id === 'openai/gpt-5.5').typical, '$0.20 a run');
  });
});
