/**
 * LIN-3952 items 1 and 2 of the polish: spend is visible on each job row at rest (total, typical run, share), each
 * section shows its total, and the long tail folds behind one "Show N more" row. The figures are read through the
 * spend module; the renderer adds no arithmetic of its own (the spend-module tests pin the sums).
 *
 * Run with: node --test tests/unit/models-ranked-row.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { modelsBody, FOLD_KEEP } from '../../lib/render-settings-models.js';
import { emptyTable, effectiveTable, applyChangesToTable, AGENT_JOB_IDS, HARBOUR_JOB_IDS } from '../../lib/model-routing.js';
import { agentSpendByJob, harbourSpendByJob } from '../../lib/model-routing-spend.js';
import { DEFAULT_MODEL } from '../../lib/openrouter.js';
import { SURFACES } from '../../lib/llm-jobs.js';

const AGENT = SURFACES.AGENT_SESSION;

const usageRow = (id, kind, costUsd) => ({
  id, status: 'taken', kind, dispatchedAt: '2026-10-20T10:00:00Z', rootItemId: id,
  feedback: [{ kind: 'usage', timestamp: '2026-10-20T10:01:00Z', message: `[usage] ${JSON.stringify({ model: 'anthropic/claude-sonnet-5', harness: 'claude-code', costUsd })}` }]
});

function body(table, rows = [], extra = {}) {
  const effective = effectiveTable(table, { defaultModel: DEFAULT_MODEL });
  return modelsBody({
    urlKey: 'acme', table, effective,
    agentSpend: agentSpendByJob(rows, { jobs: AGENT_JOB_IDS }),
    harbourSpend: harbourSpendByJob([], { jobs: HARBOUR_JOB_IDS }),
    presets: [], log: [], catalog: [], availableModels: [], hasRunner: true,
    ...extra
  });
}

/** One agent job's summary, from its row's testid to the chevron: what is seen without opening it. */
const summaryOf = (html, id) => {
  const start = html.indexOf(`data-testid="models-job-${id}"`);
  assert.notEqual(start, -1, id);
  const end = html.indexOf('</summary>', start);
  return html.slice(start, end);
};

describe('spend at rest on each job row (LIN-3952 item 1)', () => {
  test('a job with priced runs shows its total and its typical run in its summary, without opening it', () => {
    const rows = [usageRow('r1', 'review', 2), usageRow('r2', 'review', 4)];
    const summary = summaryOf(body(emptyTable(), rows), 'review');
    assert.match(summary, /settings-row-total">\$6\.00</);
    assert.match(summary, /typical \$3\.00 a run/);
    assert.match(summary, /models-row-share-review/, 'a share bar for its part of priced spend');
  });

  test('a job with runs and no price reads "unpriced", never $0', () => {
    const summary = summaryOf(body(emptyTable(), [usageRow('b1', 'bug', undefined)]), 'bug');
    assert.match(summary, /settings-row-total">unpriced</);
    assert.doesNotMatch(summary, /\$0\.00/);
  });

  test('a job with no runs shows no figures at all: its "no runs" flag says so', () => {
    const summary = summaryOf(body(emptyTable()), 'review');
    assert.doesNotMatch(summary, /settings-row-figures/);
    assert.match(summary, /no runs/);
  });
});

describe('each section shows its total (LIN-3952 item 1)', () => {
  test('the agent section title carries the priced total of its jobs', () => {
    const html = body(emptyTable(), [usageRow('r1', 'review', 2), usageRow('i1', 'implementation', 1.25)]);
    assert.match(html, /data-testid="models-agent-jobs-total">\$3\.25 priced in 30 days</);
  });

  test('a section with nothing priced says nothing as its total, rather than $0', () => {
    assert.doesNotMatch(body(emptyTable()), /data-testid="models-agent-jobs-total"/);
  });
});

describe('the long tail folds (LIN-3952 item 1)', () => {
  // Eight agent jobs with runs: the top FOLD_KEEP stay at rest, the rest fold.
  const kinds = ['review', 'implementation', 'bug', 'plan', 'close-out', 'plan-review', 'retro', 'design'];
  const rows = kinds.map((k, i) => usageRow(`r-${k}`, k, 8 - i));

  test('the first six jobs with runs are at rest, and the rest sit behind a "Show N more" row', () => {
    const html = body(emptyTable(), rows);
    const atRest = html.slice(0, html.indexOf('data-testid="models-fold-agent"'));
    const restIds = [...atRest.matchAll(/data-testid="models-job-([a-z-]+)"/g)].map((m) => m[1]);
    assert.equal(restIds.length, FOLD_KEEP, 'six jobs above the fold');
    assert.deepEqual(restIds, kinds.slice(0, FOLD_KEEP), 'the six with the most spend');
    assert.match(html, /<summary class="models-fold-summary">Show \d+ more<\/summary>/);
  });

  test('a fold stays closed unless it holds a staged value, which opens it', () => {
    const closed = body(emptyTable(), rows);
    assert.doesNotMatch(closed, /data-models-fold open/);
    const staged = body(emptyTable(), rows, { flash: { message: 'refused', values: { 'c__job__agent-session__design__model': 'opus' } } });
    assert.match(staged, /data-testid="models-fold-agent" data-models-fold open/);
  });

  test('a job folded away is still in the form, so a staged field posts with the page', () => {
    const html = body(emptyTable(), rows);
    const folded = html.slice(html.indexOf('models-fold-agent'));
    assert.match(folded, /name="c__job__agent-session__design__model"/);
  });
});
