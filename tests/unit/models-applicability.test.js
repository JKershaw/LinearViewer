/**
 * LIN-3952 item 6: Models shows what applies, and says where each value comes from. An empty workspace has no agent
 * work to set, so its twenty agent jobs are one line; groups with no job are not listed; a Harbour call with nothing
 * stored says it runs on the server's default; and on the free tier the page says once what every Harbour call runs.
 *
 * Run with: node --test tests/unit/models-applicability.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { modelsBody, agentHasSetting } from '../../lib/render-settings-models.js';
import { emptyTable, effectiveTable, applyChangesToTable, AGENT_JOB_IDS, HARBOUR_JOB_IDS } from '../../lib/model-routing.js';
import { agentSpendByJob, harbourSpendByJob } from '../../lib/model-routing-spend.js';
import { DEFAULT_MODEL, getModelDisplayName } from '../../lib/openrouter.js';
import { SURFACES } from '../../lib/llm-jobs.js';

const AGENT = SURFACES.AGENT_SESSION;

function body(table = emptyTable(), extra = {}) {
  return modelsBody({
    urlKey: 'acme', table, effective: effectiveTable(table, { defaultModel: DEFAULT_MODEL }),
    agentSpend: agentSpendByJob([], { jobs: AGENT_JOB_IDS }),
    harbourSpend: harbourSpendByJob([], { jobs: HARBOUR_JOB_IDS }),
    presets: [], log: [], catalog: [], availableModels: [], hasRunner: false,
    ...extra
  });
}

describe('agent rows apply only when the workspace has agent work (LIN-3952 item 6)', () => {
  test('an empty workspace lists no agent job rows, and says agent sessions appear once steps run from Harbour', () => {
    const html = body();
    for (const id of AGENT_JOB_IDS) assert.doesNotMatch(html, new RegExp(`data-testid="models-job-${id}"`), id);
    assert.match(html, /Agent sessions appear once steps run from Harbour/);
  });

  test('its Harbour calls still list, with their spend', () => {
    assert.match(body(), /data-testid="models-job-brief"/);
  });

  test('a live runner shows the agent rows', () => {
    assert.match(body(emptyTable(), { hasRunner: true }), /data-testid="models-job-review"/);
  });

  test('a stored agent setting shows the agent rows, even with no runner: it is not hidden', () => {
    const table = applyChangesToTable(emptyTable(), [{ scope: 'job', surface: AGENT, key: 'bug', field: 'model', to: 'haiku' }]);
    assert.equal(agentHasSetting(table), true);
    assert.match(body(table), /data-testid="models-job-bug"/);
  });

  test('an agent run in the window shows the agent rows', () => {
    const run = { id: 'r1', status: 'taken', kind: 'review', dispatchedAt: '2026-10-20T10:00:00Z', rootItemId: 'r1', feedback: [] };
    const html = body(emptyTable(), { agentSpend: agentSpendByJob([run], { jobs: AGENT_JOB_IDS }) });
    assert.match(html, /data-testid="models-job-review"/);
  });

  test('a table with nothing set in it has no agent setting', () => {
    assert.equal(agentHasSetting(emptyTable()), false);
  });
});

describe('groups with no job are not listed (LIN-3952 item 6)', () => {
  test('agent tell and Harbour judge, plan and make are not listed; the groups with jobs are', () => {
    const html = body(emptyTable(), { hasRunner: true });
    assert.doesNotMatch(html, /data-testid="models-group-agent-session-tell"/);
    for (const g of ['judge', 'plan', 'make']) assert.doesNotMatch(html, new RegExp(`data-testid="models-group-harbour-call-${g}"`));
    assert.match(html, /data-testid="models-group-harbour-call-steer"/);
    assert.match(html, /data-testid="models-group-agent-session-make"/);
  });
});

describe('a Harbour call with nothing stored says where it runs (LIN-3952 item 6)', () => {
  test('a Harbour row with no stored model reads "server default", not "not set"', () => {
    const html = body();
    const value = html.match(/data-testid="models-job-brief"[\s\S]*?settings-row-value">([^<]*)</)[1];
    assert.match(value, /server default/);
    assert.doesNotMatch(value, /not set/);
  });

  test('an agent row with nothing stored still reads "not set"', () => {
    const html = body(emptyTable(), { hasRunner: true });
    const value = html.match(/data-testid="models-job-review"[\s\S]*?settings-row-value">([^<]*)</)[1];
    assert.match(value, /not set/);
  });

  test('the free tier is said once, under the Harbour calls, by display name', () => {
    const html = body(emptyTable(), { freeTierModel: 'openai/gpt-5.4-mini' });
    assert.ok(html.includes(`Harbour calls run ${getModelDisplayName('openai/gpt-5.4-mini')} whatever is set here.`));
    assert.doesNotMatch(body(), /on the free tier/i, 'not on a paid workspace');
  });
});

describe('group descriptions read as sentences (LIN-3952 item 9)', () => {
  test('a group note starts with a capital letter', () => {
    assert.match(body(emptyTable(), { hasRunner: true }), /<p class="settings-note">Produces the change<\/p>/);
  });
});
