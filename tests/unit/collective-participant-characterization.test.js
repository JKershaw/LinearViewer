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
import { buildCollectiveParticipantPrompt } from '../../lib/prompts/collective-participant.js';

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
