/**
 * Characterization test for lib/prompts/collective-participant.js (LIN-1047).
 *
 * This is the COMPATIBILITY ANCHOR for the character-based fan-out refactor
 * (LIN-1047, S1 of LIN-820). It pins the BYTE-EXACT output of
 * buildCollectiveParticipantPrompt(...) as it stands at HEAD, so the
 * behaviour-preserving refactor in the later beats can prove the default output
 * is unchanged. The expected strings are the ACTUAL captured output of the
 * current function, stored as fixtures under
 * tests/fixtures/collective-participant/ (regenerate deliberately, never
 * casually — a diff here means the default prompt changed).
 *
 * Two cases pin the two shapes the builder can emit:
 *   1. default / no-token  → the body with NO appended Linear-access block.
 *   2. with-token          → both proxyBaseUrl + proxyToken set, so the
 *                            appended Linear-access block is covered.
 * The fixed inputs exercise every field that varies the output:
 * channel, nick, topic, yapBaseUrl (with a trailing slash, to pin the
 * slash-stripping), yapPassword, proxyBaseUrl (trailing slash) and proxyToken.
 *
 * Run with: node --test tests/unit/collective-participant-characterization.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildCollectiveParticipantPrompt,
  DEFAULT_COLLECTIVE_CHARACTER,
} from '../../lib/prompts/collective-participant.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) =>
  readFileSync(join(__dirname, '../fixtures/collective-participant', name), 'utf8');

// Fixed inputs that vary every output-affecting field. yapBaseUrl and
// proxyBaseUrl carry trailing slashes so the fixtures also pin the
// slash-stripping behaviour.
const SHARED = {
  channel: '#collective-2026-07-05',
  nick: 'harbour',
  topic: 'how far could these projects go together?',
};

describe('buildCollectiveParticipantPrompt — HEAD characterization (LIN-1047)', () => {
  test('default / no-token output is byte-for-byte the pinned snapshot', () => {
    const text = buildCollectiveParticipantPrompt({
      ...SHARED,
      yapBaseUrl: 'https://yap.example.com/',
    });
    assert.strictEqual(text, fixture('default-no-token.txt'));
  });

  test('with-token output (proxy + yap password) is byte-for-byte the pinned snapshot', () => {
    const text = buildCollectiveParticipantPrompt({
      ...SHARED,
      yapBaseUrl: 'https://yap.example.com',
      yapPassword: 's3cr3t',
      proxyBaseUrl: 'https://app.example.com/',
      proxyToken: 'tok_abc123',
    });
    assert.strictEqual(text, fixture('with-token.txt'));
  });

  // Guard-rails that make a snapshot drift legible: if a future edit changes the
  // output, these narrow the failure to WHICH shape/field moved rather than only
  // reporting a wall-of-text inequality.
  test('the no-token snapshot has NO appended Linear-access block', () => {
    const snap = fixture('default-no-token.txt');
    assert.ok(!snap.includes('Workspace API access (auto-appended)'));
  });

  test('the with-token snapshot appends the Linear-access block with the embedded token', () => {
    const snap = fixture('with-token.txt');
    assert.ok(snap.includes('Workspace API access (auto-appended)'));
    assert.ok(snap.includes('Authorization: Bearer tok_abc123'));
    assert.ok(snap.includes('https://app.example.com/api/proxy'));
  });

  test('both snapshots thread the fixed channel, nick and topic', () => {
    for (const name of ['default-no-token.txt', 'with-token.txt']) {
      const snap = fixture(name);
      assert.ok(snap.includes('#collective-2026-07-05'), `${name}: channel`);
      assert.ok(snap.includes('harbour'), `${name}: nick`);
      assert.ok(snap.includes('how far could these projects go together?'), `${name}: topic`);
    }
  });

  test('yapBaseUrl trailing slash is stripped in the pinned no-token snapshot', () => {
    const snap = fixture('default-no-token.txt');
    assert.ok(snap.includes('https://yap.example.com/llms.txt'));
    assert.ok(!snap.includes('yap.example.com//'));
  });

  test('yapPassword drives the Bearer auth note in the with-token snapshot', () => {
    const snap = fixture('with-token.txt');
    assert.ok(snap.includes('Authorization: Bearer s3cr3t'));
  });
});

// LIN-2354: the provider-identity seam on the appended access block. The pinned
// with-token.txt fixture above is captured with NO providerDisplayName (an
// unresolved call) and correctly renders the neutral form; these assert the
// three properties a residual-string count cannot express — positively that a
// resolved identity is named, negatively that an unresolved one is never
// guessed as Linear.
describe('buildCollectiveParticipantPrompt — providerDisplayName (LIN-2354)', () => {
  const WITH_TOKEN = {
    channel: '#collective-2026-07-05',
    nick: 'harbour',
    topic: 'how far could these projects go together?',
    yapBaseUrl: 'https://yap.example.com',
    proxyBaseUrl: 'https://app.example.com/',
    proxyToken: 'tok_abc123',
  };

  test('Linear byte-parity: providerDisplayName "Linear" reproduces the historical sentence', () => {
    const text = buildCollectiveParticipantPrompt({ ...WITH_TOKEN, providerDisplayName: 'Linear' });
    assert.ok(text.includes('(source-neutral; currently backed by Linear). Base:'));
  });

  test('discrimination: a non-Linear provider names itself, and no residual "Linear" survives', () => {
    const text = buildCollectiveParticipantPrompt({ ...WITH_TOKEN, providerDisplayName: 'GitHub Issues' });
    assert.ok(text.includes('(source-neutral; currently backed by GitHub Issues). Base:'));
    assert.ok(!text.includes('Linear'), 'no residual "Linear" for a GitHub-backed workspace');
  });

  test('unresolved (omitted/null): the clause is dropped, not hedged', () => {
    for (const text of [
      buildCollectiveParticipantPrompt(WITH_TOKEN),
      buildCollectiveParticipantPrompt({ ...WITH_TOKEN, providerDisplayName: null }),
    ]) {
      assert.ok(text.includes('(source-neutral). Base:'), 'drops the clause entirely, no hedge');
      assert.ok(!text.includes('currently backed by'), 'no backing-provider claim at all when unresolved');
      assert.ok(!text.includes('Linear'), 'never guesses Linear for an unresolved identity');
    }
  });
});

describe('buildCollectiveParticipantPrompt — persona seam (LIN-1047, beat 2)', () => {
  const DEFAULT_INPUT = { ...SHARED, yapBaseUrl: 'https://yap.example.com/' };

  test('passing the DEFAULT character explicitly is byte-identical to the no-token snapshot', () => {
    const text = buildCollectiveParticipantPrompt({
      ...DEFAULT_INPUT,
      character: DEFAULT_COLLECTIVE_CHARACTER,
    });
    assert.strictEqual(text, fixture('default-no-token.txt'));
  });

  test('a partial character that merges to the default is still byte-identical', () => {
    // Only role supplied; the rest fall back to the default → effective character
    // equals the default → no persona block, output unchanged.
    const text = buildCollectiveParticipantPrompt({
      ...DEFAULT_INPUT,
      character: { role: DEFAULT_COLLECTIVE_CHARACTER.role },
    });
    assert.strictEqual(text, fixture('default-no-token.txt'));
  });

  test('character: null (the default) is byte-identical to omitting it entirely', () => {
    const withNull = buildCollectiveParticipantPrompt({ ...DEFAULT_INPUT, character: null });
    const omitted = buildCollectiveParticipantPrompt(DEFAULT_INPUT);
    assert.strictEqual(withNull, omitted);
    assert.strictEqual(withNull, fixture('default-no-token.txt'));
  });

  test('the default path emits NO persona block', () => {
    const text = buildCollectiveParticipantPrompt(DEFAULT_INPUT);
    assert.ok(!text.includes('## Your character'));
  });

  test('a non-default character prepends a persona block that carries its fields', () => {
    const character = {
      role: 'Skeptic',
      lens: 'what could go wrong',
      objective: 'stress-test the plan',
      value: 'hard questions early',
      disposition: 'refute before agreeing',
    };
    const text = buildCollectiveParticipantPrompt({ ...DEFAULT_INPUT, character });
    assert.ok(text.includes('## Your character: Skeptic'));
    assert.ok(text.includes('what could go wrong'));
    assert.ok(text.includes('stress-test the plan'));
    assert.ok(text.includes('hard questions early'));
    assert.ok(text.includes('refute before agreeing'));
    // The persona block sits after the intro, before the venue (Yap) block.
    assert.ok(text.indexOf('## Your character: Skeptic') < text.indexOf('## The venue: Yap'));
  });

  test('a non-default character does not disturb the grounding/discipline body', () => {
    const character = { ...DEFAULT_COLLECTIVE_CHARACTER, role: 'Skeptic' };
    const text = buildCollectiveParticipantPrompt({ ...DEFAULT_INPUT, character });
    // The whole default body is still present verbatim as a suffix once the
    // persona block is stripped off the front.
    const snap = fixture('default-no-token.txt');
    assert.ok(text.endsWith(snap.slice(snap.indexOf('## The venue: Yap'))));
  });
});
