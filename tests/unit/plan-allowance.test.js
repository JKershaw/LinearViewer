/**
 * LIN-3706 — the plan / allowance seam (lib/plan-allowance.js): Free's answers,
 * the off-path inputs that must fall through as they did before the move, the
 * `FREE_FOR` table driving its predicates, and a second plan joining as a row.
 *
 * Written before the seam existed (red at base: the module is absent). The
 * route-level and store-level behaviour of the fronts is pinned separately in
 * free-tier-allowance-fronts.test.js, green on both sides of the move.
 */
import { test, describe, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  FREE_FOR,
  isFreeFor,
  PLANS,
  FREE_PLAN,
  planOf,
  modelClampOf,
  readAllowanceEnv,
  allowanceOf,
  wallClock,
  dayWindow,
  hourWindow,
  remainingOf,
  hourlyDenial,
  USAGE_DENIAL_REASONS,
  promptRefusalBlock,
  secondsUntil,
  RUN_LIMIT_CODE,
  RUN_LIMIT_UNVERIFIED_CODE,
  runLimitStatus,
  isRetryableRunLimit,
  runRefusal,
  quotaAnswer
} from '../../lib/plan-allowance.js';
import { FreeTierStore } from '../../lib/free-tier-store.js';
import { createDispatchItem, RUN_LIMIT_CODE as FACTORY_RUN_LIMIT_CODE, RUN_LIMIT_UNVERIFIED_CODE as FACTORY_UNVERIFIED_CODE } from '../../lib/dispatch-factory.js';
import { mapDispatchRefusal } from '../../lib/dispatch-refusal.js';

const FACTS = { hasSessionKey: false, hasPaidEnvKey: false, hasFreeKey: false, hasTestFlag: false };

describe('LIN-3706 — Free in the plan table', () => {
  test('production ships one row, frozen, with the placeholder numbers', () => {
    assert.equal(PLANS.length, 1);
    assert.equal(Object.isFrozen(PLANS), true);
    assert.equal(Object.isFrozen(PLANS[0]), true);
    assert.equal(FREE_PLAN, PLANS[0]);
    assert.deepEqual(
      { id: FREE_PLAN.id, runsPerDay: FREE_PLAN.runsPerDay, promptsPerHour: FREE_PLAN.promptsPerHour, clampsModel: FREE_PLAN.clampsModel, promptsUnlimited: FREE_PLAN.promptsUnlimited },
      { id: 'free', runsPerDay: 10, promptsPerHour: 50, clampsModel: true, promptsUnlimited: true }
    );
  });

  test('planOf: the Free row applies to a free key with no own key, else null', () => {
    assert.equal(planOf({ ...FACTS, hasFreeKey: true }), FREE_PLAN);
    assert.equal(planOf(FACTS), null);
    assert.equal(planOf({ ...FACTS, hasFreeKey: true, hasSessionKey: true }), null);
    assert.equal(planOf({ ...FACTS, hasFreeKey: true, hasPaidEnvKey: true }), null);
    assert.equal(planOf({ ...FACTS, hasTestFlag: true }), null, 'the test flag alone is not the Free plan');
  });
});

describe('LIN-3706 — remainingOf', () => {
  test('limit minus used, floored at 0', () => {
    assert.equal(remainingOf(10, 0), 10);
    assert.equal(remainingOf(10, 9), 1);
    assert.equal(remainingOf(10, 10), 0);
    assert.equal(remainingOf(10, 11), 0);
  });
  test('null and undefined used are 0 (an unreadable count claims no allowance)', () => {
    assert.equal(remainingOf(10, null), 0);
    assert.equal(remainingOf(10, undefined), 0);
  });
  test('NaN stays NaN; a negative used adds to the remainder', () => {
    assert.ok(Number.isNaN(remainingOf(10, NaN)));
    assert.equal(remainingOf(10, -3), 13);
  });
  test('a zero or negative limit leaves 0', () => {
    assert.equal(remainingOf(0, 0), 0);
    assert.equal(remainingOf(0, 5), 0);
    assert.equal(remainingOf(-2, 0), 0);
    assert.equal(remainingOf(-2, -9), 7);
  });
});

