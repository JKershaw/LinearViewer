/**
 * Unit tests for the Collective FACILITATOR prompt (LIN-1049, Step 2).
 *
 * The facilitator is a DISTINCT exported builder (not an `isFacilitator` flag on
 * the participant builder). These tests pin: it composes the same shared blocks
 * + roster as the participant path; it carries the seven facilitator behaviors
 * (roster-first, objective+exit, turn discipline, forced dissent, checkpoints,
 * pause-for-John, declare-done+synthesise); and it threads objective/exitCondition
 * overrides while defaulting sanely.
 *
 * Run with: node --test tests/unit/collective-facilitator.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  buildCollectiveParticipantPrompt,
  buildCollectiveFacilitatorPrompt,
  DEFAULT_FACILITATOR_CHARACTER,
  DEFAULT_EXIT_CONDITION,
  DEFAULT_HUMAN_NICK,
} from '../../lib/prompts/collective-participant.js';

const BASE = {
  channel: '#Collective',
  nick: 'chair',
  yapBaseUrl: 'https://yap.test',
  topic: 'how far can these go together?',
};

const ROSTER = [
  { name: 'Alpha Project', nick: 'alpha', objective: 'ship the parser', value: 'parser knowledge' },
  { name: 'Chair Project', nick: 'chair', objective: 'run the room', value: 'facilitation', isFacilitator: true },
  { name: 'Bravo Project', nick: 'bravo', objective: 'harden the API', value: 'security instincts' },
];

describe('facilitator is a distinct builder', () => {
  test('is a separate export, not the participant builder', () => {
    assert.equal(typeof buildCollectiveFacilitatorPrompt, 'function');
    assert.notEqual(buildCollectiveFacilitatorPrompt, buildCollectiveParticipantPrompt);
  });

  test('its output differs from the participant prompt for the same inputs', () => {
    const facil = buildCollectiveFacilitatorPrompt({ ...BASE, roster: ROSTER });
    const part = buildCollectiveParticipantPrompt({ ...BASE, roster: ROSTER });
    assert.notEqual(facil, part);
    // The distinguishing facilitator heading is absent from the participant path.
    assert.ok(facil.includes('## You are the facilitator'));
    assert.ok(!part.includes('## You are the facilitator'));
  });
});

describe('shares the participant blocks (single source of truth)', () => {
  const text = buildCollectiveFacilitatorPrompt({ ...BASE, roster: ROSTER });

  test('opens with the same intro block', () => {
    assert.ok(text.includes("# You're representing this project in the Collective"));
    assert.ok(text.includes('## First: ground yourself in the LIVE system'));
  });

  test('includes the shared Yap venue block', () => {
    assert.ok(text.includes('## The venue: Yap'));
    assert.ok(text.includes('https://yap.test/llms.txt'));
  });

  test('includes the shared side-effect (ask-before-you-change) block', () => {
    assert.ok(text.includes('## Ask before you change anything (important)'));
  });

  test('reuses the roster block, with its own line marked (chair) and self', () => {
    assert.ok(text.includes("## Who's in the room"));
    const chairLine = text.split('\n').find((l) => l.includes('**Chair Project**'));
    assert.ok(chairLine.includes('(chair)'), 'own line is the chair');
    assert.ok(chairLine.includes('← this is you'), 'own line is self-marked by nick');
  });

  test('appends the Linear-access block when a proxy token is supplied', () => {
    const withToken = buildCollectiveFacilitatorPrompt({
      ...BASE,
      roster: ROSTER,
      proxyBaseUrl: 'https://app.test',
      proxyToken: 'tok_xyz',
    });
    assert.ok(withToken.includes('Workspace API access (auto-appended)'));
    assert.ok(withToken.includes('Authorization: Bearer tok_xyz'));
  });
});

describe('the seven facilitator behaviors are present', () => {
  const text = buildCollectiveFacilitatorPrompt({ ...BASE, roster: ROSTER });

  test('(a) opens by reading the roster aloud by nick', () => {
    assert.ok(/read the roster aloud by nick/i.test(text));
  });

  test('(b) states an objective and a concrete exit condition', () => {
    assert.ok(text.includes('## Objective & exit condition'));
    assert.ok(text.includes(`reach a shared, honest answer to: ${BASE.topic}`));
    assert.ok(/The meeting is DONE only when ALL of these hold/i.test(text));
    assert.ok(/no silent seats/i.test(text));
  });

  test('(c) enforces turn discipline (direct, do not argue)', () => {
    assert.ok(text.includes('## Run the turns'));
    assert.ok(/Direct, don't argue/i.test(text));
    assert.ok(/Independent openings first/i.test(text));
  });

  test('(d) forces a dissent on single-round convergence', () => {
    assert.ok(text.includes('## Force a dissent before you accept consensus'));
    assert.ok(/converges in a single round/i.test(text));
    assert.ok(/Assign a real dissent by nick/i.test(text));
  });

  test('(e) checkpoints the room', () => {
    assert.ok(text.includes('## Checkpoint the room'));
    assert.ok(/stall signal/i.test(text));
  });

  test('(f) pauses for John (yield-and-wait, by human nick)', () => {
    assert.ok(text.includes('## Pause for John'));
    assert.ok(text.includes(`\`${DEFAULT_HUMAN_NICK}\``));
    assert.ok(/long-poll Yap and WAIT/i.test(text));
    assert.ok(/before you declare\s+the meeting done/i.test(text));
  });

  test('(g) declares done and synthesises (anti no-natural-stopping)', () => {
    assert.ok(text.includes('## Call it, and synthesise'));
    assert.ok(/State plainly that the meeting is \*\*DONE\*\*/i.test(text));
    assert.ok(/never declare\s+victory before the exit condition is genuinely met/i.test(text));
  });

  test('names the three distinct authorities (process / content / decision)', () => {
    assert.ok(/You own\s+\*\*process\*\*/i.test(text) || /own the \*process\*/i.test(text));
    assert.ok(/own\s+\*\*content\*\*/i.test(text));
    assert.ok(/owns the \*\*decision\*\*/i.test(text));
  });
});

