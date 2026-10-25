/**
 * LIN-3855: the Models page's spend (lib/model-routing-spend.js) and sidebar summary
 * (lib/model-routing-summary.js). Pure, seeded rows, no provider and no call.
 *
 * Run with: node --test tests/unit/model-routing-spend.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { agentSpendByJob, harbourSpendByJob, byJobSpend } from '../../lib/model-routing-spend.js';
import { summariseRouting, fit } from '../../lib/model-routing-summary.js';
import { AGENT_JOB_IDS, HARBOUR_JOB_IDS } from '../../lib/model-routing.js';
import { STATE_MAX_LENGTH } from '../../lib/settings-areas.js';

// A `[usage]` feedback entry, as the runner posts it. `costUsd` pins a price; omit it to be unpriced.
function usage({ model = 'anthropic/claude-sonnet-5', costUsd, harness = 'claude-code', timestamp = '2026-10-20T10:01:00Z' } = {}) {
  const payload = { model, harness };
  if (costUsd !== undefined) payload.costUsd = costUsd;
  return { kind: 'usage', timestamp, message: `[usage] ${JSON.stringify(payload)}` };
}
const taken = ({ id, kind = 'implementation', feedback = [], dispatchedAt = '2026-10-20T10:00:00Z', rootItemId }) => ({ id, status: 'taken', kind, dispatchedAt, feedback, rootItemId });

describe('agentSpendByJob', () => {
  test('a priced run adds to spend; a run with no price is unpriced, never $0', () => {
    const rows = [
      taken({ id: 'a', kind: 'implementation', feedback: [usage({ costUsd: 0.5 })] }),
      taken({ id: 'b', kind: 'implementation', feedback: [usage({ costUsd: 1.5 })] }),
      taken({ id: 'c', kind: 'implementation', feedback: [usage({ model: 'anthropic/claude-haiku-5.5' })] })
    ];
    const [impl] = agentSpendByJob(rows, { jobs: ['implementation'] });
    assert.equal(impl.runs, 3);
    assert.equal(impl.priced, 2);
    assert.equal(impl.unpriced, 1, 'the unpriced run is counted as unpriced');
    assert.equal(impl.noTelemetry, 0);
    assert.equal(impl.spendUsd, 2, 'spend is what is priced, no $0 for the unknown run');
    assert.equal(impl.typicalUsd, 1, 'typical is the mean of the priced runs');
  });

  test('a run with no [usage] at all is no-telemetry, and is not $0 either', () => {
    const rows = [taken({ id: 'a', kind: 'make', feedback: [] })];
    const [make] = agentSpendByJob(rows, { jobs: ['make'] });
    assert.deepEqual([make.runs, make.priced, make.unpriced, make.noTelemetry, make.spendUsd, make.typicalUsd], [1, 0, 0, 1, 0, null]);
  });

  test('a seeded unpriced Haiku 5.5 claude-code row is unpriced and lists its model', () => {
    const rows = [taken({ id: 'h', kind: 'brief', feedback: [usage({ model: 'claude-haiku-5-5', harness: 'claude-code' })] })];
    const [brief] = agentSpendByJob(rows, { jobs: ['brief'] });
    assert.equal(brief.unpriced, 1);
    assert.deepEqual(brief.models, ['claude-haiku-5-5']);
  });

  test('queued and other non-taken rows never ran and are dropped', () => {
    const rows = [{ id: 'q', status: 'queued', kind: 'make', dispatchedAt: '2026-10-20T10:00:00Z', feedback: [usage({ costUsd: 9 })] }];
    const [make] = agentSpendByJob(rows, { jobs: ['make'] });
    assert.equal(make.runs, 0);
    assert.equal(make.spendUsd, 0);
  });

  test('a job with no rows is listed with zero runs, in the order given', () => {
    const out = agentSpendByJob([], { jobs: ['make', 'judge'] });
    assert.deepEqual(out.map((j) => [j.id, j.runs, j.typicalUsd]), [['make', 0, null], ['judge', 0, null]]);
  });

  test('a lineage counts once, under its earliest row\'s kind', () => {
    const rows = [
      taken({ id: 'first', kind: 'plan', dispatchedAt: '2026-10-20T10:00:00Z', feedback: [usage({ costUsd: 1 })], rootItemId: 'root' }),
      taken({ id: 'follow', kind: 'make', dispatchedAt: '2026-10-20T11:00:00Z', feedback: [usage({ costUsd: 3 })], rootItemId: 'root' })
    ];
    const [plan, make] = agentSpendByJob(rows, { jobs: ['plan', 'make'] });
    assert.equal(plan.runs, 1);
    assert.equal(make.runs, 0, 'the follow-up is part of the plan lineage, not a make run');
  });
});

describe('harbourSpendByJob', () => {
  test('a null cost is unpriced, not folded to $0', () => {
    const docs = [
      { feature: 'judge', model: 'openai/gpt-6.1-sol', cost: 0.25 },
      { feature: 'judge', model: 'openai/gpt-6.1-sol', cost: null },
      { feature: 'judge', model: 'anthropic/claude-haiku-5.5', cost: null }
    ];
    const [judge] = harbourSpendByJob(docs, { jobs: ['judge'] });
    assert.equal(judge.runs, 3);
    assert.equal(judge.priced, 1);
    assert.equal(judge.unpriced, 2);
    assert.equal(judge.spendUsd, 0.25);
    assert.equal(judge.typicalUsd, 0.25);
    assert.deepEqual(judge.models, ['anthropic/claude-haiku-5.5', 'openai/gpt-6.1-sol']);
  });

  test('a Harbour job with no calls is listed with zero runs', () => {
    const [plan] = harbourSpendByJob([], { jobs: ['plan'] });
    assert.equal(plan.runs, 0);
    assert.equal(plan.typicalUsd, null);
  });
});

describe('byJobSpend', () => {
  test('largest priced spend first, then runs, then registry order; no-run jobs last', () => {
    const index = new Map([['a', 0], ['b', 1], ['c', 2], ['d', 3]]);
    const rows = [
      { id: 'd', spendUsd: 0, runs: 0 },
      { id: 'c', spendUsd: 0, runs: 2 },
      { id: 'b', spendUsd: 5, runs: 1 },
      { id: 'a', spendUsd: 5, runs: 3 }
    ];
    assert.deepEqual(rows.sort(byJobSpend(index)).map((r) => r.id), ['a', 'b', 'c', 'd']);
  });

  test('the registry has agent and Harbour jobs to aggregate over', () => {
    assert.ok(AGENT_JOB_IDS.length > 0 && HARBOUR_JOB_IDS.length > 0);
  });
});

describe('summariseRouting: the sidebar summary', () => {
  const name = (m) => ({ 'openai/gpt-6.1-sol': 'GPT-6.1 Sol', 'anthropic/claude-sonnet-5': 'Claude Sonnet 5' })[m] || m.split('/').pop();

  test('names the model most jobs run on, with how many other models are in use', () => {
    const rows = [
      { model: 'openai/gpt-6.1-sol' }, { model: 'openai/gpt-6.1-sol' }, { model: 'openai/gpt-6.1-sol' },
      { model: 'anthropic/claude-sonnet-5' }, { model: 'google/x' }
    ];
    assert.equal(summariseRouting(rows, name), 'GPT-6.1 Sol +2');
  });

  test('a single model is shown with no suffix; no jobs is Default', () => {
    assert.equal(summariseRouting([{ model: 'openai/gpt-6.1-sol' }], name), 'GPT-6.1 Sol');
    assert.equal(summariseRouting([], name), 'Default');
  });

  test('a job with no stored model counts as Default, and the top model wins on job count', () => {
    assert.equal(summariseRouting([{ model: null }, { model: null }, { model: 'openai/gpt-6.1-sol' }], name), 'Default +1');
  });

  test('a ties go to the model the registry meets first', () => {
    assert.equal(summariseRouting([{ model: 'openai/gpt-6.1-sol' }, { model: 'anthropic/claude-sonnet-5' }], name), 'GPT-6.1 Sol +1');
  });

  test('every summary fits the sidebar, and the +N is never clipped', () => {
    const long = 'An Extraordinarily Long Model Display Name';
    for (const others of [0, 1, 9, 42]) {
      const text = fit(long, others);
      assert.ok(text.length <= STATE_MAX_LENGTH, `${text} is ${text.length} characters`);
      if (others) assert.ok(text.endsWith(` +${others}`), `${text} keeps its count`);
    }
  });
});