describe('LIN-3706 — dayWindow and hourWindow', () => {
  const edges = [
    // [now, dayKey, dayResets, hourKey, hourResets]
    ['2026-10-19T23:59:59.999Z', '2026-10-19', '2026-10-20T00:00:00.000Z', '2026-10-19T23', '2026-10-20T00:00:00.000Z'],
    ['2026-10-20T00:00:00.000Z', '2026-10-20', '2026-10-21T00:00:00.000Z', '2026-10-20T00', '2026-10-20T01:00:00.000Z'],
    ['2026-10-20T00:00:00.001Z', '2026-10-20', '2026-10-21T00:00:00.000Z', '2026-10-20T00', '2026-10-20T01:00:00.000Z'],
    ['2026-10-31T23:30:00.000Z', '2026-10-31', '2026-11-01T00:00:00.000Z', '2026-10-31T23', '2026-11-01T00:00:00.000Z'],
    ['2026-12-31T23:59:59.999Z', '2026-12-31', '2027-01-01T00:00:00.000Z', '2026-12-31T23', '2027-01-01T00:00:00.000Z'],
    ['2028-02-29T10:30:00.000Z', '2028-02-29', '2028-03-01T00:00:00.000Z', '2028-02-29T10', '2028-02-29T11:00:00.000Z']
  ];
  for (const [iso, dayKey, dayResets, hourKey, hourResets] of edges) {
    test(`at ${iso}`, () => {
      const now = new Date(iso);
      const day = dayWindow(now);
      assert.equal(day.key, dayKey);
      assert.equal(day.start.toISOString(), `${dayKey}T00:00:00.000Z`);
      assert.equal(day.resetsAt, dayResets);
      const hour = hourWindow(now);
      assert.equal(hour.key, hourKey);
      assert.equal(hour.start.toISOString(), `${hourKey}:00:00.000Z`);
      assert.equal(hour.resetsAt, hourResets);
    });
  }

  test('the window never mutates the Date it was given', () => {
    const now = new Date('2026-10-20T10:30:00.000Z');
    dayWindow(now).resetsAt;
    hourWindow(now).resetsAt;
    assert.equal(now.toISOString(), '2026-10-20T10:30:00.000Z');
  });

  test('an invalid Date throws on key, as toISOString did', () => {
    assert.throws(() => dayWindow(new Date(NaN)), RangeError);
    assert.throws(() => hourWindow(new Date(NaN)), RangeError);
  });

  test('wallClock reads the global Date at call time', () => {
    const RealDate = globalThis.Date;
    try {
      globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : ['2001-02-03T04:05:06.000Z'])); } };
      assert.equal(wallClock().toISOString(), '2001-02-03T04:05:06.000Z');
    } finally {
      globalThis.Date = RealDate;
    }
  });
});

describe('LIN-3706 — readAllowanceEnv and allowanceOf', () => {
  test('readAllowanceEnv hands back the two raw strings and reads the env it is given', () => {
    assert.deepEqual(readAllowanceEnv({ FREE_TIER_RUN_LIMIT: '4', FREE_TIER_HOURLY_LIMIT: '9' }), { runLimit: '4', hourlyLimit: '9' });
    assert.deepEqual(readAllowanceEnv({}), { runLimit: undefined, hourlyLimit: undefined });
  });

  // [raw, expected]: parseInt(raw, 10) || the plan's number
  const readings = [
    ['0', 10], ['-3', -3], ['abc', 10], ['', 10], [' 7 ', 7], ['3.9', 3], ['1e2', 1], [undefined, 10], ['12', 12]
  ];
  for (const [raw, expected] of readings) {
    test(`FREE_TIER_RUN_LIMIT=${JSON.stringify(raw)} reads as ${expected}`, () => {
      assert.equal(allowanceOf(FREE_PLAN, { runLimit: raw }).runsPerDay, expected);
    });
  }
  test('the hourly limit reads the same way against 50', () => {
    for (const [raw, expected] of [['0', 50], ['-3', -3], ['abc', 50], ['', 50], [' 7 ', 7], ['3.9', 3], ['1e2', 1], [undefined, 50]]) {
      assert.equal(allowanceOf(FREE_PLAN, { hourlyLimit: raw }).promptsPerHour, expected, JSON.stringify(raw));
    }
  });
  test('no env limits at all: the plan\'s own numbers', () => {
    assert.deepEqual(allowanceOf(FREE_PLAN), { runsPerDay: 10, promptsPerHour: 50 });
    assert.deepEqual(allowanceOf(FREE_PLAN, {}), { runsPerDay: 10, promptsPerHour: 50 });
  });
});

