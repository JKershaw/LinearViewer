/**
 * LIN-4253: a stage's traits are declared once, on its template. `route` says whether it is
 * offered as a next step (`null` = hand-only). `writes` says what the stage may write. Every
 * reader asks the template: the stage selector, the router's refusal, the "Another step" list,
 * dispatch-entrance (which hands `writes` down) and the dispatch preamble.
 *
 * Two kinds of check. The completeness tests fail when a template omits a trait. The pin table
 * is the one non-circular check: it names every kind's trait values, with the reason beside each
 * row that is not the default. A test that only reads a trait back from the template would pass if
 * the trait flipped; this table would not.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PROMPT_TEMPLATES, EXCLUDED_FROM_AI_RECOMMENDATION, getSelectableStages } from '../../lib/prompt-templates.js';
import { rejectExcludedKind } from '../../lib/action-kind.js';
import { WRITES, WRITES_VALUES } from '../../lib/stage-writes.js';
import { STAGE_INTENT } from '../../lib/prompts/stage-intent.js';

const DEFAULT = WRITES.WORK;
const READING = /^This is a reading pass\./;
const ROOT = new URL('../../', import.meta.url);

// Every kind, in registry order. route: 'offered' (an object) or 'hand-only' (null). writes: what the
// stage may write. Each row that is hand-only or not the default says why.
const PINNED = {
  'blocked': { route: 'offered', writes: 'work' },
  'bug': { route: 'offered', writes: 'work' },
  'plan': { route: 'offered', writes: 'work' },
  'look-into': { route: 'offered', writes: 'none', reason: 'A reading pass (STAGE_INTENT READING) that writes nothing (LIN-4251): it reports its findings in the session.' },
  'triage': { route: 'offered', writes: 'ticket-fields', reason: 'Changes this ticket\'s labels, priority, state and project and comments on it (LIN-4251); it never files tickets, rewrites the description or touches code.' },
  'breakdown': { route: 'offered', writes: 'work' },
  'research': { route: 'offered', writes: 'work' },
  'scoping': { route: 'offered', writes: 'work' },
  'design': { route: 'offered', writes: 'work' },
  'spike': { route: 'offered', writes: 'work' },
  'context': { route: 'offered', writes: 'one-comment', reason: 'A reading pass (STAGE_INTENT READING) whose only write is one comment on its ticket (LIN-4251); it is not a forecast.' },
  'plan-review': { route: 'offered', writes: 'work' },
  'implementation': { route: 'offered', writes: 'work' },
  'review': { route: 'offered', writes: 'work' },
  'close-out': { route: 'offered', writes: 'work' },
  'retrospective-audit': { route: 'offered', writes: 'work' },
  'retro': { route: 'hand-only', writes: 'none', reason: 'Hand-triggered look-back, never routed (LIN-3309); a reading pass that writes nothing unless asked (LIN-4251).' },
  'survey-task': { route: 'hand-only', writes: 'one-comment', reason: 'LIN-4248 forecast: reads, posts one comment on the surveyed ticket, changes nothing else.' },
  'survey-place': { route: 'hand-only', writes: 'one-comment', reason: 'LIN-4248 forecast of the codebase as a place: the same one-comment write as survey-task.' },
};
const KINDS = Object.keys(PINNED);
const HAND_ONLY = KINDS.filter(kind => PINNED[kind].route === 'hand-only');
const OFFERED = KINDS.filter(kind => PINNED[kind].route === 'offered');

describe('LIN-4253 — the pin table names every template, with its reason (non-circular)', () => {
  test('the table names the registry, in registry order: no kind missing, none extra', () => {
    assert.deepEqual(Object.keys(PROMPT_TEMPLATES), KINDS);
  });

  test('every hand-only or non-default row says why', () => {
    for (const kind of KINDS) {
      const row = PINNED[kind];
      if (row.route === 'hand-only' || row.writes !== DEFAULT) {
        assert.ok(row.reason && row.reason.length > 20, `${kind} needs its reason`);
      }
    }
  });

  test('each template route is the pinned one: null for hand-only, an object when offered', () => {
    for (const kind of KINDS) {
      const route = PROMPT_TEMPLATES[kind].route;
      if (PINNED[kind].route === 'hand-only') assert.equal(route, null, kind);
      else assert.equal(typeof route, 'object', kind);
    }
  });

  test('each template writes is the pinned value', () => {
    for (const kind of KINDS) assert.equal(PROMPT_TEMPLATES[kind].writes, PINNED[kind].writes, kind);
  });

  test('the pinned hand-only kinds are the three that were hand-only before LIN-4253, in the same order', () => {
    assert.deepEqual(HAND_ONLY, ['retro', 'survey-task', 'survey-place']);
  });
});

describe('LIN-4253 — the derived sets keep the order their tests pin', () => {
  test('the excluded set is the pinned hand-only kinds, in registry order', () => {
    assert.deepEqual([...EXCLUDED_FROM_AI_RECOMMENDATION], HAND_ONLY);
  });

  test('the selector offers exactly the pinned offered kinds, in registry order', () => {
    const templateKeys = getSelectableStages().map(s => s.key).filter(key => PROMPT_TEMPLATES[key]);
    assert.deepEqual(templateKeys, OFFERED);
  });
});

describe('LIN-4253 — every template declares both traits (a missing one fails here)', () => {
  for (const kind of Object.keys(PROMPT_TEMPLATES)) {
    test(`${kind}: an own route, null or an object with when and whenNot`, () => {
      const t = PROMPT_TEMPLATES[kind];
      assert.ok(Object.hasOwn(t, 'route'), `${kind} declares route`);
      if (t.route !== null) {
        assert.equal(typeof t.route.when, 'string', `${kind} route.when`);
        assert.equal(typeof t.route.whenNot, 'string', `${kind} route.whenNot`);
      }
    });

    test(`${kind}: an own writes, one of the known values`, () => {
      const t = PROMPT_TEMPLATES[kind];
      assert.ok(Object.hasOwn(t, 'writes'), `${kind} declares writes`);
      assert.ok(WRITES_VALUES.includes(t.writes), `${kind} writes "${t.writes}" is a known value`);
    });
  }
});

describe('LIN-4253 / LIN-4251 — writes and the reading pass (STAGE_INTENT), related, not folded', () => {
  // The two-way statement (LIN-4251): a stage is a reading pass exactly when its writes is `none`
  // or `one-comment`. Each direction is checked, so a stage that reads and writes as work, or that
  // writes and does not read, fails here.
  test('a stage is READING exactly when its writes is none or one-comment', () => {
    const READS_ONLY = [WRITES.NONE, WRITES.ONE_COMMENT];
    for (const kind of KINDS) {
      const reading = READING.test(STAGE_INTENT[kind][0]);
      assert.equal(reading, READS_ONLY.includes(PROMPT_TEMPLATES[kind].writes), `${kind}: READING iff writes is none or one-comment`);
    }
  });

  test('ticket-fields is not READING: triage is filing, its STAGE_INTENT says so', () => {
    assert.doesNotMatch(STAGE_INTENT.triage[0], READING);
    assert.equal(PROMPT_TEMPLATES.triage.writes, WRITES.TICKET_FIELDS);
  });
});

describe('LIN-4253 — the router refusal asks the template, not a list', () => {
  for (const kind of HAND_ONLY) {
    test(`refuses ${kind}, which is hand-only`, () => {
      assert.throws(() => rejectExcludedKind(kind), /cannot be recommended/);
    });
  }

  test('allows an offered stage', () => {
    assert.equal(rejectExcludedKind('implementation'), 'implementation');
  });

  test('allows defer: a meta kind with no template has no route, so it is not hand-only', () => {
    assert.equal(rejectExcludedKind('defer'), 'defer');
  });

  test('allows a name that derives no template', () => {
    assert.equal(rejectExcludedKind('custom'), 'custom');
    assert.equal(rejectExcludedKind('nonsense'), 'nonsense');
  });
});

describe('LIN-4253 — the readers hold no hand-kept stage list', () => {
  const READERS = ['lib/proxy-preamble.js', 'lib/action-kind.js', 'lib/prompt-templates.js', 'lib/dispatch-entrance.js'];
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, ROOT)), 'utf8');

  for (const rel of READERS) {
    test(`${rel} names no hand-only or one-comment stage as a literal`, () => {
      assert.doesNotMatch(read(rel), /['"](survey-task|survey-place|retro)['"]/, rel);
    });
  }

  test('the preamble does not import the template registry (it is handed writes, and knows no stage)', () => {
    const preamble = read('lib/proxy-preamble.js');
    assert.doesNotMatch(preamble, /from ['"]\.\/prompt-(template|template-defs)\.js['"]/);
  });
});
