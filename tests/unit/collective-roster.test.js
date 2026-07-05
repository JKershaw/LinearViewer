/**
 * Unit tests for the Collective roster pre-brief (LIN-1049, Step 1).
 *
 * Covers the "## Who's in the room" block added to buildCollectiveParticipantPrompt:
 * the ≥2-participant emission rule (byte-identity guard), render order, the derived
 * self-marker, the `(chair)` tag, the objective/value fallback, `-` bullets, and
 * the co-located anti-redundancy + "not a ranking" prose.
 *
 * Run with: node --test tests/unit/collective-roster.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  buildCollectiveParticipantPrompt,
  DEFAULT_COLLECTIVE_CHARACTER,
} from '../../lib/prompts/collective-participant.js';

const BASE = {
  channel: '#Collective',
  nick: 'alpha',
  yapBaseUrl: 'https://yap.test',
};

const ROSTER = [
  { name: 'Alpha Project', nick: 'alpha', objective: 'ship the parser', value: 'deep parser knowledge' },
  { name: 'Bravo Project', nick: 'bravo', objective: 'harden the API', value: 'security instincts' },
  { name: 'Charlie Project', nick: 'charlie', objective: 'grow adoption', value: 'a user lens' },
];

describe('roster emission rule (byte-identity guard)', () => {
  test('no roster param → no roster block, output byte-identical to a bare build', () => {
    const withNull = buildCollectiveParticipantPrompt({ ...BASE, roster: null });
    const omitted = buildCollectiveParticipantPrompt(BASE);
    assert.strictEqual(withNull, omitted);
    assert.ok(!withNull.includes("## Who's in the room"));
  });

  test('a solo roster (1 entry) emits NO roster block and is byte-identical to a bare build', () => {
    const solo = buildCollectiveParticipantPrompt({ ...BASE, roster: [ROSTER[0]] });
    const omitted = buildCollectiveParticipantPrompt(BASE);
    assert.strictEqual(solo, omitted);
    assert.ok(!solo.includes("## Who's in the room"));
  });

  test('an empty roster array emits NO roster block', () => {
    const text = buildCollectiveParticipantPrompt({ ...BASE, roster: [] });
    assert.ok(!text.includes("## Who's in the room"));
  });

  test('≥2 participants → the roster block is emitted', () => {
    const text = buildCollectiveParticipantPrompt({ ...BASE, roster: ROSTER });
    assert.ok(text.includes("## Who's in the room"));
    assert.ok(text.includes('You are one of 3 people in this discussion.'));
  });
});

describe('roster block formatting', () => {
  test('renders one `-` bullet per participant in the supplied array order', () => {
    const text = buildCollectiveParticipantPrompt({ ...BASE, roster: ROSTER });
    const iAlpha = text.indexOf('**Alpha Project**');
    const iBravo = text.indexOf('**Bravo Project**');
    const iCharlie = text.indexOf('**Charlie Project**');
    assert.ok(iAlpha > 0 && iBravo > iAlpha && iCharlie > iBravo, 'order must follow the array');
    // Bullets are `-`, never numbered (anchoring guard).
    assert.ok(text.includes('- **Alpha Project**'));
    assert.ok(!/^\s*1\.\s+\*\*Alpha Project\*\*/m.test(text), 'no numbered list');
  });

  test('each line shows nick, objective (Wants) and value (Brings)', () => {
    const text = buildCollectiveParticipantPrompt({ ...BASE, roster: ROSTER });
    assert.ok(text.includes('posts as `bravo`. Wants: harden the API. Brings: security instincts.'));
  });

  test('does NOT surface role or lens', () => {
    const roster = ROSTER.map((e) => ({ ...e, role: 'SECRET_ROLE', lens: 'SECRET_LENS' }));
    const text = buildCollectiveParticipantPrompt({ ...BASE, roster });
    assert.ok(!text.includes('SECRET_ROLE'));
    assert.ok(!text.includes('SECRET_LENS'));
  });

  test('marks the self line (matched by nick) with "← this is you" and only that line', () => {
    const text = buildCollectiveParticipantPrompt({ ...BASE, nick: 'bravo', roster: ROSTER });
    const selfMarks = text.match(/← this is you/g) || [];
    assert.equal(selfMarks.length, 1, 'exactly one self marker');
    // The marker is on the bravo line.
    const bravoLine = text.split('\n').find((l) => l.includes('**Bravo Project**'));
    assert.ok(bravoLine.includes('← this is you'));
    const alphaLine = text.split('\n').find((l) => l.includes('**Alpha Project**'));
    assert.ok(!alphaLine.includes('← this is you'));
  });

  test('a nick with no matching roster entry produces no self marker', () => {
    const text = buildCollectiveParticipantPrompt({ ...BASE, nick: 'nobody', roster: ROSTER });
    assert.ok(!text.includes('← this is you'));
  });

  test('marks the facilitator entry with "(chair)"', () => {
    const roster = [ROSTER[0], { ...ROSTER[1], isFacilitator: true }, ROSTER[2]];
    const text = buildCollectiveParticipantPrompt({ ...BASE, roster });
    const bravoLine = text.split('\n').find((l) => l.includes('**Bravo Project**'));
    assert.ok(bravoLine.includes('(chair)'));
    const alphaLine = text.split('\n').find((l) => l.includes('**Alpha Project**'));
    assert.ok(!alphaLine.includes('(chair)'));
  });

  test('empty objective/value fall back to the default character (no "Wants: ." lines)', () => {
    const roster = [
      { name: 'Alpha Project', nick: 'alpha', objective: '', value: '   ' },
      { name: 'Bravo Project', nick: 'bravo' },
    ];
    const text = buildCollectiveParticipantPrompt({ ...BASE, roster });
    assert.ok(!text.includes('Wants: .'));
    assert.ok(!text.includes('Brings: .'));
    assert.ok(text.includes(`Wants: ${DEFAULT_COLLECTIVE_CHARACTER.objective}.`));
    assert.ok(text.includes(`Brings: ${DEFAULT_COLLECTIVE_CHARACTER.value}.`));
  });
});

describe('roster anti-redundancy + anchoring prose (load-bearing, co-located)', () => {
  test('carries the stay-in-your-lane / defer-or-build directive inside the block', () => {
    const text = buildCollectiveParticipantPrompt({ ...BASE, roster: ROSTER });
    assert.ok(/Speak from your\s+OWN lane/i.test(text));
    assert.ok(/don't re-derive it/i.test(text));
    assert.ok(/coverage from\s+distinct angles, not everyone answering everything/i.test(text));
  });

  test('explicitly says it is a list, not a ranking', () => {
    const text = buildCollectiveParticipantPrompt({ ...BASE, roster: ROSTER });
    assert.ok(/This is a list, not a ranking/i.test(text));
    assert.ok(/being listed first grants no authority/i.test(text));
  });

  test('the roster block sits after the venue-less intro and before the Yap venue block', () => {
    const text = buildCollectiveParticipantPrompt({ ...BASE, roster: ROSTER });
    assert.ok(text.indexOf("## Who's in the room") < text.indexOf('## The venue: Yap'));
  });

  test('with a persona, the roster block sits AFTER the persona block', () => {
    const character = { ...DEFAULT_COLLECTIVE_CHARACTER, role: 'Skeptic' };
    const text = buildCollectiveParticipantPrompt({ ...BASE, roster: ROSTER, character });
    assert.ok(text.indexOf('## Your character: Skeptic') < text.indexOf("## Who's in the room"));
    assert.ok(text.indexOf("## Who's in the room") < text.indexOf('## The venue: Yap'));
  });
});