describe('LIN-3706 — the three refusal bodies, byte for byte', () => {
  test('promptRefusalBlock: four keys in order, never runsUsed; undefined remaining drops; null throws', () => {
    const denial = { allowed: false, reason: 'Service busy, try again later', remaining: 0, limit: 50, resetsAt: '2026-10-20T11:00:00.000Z', runsUsed: 3 };
    assert.equal(JSON.stringify(promptRefusalBlock(denial)), '{"freeTier":{"used":true,"remaining":0,"limit":50,"resetsAt":"2026-10-20T11:00:00.000Z"}}');
    assert.equal(JSON.stringify(promptRefusalBlock({ ...denial, remaining: undefined })), '{"freeTier":{"used":true,"limit":50,"resetsAt":"2026-10-20T11:00:00.000Z"}}');
    assert.throws(() => promptRefusalBlock(null), TypeError);
  });

  test('hourlyDenial: the record key order and the three reasons', () => {
    assert.equal(
      JSON.stringify(hourlyDenial(USAGE_DENIAL_REASONS.busy, 50, 'R')),
      '{"allowed":false,"reason":"Service busy, try again later","remaining":0,"limit":50,"resetsAt":"R"}'
    );
    assert.deepEqual({ ...USAGE_DENIAL_REASONS }, {
      missingWorkspace: 'Missing workspace',
      busy: 'Service busy, try again later',
      unverified: 'Unable to verify usage limits, try again later'
    });
  });

  const RESETS = '2026-10-03T00:00:00.000Z';
  const NOW = Date.parse('2026-10-02T12:00:00.000Z');

  test('runRefusal 429', () => {
    const { status, body } = runRefusal({ allowed: false, reason: 'limit', runsUsed: 10, limit: 10, remaining: 0, resetsAt: RESETS }, NOW);
    assert.equal(status, 429);
    assert.equal(
      JSON.stringify(body),
      '{"error":"Daily run limit reached (10 of 10 today). Resets at midnight UTC.","code":"RUN_LIMIT_REACHED","freeTier":{"used":true,"remaining":0,"limit":10,"resetsAt":"2026-10-03T00:00:00.000Z","runsUsed":10},"retryAfter":43200}'
    );
  });

  test('runRefusal 503, with and without a gate to read', () => {
    const withGate = runRefusal({ allowed: false, reason: 'unverified', limit: 10, resetsAt: RESETS }, NOW);
    assert.equal(withGate.status, 503);
    assert.equal(
      JSON.stringify(withGate.body),
      '{"error":"Unable to verify the run limit for this account","code":"RUN_LIMIT_UNVERIFIED","freeTier":{"used":true,"remaining":0,"limit":10,"resetsAt":"2026-10-03T00:00:00.000Z","runsUsed":null},"retryAfter":43200}'
    );
    for (const gate of [null, undefined, {}, 5]) {
      const { status, body } = runRefusal(gate, NOW);
      assert.equal(status, 503, String(gate));
      assert.equal(
        JSON.stringify(body),
        '{"error":"Unable to verify the run limit for this account","code":"RUN_LIMIT_UNVERIFIED","freeTier":{"used":true,"remaining":0,"limit":null,"resetsAt":null,"runsUsed":null},"retryAfter":1}'
      );
    }
  });

  test('secondsUntil: at least 1, NaN passes through', () => {
    assert.equal(secondsUntil(RESETS, NOW), 43200);
    assert.equal(secondsUntil('2020-01-01T00:00:00.000Z', NOW), 1);
    assert.ok(Number.isNaN(secondsUntil('nope', NOW)));
  });
});

