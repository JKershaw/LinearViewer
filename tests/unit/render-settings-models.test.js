/**
 * LIN-3855: the Settings › Models body (lib/render-settings-models.js) and its pieces: what a row says, where a
 * value comes from, the option sets a row offers, the spend words, the filter, and the classes the new rows
 * must not carry.
 *
 * Run with: node --test tests/unit/render-settings-models.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { modelsBody, agentOptions, jobLabel } from '../../lib/render-settings-models.js';
import { getModelDisplayName } from '../../lib/openrouter.js';
import { emptyTable, effectiveTable, applyChangesToTable, AGENT_JOB_IDS, HARBOUR_JOB_IDS } from '../../lib/model-routing.js';
import { agentSpendByJob, harbourSpendByJob } from '../../lib/model-routing-spend.js';
import { DEFAULT_MODEL } from '../../lib/openrouter.js';
import { SURFACES } from '../../lib/llm-jobs.js';
import { decisionPanel, fieldName } from '../../lib/components/decision-panel.js';
import { spendBar } from '../../lib/components/settings-spend-bar.js';

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

  test('the no-runs flag is its own tag after the job name, so the two never run together (LIN-3855 review)', () => {
    const html = body(emptyTable());
    assert.match(html, /settings-row-label">Review<span class="settings-row-flags"><span class="settings-row-flag">no runs<\/span><\/span><\/span>/);
    assert.doesNotMatch(html, /Reviewno runs/);
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
    assert.match(body(table), /value="odd\/model-x"/);
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

describe('the blank option on a group and the No job row', () => {
  // One decision panel, from its testid to its own closing div: the panel nests divs, so count them. A match
  // cannot run on into the next row's panel.
  const panelOf = (html, testid) => {
    const start = html.indexOf(`data-testid="${testid}"`);
    assert.notEqual(start, -1, testid);
    const tag = /<(\/?)div\b/g;
    tag.lastIndex = start;
    let depth = 0;
    for (let m = tag.exec(html); m; m = tag.exec(html)) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) return html.slice(start, m.index + m[0].length);
    }
    assert.fail(`no closing div for ${testid}`);
  };

  test('an agent group with no setting reads "Not set": nothing above it fills the blank (LIN-3855 ruling)', () => {
    const html = body(emptyTable());
    assert.match(panelOf(html, 'models-panel-group-agent-session-make'), /<option value=""[^>]*>Not set<\/option>/);
  });

  test('the No job row is not on Models any more: it moved to the Dispatch page (LIN-3952 item 6)', () => {
    const html = body(emptyTable());
    assert.doesNotMatch(html, /models-default-agent|No job \(Dispatch suggestion\)/);
  });

  test('no blank option on the page says "Inherit the default": a blank group reads nothing above it (agent and Harbour alike)', () => {
    const html = body(emptyTable());
    assert.match(panelOf(html, 'models-panel-group-harbour-call-steer'), /placeholder="Not set"/, 'a Harbour call has no harness: its model follows the group');
    assert.doesNotMatch(html, /Inherit the default/);
  });
});

describe('the decision panel (LIN-3962)', () => {
  const lists = { 'claude-code': [], opencode: [{ id: 'openai/gpt-5.5', label: 'GPT-5.5', free: false }], any: [{ id: 'openai/gpt-5.5', label: 'GPT-5.5', free: false }] };
  const named = (target) => ({ nameOf: (field) => fieldName({ ...target, field }), fieldAttrs: (field) => `data-models-field="${field}"` });

  test('its fields are named by scope, surface, key and field, and the blank option follows the group', () => {
    const target = { scope: 'job', surface: 'agent-session', key: 'bug' };
    const html = decisionPanel({
      testid: 'models-panel-job-agent-session-bug',
      harness: { value: null, inForce: 'opencode', follow: 'Follow Make (opencode)' },
      model: { value: null, follow: 'Follow Make (none)', lists, suggestions: {} },
      effort: { value: null, follow: 'Follow Make (none)' },
      ...named(target)
    });
    assert.match(html, /name="c__job__agent-session__bug__harness"/);
    assert.match(html, /name="c__job__agent-session__bug__model"/);
    assert.match(html, /name="c__job__agent-session__bug__effort"/);
    assert.match(html, /<option value=""[^>]*>Follow Make \(opencode\)<\/option>/);
    assert.match(html, /placeholder="Follow Make \(none\)"/);
  });

  test('effort is hidden on a harness that takes none, and the panel never carries the old row classes', () => {
    const target = { scope: 'group', surface: 'agent-session', key: 'make' };
    const html = decisionPanel({
      testid: 'models-panel-group-agent-session-make',
      harness: { value: 'opencode', inForce: 'opencode', follow: 'Not set' },
      model: { value: null, follow: 'Not set', lists, suggestions: {} },
      effort: { value: null, follow: 'Not set' },
      ...named(target)
    });
    assert.match(html, /data-decision-effort hidden/);
    assert.doesNotMatch(html, /class="[^"]*\b(line|toggle-btn|action-btn|settings-change-panel)\b/);
  });

  test('a free option carries data-free, never option text', () => {
    const target = { scope: 'job', surface: 'agent-session', key: 'bug' };
    const html = decisionPanel({
      testid: 'models-panel-job-agent-session-bug',
      harness: { value: 'opencode', inForce: 'opencode', follow: 'Follow Make' },
      model: { value: null, follow: 'Follow Make', lists: { ...lists, opencode: [{ id: 'z/free', label: 'Free', free: true }] }, suggestions: {} },
      effort: { value: null, follow: 'Follow Make' },
      ...named(target)
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
    assert.match(html, /\$1\.50 · typical \$0\.75 a run/);
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

  test('a model has one display name in the rows: the one getModelDisplayName gives, never the alias or the id (LIN-3952)', () => {
    const table = applyChangesToTable(emptyTable(), [{ scope: 'job', surface: SURFACES.AGENT_SESSION, key: 'bug', field: 'model', to: 'anthropic/claude-sonnet-5' }]);
    assert.ok(body(table).includes(getModelDisplayName('anthropic/claude-sonnet-5')), 'the display name shows');
    const summary = body(table).match(/data-testid="models-job-bug"[\s\S]*?settings-row-value">([^<]*)</)[1];
    assert.doesNotMatch(summary, /\//, 'no raw id in the row summary');
  });

  test('an agent job reads its stage word, so Close-out and Build match the rest of the app (LIN-3952)', () => {
    assert.match(body(emptyTable()), /data-testid="models-job-close-out"[\s\S]*?settings-row-label">Close-out/);
    assert.match(body(emptyTable()), /data-testid="models-job-implementation"[\s\S]*?settings-row-label">Build/);
  });
});

describe('the page lists jobs by spend (LIN-3855 done-when)', () => {
  // A taken dispatch row of a job's kind, carrying the runner's `[usage]` entry. Omit `costUsd` for an unpriced run.
  const usageRow = (id, kind, costUsd) => ({
    id, status: 'taken', kind, dispatchedAt: '2026-10-20T10:00:00Z', rootItemId: id,
    feedback: [{ kind: 'usage', timestamp: '2026-10-20T10:01:00Z', message: `[usage] ${JSON.stringify({ model: 'anthropic/claude-sonnet-5', harness: 'claude-code', costUsd })}` }]
  });
  const agentJobRowIds = (html) => [...new Set([...html.matchAll(/data-testid="models-job-([a-z-]+)"/g)].map((m) => m[1]))]
    .filter((id) => AGENT_JOB_IDS.includes(id));

  test('the most spent job is first, then the next, then an unpriced run, and a job with no runs is last', () => {
    const rows = [
      usageRow('r1', 'review', 5),
      usageRow('i1', 'implementation', 0.5),
      usageRow('i2', 'implementation', 1.5),
      usageRow('b1', 'bug', undefined)
    ];
    const html = body(emptyTable(), { agentSpend: agentSpendByJob(rows, { jobs: AGENT_JOB_IDS }) });
    const ids = agentJobRowIds(html);
    assert.deepEqual(ids.slice(0, 3), ['review', 'implementation', 'bug'], 'priced spend first, then runs, by spend');
    const noRuns = AGENT_JOB_IDS.filter((id) => !['review', 'implementation', 'bug'].includes(id));
    assert.deepEqual(ids.slice(3), noRuns, 'the jobs with no runs follow, in the registry order');
    assert.match(html, /data-testid="models-job-review"[\s\S]*?\$5\.00/, 'the spend is the priced sum on the row');
    assert.match(html, /data-testid="models-job-bug"[\s\S]*?unknown/, 'an unpriced run is unknown, not $0');
  });
});

// LIN-3987: a label says what it resolves to in words, and the window's note names models by display name.
describe('the Models words (LIN-3987)', () => {
  test('a job following a blank group names what the group resolves to, never "(none)"', () => {
    const html = body(emptyTable());
    assert.doesNotMatch(html, /\(none\)/);
    assert.match(html, /<option value=""[^>]*>Follow [^<]*\(Claude Code(?:&#039;|')s own effort\)<\/option>/, 'effort follows the harness in force, in words');
    assert.match(html, /<option value=""[^>]*>Follow [^<]*\(Claude Code\)<\/option>/, 'a blank harness resolves to Claude Code');
  });

  test('the "also ran on" note names models by their display names, not their ids', () => {
    const table = emptyTable();
    table.jobs.implementation = { model: 'claude-sonnet-5-5' };
    const spend = { id: 'implementation', runs: 3, priced: 3, unpriced: 0, noTelemetry: 0, spendUsd: 1, typicalUsd: 0.3, models: ['claude-sonnet-5-5', 'claude-opus-5-5'] };
    const html = body(table, { agentSpend: [spend] });
    assert.match(html, /also ran on Claude Opus 5\.5 \(1 of 2 models in the window\)/);
    assert.doesNotMatch(html, /also ran on claude-opus-5-5/);
  });
});

