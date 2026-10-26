/**
 * LIN-3952 (consolidation): one function words a model change for both logs. A change names its model by display name
 * and its job by stage word, one line per job, so no raw key or id reaches the log. The Models log's "You" comes from
 * the same actor rule as the Change log (render-settings-workspace.js actorLabel).
 *
 * Run with: node --test tests/unit/model-change-lines.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { modelChangeLines, jobWords } from '../../lib/components/model-change-lines.js';
import { modelsBody } from '../../lib/render-settings-models.js';
import { emptyTable, effectiveTable, AGENT_JOB_IDS, HARBOUR_JOB_IDS } from '../../lib/model-routing.js';
import { agentSpendByJob, harbourSpendByJob } from '../../lib/model-routing-spend.js';
import { DEFAULT_MODEL, getModelDisplayName } from '../../lib/openrouter.js';
import { SURFACES } from '../../lib/llm-jobs.js';
import { actorLabel } from '../../lib/render-settings-workspace.js';
import { FORMER_MEMBER } from '../../lib/workspace-change-log.js';

const AGENT = SURFACES.AGENT_SESSION;

describe('modelChangeLines', () => {
  test('one line per job, naming the job by its stage word and the model by its display name', () => {
    const lines = modelChangeLines([
      { scope: 'job', surface: AGENT, key: 'implementation', field: 'model', to: 'anthropic/claude-sonnet-5' },
      { scope: 'job', surface: AGENT, key: 'implementation', field: 'effort', to: 'high' }
    ]);
    assert.deepEqual(lines, [`Build: model → ${getModelDisplayName('anthropic/claude-sonnet-5')}, effort → high`]);
  });

  test('a grouped change is one line per job, never a paragraph of raw keys', () => {
    const lines = modelChangeLines([
      { scope: 'job', surface: AGENT, key: 'bug', field: 'model', to: 'haiku' },
      { scope: 'job', surface: AGENT, key: 'review', field: 'model', to: 'opus' }
    ]);
    assert.equal(lines.length, 2);
    assert.ok(lines.every((l) => !/__|agent-session|\bbug model\b/.test(l)), lines.join(' | '));
  });

  test('a cleared field reads "follow the group", and a group names itself', () => {
    assert.deepEqual(modelChangeLines([{ scope: 'group', surface: AGENT, key: 'make', field: 'model', to: null }]), ['Make group: model → follow the group']);
  });

  test('no changes, no lines', () => {
    assert.deepEqual(modelChangeLines([]), []);
    assert.deepEqual(modelChangeLines(undefined), []);
  });

  test('a Harbour call is named in words, and an agent job keeps its stage word', () => {
    assert.equal(jobWords('close-out', AGENT), 'Close-out');
    assert.equal(jobWords('plan-review', SURFACES.HARBOUR_CALL), 'Plan review');
  });
});

describe('the "You" rule through the Models adapter', () => {
  test('the viewer\'s own Models change reads "You", and another member\'s reads their name', () => {
    const mine = actorLabel({ actorName: 'Ada', actorId: 'acct-1', actorVia: 'page' }, 'acct-1');
    const theirs = actorLabel({ actorName: 'Grace', actorId: 'acct-2', actorVia: 'page' }, 'acct-1');
    assert.equal(mine, 'You');
    assert.equal(theirs, 'Grace');
  });

  test('a Models entry with no actor name falls back to the former-member name, never "undefined"', () => {
    assert.equal(actorLabel({ actorName: FORMER_MEMBER, actorId: null, actorVia: 'page' }, 'acct-1'), FORMER_MEMBER);
  });

  test('the Models log shows "You" for the viewer\'s own entry, through the page body', () => {
    const table = emptyTable();
    const effective = effectiveTable(table, { defaultModel: DEFAULT_MODEL });
    const log = [{
      _id: 'e1', kind: 'change', at: new Date().toISOString(), reason: 'testing',
      actor: { via: 'page', id: 'acct-1', name: 'Ada' },
      changes: [{ scope: 'job', surface: AGENT, key: 'bug', field: 'model', to: 'haiku', from: null }]
    }];
    const html = modelsBody({
      urlKey: 'acme', table, effective, log, viewerAccountId: 'acct-1', presets: [], catalog: [], availableModels: [],
      agentSpend: agentSpendByJob([], { jobs: AGENT_JOB_IDS }), harbourSpend: harbourSpendByJob([], { jobs: HARBOUR_JOB_IDS })
    });
    assert.match(html, /data-testid="models-log-e1"[\s\S]*?settings-row-label">You · /);
    assert.doesNotMatch(html, /data-testid="models-log-e1"[\s\S]*?Ada/);
    assert.match(html, /data-testid="models-log-e1"[\s\S]*?Bug fix: model → /);
  });
});