describe('LIN-3706 — the run-limit codes and status', () => {
  test('the codes are the wire strings, and the factory re-exports the same values', () => {
    assert.equal(RUN_LIMIT_CODE, 'RUN_LIMIT_REACHED');
    assert.equal(RUN_LIMIT_UNVERIFIED_CODE, 'RUN_LIMIT_UNVERIFIED');
    assert.equal(FACTORY_RUN_LIMIT_CODE, RUN_LIMIT_CODE);
    assert.equal(FACTORY_UNVERIFIED_CODE, RUN_LIMIT_UNVERIFIED_CODE);
  });

  test('runLimitStatus: 503 for the unverified code, 429 for every other code, a missing one included', () => {
    assert.equal(runLimitStatus(RUN_LIMIT_UNVERIFIED_CODE), 503);
    for (const code of [RUN_LIMIT_CODE, 'X', undefined, null, '', 'run_limit_unverified']) {
      assert.equal(runLimitStatus(code), 429, String(code));
    }
  });

  test('isRetryableRunLimit is strict equality on the unverified code', () => {
    assert.equal(isRetryableRunLimit(RUN_LIMIT_UNVERIFIED_CODE), true);
    for (const code of [RUN_LIMIT_CODE, 'X', undefined, null, '', 'run_limit_unverified', 1, true]) {
      assert.equal(isRetryableRunLimit(code), false, String(code));
    }
  });

  test('the status reaches mapDispatchRefusal: an unknown code stays 429 with its retryAfter', () => {
    const out = mapDispatchRefusal({ runLimit: { code: 'X', error: 'e', freeTier: {}, retryAfter: 7 } });
    assert.equal(out.status, 429);
    assert.equal(out.retryAfter, 7);
  });
});

describe('LIN-3706 — quotaAnswer', () => {
  const USAGE = { runsUsed: 4, limit: 10, remaining: 6, resetsAt: '2026-10-21T00:00:00.000Z' };

  test('limited:false only when the plan is absent', () => {
    assert.equal(JSON.stringify(quotaAnswer(null)), '{"limited":false,"runsUsed":null,"limit":null,"remaining":null,"resetsAt":null}');
    assert.equal(JSON.stringify(quotaAnswer(undefined, USAGE)), '{"limited":false,"runsUsed":null,"limit":null,"remaining":null,"resetsAt":null}');
  });

  test('with a plan, the usage in the five-key order', () => {
    assert.equal(JSON.stringify(quotaAnswer(FREE_PLAN, USAGE)), '{"limited":true,"runsUsed":4,"limit":10,"remaining":6,"resetsAt":"2026-10-21T00:00:00.000Z"}');
    assert.equal(JSON.stringify(quotaAnswer(FREE_PLAN, { ...USAGE, runsUsed: null, remaining: 0 })), '{"limited":true,"runsUsed":null,"limit":10,"remaining":0,"resetsAt":"2026-10-21T00:00:00.000Z"}');
  });

  test('a plan with a null or missing usage THROWS: it is never turned into limited:false', () => {
    assert.throws(() => quotaAnswer(FREE_PLAN, null), TypeError);
    assert.throws(() => quotaAnswer(FREE_PLAN, undefined), TypeError);
    assert.throws(() => quotaAnswer(FREE_PLAN), TypeError);
  });
});

