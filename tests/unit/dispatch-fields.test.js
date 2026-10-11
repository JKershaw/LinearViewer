/**
 * LIN-3486 (LIN-3471 A) — lib/dispatch-fields.js: the run-row fields declared
 * once. Pins the 23 always-present normalisers (`RUN_FIELDS`), the six value
 * rules (`RUN_FIELD_RULES` / `validateRunField`), `isPositiveInteger`, and the
 * one store method outside the four hops that restates two of the defaults
 * (`resolveFollowUpRoot`, which no other test references).
 *
 * The store hops themselves are pinned by the S0 key-set witnesses
 * (lin-3134-default-path-characterization, dispatch-store-issue-binding); this
 * file only reads the new module and the one store method above.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  RUN_FIELDS,
  RUN_FIELD_RULES,
  normalizeRunFields,
  validateRunField,
  isPositiveInteger,
} from '../../lib/dispatch-fields.js';
import { SUBSCRIPTION_LEVELS, DEFAULT_SUBSCRIPTION } from '../../lib/dispatch-wake.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const FIELD_NAMES = [
  'kind', 'target', 'repo', 'model', 'harness', 'terminal', 'effort',
  'presetConfig', 'presetName', 'followUpTo', 'force', 'abort', 'abortTo',
  'cascade', 'sessionId', 'periodicalId', 'maxTasks', 'stopAt', 'variant',
  'waitForFollowUps', 'queueIfBusy', 'subscription', 'consumerLastSeenAt',
];

const DEFAULTS = {
  kind: 'custom', target: 'cli', repo: null, model: null, harness: null,
  terminal: null, effort: null, presetConfig: null, presetName: null,
  followUpTo: null, force: false, abort: false, abortTo: null, cascade: false,
  sessionId: null, periodicalId: null, maxTasks: null, stopAt: null,
  variant: null, waitForFollowUps: false, queueIfBusy: false,
  subscription: 'terminal-only', consumerLastSeenAt: null,
};

describe('RUN_FIELDS', () => {
  test('declares exactly the 23 fields, in hop order, frozen', () => {
    assert.deepEqual(Object.keys(RUN_FIELDS), FIELD_NAMES);
    assert.equal(Object.isFrozen(RUN_FIELDS), true);
  });

  test('normalizeRunFields({}) yields the 23 defaults', () => {
    assert.deepEqual(normalizeRunFields({}), DEFAULTS);
    assert.deepEqual(Object.keys(normalizeRunFields({})), FIELD_NAMES);
  });

  test('null / undefined source yields the same defaults', () => {
    assert.deepEqual(normalizeRunFields(null), DEFAULTS);
    assert.deepEqual(normalizeRunFields(undefined), DEFAULTS);
  });

  test('`||` fields collapse every falsy value to the default and keep a valid one', () => {
    const orNull = [
      'repo', 'model', 'harness', 'terminal', 'effort', 'presetConfig',
      'presetName', 'followUpTo', 'abortTo', 'sessionId', 'periodicalId',
      'consumerLastSeenAt',
    ];
    for (const name of orNull) {
      for (const junk of ['', 0, false, null, undefined]) {
        assert.equal(normalizeRunFields({ [name]: junk })[name], null, `${name}=${String(junk)}`);
      }
      assert.equal(normalizeRunFields({ [name]: 'v' })[name], 'v', name);
    }
    for (const junk of ['', 0, false, null, undefined]) {
      assert.equal(normalizeRunFields({ kind: junk }).kind, 'custom');
      assert.equal(normalizeRunFields({ target: junk }).target, 'cli');
      assert.equal(normalizeRunFields({ subscription: junk }).subscription, DEFAULT_SUBSCRIPTION);
    }
    assert.equal(normalizeRunFields({ kind: 'autopilot' }).kind, 'autopilot');
    assert.equal(normalizeRunFields({ target: 'web' }).target, 'web');
    assert.equal(normalizeRunFields({ subscription: 'everything' }).subscription, 'everything');
  });

  test('`=== true` fields are true only for the boolean true', () => {
    for (const name of ['force', 'abort', 'cascade', 'waitForFollowUps', 'queueIfBusy']) {
      assert.equal(normalizeRunFields({ [name]: true })[name], true, name);
      for (const junk of ['true', 1, 'yes', {}, [], null, undefined, false, 0, '']) {
        assert.equal(normalizeRunFields({ [name]: junk })[name], false, `${name}=${JSON.stringify(junk)}`);
      }
    }
  });

  test('`??` fields keep 0, "" and false (only nullish becomes null)', () => {
    for (const name of ['maxTasks', 'stopAt', 'variant']) {
      assert.equal(normalizeRunFields({ [name]: null })[name], null, name);
      assert.equal(normalizeRunFields({ [name]: undefined })[name], null, name);
      for (const kept of [0, '', false]) {
        assert.equal(normalizeRunFields({ [name]: kept })[name], kept, `${name}=${JSON.stringify(kept)}`);
      }
    }
    assert.equal(normalizeRunFields({ maxTasks: 5 }).maxTasks, 5);
    assert.equal(normalizeRunFields({ stopAt: 'pr' }).stopAt, 'pr');
    assert.equal(normalizeRunFields({ variant: 'stepper' }).variant, 'stepper');
  });

  test('presetConfig is returned by reference (no copy)', () => {
    const presetConfig = { a: 1 };
    assert.equal(normalizeRunFields({ presetConfig }).presetConfig, presetConfig);
  });

  test('is pure: source untouched, fresh plain object each call, other keys ignored', () => {
    const src = Object.freeze({ kind: 'autopilot', force: true, prompt: 'x', _id: 'a' });
    const a = normalizeRunFields(src);
    const b = normalizeRunFields(src);
    assert.notEqual(a, b);
    assert.deepEqual(a, b);
    assert.equal(Object.getPrototypeOf(a), Object.prototype);
    assert.equal('prompt' in a, false);
    assert.equal('_id' in a, false);
    assert.deepEqual(Object.keys(src), ['kind', 'force', 'prompt', '_id']);
  });
});

describe('isPositiveInteger', () => {
  test('true for integers >= 1', () => {
    for (const v of [1, 2, Number.MAX_SAFE_INTEGER]) assert.equal(isPositiveInteger(v), true, String(v));
  });

  test('false for everything else', () => {
    for (const v of [0, -1, 2.5, NaN, Infinity, '2', null, undefined, true, [2], 2n]) {
      assert.equal(isPositiveInteger(v), false, String(typeof v === 'bigint' ? `${v}n` : v));
    }
  });
});

describe('RUN_FIELD_RULES', () => {
  test('covers exactly the seven rule fields, frozen', () => {
    assert.deepEqual(
      Object.keys(RUN_FIELD_RULES).sort(),
      ['cascade', 'force', 'maxTasks', 'queueIfBusy', 'stopAt', 'subscription', 'waitForFollowUps']
    );
    assert.equal(Object.isFrozen(RUN_FIELD_RULES), true);
    for (const rule of Object.values(RUN_FIELD_RULES)) {
      assert.equal(Object.isFrozen(rule), true);
      assert.deepEqual(Object.keys(rule).sort(), ['absent', 'message', 'valid']);
    }
  });

  test('maxTasks: absent for undefined and null; accepts integers >= 1; exact message', () => {
    const msg = 'maxTasks must be an integer >= 1';
    assert.equal(validateRunField('maxTasks', undefined), null);
    assert.equal(validateRunField('maxTasks', null), null);
    assert.equal(validateRunField('maxTasks', 1), null);
    assert.equal(validateRunField('maxTasks', 40), null);
    for (const bad of [0, -1, 2.5, NaN, '2', true, [2], {}]) {
      assert.equal(validateRunField('maxTasks', bad), msg, String(bad));
    }
  });

  test("stopAt: absent for undefined and null; only 'pr' accepted; exact message (LIN-3487)", () => {
    const msg = "stopAt must be 'pr'";
    assert.equal(validateRunField('stopAt', undefined), null);
    assert.equal(validateRunField('stopAt', null), null);
    assert.equal(validateRunField('stopAt', 'pr'), null);
    for (const bad of ['', 'PR', 'merge', 'pr ', 0, false, true, {}, ['pr']]) {
      assert.equal(validateRunField('stopAt', bad), msg, JSON.stringify(bad));
    }
  });

  for (const name of ['force', 'cascade', 'waitForFollowUps', 'queueIfBusy']) {
    test(`${name}: absent only for undefined; booleans only; exact message`, () => {
      const msg = `${name} must be a boolean`;
      assert.equal(validateRunField(name, undefined), null);
      assert.equal(validateRunField(name, true), null);
      assert.equal(validateRunField(name, false), null);
      for (const bad of [null, 0, 1, '', 'true', 'false', {}, []]) {
        assert.equal(validateRunField(name, bad), msg, JSON.stringify(bad));
      }
    });
  }

  test('subscription: absent only for undefined; declared levels only; exact message', () => {
    const msg = `subscription must be one of: ${SUBSCRIPTION_LEVELS.join(', ')}`;
    assert.equal(msg, 'subscription must be one of: everything, terminal-only');
    assert.equal(validateRunField('subscription', undefined), null);
    for (const level of SUBSCRIPTION_LEVELS) assert.equal(validateRunField('subscription', level), null);
    for (const bad of [null, '', 'all', 'EVERYTHING', 1, true]) {
      assert.equal(validateRunField('subscription', bad), msg, JSON.stringify(bad));
    }
  });
});

describe('validateRunField', () => {
  test('throws a TypeError for a name with no rule, including inherited names', () => {
    for (const name of ['kind', 'nope', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      assert.throws(() => validateRunField(name, 1), TypeError, name);
    }
  });
});

describe('DispatchQueueStore.resolveFollowUpRoot (only pin; shares the kind / sessionId defaults)', () => {
  function makeStore() {
    const historyCollection = createMockCollection();
    const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection });
    return { store, historyCollection };
  }

  test('a root row lacking kind and sessionId resolves to the defaults', async () => {
    const { store, historyCollection } = makeStore();
    await historyCollection.insertOne({ _id: 'root-1', urlKey: 'acme' });
    assert.deepEqual(await store.resolveFollowUpRoot('acme', 'root-1'), {
      id: 'root-1', kind: 'custom', sessionId: null,
    });
  });

  test('a root row carrying both returns them unchanged', async () => {
    const { store, historyCollection } = makeStore();
    await historyCollection.insertOne({ _id: 'root-2', urlKey: 'acme', kind: 'autopilot', sessionId: 'sess-9' });
    assert.deepEqual(await store.resolveFollowUpRoot('acme', 'root-2'), {
      id: 'root-2', kind: 'autopilot', sessionId: 'sess-9',
    });
  });

  test('walks followUpTo to the root, and returns null for a missing start / startId', async () => {
    const { store, historyCollection } = makeStore();
    await historyCollection.insertOne({ _id: 'r', urlKey: 'acme', kind: 'autopilot' });
    await historyCollection.insertOne({ _id: 'c', urlKey: 'acme', followUpTo: 'r' });
    assert.deepEqual(await store.resolveFollowUpRoot('acme', 'c'), { id: 'r', kind: 'autopilot', sessionId: null });
    assert.equal(await store.resolveFollowUpRoot('acme', 'missing'), null);
    assert.equal(await store.resolveFollowUpRoot('acme', ''), null);
  });
});
