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
import { decisionPanel, decisionSuggestions, routingWords } from '../../lib/components/decision-panel.js';
import { DISPATCH_EFFORT_LEVELS } from '../../lib/dispatch-validation.js';
import { typicalByModel } from '../../lib/model-routing-spend.js';

const NUMBERS = { testid: 'models-spend-bug', heading: 'Last 30 days', runs: 2, priced: 2, unpriced: 0, noTelemetry: 0, spendUsd: 1.5, typicalUsd: 0.75, share: 0.5 };
const LISTS = {
  'claude-code': [{ id: 'sonnet', label: 'sonnet', free: false }],
  opencode: [{ id: 'openai/gpt-5.5', label: 'GPT-5.5', free: false }],
  any: [{ id: 'sonnet', label: 'sonnet', free: false }, { id: 'openai/gpt-5.5', label: 'GPT-5.5', free: false }]
};
// LIN-3987: a suggestion with no known rate has price null; the panel says so once, in a note.
const SUGGEST = {
  'claude-code': [{ id: 'sonnet', name: 'Claude Sonnet 5.5', reason: 'A mid-size Claude model', price: '$2.00 in / $10.00 out per 1M tokens', typical: '$0.75 a run', source: 'mapped' }],
  opencode: [{ id: 'openai/gpt-5.5', name: 'GPT-5.5', reason: 'OpenAI model', price: '$5.00 in / $30.00 out per 1M tokens', typical: null, source: null }]
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

  test('a blank field\'s hint reads on its own line under the field, and a chosen value hides it (390px: the option is not clipped)', () => {
    const hinted = (value) => panel({
      harness: { value, inForce: 'opencode', follow: 'As Settings › Models sets it', hint: 'Right now: opencode' },
      model: { value: null, follow: 'As Settings › Models sets it', hint: 'Right now: the default model', lists: LISTS, suggestions: SUGGEST },
      effort: { value: null, follow: 'As Settings › Models sets it', hint: 'Right now: none' }
    });
    const blank = hinted(null);
    assert.match(blank, /<option value=""[^>]*>As Settings › Models sets it<\/option>/);
    assert.match(blank, /<span class="decision-panel-hint" data-decision-hint="harness">Right now: opencode<\/span>/);
    assert.match(blank, /<span class="decision-panel-hint" data-decision-hint="model">Right now: the default model<\/span>/);
    assert.match(blank, /<span class="decision-panel-hint" data-decision-hint="effort">Right now: none<\/span>/);
    assert.match(hinted('claude-code'), /data-decision-hint="harness" hidden>/, 'a chosen harness needs no hint');
    assert.doesNotMatch(panel(), /data-decision-hint/, 'a page that gives no hint (Models) gets none');
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
    assert.match(html, /\$2\.00 in \/ \$10\.00 out per 1M tokens/);
  });

  test('a suggestion\'s name, rate and typical cost share one line; its reason sits under them', () => {
    const html = panel();
    assert.match(html, /<span class="decision-panel-suggestion-head">\s*<button type="button" class="btn decision-panel-pick"[^>]*>Claude Sonnet 5\.5<\/button>\s*<span class="decision-panel-costs">\s*<span class="decision-panel-price">\$2\.00 in \/ \$10\.00 out per 1M tokens<\/span>\s*<span class="decision-panel-typical">\$0\.75 a run<\/span>/);
    assert.match(html, /<\/span>\s*<span class="decision-panel-reason">A mid-size Claude model<\/span>\s*<\/li>/);
  });

  test('a suggestion with no known rate is named once, in a note, and never reads "price unknown"', () => {
    const unrated = { 'claude-code': [{ id: 'sonnet', name: 'Claude Sonnet 5.5', reason: 'r', price: null, typical: null, source: 'mapped' }], opencode: [] };
    const html = panel({ model: { value: 'sonnet', follow: 'Follow', lists: LISTS, suggestions: unrated } });
    assert.match(html, /<p class="decision-panel-note" data-decision-harness="claude-code">No known rate for Claude Sonnet 5\.5\.<\/p>/);
    assert.doesNotMatch(html, /price unknown/);
    assert.doesNotMatch(html, /decision-panel-price/);
  });

  test('Claude Code\'s rates carry one note: they are for comparison, and a subscription may cover them', () => {
    const html = panel();
    assert.match(html, /<p class="decision-panel-note" data-decision-harness="claude-code">Rates are per 1M tokens, for comparison\. A Claude Code subscription may cover the cost\.<\/p>/);
    assert.doesNotMatch(html, /<p class="decision-panel-note" data-decision-harness="opencode">Rates/);
  });

  test('a suggestion that ran or is mapped says which, in words', () => {
    assert.match(panel(), /decision-panel-source">Mapped to this model</);
    const ran = { 'claude-code': [{ id: 'sonnet', name: 'Claude Sonnet 5.5', reason: 'r', price: '$2.00 in / $10.00 out per 1M tokens', typical: null, source: 'ran' }], opencode: [] };
    assert.match(panel({ model: { value: 'sonnet', follow: 'Follow', lists: LISTS, suggestions: ran } }), /decision-panel-source">Ran as this model</);
  });

  test('the search list is one datalist per harness, and the input starts on the harness in force', () => {
    const html = panel({ harness: { value: 'opencode', inForce: 'opencode', follow: 'Follow Make' } });
    assert.match(html, /<datalist[^>]*data-decision-list="opencode"/);
    assert.match(html, /<datalist[^>]*data-decision-list="claude-code"/);
    assert.match(html, /<datalist[^>]*data-decision-list="any"/);
    const modelInput = html.slice(html.indexOf('data-decision-field="model"') - 200, html.indexOf('data-decision-field="model"') + 200);
    assert.match(modelInput, /list="[^"]*opencode"/);
  });

  test('a suggestion pick is a shared button that sets the input, never a submit', () => {
    const html = panel();
    assert.match(html, /<button type="button" class="btn decision-panel-pick" data-decision-pick="sonnet"/);
  });

  test('the suggestion the model field names is the chosen one (aria-pressed); the others are not', () => {
    const chosen = (value) => {
      const html = panel({ model: { value, follow: 'Follow', lists: LISTS, suggestions: SUGGEST } });
      return [...html.matchAll(/data-decision-pick="([^"]*)" aria-pressed="(true|false)"/g)].map((m) => [m[1], m[2]]);
    };
    assert.deepEqual(chosen('sonnet'), [['sonnet', 'true'], ['openai/gpt-5.5', 'false']]);
    assert.deepEqual(chosen('openai/gpt-5.5'), [['sonnet', 'false'], ['openai/gpt-5.5', 'true']]);
    assert.deepEqual(chosen('something-typed'), [['sonnet', 'false'], ['openai/gpt-5.5', 'false']]);
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

describe('the effort row says why it is missing (LIN-3987)', () => {
  test('with opencode in force, the Effort row is hidden and one line says effort does not apply', () => {
    const html = panel({ harness: { value: 'opencode', inForce: 'opencode', follow: 'Follow Make' } });
    assert.match(html, /data-decision-effort hidden/);
    assert.match(html, /<p class="decision-panel-note" data-decision-harness="opencode">Effort does not apply: opencode through OpenRouter takes none\.<\/p>/);
  });

  test('with Claude Code in force the Effort row shows, and the line for opencode stays hidden', () => {
    const html = panel();
    assert.doesNotMatch(html, /data-decision-effort hidden/);
    assert.match(html, /<p class="decision-panel-note" data-decision-harness="opencode" hidden>Effort does not apply/);
  });

  test('the effort line is not written where the panel has no effort row', () => {
    assert.doesNotMatch(panel({ withEffort: false }), /Effort does not apply/);
  });
});

describe('routingWords: every value the panel prints is said in words (LIN-3987)', () => {
  test('a blank harness is Claude Code, and a blank model is its own model, not a default id', () => {
    assert.deepEqual(routingWords({}), { harness: 'Claude Code', model: "Claude Code's own model", effort: "Claude Code's own effort" });
  });

  test('a blank model under opencode is opencode\'s default, and its effort is not used', () => {
    assert.deepEqual(routingWords({ harness: 'opencode' }), { harness: 'opencode through OpenRouter', model: "opencode's default model", effort: 'not used' });
  });

  test('a Claude Code alias is the model it runs, by display name; an id is its own name', () => {
    assert.equal(routingWords({ harness: 'claude-code', model: 'sonnet' }).model, 'Claude Sonnet 5.5');
    assert.equal(routingWords({ harness: 'claude-code', model: 'claude-opus-5-5' }).model, 'Claude Opus 5.5');
  });

  test('a stored effort is shown as itself under Claude Code; the words never print a raw harness id', () => {
    const w = routingWords({ harness: 'claude-code', effort: 'turbo' });
    assert.equal(w.effort, 'turbo');
    assert.doesNotMatch(JSON.stringify(routingWords({ harness: 'opencode', model: 'openai/gpt-5.5', effort: 'high' })), /opencode"|claude-code|\bsonnet\b/);
  });
});

describe('decisionSuggestions: what a suggested row says, from the job\'s own runs', () => {
  const rows = (...r) => typicalByModel(r, { job: 'implementation' });
  const taken = (model, costUsd) => ({
    id: `${model}-${costUsd}`, status: 'taken', kind: 'implementation', dispatchedAt: '2026-10-20T10:00:00Z', rootItemId: undefined,
    feedback: [{ kind: 'usage', timestamp: '2026-10-20T10:01:00Z', message: `[usage] ${JSON.stringify(costUsd === undefined ? { model } : { model, costUsd })}` }]
  });

  test('an alias that ran as exactly one model, with a rate, shows that model, its rate and its typical cost', () => {
    const [opus] = decisionSuggestions({ harness: 'claude-code', typicals: rows(taken('claude-opus-5', 2), taken('claude-opus-5', 4)) }).filter((s) => s.id === 'opus');
    assert.equal(opus.name, 'Claude Opus 5');
    assert.equal(opus.price, '$5.00 in / $25.00 out per 1M tokens');
    assert.equal(opus.typical, '$3.00 a run');
    assert.equal(opus.source, 'ran');
  });

  test('an alias the job never ran shows the model its mapping names, its rate, and no cost', () => {
    const [opus] = decisionSuggestions({ harness: 'claude-code', typicals: [] }).filter((s) => s.id === 'opus');
    assert.equal(opus.name, 'Claude Opus 5.5');
    assert.equal(opus.price, '$4.00 in / $20.00 out per 1M tokens');
    assert.equal(opus.typical, null);
    assert.equal(opus.source, 'mapped');
  });

  test('an alias with two reported models of its family shows its mapping and no per-model cost, never a guessed one', () => {
    const [opus] = decisionSuggestions({ harness: 'claude-code', typicals: rows(taken('claude-opus-4-1', 1), taken('claude-opus-5', 3)) }).filter((s) => s.id === 'opus');
    assert.equal(opus.typical, null);
    assert.equal(opus.name, 'Claude Opus 5.5');
    assert.equal(opus.source, 'mapped');
  });

  test('every Claude Code alias has a rate, so none is left unrated', () => {
    const list = decisionSuggestions({ harness: 'claude-code', typicals: [] });
    assert.equal(list.length, 4);
    assert.ok(list.every((s) => s.price && s.price.includes('per 1M tokens')), 'no alias reads without a rate');
  });

  test('the opencode suggestions are full ids, and their cost matches the exact model only', () => {
    const list = decisionSuggestions({ harness: 'opencode', typicals: rows(taken('openai/gpt-5.5', 0.2)) });
    assert.ok(list.length > 0 && list.every((s) => s.id.includes('/')));
    assert.equal(list.find((s) => s.id === 'openai/gpt-5.5').typical, '$0.20 a run');
  });
});