describe('LIN-3706 — FREE_FOR drives its predicates', () => {
  test('the table is frozen data with a reason per row', () => {
    assert.equal(Object.isFrozen(FREE_FOR), true);
    assert.deepEqual(Object.keys(FREE_FOR), ['keyed', 'label', 'flagged', 'offered']);
    for (const row of Object.values(FREE_FOR)) {
      assert.equal(Object.isFrozen(row), true, row.id);
      assert.equal(typeof row.reason, 'string');
      assert.ok(row.reason.length > 20, `${row.id} says why`);
    }
  });

  test('today\'s answers, row by row', () => {
    const f = (over) => ({ ...FACTS, ...over });
    // keyed: no own key, a free key
    assert.equal(isFreeFor('keyed', f({ hasFreeKey: true })), true);
    assert.equal(isFreeFor('keyed', f({ hasTestFlag: true })), false);
    assert.equal(isFreeFor('keyed', f({ hasFreeKey: true, hasSessionKey: true })), false);
    assert.equal(isFreeFor('keyed', f({ hasFreeKey: true, hasPaidEnvKey: true })), false);
    // label: as keyed, or the test flag
    assert.equal(isFreeFor('label', f({ hasTestFlag: true })), true);
    assert.equal(isFreeFor('label', f({ hasFreeKey: true })), true);
    assert.equal(isFreeFor('label', f({ hasTestFlag: true, hasSessionKey: true })), false);
    // flagged: the test flag only, ignoring the free key
    assert.equal(isFreeFor('flagged', f({ hasTestFlag: true })), true);
    assert.equal(isFreeFor('flagged', f({ hasFreeKey: true })), false);
    assert.equal(isFreeFor('flagged', f({ hasTestFlag: true, hasPaidEnvKey: true })), false);
    // offered: a free key is configured, whatever else is set
    assert.equal(isFreeFor('offered', f({ hasFreeKey: true, hasSessionKey: true, hasPaidEnvKey: true })), true);
    assert.equal(isFreeFor('offered', f({ hasTestFlag: true })), false);
  });

  test('an unknown row is not Free', () => {
    assert.equal(isFreeFor('nope', { ...FACTS, hasFreeKey: true }), false);
  });

  test('flip one cell and the predicate follows (LIN-3663 option B on the label row)', () => {
    const facts = { ...FACTS, hasTestFlag: true };
    assert.equal(isFreeFor('label', facts), true);
    const optionB = { ...FREE_FOR, label: { ...FREE_FOR.label, anyOf: ['hasFreeKey'] } };
    assert.equal(isFreeFor('label', facts, optionB), false, 'the flag no longer counts for the label');
    assert.equal(isFreeFor('label', { ...FACTS, hasFreeKey: true }, optionB), true);
    assert.equal(isFreeFor('flagged', facts, optionB), true, 'the other rows are untouched');
  });

  test('flip one cell the other way (LIN-3663 option A on the keyed row), and a plan follows it', () => {
    const optionA = { ...FREE_FOR, keyed: { ...FREE_FOR.keyed, anyOf: ['hasFreeKey', 'hasTestFlag'] } };
    const facts = { ...FACTS, hasTestFlag: true };
    assert.equal(isFreeFor('keyed', facts), false);
    assert.equal(isFreeFor('keyed', facts, optionA), true);
    const plans = [{ ...FREE_PLAN, appliesTo: (f) => isFreeFor('keyed', f, optionA) }];
    assert.equal(planOf(facts, plans), plans[0]);
    assert.equal(planOf(facts), null);
  });
});

