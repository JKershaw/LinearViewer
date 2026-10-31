/**
 * LIN-4069 (piece A of LIN-4068): the task-facts holder's write gate, its read-only accessor, and the refresh trigger's
 * single-flight and cadence. Pure: an injected clock and an injected `fetchAndPrepareProjects`, so each rule is tested
 * at its exact boundary and the provider budget is counted, not estimated.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createTaskFactsHolder, createTaskFactsRefresh, gateRefusalOf,
  SERVE_MAX_AGE_MS, REFRESH_AFTER_MS, ATTEMPT_FLOOR_MS,
} from '../../lib/task-facts-holder.js';

const MIN = 60 * 1000;
const issue = (identifier, type = 'started', parent = null) => ({
  id: `id-${identifier}`, identifier, title: identifier, state: { name: type, type }, parent: parent ? { id: `id-${parent}` } : null,
});
/** A fetch result as `fetchAndPrepareProjects` returns it, whole by default. */
const complete = (stateIssues, over = {}) => ({ stateIssues, truncated: false, degradedSources: [], selectedTeamId: null, stateMock: false, ...over });

function clock(start = 1_000_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

/** A fetch double that records its calls and resolves to whatever `respond` returns. */
function fetchDouble(respond = () => complete([issue('A-1')])) {
  const calls = [];
  const fn = async (...args) => {
    calls.push(args);
    return respond(calls.length);
  };
  fn.calls = calls;
  return fn;
}

describe('the write gate (LIN-4068 B1)', () => {
  test('a whole set is held; every incomplete way in is refused', () => {
    assert.equal(gateRefusalOf(complete([issue('A-1')])), null);
    assert.equal(gateRefusalOf(complete([issue('A-1')], { degradedSources: [{ provider: 'linear', scope: 'x' }] })), 'degraded');
    assert.equal(gateRefusalOf(complete([issue('A-1')], { truncated: true })), 'truncated');
    assert.equal(gateRefusalOf(complete([issue('A-1')], { selectedTeamId: 'team-1' })), 'team');
    assert.equal(gateRefusalOf(complete([issue('A-1')], { stateMock: true })), 'mock');
    assert.equal(gateRefusalOf({ truncated: false }), 'no-set');
    assert.equal(gateRefusalOf(null), 'no-set');
  });

  for (const [name, fetched] of [
    ['degradedSources is non-empty', complete([issue('A-2')], { degradedSources: [{ provider: 'linear', scope: 'x' }] })],
    ['a binding is truncated', complete([issue('A-2')], { truncated: true })],
    ['a team was applied', complete([issue('A-2')], { selectedTeamId: 'team-1' })],
    ['a mock set was used', complete([issue('A-2')], { stateMock: true })],
  ]) {
    test(`writes nothing when ${name}: a cold holder stays cold`, () => {
      const c = clock();
      const holder = createTaskFactsHolder({ now: c.now });
      assert.equal(holder.write('acme', fetched).written, false);
      assert.deepEqual(holder.read('acme', { identifier: 'A-2' }), { complete: false, reason: 'cold' });
    });
  }

  test('a refused write leaves an older complete entry in place; it ages cold, never partial', () => {
    const c = clock();
    const holder = createTaskFactsHolder({ now: c.now });
    assert.equal(holder.write('acme', complete([issue('A-1')])).written, true);
    c.advance(1 * MIN);
    assert.equal(holder.write('acme', complete([issue('A-9')], { truncated: true })).written, false);
    const read = holder.read('acme', { identifier: 'A-1' });
    assert.equal(read.complete, true, 'the complete set written before still serves');
    assert.deepEqual(holder.read('acme', { identifier: 'A-9' }), { complete: false, reason: 'task-missing' }, 'the refused set is not in it');
    c.advance(SERVE_MAX_AGE_MS);
    assert.deepEqual(holder.read('acme', { identifier: 'A-1' }), { complete: false, reason: 'cold' });
  });

  test('the holder is keyed per workspace: one urlKey never serves another', () => {
    const c = clock();
    const holder = createTaskFactsHolder({ now: c.now });
    holder.write('acme', complete([issue('A-1')]));
    assert.equal(holder.read('globex', { identifier: 'A-1' }).reason, 'cold');
  });
});

describe('the read-only accessor (LIN-4068 D4, B2)', () => {
  test('a complete set under 5 minutes serves; at 5 minutes it is cold', () => {
    const c = clock();
    const holder = createTaskFactsHolder({ now: c.now });
    holder.write('acme', complete([issue('A-1'), issue('A-2', 'started', 'A-1')]));
    c.advance(SERVE_MAX_AGE_MS - 1);
    const served = holder.read('acme', { identifier: 'A-2' });
    assert.equal(served.complete, true);
    assert.equal(served.index.length, 1, 'the index is held with the set, built once');
    assert.equal(served.index[0].children[0].issue.identifier, 'A-2');
    c.advance(1);
    assert.deepEqual(holder.read('acme', { identifier: 'A-2' }), { complete: false, reason: 'cold' });
  });

  test('a complete set without the task answers task-missing, not from the task’s own loops', () => {
    const c = clock();
    const holder = createTaskFactsHolder({ now: c.now });
    holder.write('acme', complete([issue('A-1')]));
    assert.deepEqual(holder.read('acme', { identifier: 'Z-404' }), { complete: false, reason: 'task-missing' });
  });

  test('the read-only holder exposes no way to fetch', () => {
    const c = clock();
    const holder = createTaskFactsHolder({ now: c.now });
    assert.deepEqual(Object.keys(holder).sort(), ['ageOf', 'read', 'write']);
    const source = readFileSync(new URL('../../lib/task-facts-holder.js', import.meta.url), 'utf8');
    assert.ok(!/fetchWorkspaceIssues/.test(source), 'the holder never uses the active-binding, truncation-blind fetch');
  });
});

describe('the refresh trigger (LIN-4068 D4, N1, N4)', () => {
  test('on a cold holder it calls fetchAndPrepareProjects with the fixed arguments, and writes the whole set', async () => {
    const c = clock();
    const holder = createTaskFactsHolder({ now: c.now });
    const fetch = fetchDouble();
    const workspace = { urlKey: 'acme', id: 'ws-1' };
    const refresh = createTaskFactsRefresh({ holder, fetchAndPrepareProjects: fetch, now: c.now });
    const started = refresh({ urlKey: 'acme', workspace, accountId: 'acct-1' });
    assert.equal(started.started, true);
    assert.deepEqual(await started.promise, { written: true, refusal: null });
    assert.equal(fetch.calls.length, 1);
    assert.deepEqual(fetch.calls[0], [workspace, null, null, 'acme', { slim: true, accountId: 'acct-1', degradeSecondary: false }],
      'the workspace object and accountId are the request’s; no team, no mock, and no degraded secondary');
    assert.equal(holder.read('acme', { identifier: 'A-1' }).complete, true);
  });

  test('two triggers while one fetch is in flight start one fetch (single-flight)', async () => {
    const c = clock();
    const holder = createTaskFactsHolder({ now: c.now });
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const fetch = fetchDouble(() => gate.then(() => complete([issue('A-1')])));
    const refresh = createTaskFactsRefresh({ holder, fetchAndPrepareProjects: fetch, now: c.now });
    const first = refresh({ urlKey: 'acme', workspace: {}, accountId: null });
    const second = refresh({ urlKey: 'acme', workspace: {}, accountId: null });
    assert.equal(first.started, true);
    assert.equal(second.started, false);
    assert.equal(second.reason, 'in-flight');
    release();
    await first.promise;
    assert.equal(fetch.calls.length, 1);
  });

  test('a fetch that throws logs, writes nothing, and the entry stays cold', async () => {
    const c = clock();
    const holder = createTaskFactsHolder({ now: c.now });
    const logged = [];
    const refresh = createTaskFactsRefresh({
      holder, now: c.now,
      fetchAndPrepareProjects: async () => { throw new Error('linear 500'); },
      onError: (message) => logged.push(message),
    });
    const started = refresh({ urlKey: 'acme', workspace: {}, accountId: null });
    assert.deepEqual(await started.promise, { written: false, refusal: 'failed' });
    assert.equal(logged.length, 1);
    assert.deepEqual(holder.read('acme', { identifier: 'A-1' }), { complete: false, reason: 'cold' });
  });

  test('an entry under 2 minutes old starts nothing; at 2 minutes it starts', async () => {
    const c = clock();
    const holder = createTaskFactsHolder({ now: c.now });
    holder.write('acme', complete([issue('A-1')]));
    const fetch = fetchDouble();
    const refresh = createTaskFactsRefresh({ holder, fetchAndPrepareProjects: fetch, now: c.now });
    c.advance(REFRESH_AFTER_MS - 1);
    assert.deepEqual(refresh({ urlKey: 'acme', workspace: {}, accountId: null }).reason, 'fresh');
    c.advance(1);
    const started = refresh({ urlKey: 'acme', workspace: {}, accountId: null });
    assert.equal(started.started, true);
    await started.promise;
    assert.equal(fetch.calls.length, 1);
  });

  test('a failed attempt counts: a retry inside the 60 s floor starts nothing', async () => {
    const c = clock();
    const holder = createTaskFactsHolder({ now: c.now });
    let fail = true;
    const fetch = fetchDouble(() => { if (fail) throw new Error('boom'); return complete([issue('A-1')]); });
    const refresh = createTaskFactsRefresh({ holder, fetchAndPrepareProjects: fetch, now: c.now, onError: () => {} });
    await refresh({ urlKey: 'acme', workspace: {}, accountId: null }).promise;
    c.advance(ATTEMPT_FLOOR_MS - 1);
    assert.equal(refresh({ urlKey: 'acme', workspace: {}, accountId: null }).reason, 'attempt-floor');
    fail = false;
    c.advance(1);
    assert.equal(refresh({ urlKey: 'acme', workspace: {}, accountId: null }).started, true);
  });

  test('a poll every 10 s for an hour on an open page makes 30 provider reads (one per 2 minutes), not 360', async () => {
    const c = clock();
    const holder = createTaskFactsHolder({ now: c.now });
    const fetch = fetchDouble(() => complete([issue('A-1')]));
    const refresh = createTaskFactsRefresh({ holder, fetchAndPrepareProjects: fetch, now: c.now });
    for (let s = 0; s < 3600; s += 10) {
      const r = refresh({ urlKey: 'acme', workspace: {}, accountId: null });
      if (r.started) await r.promise;
      c.advance(10 * 1000);
    }
    assert.equal(fetch.calls.length, 30);
  });

  test('a task missing from a warm set follows the same 2-minute rule (task-missing budget, note 3)', async () => {
    const c = clock();
    const holder = createTaskFactsHolder({ now: c.now });
    const fetch = fetchDouble(() => complete([issue('A-1')]));
    const refresh = createTaskFactsRefresh({ holder, fetchAndPrepareProjects: fetch, now: c.now });
    await refresh({ urlKey: 'acme', workspace: {}, accountId: null }).promise;
    assert.deepEqual(holder.read('acme', { identifier: 'Z-404' }), { complete: false, reason: 'task-missing' });
    c.advance(REFRESH_AFTER_MS - MIN);
    assert.equal(refresh({ urlKey: 'acme', workspace: {}, accountId: null }).reason, 'fresh', 'not refreshed every 60 s for a task that is never in the set');
    c.advance(MIN);
    assert.equal(refresh({ urlKey: 'acme', workspace: {}, accountId: null }).started, true);
  });
});

describe('the wiring: who may write, and who may refresh (LIN-4068 D4, B2; LIN-4069 review note 1)', () => {
  const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
  /** The source of one top-level function declaration, from its header to the next top-level declaration. */
  const functionSource = (src, name) => {
    const start = src.indexOf(`\nasync function ${name}(`);
    assert.ok(start !== -1, `${name} is declared in server.js`);
    const next = src.indexOf('\n}\n', start);
    return src.slice(start, next);
  };

  test('fetchAndPrepareProjects writes nothing: its callers hand the result to the holder’s gate', () => {
    const body = functionSource(read('server.js'), 'fetchAndPrepareProjects');
    assert.ok(!/taskFacts|writeTaskFacts|refreshTaskFacts/.test(body), 'the fetch returns stateIssues and no holder write');
    assert.match(body, /const stateIssues = issues;/, 'the set is captured before the assignee filter');
  });

  test('the refresh trigger is not handed to the task-page loader, the share router, or the Sessions fold', () => {
    const server = read('server.js');
    assert.ok(!/createTaskPageLoader\(\{[^}]*refresh/is.test(server), 'the loader is not built with a refresh');
    for (const rel of ['lib/task-page-loader.js', 'routes/task-share.js', 'routes/workspace-api-run-evidence.js']) {
      assert.ok(!/refreshTaskFacts|createTaskFactsRefresh/.test(read(rel)), `${rel} cannot start a refresh`);
    }
  });
});
