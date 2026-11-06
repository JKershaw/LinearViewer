/**
 * LIN-4317 — the one periodical grant rule (`declaresPeriodicalGrant`, lib/dispatch-entrance.js).
 *
 * Both lanes decide the periodical "+ Autopilot" grant through this rule. The session lane passes
 * `isAutopilotVariant(prompt)`, learned from its rendered prompt text; the mint lane passes its own
 * `autopilot` flag. The rule itself carries the preconditions, so it is driven here directly over
 * kind × periodicalId × variant: the lane tests can only reach the cases a lane lets through (a session
 * refuses an unknown id before it decides the grant), and this table reaches the rest.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { declaresPeriodicalGrant } from '../../lib/dispatch-entrance.js';
import { getPeriodicals, isAutopilotVariant, withAutopilotTail, renderPeriodicalPrompt } from '../../lib/periodicals.js';

const ID = 'seams-tangles';

describe('LIN-4317 — declaresPeriodicalGrant: the grant follows the variant, under its preconditions', () => {
  test('the "+ Autopilot" variant of a valid id on kind periodical declares the grant', () => {
    assert.equal(declaresPeriodicalGrant({ kind: 'periodical', periodicalId: ID, autopilot: true }), true);
  });

  test('a plain Mint (autopilot false) of a valid id does not declare the grant', () => {
    assert.equal(declaresPeriodicalGrant({ kind: 'periodical', periodicalId: ID, autopilot: false }), false);
  });

  test('a non-boolean-true autopilot is refused, never coerced (only === true declares)', () => {
    for (const autopilot of ['true', 1, {}, undefined, null]) {
      assert.equal(declaresPeriodicalGrant({ kind: 'periodical', periodicalId: ID, autopilot }), false, `autopilot=${JSON.stringify(autopilot)}`);
    }
  });

  test('a kind other than periodical never declares it, even with a valid id and autopilot true', () => {
    for (const kind of ['autopilot', 'implementation', 'kickoff', undefined]) {
      assert.equal(declaresPeriodicalGrant({ kind, periodicalId: ID, autopilot: true }), false, `kind=${kind}`);
    }
  });

  test('an absent periodicalId is refused (the precondition holds on its own)', () => {
    assert.equal(declaresPeriodicalGrant({ kind: 'periodical', periodicalId: undefined, autopilot: true }), false);
  });

  test('an unknown id, or a non-string id, is refused even when the variant is "+ Autopilot"', () => {
    for (const periodicalId of ['no-such-periodical', '', null, 42, {}, ['seams-tangles']]) {
      assert.equal(declaresPeriodicalGrant({ kind: 'periodical', periodicalId, autopilot: true }), false, `periodicalId=${JSON.stringify(periodicalId)}`);
    }
  });

  test('every registry id declares for "+ Autopilot" and not for a plain Mint', () => {
    for (const template of getPeriodicals()) {
      assert.equal(declaresPeriodicalGrant({ kind: 'periodical', periodicalId: template.id, autopilot: true }), true, template.id);
      assert.equal(declaresPeriodicalGrant({ kind: 'periodical', periodicalId: template.id, autopilot: false }), false, template.id);
    }
  });
});

describe('LIN-4317 — isAutopilotVariant: the session lane\'s input, read from prompt text (includes, as before)', () => {
  test('a plain prompt is not the variant; the variant of any id is', () => {
    assert.equal(isAutopilotVariant(renderPeriodicalPrompt(ID)), false);
    assert.equal(isAutopilotVariant(renderPeriodicalPrompt(ID, { autopilot: true })), true);
    assert.equal(isAutopilotVariant(withAutopilotTail('x')), true);
  });

  test('a non-string prompt is not the variant', () => {
    for (const prompt of [undefined, null, 7, {}]) {
      assert.equal(isAutopilotVariant(prompt), false, JSON.stringify(prompt));
    }
  });

  test('the tail anywhere in the text counts (`includes`, today\'s behaviour, deliberately not tightened)', () => {
    assert.equal(isAutopilotVariant(`prefix\n\n${withAutopilotTail('body')}\n\nsuffix`), true);
  });
});