describe('LIN-3706 — a second plan joins as a row, with no production line changed', () => {
  const PLUS = Object.freeze({
    id: 'plus',
    appliesTo: (facts) => facts.hasSessionKey === false && facts.hasPaidEnvKey === false && facts.hasPlusKey === true,
    runsPerDay: 25,
    promptsPerHour: 80,
    clampsModel: false,
    promptsUnlimited: true
  });
  const TABLE = Object.freeze([PLUS, FREE_PLAN]);
  const RESETS_AT = '2026-10-21T00:00:00.000Z';

  test('planOf picks the first row that applies, and falls through to Free', () => {
    assert.equal(planOf({ ...FACTS, hasPlusKey: true }, TABLE), PLUS);
    assert.equal(planOf({ ...FACTS, hasFreeKey: true }, TABLE), FREE_PLAN);
    assert.equal(planOf(FACTS, TABLE), null);
  });

  test('the allowance follows the row, and an env override still beats it', () => {
    assert.deepEqual(allowanceOf(PLUS), { runsPerDay: 25, promptsPerHour: 80 });
    assert.deepEqual(allowanceOf(PLUS, { runLimit: '30' }), { runsPerDay: 30, promptsPerHour: 80 });
    assert.deepEqual(allowanceOf(PLUS, { runLimit: '0', hourlyLimit: 'x' }), { runsPerDay: 25, promptsPerHour: 80 });
  });

  test('the clamp follows the row; the caller supplies the value', () => {
    const resolve = (plan) => `clamp-for-${plan.id}`;
    assert.equal(modelClampOf(FREE_PLAN, resolve), 'clamp-for-free');
    assert.equal(modelClampOf(PLUS, resolve), null);
    assert.equal(modelClampOf(null, resolve), null);
  });

  afterEach(() => mock.timers.reset());

  test('remaining and both resets follow the plan\'s number through the store', async () => {
    mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-20T10:30:00.000Z') });
    const allowance = allowanceOf(PLUS);
    const collection = { findOneAndUpdate: async () => ({ count: 1 }) };
    const store = new FreeTierStore({
      collection,
      hourlyLimit: allowance.promptsPerHour,
      runLimit: allowance.runsPerDay,
      dispatchStore: { countFreshRunsSince: async () => 24 }
    });
    assert.equal(store.runLimit, 25);
    assert.equal(store.hourlyLimit, 80);
    const usage = await store.getRunUsage(['a']);
    assert.equal(usage.limit, 25);
    assert.equal(usage.remaining, 1);
    assert.equal(usage.resetsAt, '2026-10-21T00:00:00.000Z');
    const allowed = await store.tryUse('acme');
    assert.equal(allowed.limit, 80);
    assert.equal(allowed.remaining, 79);
    assert.equal(allowed.resetsAt, '2026-10-20T11:00:00.000Z');
  });

  test('the three bodies follow the plan\'s number', async () => {
    const allowance = allowanceOf(PLUS);
    // run body (429) from a store at the second plan's limit
    const atLimit = new FreeTierStore({
      collection: {},
      runLimit: allowance.runsPerDay,
      dispatchStore: { countFreshRunsSince: async () => 25 }
    });
    const gate = await atLimit.checkRun(['a']);
    const { status, body } = runRefusal(gate, Date.parse(RESETS_AT) - 5000);
    assert.equal(status, 429);
    assert.match(body.error, /\(25 of 25 today\)/);
    assert.equal(body.freeTier.limit, 25);
    assert.equal(body.freeTier.runsUsed, 25);

    // through the factory too: the thrown refusal carries the same body
    const err = await createDispatchItem({
      store: { addItem: async () => { throw new Error('must not enqueue'); } },
      urlKey: 'acme', now: Date.parse(RESETS_AT) - 5000, prompt: 'x', runGate: async () => gate,
      fields: { promptName: 'implementation', issueIdentifier: 'LIN-1' }
    }).then(() => null, (e) => e);
    assert.equal(err.status, 429);
    assert.equal(err.runLimit.freeTier.limit, 25);
    assert.equal(mapDispatchRefusal(err).status, 429);

    // prompt body from a store at the second plan's hourly number
    const busy = new FreeTierStore({
      collection: { findOneAndUpdate: async (f, u) => ({ count: u.$inc.count === 1 ? 81 : 80 }) },
      hourlyLimit: allowance.promptsPerHour
    });
    const denial = await busy.tryUse('acme');
    assert.equal(denial.allowed, false);
    assert.equal(denial.limit, 80);
    assert.equal(promptRefusalBlock(denial).freeTier.limit, 80);

    // quota answer from the plan
    assert.equal(quotaAnswer(PLUS, { runsUsed: 25, limit: 25, remaining: 0, resetsAt: RESETS_AT }).limit, 25);
    assert.equal(quotaAnswer(PLUS, { runsUsed: 25, limit: 25, remaining: 0, resetsAt: RESETS_AT }).limited, true);
  });
});
