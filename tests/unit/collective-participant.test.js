/**
 * Unit tests for lib/prompts/collective-participant.js
 *
 * Run with: node --test tests/unit/collective-participant.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  buildCollectiveParticipantPrompt,
  DEFAULT_COLLECTIVE_CHANNEL,
  DEFAULT_COLLECTIVE_TOPIC,
} from '../../lib/prompts/collective-participant.js';

const BASE = {
  channel: '#Collective',
  nick: 'LinearViewer',
  yapBaseUrl: 'https://yap.test',
};

describe('buildCollectiveParticipantPrompt', () => {
  test('threads the channel and nick into the body', () => {
    const text = buildCollectiveParticipantPrompt(BASE);
    assert.ok(text.includes('#Collective'));
    assert.ok(text.includes('LinearViewer'));
  });

  test('points the participant at the Yap server and its llms.txt', () => {
    const text = buildCollectiveParticipantPrompt(BASE);
    assert.ok(text.includes('https://yap.test/llms.txt'));
    assert.ok(text.includes('https://yap.test/api/join'));
    assert.ok(text.includes('https://yap.test/api/say'));
  });

  test('encodes the discipline: verify-before-answer, name-the-gap, pause-for-John', () => {
    const text = buildCollectiveParticipantPrompt(BASE);
    assert.ok(/verify before you answer/i.test(text));
    assert.ok(/name the gap/i.test(text));
    assert.ok(/pause for john/i.test(text));
  });

  test('carries the ask-before-mutating constraint', () => {
    const text = buildCollectiveParticipantPrompt(BASE);
    assert.ok(/ask before you change anything/i.test(text));
    assert.ok(/do not file tickets/i.test(text));
  });

  test('tells the participant to read prior meeting notes', () => {
    const text = buildCollectiveParticipantPrompt(BASE);
    assert.ok(text.includes('docs/collective-session-'));
  });

  test('defaults the topic to the June topic', () => {
    const text = buildCollectiveParticipantPrompt(BASE);
    assert.ok(text.includes(DEFAULT_COLLECTIVE_TOPIC));
  });

  test('uses a custom topic when provided', () => {
    const text = buildCollectiveParticipantPrompt({ ...BASE, topic: 'should we ship to strangers?' });
    assert.ok(text.includes('should we ship to strangers?'));
  });

  test('mentions the password requirement only when a password is set', () => {
    const withPw = buildCollectiveParticipantPrompt({ ...BASE, yapPassword: 'sekret' });
    assert.ok(withPw.includes('Authorization: Bearer sekret'));
    const noPw = buildCollectiveParticipantPrompt(BASE);
    assert.ok(/needs no password/i.test(noPw));
    assert.ok(!noPw.includes('Authorization: Bearer'));
  });

  test('omits the Linear-access block when no proxy token is supplied', () => {
    const text = buildCollectiveParticipantPrompt(BASE);
    assert.ok(!text.includes('Workspace API access (auto-appended)'));
  });

  test('appends a read-first Linear-access block when a proxy token is supplied', () => {
    const text = buildCollectiveParticipantPrompt({
      ...BASE,
      proxyBaseUrl: 'https://app.test',
      proxyToken: 'tok_123',
    });
    assert.ok(text.includes('Workspace API access (auto-appended)'));
    assert.ok(text.includes('Authorization: Bearer tok_123'));
    assert.ok(text.includes('https://app.test/api/proxy'));
    // Writes must be gated behind John's go-ahead.
    assert.ok(/off-limits until John/i.test(text));
  });

  test('exports sane defaults', () => {
    assert.strictEqual(DEFAULT_COLLECTIVE_CHANNEL, '#Collective');
    assert.ok(DEFAULT_COLLECTIVE_TOPIC.length > 0);
  });
});
