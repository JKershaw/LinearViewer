/**
 * LIN-4351: below the block wins.
 *
 * A breakdown child is filed with `Session fit:` and `Plan-review due: no — covered
 * by …` inside its `## As asked` block. A revised plan written below the block must
 * win, the block is read only when the text below lacks the fact, and a ticket with
 * no block reads exactly as before. Each reader in the census is checked here:
 * recommendation-facts (assembleTrailFacts, assembleNodeFacts, extractSessionFit,
 * condensePlan), file-pointer (extractPlanSection, extractPlanPaths),
 * plan-review-round-trips (gateDue) and follow-on-ratio (hasPlanMarker).
 *
 * Run with: node --test tests/unit/as-asked-readers.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sealAsAsked, splitAsAsked } from '../../lib/as-asked.js';
import {
  assembleTrailFacts,
  assembleNodeFacts,
  extractSessionFit,
  condensePlan
} from '../../lib/recommendation-facts.js';
import { extractPlanSection, extractPlanPaths } from '../../lib/file-pointer.js';
import { computeIssueRoundTrips } from '../../lib/plan-review-round-trips.js';
import { __internal as followOnRatio } from '../../lib/follow-on-ratio.js';

const ASOF = '2026-08-09T12:00:00.000Z';

/** A breakdown child's block, the way breakdown files it. */
const childBlock = (due, fit = 'fits one session') => sealAsAsked(
  `Piece A of the parent's plan.\n\n**Session fit:** ${fit}\n\n**Plan-review due:** ${due} — covered by the parent's plan-review`
);

const trailPlan = (description, comments = []) => assembleTrailFacts(comments, description, { leaf: true }).plan;

const planRows = [
  { id: 'p1', kind: 'plan', status: 'done', dispatchedAt: '2026-08-09T09:00:00.000Z', completedAt: '2026-08-09T09:30:00.000Z' }
];
const gateDue = (description) =>
  computeIssueRoundTrips({ id: 'x', identifier: 'LIN-x', description, comments: [], rows: planRows }, { asOf: ASOF }).gateDue;

const OPEN_CHILD = [{ identifier: 'LIN-2', state: { type: 'unstarted' } }];

describe('plan-review due: below the block wins', () => {
  test('assembleTrailFacts: block no, below yes reads yes', () => {
    const desc = `${childBlock('no')}\n\n## Implementation Plan (revision 2)\n\nplan-review due: yes`;
    assert.equal(trailPlan(desc).planReviewDue, 'yes');
  });

  test('assembleTrailFacts: nothing below the block reads the block\'s no', () => {
    assert.equal(trailPlan(childBlock('no')).planReviewDue, 'no');
  });

  test('assembleTrailFacts: block yes, below no reads no (the inverse)', () => {
    const desc = `${childBlock('yes')}\n\n## Implementation Plan (revision 2)\n\nplan-review due: no`;
    assert.equal(trailPlan(desc).planReviewDue, 'no');
  });

  test('assembleTrailFacts: a plan comment reads with the text below, ahead of the block', () => {
    const comment = { body: '## Implementation Plan\n\nplan-review due: yes', createdAt: '2026-11-07T10:00:00.000Z' };
    assert.equal(trailPlan(childBlock('no'), [comment]).planReviewDue, 'yes');
    assert.equal(trailPlan(childBlock('no'), [comment]).where, 'comment');
  });

  test('assembleTrailFacts: a plan comment outranks a plan heading inside the block', () => {
    const desc = sealAsAsked('My idea.\n\n## Implementation Plan\n\nplan-review due: no');
    const comment = { body: '## Implementation Plan\n\nneeds multiple sessions\n\nplan-review due: yes', createdAt: '2026-11-07T10:00:00.000Z' };
    const plan = trailPlan(desc, [comment]);
    assert.equal(plan.where, 'comment');
    assert.equal(plan.planReviewDue, 'yes');
    assert.equal(plan.sessionFit, 'needs multiple sessions');
    assert.equal(trailPlan(desc).where, 'description', 'with no plan anywhere else, the block\'s plan is the plan');
  });

  test('round-trips gateDue: block no, below yes reads yes', () => {
    assert.equal(gateDue(`${childBlock('no')}\n\nplan-review due: yes`), true);
  });

  test('round-trips gateDue: nothing below the block reads the block\'s no', () => {
    assert.equal(gateDue(childBlock('no')), false);
    assert.equal(gateDue(sealAsAsked('plan-review due: yes')), true);
  });

  test('round-trips gateDue: block yes, below no reads no (the inverse)', () => {
    assert.equal(gateDue(`${sealAsAsked('plan-review due: yes')}\n\nplan-review due: no`), false);
    assert.equal(gateDue(`${sealAsAsked('plan-review due: yes')}\n\n**plan-review due:** no`), false);
  });
});

