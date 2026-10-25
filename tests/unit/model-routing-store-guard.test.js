/**
 * LIN-3855: the optional write guard on the model-routing store (`_commit`'s `guard`).
 *
 * `expectedVersion` refuses a save made from a table that has since moved (CONFLICT), and `check`
 * is the caller's rule over the table that would be written. Both run on every CAS retry, before the
 * write, so a refusal writes nothing and appends no log entry. Omitting the guard is the old behaviour.
 *
 * Run with: node --test tests/unit/model-routing-store-guard.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { routingFixture } from './helpers/routing-fakes.js';
import { RoutingError } from '../../lib/model-routing.js';

const URL_KEY = 'acme';
const ctx = (reason = 'because', actor = { via: 'page', id: 'acct-1' }) => ({ urlKey: URL_KEY, reason, actor });
const agentModel = (model) => ({ scope: 'default', surface: 'agent-session', key: 'default', field: 'model', to: model });

describe('the model-routing store guard (LIN-3855)', () => {
  let fx;
  beforeEach(() => { fx = routingFixture(); });
  const store = () => fx.routingStore;
  const snapshot = () => JSON.stringify([fx.collections.routing._docs, fx.collections.log._docs]);

  test('omitting the guard is unchanged: the write lands and logs one entry', async () => {
    const entry = await store().applyChanges([agentModel('claude-sonnet-5')], ctx());
    assert.equal(entry.seq, 1);
    assert.equal((await store().getTable(URL_KEY)).version, 1);
  });

  test('a matching expectedVersion lands', async () => {
    const version = (await store().getTable(URL_KEY)).version;
    await store().applyChanges([agentModel('claude-sonnet-5')], ctx(), { expectedVersion: version });
    assert.equal((await store().getTable(URL_KEY)).version, version + 1);
  });

  test('a stale expectedVersion is CONFLICT, and nothing is written or logged', async () => {
    await store().applyChanges([agentModel('claude-sonnet-5')], ctx('first'));
    const before = snapshot();
    await assert.rejects(
      () => store().applyChanges([agentModel('claude-opus-5')], ctx('second'), { expectedVersion: 0 }),
      (err) => err instanceof RoutingError && err.code === 'CONFLICT' && err.details.version === 1
    );
    assert.equal(snapshot(), before, 'the table and the log are untouched');
  });

  test('check sees the table before and the table that would be written', async () => {
    const seen = [];
    await store().applyChanges([agentModel('claude-sonnet-5')], ctx(), {
      check: (before, after) => seen.push([before.defaults['agent-session'].model ?? null, after.defaults['agent-session'].model])
    });
    assert.deepEqual(seen, [[null, 'claude-sonnet-5']]);
  });

  test('a check that throws refuses the write: nothing is written or logged', async () => {
    await store().getTable(URL_KEY); // the lazy migration inserts the table doc on first read; not the write under test
    const before = snapshot();
    await assert.rejects(
      () => store().applyChanges([agentModel('openai/gpt-6.1-sol')], ctx(), {
        check: () => { throw new RoutingError('INVALID', 'refused by the test', { problems: ['x'] }); }
      }),
      (err) => err.code === 'INVALID' && err.details.problems[0] === 'x'
    );
    assert.equal(snapshot(), before);
  });

  test('applyPreset and undo take the same guard and refuse in the same way', async () => {
    await store().savePreset('keep', ctx('seed'));
    const [preset] = await store().listPresets(URL_KEY);
    await store().applyChanges([agentModel('claude-sonnet-5')], ctx('set'));
    const entry = (await store().getLog(URL_KEY))[0];
    const refuse = () => { throw new RoutingError('INVALID', 'refused by the test'); };

    const before = snapshot();
    await assert.rejects(() => store().applyPreset(preset._id, ctx('apply'), { check: refuse }), (err) => err.code === 'INVALID');
    await assert.rejects(() => store().undo(entry._id, ctx('undo'), { check: refuse }), (err) => err.code === 'INVALID');
    assert.equal(snapshot(), before);
  });

  test('on a CAS retry the expectedVersion is checked again: a version that moved under the save is CONFLICT, not an overwrite', async () => {
    const checks = [];
    const routing = fx.collections.routing;
    const realUpdate = routing.updateOne.bind(routing);
    let raced = false;
    routing.updateOne = async (query, update, options) => {
      if (!raced) {
        raced = true;
        // Another writer (a proxy write, say) lands between this save's read and its write.
        await store().changeDefault('agent-session', { model: 'anthropic/claude-haiku-5.5' }, ctx('proxy', { via: 'proxy' }));
      }
      return realUpdate(query, update, options);
    };

    await assert.rejects(
      () => store().applyChanges([agentModel('claude-opus-5')], ctx('page'), {
        expectedVersion: 0,
        check: (before, after) => checks.push(after.version)
      }),
      (err) => err.code === 'CONFLICT'
    );
    // The first attempt passed both checks and was then raced; the retry re-reads, finds the version moved and
    // stops at CONFLICT before the check judges anything again.
    assert.equal(checks.length, 1, 'the check ran once, on the first attempt, and not on the stale retry');
    assert.equal((await store().getTable(URL_KEY)).defaults['agent-session'].model, 'anthropic/claude-haiku-5.5', 'the proxy write stands');
  });
});
