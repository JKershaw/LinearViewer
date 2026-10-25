/**
 * LIN-3855, review finding 5 and the ruling "No job is Dispatch suggestion only": the No job row feeds no job's
 * run. This runs the seam a queued dispatch reads (resolveDispatchDefaults, which dispatch-factory.js calls),
 * not the table function, so a change that reaches dispatch through another path still turns this red.
 * model-routing.test.js pins the table side of the same rule.
 *
 * Run with: node --test tests/unit/models-no-job-dispatch.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDispatchDefaults } from '../../lib/workspace-preferences.js';
import { emptyTable, applyChangesToTable } from '../../lib/model-routing.js';
import { SURFACES } from '../../lib/llm-jobs.js';

const AGENT = SURFACES.AGENT_SESSION;
const URL_KEY = 'acme';

// The routing store answers with the table; resolveDispatchDefaults reads it through getRoutingTable.
const storeWith = (table) => ({ getRoutingTable: async () => table });

const noJobSet = applyChangesToTable(emptyTable(), [
  { scope: 'default', surface: AGENT, key: 'default', field: 'harness', to: 'claude-code' },
  { scope: 'default', surface: AGENT, key: 'default', field: 'model', to: 'anthropic/claude-sonnet-5' },
  { scope: 'default', surface: AGENT, key: 'default', field: 'effort', to: 'high' }
]);

describe('a queued dispatch takes nothing from the No job row (LIN-3855 finding 5)', () => {
  test('a dispatch of a registered agent job with its job and group blank resolves to nothing', async () => {
    for (const kind of ['implementation', 'review', 'bug', 'custom']) {
      const resolved = await resolveDispatchDefaults({ urlKey: URL_KEY, kind, store: storeWith(noJobSet) });
      assert.deepEqual(resolved, { model: null, harness: null, effort: null }, kind);
    }
  });

  test('a group setting still reaches the dispatch, and the No job row does not fill what the group leaves blank', async () => {
    const table = applyChangesToTable(noJobSet, [
      { scope: 'group', surface: AGENT, key: 'make', field: 'effort', to: 'medium' }
    ]);
    const resolved = await resolveDispatchDefaults({ urlKey: URL_KEY, kind: 'implementation', store: storeWith(table) });
    assert.deepEqual(resolved, { model: null, harness: null, effort: 'medium' });
  });
});