describe('session fit: below the block wins', () => {
  const desc = `${childBlock('no', 'needs multiple sessions')}\n\n## Implementation Plan\n\nThis fits one session.`;

  test('extractSessionFit: block "needs multiple sessions", below "fits one session" reads fits', () => {
    assert.equal(extractSessionFit(desc), 'fits one session');
  });

  test('assembleTrailFacts and assembleNodeFacts read the same', () => {
    assert.equal(trailPlan(desc).sessionFit, 'fits one session');
    assert.equal(assembleNodeFacts({ description: desc, state: { type: 'started' } }, OPEN_CHILD).frontierFacts.sessionFit, 'fits one session');
  });

  test('nothing below the block reads the block', () => {
    assert.equal(extractSessionFit(childBlock('no', 'needs multiple sessions')), 'needs multiple sessions');
    assert.equal(trailPlan(childBlock('no')).sessionFit, 'fits one session');
  });
});

describe('plan section: below the block wins', () => {
  const blockPlan = sealAsAsked('Please fix it.\n\n## Implementation Plan\n\nTouch `lib/asked.js`.');

  test('a plan below the block wins over a plan heading in the block', () => {
    const desc = `${blockPlan}\n\n## Implementation Plan (revision 1)\n\nTouch \`lib/revised.js\`.`;
    assert.deepEqual(extractPlanPaths(desc), ['lib/revised.js']);
  });

  test('with no plan below, the block\'s plan is read, and it stops at the block\'s end', () => {
    const desc = `${blockPlan}\n\nNotes below mention \`lib/notes.js\`.`;
    assert.equal(extractPlanSection(desc), '\nTouch `lib/asked.js`.');
    assert.deepEqual(extractPlanPaths(desc), ['lib/asked.js']);
  });
});

describe('condensePlan never condenses inside the block', () => {
  const longPlan = (tag) => `## Implementation Plan\n\n${`${tag} lead paragraph. `.repeat(10)}\n\n${'### Step\n\n' + 'x'.repeat(4000)}`;

  test('a long plan heading inside the block is left byte for byte', () => {
    const sealed = sealAsAsked(`The ask.\n\n${longPlan('asked')}`);
    const desc = `${sealed}\n\n${longPlan('revised')}`;
    const out = condensePlan(desc);
    assert.ok(out.startsWith(sealed), 'the block must come through untouched');
    assert.match(out.slice(sealed.length), /\[Plan body condensed for routing/, 'the plan below is still condensed');
    assert.ok(splitAsAsked(out), 'the condensed description still carries its block');
  });

  test('a sealed description with nothing to condense is returned unchanged', () => {
    const desc = `${childBlock('no')}\n\nShort notes.`;
    assert.equal(condensePlan(desc), desc);
  });
});

describe('an unsealed ticket reads as today', () => {
  test('first plan-review due line wins in assembleTrailFacts', () => {
    assert.equal(trailPlan('plan-review due: no\n\n## Implementation Plan\n\nplan-review due: yes').planReviewDue, 'no');
  });

  test('round-trips reads the due line as the selector does: the first line, plain or bold, value on that line', () => {
    assert.equal(gateDue('plan-review due: no\n\nplan-review due: yes'), false, 'due-line case 2: a no line followed by a yes line now counts as not due (the first line wins)');
    assert.equal(gateDue('plan-review due: no'), false);
    assert.equal(gateDue('**plan-review due:** yes'), true, 'due-line case 1: the bold form now counts as due');
    assert.equal(gateDue('no due line at all'), false);
    assert.equal(gateDue('plan-review due:\nyes'), false, 'due-line case 3: yes on the next line no longer counts');
    assert.equal(gateDue('plan-review due: yesterday'), false, 'due-line case 4: `yesterday` no longer counts');
  });

  test('session fit keeps its priority order over the whole description', () => {
    assert.equal(extractSessionFit('fits one session, then needs multiple sessions'), 'needs multiple sessions');
  });

  test('the last plan heading wins, and runs to the next ## heading', () => {
    const desc = '## Implementation Plan\n\n`lib/a.js`\n\n## Implementation Plan (rev)\n\n`lib/b.js`\n\nmore `lib/c.js`';
    assert.deepEqual(extractPlanPaths(desc), ['lib/b.js', 'lib/c.js']);
  });

  test('a long unsealed plan is condensed', () => {
    const desc = `## Implementation Plan\n\nLead.\n\n### Step\n\n${'y'.repeat(4000)}`;
    assert.match(condensePlan(desc), /\[Plan body condensed for routing/);
  });

  test('follow-on-ratio\'s plan marker reads the description as before', () => {
    assert.equal(followOnRatio.hasPlanMarker({ description: 'Session fit: fits one session' }), true);
    assert.equal(followOnRatio.hasPlanMarker({ description: 'no marker here' }), false);
  });
});

describe('follow-on-ratio plan marker on a sealed ticket', () => {
  // A presence marker: "below wins" and "either place" give the same boolean, so
  // routing it through readFact cannot move this measure (stated in the module).
  test('a marker below or in the block counts; none in either does not', () => {
    assert.equal(followOnRatio.hasPlanMarker({ description: `${sealAsAsked('The ask.')}\n\n## Implementation Plan` }), true);
    assert.equal(followOnRatio.hasPlanMarker({ description: sealAsAsked('This fits one session.') }), true);
    assert.equal(followOnRatio.hasPlanMarker({ description: `${sealAsAsked('The ask.')}\n\nnotes` }), false);
  });
});
