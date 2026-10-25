/**
 * LIN-3853: the pure part of the routing table — migration, the reverse projection the old
 * Settings sections read, the diff, and the census of which jobs the old forms reach.
 *
 * Run with: node --test tests/unit/model-routing.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { JOBS } from '../../lib/llm-jobs.js';
import { DISPATCH_DEFAULT_KINDS } from '../../lib/prompt-templates.js';
import {
  AI_OPERATION_KINDS, AGENT_JOB_IDS, HARBOUR_JOB_IDS, tableFromPreferences, projectLegacy, emptyTable,
  diffTables, applyChangesToTable, harbourModelChanges
} from '../../lib/model-routing.js';
import { AI_OPERATION_KINDS as REEXPORTED } from '../../lib/workspace-preferences.js';

describe('migration: the switch changes nothing', () => {
  test('dispatchDefaults.byKind rows become the job\'s own setting, partial rows kept partial', () => {
    const t = tableFromPreferences({ dispatchDefaults: { model: 'top', byKind: { review: { harness: 'opencode' }, bug: { model: 'm', effort: 'e' } } } });
    assert.deepEqual(t.jobs.review, { harness: 'opencode' });
    assert.deepEqual(t.jobs.bug, { model: 'm', effort: 'e' });
    assert.equal(t.jobs.plan, undefined);
  });

  test('every agent group and the agent default take the workspace-wide row; Harbour groups take modelId', () => {
    const t = tableFromPreferences({ modelId: 'a/b', dispatchDefaults: { model: 'top', harness: 'claude-code' } });
    for (const g of Object.keys(t.groups['agent-session'])) assert.deepEqual(t.groups['agent-session'][g], { model: 'top', harness: 'claude-code' });
    for (const g of Object.keys(t.groups['harbour-call'])) assert.deepEqual(t.groups['harbour-call'][g], { model: 'a/b' });
    assert.deepEqual(t.defaults, { 'agent-session': { model: 'top', harness: 'claude-code' }, 'harbour-call': { model: 'a/b' } });
  });

  test('an override becomes the job\'s own model, and scan also seeds scan-retire', () => {
    const t = tableFromPreferences({ aiModelOverrides: { byKind: { scan: { model: 's' }, recap: { model: 'r' }, 'feedback-title': { model: 'ignored' } } } });
    assert.deepEqual([t.jobs.scan, t.jobs['scan-retire'], t.jobs.recap, t.jobs['feedback-title']], [{ model: 's' }, { model: 's' }, { model: 'r' }, undefined]);
  });

  test('a blank stays blank (no key), and stray byKind for custom/periodical is ignored', () => {
    const t = tableFromPreferences({ dispatchDefaults: { byKind: { custom: { model: 'x' }, periodical: { model: 'y' } } } });
    assert.deepEqual(t.jobs, {});
    assert.deepEqual(t.defaults['agent-session'], {});
  });
});

describe('the old forms are the migration run in reverse', () => {
  const FORM_PREFS = [
    {},
    { modelId: 'a/b' },
    { modelId: 'a/b', dispatchDefaults: { model: 'm', harness: 'opencode', effort: 'high', byKind: { review: { model: 'r' }, autopilot: { harness: 'claude-code', effort: 'low' } } }, aiModelOverrides: { byKind: { recommend: { model: 'a/rec' }, scan: { model: 'a/scan' } } } }
  ];
  for (const [i, prefs] of FORM_PREFS.entries()) {
    test(`projectLegacy(tableFromPreferences(p)) equals the form-shaped p (${i})`, () => {
      const out = projectLegacy(tableFromPreferences(prefs));
      assert.equal(out.modelId, prefs.modelId);
      assert.deepEqual(out.dispatchDefaults, prefs.dispatchDefaults || {});
      assert.deepEqual(out.aiModelOverrides, prefs.aiModelOverrides || {});
    });
  }

  test('the Harbour model seed sets the Harbour default and every Harbour group, leaving job rows', () => {
    const base = applyChangesToTable(tableFromPreferences({ aiModelOverrides: { byKind: { recap: { model: 'own' } } } }), []);
    const t = applyChangesToTable(base, harbourModelChanges('a/new'));
    assert.equal(t.defaults['harbour-call'].model, 'a/new');
    assert.ok(Object.values(t.groups['harbour-call']).every((g) => g.model === 'a/new'));
    assert.equal(t.jobs.recap.model, 'own');
  });
});

describe('diff and apply', () => {
  test('diffTables reports from and to, and applying the diff reproduces the table', () => {
    const a = tableFromPreferences({ dispatchDefaults: { model: 'x' } });
    const b = applyChangesToTable(applyChangesToTable(a, harbourModelChanges('a/b')), [{ scope: 'job', surface: 'harbour-call', key: 'recap', field: 'model', to: 'a/r' }]);
    const changes = diffTables(a, b);
    assert.ok(changes.some((c) => c.key === 'recap' && c.from === null && c.to === 'a/r'));
    assert.deepEqual(diffTables(applyChangesToTable(a, changes), b), []);
  });

  test('diffing a table with itself is empty', () => {
    assert.deepEqual(diffTables(emptyTable(), emptyTable()), []);
  });
});

describe('census (item 1\'s registry against the old forms\' scope)', () => {
  test('agent jobs are DISPATCH_DEFAULT_KINDS plus periodical and custom', () => {
    assert.deepEqual([...AGENT_JOB_IDS].sort(), [...new Set([...DISPATCH_DEFAULT_KINDS, 'periodical', 'custom'])].sort());
  });

  test('the ten AI operations are all Harbour jobs, and the job counts are the registry\'s', () => {
    for (const op of AI_OPERATION_KINDS) assert.ok(HARBOUR_JOB_IDS.includes(op), op);
    assert.equal(AGENT_JOB_IDS.length + HARBOUR_JOB_IDS.length, JOBS.length);
  });

  test('AI_OPERATION_KINDS is still exported from workspace-preferences', () => {
    assert.equal(REEXPORTED, AI_OPERATION_KINDS);
  });
});