describe('objective / exit-condition threading and defaults', () => {
  test('defaults the objective to the topic and the exit condition to DEFAULT_EXIT_CONDITION', () => {
    const text = buildCollectiveFacilitatorPrompt({ ...BASE, roster: ROSTER });
    assert.ok(text.includes(`reach a shared, honest answer to: ${BASE.topic}`));
    assert.ok(text.includes(DEFAULT_EXIT_CONDITION));
  });

  test('threads an explicit objective override', () => {
    const text = buildCollectiveFacilitatorPrompt({
      ...BASE,
      roster: ROSTER,
      objective: 'decide whether to merge the two parsers',
    });
    assert.ok(text.includes('decide whether to merge the two parsers'));
    assert.ok(!text.includes(`reach a shared, honest answer to: ${BASE.topic}`));
  });

  test('threads an explicit exit-condition override', () => {
    const text = buildCollectiveFacilitatorPrompt({
      ...BASE,
      roster: ROSTER,
      exitCondition: 'DONE when John types the word banana',
    });
    assert.ok(text.includes('DONE when John types the word banana'));
    assert.ok(!text.includes(DEFAULT_EXIT_CONDITION));
  });

  test('the default facilitator persona surfaces in the role block', () => {
    const text = buildCollectiveFacilitatorPrompt({ ...BASE, roster: ROSTER });
    assert.ok(text.includes(DEFAULT_FACILITATOR_CHARACTER.objective));
    assert.ok(text.includes(DEFAULT_FACILITATOR_CHARACTER.value));
  });

  test('a character override merges over the default facilitator persona', () => {
    const text = buildCollectiveFacilitatorPrompt({
      ...BASE,
      roster: ROSTER,
      character: { value: 'ruthless timekeeping' },
    });
    assert.ok(text.includes('ruthless timekeeping'));
  });
});
