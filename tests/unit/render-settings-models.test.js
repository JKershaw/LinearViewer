/**
 * LIN-3855: the Settings › Models body (lib/render-settings-models.js) and its pieces: what a row says, where a
 * value comes from, the option sets a row offers, the spend words, the filter, and the classes the new rows
 * must not carry.
 *
 * Run with: node --test tests/unit/render-settings-models.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { modelsBody, agentOptions, jobLabel, modelNamer } from '../../lib/render-settings-models.js';
import { emptyTable, effectiveTable, applyChangesToTable, AGENT_JOB_IDS, HARBOUR_JOB_IDS } from '../../lib/model-routing.js';
import { agentSpendByJob, harbourSpendByJob } from '../../lib/model-routing-spend.js';
import { DEFAULT_MODEL } from '../../lib/openrouter.js';
import { SURFACES } from '../../lib/llm-jobs.js';
import { changePanel, fieldName } from '../../lib/components/settings-change-panel.js';
import { spendBar } from '../../lib/components/settings-spend-bar.js';
import { DISPATCH_HARNESS_SUGGESTIONS } from '../../lib/model-routing-harnesses.js';

const URL_KEY = 'acme';
const AVAILABLE = [{ id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 Mini' }];

function body(table, extra = {}) {
  const effective = effectiveTable(table, { defaultModel: DEFAULT_MODEL });
  return modelsBody({
    urlKey: URL_KEY, table, effective,
    agentSpend: agentSpendByJob([], { jobs: AGENT_JOB_IDS }),
    harbourSpend: harbourSpendByJob([], { jobs: HARBOUR_JOB_IDS }),
    presets: [], log: [], catalog: [], availableModels: AVAILABLE,
    ...extra
  });
}

const job = (table, id) => table.jobs[id] || {};

describe('what a row says', () => {
  test('a job set on the job reads "set here"; a job that follows its group reads "from <Group>"', () => {
    const table = applyChangesToTable(emptyTable(), [
      { scope: 'group', surface: SURFACES.AGENT_SESSION, key: 'make', field: 'model', to: 'sonnet' },
      { scope: 'job', surface: SURFACES.AGENT_SESSION, key: 'bug', field: 'model', to: 'opus' }
    ]);
    const html = body(table);
    assert.match(html, /data-testid="models-job-bug"[\s\S]*?settings-row-value">[^<]*set here/);
    assert.match(html, /data-testid="models-job-implementation"[\s\S]*?settings-row-value">[^<]*from Make/);
  });

  test('a job with no runs in the window says so', () => {
    const html = body(emptyTable());
    assert.match(html, /data-testid="models-job-review"[\s\S]*?no runs/);
  });

  test('a Harbour job is on the Harbour surface, with no harness or effort field', () => {
    const html = body(emptyTable());
    const row = html.slice(html.indexOf('data-testid="models-job-brief"'), html.indexOf('data-testid="models-job-brief"') + 4000);
    assert.doesNotMatch(row.slice(0, row.indexOf('</details>')), /name="c__job__agent-session/);
    assert.match(row, /name="c__job__harbour-call__brief__model"/);
    assert.doesNotMatch(row, /__brief__harness/);
  });

  test('the job label is the id in words', () => {
    assert.equal(jobLabel('plan-review'), 'Plan review');
  });

  test('a stored model outside the option set still shows as itself', () => {
    const table = applyChangesToTable(emptyTable(), [{ scope: 'job', surface: SURFACES.AGENT_SESSION, key: 'bug', field: 'model', to: 'odd/model-x' }]);
    assert.match(body(table), /<option value="odd\/model-x" selected>/);
  });
});

describe('the option set a row offers', () => {
  test('claude-code offers only its four presets (and blank)', () => {
    const ids = agentOptions('claude-code', []).map((o) => o.id);
    assert.deepEqual(ids, ['haiku', 'sonnet', 'opus', 'fable']);
  });

  test('opencode offers the OpenRouter list, with the live catalog merged and free-marked', () => {
    const catalog = [{ id: 'z/free-one', name: 'Free One', pricing: { prompt: '0', completion: '0' } }];
    const ids = agentOptions('opencode', catalog).map((o) => o.id);
    assert.ok(ids.includes('openai/gpt-5.5'));
    assert.ok(ids.includes('z/free-one'));
    assert.ok(!ids.includes('haiku'));
  });

  test('a row naming no harness offers both, so an OpenRouter-only pick is possible', () => {
    const ids = agentOptions(null, []).map((o) => o.id);
    assert.ok(ids.includes('sonnet') && ids.includes('openai/gpt-5.5'));
  });
});

describe('the change panel', () => {
  test('its fields are named by scope, surface, key and field, and the blank option follows the group', () => {
    const html = changePanel({
      target: { scope: 'job', surface: 'agent-session', key: 'bug' },
      harness: 'opencode', model: null, effort: null,
      modelOptions: [{ id: 'openai/gpt-5.5', label: 'GPT-5.5', free: false }],
      harnesses: DISPATCH_HARNESS_SUGGESTIONS, inheritLabel: 'Follow Make'
    });
    assert.match(html, /name="c__job__agent-session__bug__harness"/);
    assert.match(html, /name="c__job__agent-session__bug__model"/);
    assert.match(html, /name="c__job__agent-session__bug__effort"/);
    assert.match(html, /<option value="">Follow Make<\/option>/);
  });

  test('effort is hidden on a harness that takes none, and the panel never carries the old row classes', () => {
    const html = changePanel({
      target: { scope: 'group', surface: 'agent-session', key: 'make' }, harness: 'opencode', model: null, effort: null,
      modelOptions: [], harnesses: DISPATCH_HARNESS_SUGGESTIONS, inheritLabel: 'Inherit the default'
    });
    assert.match(html, /data-models-effort hidden/);
    assert.doesNotMatch(html, /class="[^"]*\b(line|toggle-btn|action-btn)\b/);
  });

  test('a free option carries data-free, never option text', () => {
    const html = changePanel({
      target: { scope: 'job', surface: 'agent-session', key: 'bug' }, harness: 'opencode', model: null, effort: null,
      modelOptions: [{ id: 'z/free', label: 'Free', free: true }], harnesses: DISPATCH_HARNESS_SUGGESTIONS, inheritLabel: 'Follow Make'
    });
    assert.match(html, /<option value="z\/free" data-free="true">Free<\/option>/);
  });

  test('field names round-trip through fieldName', () => {
    assert.equal(fieldName({ scope: 'default', surface: 'agent-session', key: 'default', field: 'model' }), 'c__default__agent-session__default__model');
  });
});

describe('the spend', () => {
  test('a job with no priced runs shows unknown, never $0', () => {
    const html = body(emptyTable(), {
      agentSpend: [{ id: 'bug', runs: 2, priced: 0, unpriced: 1, noTelemetry: 1, spendUsd: 0, typicalUsd: null, models: [] }]
    });
    assert.match(html, /data-testid="models-spend-bug"[\s\S]*?unknown/);
    assert.match(html, /0 of 2 runs priced, 1 unpriced, 1 with no usage reported/);
  });

  test('priced spend is shown to the cent, with its typical run', () => {
    const html = body(emptyTable(), {
      agentSpend: [{ id: 'bug', runs: 2, priced: 2, unpriced: 0, noTelemetry: 0, spendUsd: 1.5, typicalUsd: 0.75, models: ['sonnet'] }]
    });
    assert.match(html, /\$1\.50 · typical \$0\.750 a run/);
  });

  test('the spend bar is a native progress element, with the share as its value', () => {
    assert.equal(spendBar({ share: 0.5, label: 'half' }), '<progress class="settings-spend-bar" max="100" value="50" aria-label="half">50%</progress>');
    assert.match(spendBar({ share: null, label: 'none' }), /value="0"/);
  });

  test('the coverage line says the window is capped when the read was', () => {
    const html = body(emptyTable(), { coverage: { windowRuns: 2000, capped: true } });
    assert.match(html, /Spend covers the newest 2000 runs/);
  });
});

describe('the page', () => {
  test('the filter shows only jobs set individually when asked', () => {
    const table = applyChangesToTable(emptyTable(), [{ scope: 'job', surface: SURFACES.AGENT_SESSION, key: 'bug', field: 'model', to: 'opus' }]);
    const html = body(table, { filter: 'set' });
    assert.match(html, /data-testid="models-job-bug"/);
    assert.doesNotMatch(html, /data-testid="models-job-review"/);
  });

  test('the staged form posts the version the page was rendered from', () => {
    const table = { ...applyChangesToTable(emptyTable(), [{ scope: 'job', surface: SURFACES.AGENT_SESSION, key: 'bug', field: 'model', to: 'opus' }]), version: 3 };
    assert.match(body(table), /name="version" value="3"/);
  });

  test('a refused save shows its message in place and keeps the values it posted', () => {
    const html = body(emptyTable(), { flash: { message: 'Nothing was changed.', values: { 'c__job__agent-session__bug__model': 'opus' } } });
    assert.match(html, /data-testid="models-error"/);
    assert.match(html, /<option value="opus" selected>|value="opus"/);
  });

  test('the Models label of a model prefers the catalog name, then the curated name, then the slug', () => {
    const name = modelNamer({ catalog: [{ id: 'a/b', name: 'From Catalog' }], availableModels: [{ id: 'a/b', name: 'Curated' }, { id: 'c/d', name: 'Curated D' }] });
    assert.equal(name('a/b'), 'From Catalog');
    assert.equal(name('c/d'), 'Curated D');
    assert.equal(name('e/f'), 'f');
    assert.equal(name(null), 'Default');
  });
});
