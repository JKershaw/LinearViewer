/**
 * LIN-3855: the Models page's spend (lib/model-routing-spend.js) and sidebar summary
 * (lib/model-routing-summary.js). Pure, seeded rows, no provider and no call.
 *
 * Run with: node --test tests/unit/model-routing-spend.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { agentSpendByJob, harbourSpendByJob, byJobSpend, totalSpend, shareOf, spendByEffectiveModel } from '../../lib/model-routing-spend.js';
import { summariseRouting, summariseSpend, fit } from '../../lib/model-routing-summary.js';
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

describe('the sidebar label off Models: summariseRouting (spend-free, LIN-3952)', () => {
  const name = (m) => ({ 'openai/gpt-6.1-sol': 'GPT-6.1 Sol', 'anthropic/claude-sonnet-5': 'Claude Sonnet 5' })[m] || m.split('/').pop();

  test('one model in use names it, with no suffix', () => {
    assert.equal(summariseRouting([{ model: 'openai/gpt-6.1-sol' }, { model: 'openai/gpt-6.1-sol' }], name), 'GPT-6.1 Sol');
  });

  test('several models in use read as a count, never a job tally', () => {
    assert.equal(summariseRouting([{ model: 'openai/gpt-6.1-sol' }, { model: 'anthropic/claude-sonnet-5' }], name), '2 models');
  });

  test('no job naming a model reads "Not set", and a job with no model does not count as a model', () => {
    assert.equal(summariseRouting([], name), 'Not set');
    assert.equal(summariseRouting([{ model: null }, { model: null }, { model: 'openai/gpt-6.1-sol' }], name), 'GPT-6.1 Sol');
  });

  test('the label fits the sidebar width', () => {
    const long = (m) => (m ? 'An Extraordinarily Long Model Display Name' : '');
    assert.ok(summariseRouting([{ model: 'x/y' }], long).length <= STATE_MAX_LENGTH);
  });
});

describe('the sidebar label on Models: summariseSpend (LIN-3952 item 5)', () => {
  const name = (m) => ({ 'anthropic/claude-sonnet-5': 'Claude Sonnet 5', 'openai/gpt-6.1-sol': 'GPT-6.1 Sol' })[m] || m;

  test('names the model carrying the most priced spend, not the one most jobs run on', () => {
    // Three cheap jobs on GPT, one expensive job on Sonnet: Sonnet carries the spend.
    const byModel = [{ model: 'anthropic/claude-sonnet-5', spendUsd: 8 }, { model: 'openai/gpt-6.1-sol', spendUsd: 0.3 }];
    assert.equal(summariseSpend(byModel, name), 'Claude Sonnet 5');
  });

  test('no priced spend reads "No priced runs"', () => {
    assert.equal(summariseSpend([], name), 'No priced runs');
  });

  test('the label fits the sidebar width', () => {
    const long = () => 'An Extraordinarily Long Model Display Name';
    assert.ok(summariseSpend([{ model: 'x', spendUsd: 1 }], long).length <= STATE_MAX_LENGTH);
  });
});

describe('spend totals and attribution (LIN-3952 item 1, 5)', () => {
  const spend = (id, spendUsd, priced) => ({ id, spendUsd, priced, runs: priced, models: [] });

  test('the total is the sum of priced spend, and a job\'s share of it is null with none priced', () => {
    const all = [spend('a', 3, 2), spend('b', 1, 1), spend('c', 0, 0)];
    assert.equal(totalSpend(all), 4);
    assert.equal(shareOf(all[0], totalSpend(all)), 0.75);
    assert.equal(shareOf(all[2], totalSpend(all)), null, 'an unpriced job has no share');
    assert.equal(shareOf(all[0], 0), null, 'no whole, no share');
  });

  test('spend is credited to each job\'s EFFECTIVE model, and a job with no model is not credited to a default', () => {
    const effectiveRows = [{ id: 'a', model: 'm1' }, { id: 'b', model: 'm1' }, { id: 'c', model: null }];
    const out = spendByEffectiveModel([spend('a', 2, 1), spend('b', 1, 1), spend('c', 5, 1)], effectiveRows);
    assert.deepEqual(out, [{ model: 'm1', spendUsd: 3 }]);
  });
});

// LIN-3962: the per-model typical cost the decision panel shows beside a suggested model, and the one
// reported model of an alias's family (the only way to know what an alias ran as).
import { typicalByModel, reportedModelForFamily } from '../../lib/model-routing-spend.js';

describe('typicalByModel (LIN-3962)', () => {
  test('a job that ran on one model gets one row, with that model\'s typical cost', () => {
    const rows = [
      taken({ id: 'a', kind: 'implementation', feedback: [usage({ model: 'claude-sonnet-5', costUsd: 0.5 })] }),
      taken({ id: 'b', kind: 'implementation', feedback: [usage({ model: 'claude-sonnet-5', costUsd: 1.5 })] })
    ];
    const rowsByModel = typicalByModel(rows, { job: 'implementation' });
    assert.equal(rowsByModel.length, 1);
    assert.equal(rowsByModel[0].id, 'claude-sonnet-5');
    assert.equal(rowsByModel[0].typicalUsd, 1);
    assert.equal(rowsByModel[0].runs, 2);
  });

  test('two models give two rows, each priced from its own runs only', () => {
    const rows = [
      taken({ id: 'a', kind: 'implementation', feedback: [usage({ model: 'claude-sonnet-5', costUsd: 0.5 })] }),
      taken({ id: 'b', kind: 'implementation', feedback: [usage({ model: 'claude-opus-5', costUsd: 4 })] }),
      taken({ id: 'c', kind: 'implementation', feedback: [usage({ model: 'claude-opus-5' })] })
    ];
    const byModel = Object.fromEntries(typicalByModel(rows, { job: 'implementation' }).map((r) => [r.id, r]));
    assert.equal(byModel['claude-sonnet-5'].typicalUsd, 0.5);
    assert.equal(byModel['claude-opus-5'].typicalUsd, 4, 'the unpriced opus run does not drag the typical to $0');
    assert.equal(byModel['claude-opus-5'].unpriced, 1);
  });

  test('another job\'s runs are not counted', () => {
    const rows = [taken({ id: 'a', kind: 'review', feedback: [usage({ model: 'claude-opus-5', costUsd: 9 })] })];
    assert.deepEqual(typicalByModel(rows, { job: 'implementation' }), []);
  });
});

describe('reportedModelForFamily (LIN-3962)', () => {
  test('an alias with exactly one reported model of its family names that model', () => {
    const models = [{ id: 'claude-opus-5' }, { id: 'claude-sonnet-5' }];
    assert.equal(reportedModelForFamily(models, 'opus'), 'claude-opus-5');
  });

  test('two models of one family name nothing: the alias shows no claim about what it ran as', () => {
    const models = [{ id: 'claude-opus-4-1' }, { id: 'claude-opus-5' }];
    assert.equal(reportedModelForFamily(models, 'opus'), null);
  });

  test('a family the job never ran names nothing', () => {
    assert.equal(reportedModelForFamily([{ id: 'claude-sonnet-5' }], 'opus'), null);
  });
});
