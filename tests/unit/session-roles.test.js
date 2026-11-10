/**
 * LIN-4405: lib/session-roles.js, the one place a dispatch's role is read.
 *
 * Kind-keyed maps are tested against both DISPATCH_KINDS and ROW_ONLY_KINDS (runs-and-dispatch lesson, LIN-4376), so a
 * row-only kind such as `wake` or `leftover` cannot fall through to `work`. A plain `custom` base with no wakes is
 * neither held nor fresh (plan-review builder note 6), and a ci-wake `custom` resume does not make a lineage held.
 *
 * Run with: node --test tests/unit/session-roles.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { roleOf, lineageRoleOf, DISPATCH_ROLES } from '../../lib/session-roles.js';
import { DISPATCH_KINDS } from '../../lib/prompt-templates.js';
import { ROW_ONLY_KINDS, LEFTOVER_KIND } from '../../lib/dispatch-fields.js';
import { ORCHESTRATION_KINDS } from '../../lib/run-view.js';

describe('roleOf: every kind has a role', () => {
  test('every DISPATCH_KINDS and ROW_ONLY_KINDS kind, with and without followUpTo, reads one of the four roles', () => {
    for (const kind of [...DISPATCH_KINDS, ...ROW_ONLY_KINDS]) {
      for (const followUpTo of [null, 'base-1']) {
        const role = roleOf({ kind, followUpTo });
        assert.ok(DISPATCH_ROLES.includes(role), `${kind} (followUpTo ${followUpTo}) reads ${role}`);
      }
    }
  });

  test('the row-only kinds: wake reads wake, leftover reads resumed (with or without followUpTo)', () => {
    assert.deepEqual(ROW_ONLY_KINDS.map(kind => roleOf({ kind })), ['wake', 'resumed']);
    assert.equal(roleOf({ kind: LEFTOVER_KIND, followUpTo: 'b1' }), 'resumed');
    assert.equal(roleOf({ kind: 'wake', followUpTo: 'b1' }), 'wake', 'a wake has followUpTo and is still a wake: wake comes first');
  });

  test('orchestration is the one set from run-view.js; every other kind without followUpTo is work', () => {
    for (const kind of DISPATCH_KINDS) {
      const expected = ORCHESTRATION_KINDS.has(kind) ? 'orchestration' : 'work';
      assert.equal(roleOf({ kind }), expected, kind);
    }
    assert.equal(roleOf({ kind: 'autopilot' }), 'orchestration');
    assert.equal(roleOf({ kind: 'periodical' }), 'orchestration');
    assert.equal(roleOf({ kind: 'implementation' }), 'work');
    assert.equal(roleOf({}), 'orchestration', 'a row with no kind is read as custom');
  });

  test('a ci-wake custom row (custom + followUpTo) reads resumed, before orchestration', () => {
    assert.equal(roleOf({ kind: 'custom', followUpTo: 'b1' }), 'resumed');
    assert.equal(roleOf({ kind: 'custom' }), 'orchestration');
  });
});

describe('lineageRoleOf: held, fresh, or labelled by kind', () => {
  const wake = { kind: 'wake', followUpTo: 'a' };
  test('an orchestration base with a wake is held', () => {
    assert.equal(lineageRoleOf({ baseKind: 'autopilot', dispatches: [{ kind: 'autopilot' }, wake] }), 'held');
  });
  test('a work base is fresh, whatever follows it', () => {
    assert.equal(lineageRoleOf({ baseKind: 'implementation', dispatches: [{ kind: 'implementation' }, { kind: 'leftover', followUpTo: 'i' }] }), 'fresh');
    assert.equal(lineageRoleOf({ baseKind: 'plan', dispatches: null }), 'fresh');
  });
  test('builder note 6: a plain custom base with no wakes is neither held nor fresh', () => {
    assert.equal(lineageRoleOf({ baseKind: 'custom', dispatches: [{ kind: 'custom' }] }), null);
    assert.equal(lineageRoleOf({ baseKind: 'custom', dispatches: null }), null);
  });
  test('a lineage driven only by ci-wake custom resumes is not held', () => {
    assert.equal(lineageRoleOf({ baseKind: 'autopilot', dispatches: [{ kind: 'autopilot' }, { kind: 'custom', followUpTo: 'a' }] }), null);
  });
  test('an orchestration base without records cannot show a wake, so it reads by kind', () => {
    assert.equal(lineageRoleOf({ baseKind: 'autopilot', dispatches: null }), null);
  });
});
