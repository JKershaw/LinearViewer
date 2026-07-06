/**
 * Unit tests for lib/collective-preset-defs.js (LIN-1050, S4)
 *
 * Run with: node --test tests/unit/collective-preset-defs.test.js
 *
 * Exercises the 6 built-in preset invariants (seat cap, single facilitator,
 * repo-agnostic shape) and the shared validatePreset/validatePresetRoster
 * guards custom presets will reuse (LIN-1050 plan beat 2/3).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  BUILTIN_PRESETS,
  MAX_PRESET_SEATS,
  validatePreset,
  validatePresetRoster,
} from '../../lib/collective-preset-defs.js';

const REQUIRED_MEETING_FIELDS = ['name', 'objective', 'exitCondition', 'defaultTopic'];
const CHARACTER_FIELDS = ['role', 'lens', 'objective', 'value', 'disposition'];

function validRoster() {
  return [
    { name: 'A', role: 'r', lens: 'l', objective: 'o', value: 'v', disposition: 'd', isFacilitator: true },
    { name: 'B', role: 'r', lens: 'l', objective: 'o', value: 'v', disposition: 'd' },
  ];
}

describe('BUILTIN_PRESETS (LIN-1050)', () => {
  test('there are exactly 6 seed presets', () => {
    assert.strictEqual(BUILTIN_PRESETS.length, 6);
  });

  test('every preset has a builtin: id and kind builtin', () => {
    for (const p of BUILTIN_PRESETS) {
      assert.ok(p.id.startsWith('builtin:'), `${p.name} id is builtin:*`);
      assert.strictEqual(p.kind, 'builtin');
    }
  });

  test('every preset carries non-empty meeting fields', () => {
    for (const p of BUILTIN_PRESETS) {
      for (const f of REQUIRED_MEETING_FIELDS) {
        assert.strictEqual(typeof p[f], 'string', `${p.name}.${f} is a string`);
        assert.ok(p[f].trim().length > 0, `${p.name}.${f} is non-empty`);
      }
    }
  });

  test('every preset roster has 1..MAX_PRESET_SEATS seats', () => {
    for (const p of BUILTIN_PRESETS) {
      assert.ok(p.roster.length >= 1 && p.roster.length <= MAX_PRESET_SEATS, `${p.name} roster within cap`);
    }
  });

  test('every preset has exactly one facilitator seat', () => {
    for (const p of BUILTIN_PRESETS) {
      const facilitators = p.roster.filter(s => s.isFacilitator === true);
      assert.strictEqual(facilitators.length, 1, `${p.name} has exactly one facilitator`);
    }
  });

  test('every seat is repo-agnostic (no workspaceUrlKey) and fully specified', () => {
    for (const p of BUILTIN_PRESETS) {
      for (const seat of p.roster) {
        assert.strictEqual(seat.workspaceUrlKey, undefined, `${p.name} seat has no workspaceUrlKey`);
        for (const f of CHARACTER_FIELDS) {
          assert.ok(typeof seat[f] === 'string' && seat[f].trim(), `${p.name} seat.${f} non-empty`);
        }
        assert.ok(typeof seat.name === 'string' && seat.name.trim(), `${p.name} seat.name non-empty`);
      }
    }
  });

  test('the 6 seeds match the named plan: Standup, Design crit, Architecture review, Pre-mortem, Synergy, Retro', () => {
    const names = BUILTIN_PRESETS.map(p => p.name).sort();
    assert.deepStrictEqual(names, [
      'Architecture review',
      'Design crit',
      'Pre-mortem',
      'Retro',
      'Standup',
      'Synergy',
    ]);
  });

  test('presets and their rosters are frozen (built-ins are non-editable constants)', () => {
    for (const p of BUILTIN_PRESETS) {
      assert.ok(Object.isFrozen(p), `${p.name} is frozen`);
      assert.ok(Object.isFrozen(p.roster), `${p.name}.roster is frozen`);
      for (const seat of p.roster) {
        assert.ok(Object.isFrozen(seat), `${p.name} seat is frozen`);
      }
    }
  });
});

describe('validatePresetRoster (LIN-1050)', () => {
  test('accepts a valid 2-seat roster with one facilitator', () => {
    assert.doesNotThrow(() => validatePresetRoster(validRoster()));
  });

  test('rejects an empty roster', () => {
    assert.throws(() => validatePresetRoster([]), /between 1 and/);
  });

  test('rejects a roster over MAX_PRESET_SEATS', () => {
    const roster = Array.from({ length: MAX_PRESET_SEATS + 1 }, (_, i) => ({
      name: `n${i}`, role: 'r', lens: 'l', objective: 'o', value: 'v', disposition: 'd',
      isFacilitator: i === 0,
    }));
    assert.throws(() => validatePresetRoster(roster), /between 1 and/);
  });

  test('rejects zero facilitators', () => {
    const roster = validRoster().map(s => ({ ...s, isFacilitator: false }));
    assert.throws(() => validatePresetRoster(roster), /exactly one facilitator/);
  });

  test('rejects more than one facilitator', () => {
    const roster = validRoster().map(s => ({ ...s, isFacilitator: true }));
    assert.throws(() => validatePresetRoster(roster), /exactly one facilitator/);
  });

  test('rejects a seat carrying a workspaceUrlKey (must be repo-agnostic)', () => {
    const roster = validRoster();
    roster[0] = { ...roster[0], workspaceUrlKey: 'some-repo' };
    assert.throws(() => validatePresetRoster(roster), /repo-agnostic/);
  });

  test('rejects a seat missing a persona field', () => {
    const roster = validRoster();
    delete roster[1].disposition;
    assert.throws(() => validatePresetRoster(roster), /disposition/);
  });
});

describe('validatePreset (LIN-1050)', () => {
  function validData() {
    return {
      name: 'My meeting',
      objective: 'obj',
      exitCondition: 'exit',
      defaultTopic: 'topic',
      roster: validRoster(),
    };
  }

  test('accepts a fully-specified preset', () => {
    assert.doesNotThrow(() => validatePreset(validData()));
  });

  for (const f of REQUIRED_MEETING_FIELDS) {
    test(`rejects a missing "${f}"`, () => {
      const data = validData();
      delete data[f];
      assert.throws(() => validatePreset(data), new RegExp(f));
    });
  }

  test('rejects an invalid roster (propagates the roster error)', () => {
    const data = validData();
    data.roster = [];
    assert.throws(() => validatePreset(data), /between 1 and/);
  });
});
