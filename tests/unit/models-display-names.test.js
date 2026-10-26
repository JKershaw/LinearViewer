/**
 * LIN-3952 item 3: one display name per model, in the rows, the panel, the sidebar summary and the log. An alias or an id
 * the page knows reads as its name; no page prints it bare. Pins the four places the finding named (the rows, the
 * sidebar's two labels and the Models log), with an alias and an id each.
 *
 * Run with: node --test tests/unit/models-display-names.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { modelsBody } from '../../lib/render-settings-models.js';
import { effectiveTable, emptyTable, applyChangesToTable, AGENT_JOB_IDS, HARBOUR_JOB_IDS } from '../../lib/model-routing.js';
import { agentSpendByJob, harbourSpendByJob, spendByEffectiveModel } from '../../lib/model-routing-spend.js';
import { summariseRouting, summariseSpend } from '../../lib/model-routing-summary.js';
import { getModelDisplayName, DEFAULT_MODEL } from '../../lib/openrouter.js';
import { modelChangeLines } from '../../lib/components/model-change-lines.js';
import { SURFACES } from '../../lib/llm-jobs.js';

const URL_KEY = 'acme';
const AVAILABLE = [{ id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 Mini' }];

function body(table, extra = {}) {
  const effective = effectiveTable(table, { defaultModel: DEFAULT_MODEL });
  return modelsBody({
    urlKey: URL_KEY, table, effective,
    agentSpend: agentSpendByJob([], { jobs: AGENT_JOB_IDS }),
    harbourSpend: harbourSpendByJob([], { jobs: HARBOUR_JOB_IDS }),
    presets: [], log: [], catalog: [], availableModels: AVAILABLE, hasRunner: true,
    ...extra
  });
}

/** The text a page prints in one element: its tags stripped. Used so a value is judged as the reader sees it. */
const textOf = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('the sidebar summary names a model, never an alias or an id (LIN-3952 item 3)', () => {
  test('on other areas, one alias or one id reads as its display name, clipped to the 16-character sidebar width', () => {
    // "Claude Sonnet 5.5" is 17 characters: the sidebar clips the name and keeps the first 15, as it does for every label.
    assert.equal(summariseRouting([{ model: 'sonnet' }], getModelDisplayName), 'Claude Sonnet 5…');
    assert.equal(summariseRouting([{ model: 'anthropic/claude-opus-4.8' }], getModelDisplayName), 'Claude Opus 4.8');
  });

  test('several models read as a count, and the count names no model', () => {
    const label = summariseRouting([{ model: 'sonnet' }, { model: 'anthropic/claude-opus-4.8' }], getModelDisplayName);
    assert.equal(label, '2 models');
  });

  test('on Models, the top spender is named by its display name, whether its spend is keyed by alias or id', () => {
    const byAlias = summariseSpend([{ model: 'opus', spendUsd: 4 }], getModelDisplayName);
    const byId = summariseSpend([{ model: 'anthropic/claude-opus-4.8', spendUsd: 4 }], getModelDisplayName);
    assert.equal(byAlias, 'Claude Opus 5.5');
    assert.equal(byId, 'Claude Opus 4.8');
    assert.doesNotMatch(byAlias, /^opus$/);
  });

  test('the spend a job carries is attributed to its effective model, named the same way', () => {
    const table = applyChangesToTable(emptyTable(), [
      { scope: 'job', surface: SURFACES.AGENT_SESSION, key: 'implementation', field: 'model', to: 'sonnet' }
    ]);
    const effective = effectiveTable(table, { defaultModel: DEFAULT_MODEL });
    const spends = [{ id: 'implementation', priced: 2, spendUsd: 1.5 }];
    const byModel = spendByEffectiveModel(spends, effective.jobs);
    assert.deepEqual(byModel.map((m) => m.model), ['sonnet']);
    assert.equal(summariseSpend(byModel, getModelDisplayName), 'Claude Sonnet 5…');
  });
});

describe('the Models log names a model, never an alias or an id (LIN-3952 item 3)', () => {
  test('a change to an alias or an id reads in display names in its line', () => {
    const lines = modelChangeLines([
      { scope: 'job', surface: SURFACES.AGENT_SESSION, key: 'implementation', field: 'model', to: 'sonnet' },
      { scope: 'job', surface: SURFACES.AGENT_SESSION, key: 'bug', field: 'model', to: 'anthropic/claude-opus-4.8' }
    ]);
    assert.deepEqual(lines, ['Build: model → Claude Sonnet 5.5', 'Bug fix: model → Claude Opus 4.8']);
  });

  test('the Models log body prints the display name, and no alias or id as text', () => {
    const entry = {
      _id: 'e1', kind: 'set', at: new Date().toISOString(), reason: 'trial',
      actor: { name: 'Sam', id: 'acc-2', via: null },
      changes: [{ scope: 'job', surface: SURFACES.AGENT_SESSION, key: 'implementation', field: 'model', to: 'sonnet' }]
    };
    const html = body(emptyTable(), { log: [entry], viewerAccountId: 'acc-1' });
    const log = html.slice(html.indexOf('data-testid="models-log"'));
    const text = textOf(log);
    assert.match(text, /Build: model → Claude Sonnet 5\.5/);
    assert.doesNotMatch(text, /→ sonnet\b/);
  });
});

describe('a row names a model by its display name (LIN-3952 item 3)', () => {
  test('a job set to an alias shows the model it runs, in the row value and not as the alias', () => {
    const table = applyChangesToTable(emptyTable(), [
      { scope: 'job', surface: SURFACES.AGENT_SESSION, key: 'implementation', field: 'model', to: 'sonnet' }
    ]);
    const html = body(table);
    const row = html.slice(html.indexOf('data-testid="models-job-implementation"'));
    const value = row.match(/settings-row-value">([^<]*)</)[1];
    assert.match(value, /Claude Sonnet 5\.5 · set here/);
    assert.doesNotMatch(value, /(^|·\s*)sonnet(\s|·|$)/);
  });

  test('a Harbour call set to an id shows its display name in the row value', () => {
    const table = applyChangesToTable(emptyTable(), [
      { scope: 'job', surface: SURFACES.HARBOUR_CALL, key: 'recap', field: 'model', to: 'openai/gpt-5.4-mini' }
    ]);
    const html = body(table);
    const row = html.slice(html.indexOf('data-testid="models-job-recap"'));
    assert.match(row.match(/settings-row-value">([^<]*)</)[1], /GPT-5\.4 Mini · set here/);
  });
});
