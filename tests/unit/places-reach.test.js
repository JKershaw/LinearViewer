/**
 * LIN-4562 (LIN-4342 piece 1): who reaches which place. The rail shows each person the places lib/places.js admits for
 * their flags (`requestFeatureFlags`, lib/run-controls.js), in one fixed order. The ways this breaks silently: a place
 * missing for someone who needs it, one shown to someone who should not have it, or a flag that reshuffles the rest.
 *
 * Witnesses: the owner with a runner, a new user with no runner (the gate exists for them), a member, an owner whose
 * runner lapsed but who has run history (the plan review's case), and every flag on and off.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/places-reach.test.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { railFor, PLACES, DRILLED, placeFor, litPlaceFor } from '../../lib/places.js';
import { EXPERIMENTAL_VIEWS } from '../../lib/feature-defaults.js';
import { createRunControlsResolver, liveConsoleOn } from '../../lib/run-controls.js';

const keysOf = (flags) => railFor(flags).flatMap(g => g.places.map(p => p.key));
const groupsOf = (flags) => railFor(flags).map(g => g.key);

const GATED = ['live', 'runs', 'dispatch', 'connect', 'kpis', 'prompts'];

/** The flags requestFeatureFlags builds for a viewer, from the resolver itself rather than a hand-written bit. */
async function flagsFor({ owner, liveKey, stored = {} }) {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const resolve = createRunControlsResolver({
    ownerCheck: async () => ({ status: owner ? 'owner' : 'not-owner' }),
    proxyTokenStore: { listTokens: async () => (liveKey ? [{ grants: ['take', 'dispatch'], expiresAt: future, consumed: false }] : []) },
    dispatchTokenStore: { listTokens: async () => [] },
  });
  const controls = await resolve({ workspace: { id: 'w1', urlKey: 'acme' }, accountId: 'a1' });
  return { ...stored, ...controls, liveConsole: liveConsoleOn(stored.liveConsole, controls.runControls) };
}

describe('the rail for each person', () => {
  test('the owner with a runner sees every group, in order', async () => {
    const flags = await flagsFor({ owner: true, liveKey: true });
    assert.equal(flags.runControls, true);
    assert.deepEqual(groupsOf(flags), ['desk', 'watch', 'views', 'tools', 'settings']);
    assert.deepEqual(keysOf(flags), ['home', 'backlog', 'live', 'runs', 'swipe', 'swim', 'dispatch', 'connect', 'kpis', 'prompts', 'settings']);
  });

  test('a new user with no runner sees none of Live, Runs, Dispatch, Connect an agent, KPIs or Prompts', async () => {
    const flags = await flagsFor({ owner: true, liveKey: false });
    assert.equal(flags.runControls, false);
    assert.equal(flags.runSetup, true, 'this is the keyless owner the gate exists for');
    const keys = keysOf(flags);
    for (const gated of GATED) assert.ok(!keys.includes(gated), `${gated} is hidden from a new user`);
    assert.deepEqual(keys, ['home', 'backlog', 'swipe', 'swim', 'settings']);
    assert.deepEqual(groupsOf(flags), ['desk', 'views', 'settings'], 'the empty Watch and Tools groups are not drawn');
  });

  test('a member who is not the owner sees what a new user sees (the reach change the PR states)', async () => {
    const flags = await flagsFor({ owner: false, liveKey: true });
    assert.deepEqual(keysOf(flags), ['home', 'backlog', 'swipe', 'swim', 'settings']);
  });

  test('an owner whose runner lapsed, with run history, loses the gated places until a key is live again', async () => {
    // The plan review's case. Runs needs runControls (the parent plan's decision), and run history is not a way to run:
    // the owner gets the runner set-up rung instead, and their run pages still answer by URL, lit from Home (litPlaceFor).
    const flags = await flagsFor({ owner: true, liveKey: false, stored: {} });
    assert.equal(flags.runSetup, true);
    assert.ok(!keysOf(flags).includes('runs'));
    assert.equal(litPlaceFor('run', { flags }).key, 'home', 'a run page they open by link lights Home, a place they have');
    assert.equal(litPlaceFor('runs', { flags }).key, 'home');
  });

  test('a stored Live Console opt-in shows Live without run controls; a stored opt-out hides it with them', async () => {
    assert.ok(keysOf(await flagsFor({ owner: true, liveKey: false, stored: { liveConsole: true } })).includes('live'));
    assert.ok(!keysOf(await flagsFor({ owner: true, liveKey: true, stored: { liveConsole: false } })).includes('live'));
  });
});

describe('a flag adds its place in its own slot and never moves the others', () => {
  const base = { runControls: true, liveConsole: true };
  const flagged = [{ flag: 'roadmap', key: 'roadmap' }, ...EXPERIMENTAL_VIEWS.map(({ flag, path }) => ({ flag, key: path }))];

  for (const { flag, key } of flagged) {
    test(`${flag} on adds ${key} to Views and leaves every other place in order`, () => {
      const off = keysOf(base);
      const on = keysOf({ ...base, [flag]: true });
      assert.ok(!off.includes(key));
      assert.ok(on.includes(key));
      assert.deepEqual(on.filter(k => k !== key), off, 'the others keep their order');
      assert.equal(railFor({ ...base, [flag]: true }).find(g => g.places.some(p => p.key === key)).key, 'views');
    });
  }

  test('every flag on: Views is Swipe, Swim, Roadmap, then the flagged views in EXPERIMENTAL_VIEWS order', () => {
    const all = Object.fromEntries(flagged.map(({ flag }) => [flag, true]));
    const views = railFor({ ...base, ...all }).find(g => g.key === 'views').places.map(p => p.key);
    assert.deepEqual(views, ['swipe', 'swim', 'roadmap', ...EXPERIMENTAL_VIEWS.map(v => v.path)]);
  });
});

describe('the lit place', () => {
  test('a place lights itself; a drilled-in page lights its parent', () => {
    const owner = { runControls: true };
    assert.equal(litPlaceFor('connect', { flags: owner }).key, 'connect');
    assert.equal(litPlaceFor('proxy', { flags: owner }).key, 'connect', 'the old bar key is an alias');
    assert.equal(litPlaceFor('run', { flags: owner }).key, 'runs');
    assert.equal(litPlaceFor('escalation', { flags: owner }).key, 'kpis');
    assert.equal(litPlaceFor('search', { flags: owner }).key, 'home');
  });

  test('a task page lights Backlog when it came from Backlog, Home otherwise', () => {
    assert.equal(litPlaceFor('task', { from: 'backlog' }).key, 'backlog');
    assert.equal(litPlaceFor('task', { from: 'home' }).key, 'home');
    assert.equal(litPlaceFor('task', { from: 'settings' }).key, 'home', 'an unknown origin falls back to Home');
    assert.equal(litPlaceFor('task').key, 'home');
  });

  test('a gated page a person reaches by URL lights a place their rail shows', () => {
    const newUser = { runControls: false };
    for (const key of [...PLACES.map(p => p.key), ...DRILLED.map(d => d.key)]) {
      const lit = litPlaceFor(key, { flags: newUser });
      assert.ok(lit.who(newUser), `${key} lights ${lit.key}, which a new user's rail shows`);
    }
    assert.equal(litPlaceFor('connect', { flags: newUser }).key, 'settings', 'Settings › Agent access is how a new user reaches it');
  });

  test('every drilled-in parent and every reachedFrom is a place', () => {
    for (const d of DRILLED) for (const parent of [d.parent, ...(d.parents || [])]) assert.ok(PLACES.includes(placeFor(parent)), `${d.key} → ${parent}`);
    for (const p of PLACES.filter(p => p.reachedFrom)) assert.ok(placeFor(p.reachedFrom).who({}), `${p.key} → ${p.reachedFrom} is always shown`);
  });
});
