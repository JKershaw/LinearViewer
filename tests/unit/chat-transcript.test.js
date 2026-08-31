/**
 * Unit tests for lib/chat-transcript.js (LIN-2430)
 *
 * Direct coverage for `filterChatTurns` — the shared predicate extracted from
 * routes/task-chat.js's sanitizeHistory and lib/saved-chat-store.js's
 * sanitizeTranscript. Both callers apply their own boundary rules on top
 * (unclamped for task-chat, durability clamps for saved-chat-store) — this
 * file only exercises the shared predicate itself.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { filterChatTurns } from '../../lib/chat-transcript.js';

describe('filterChatTurns (LIN-2430)', () => {
  test('non-array input returns an empty array', () => {
    assert.deepStrictEqual(filterChatTurns(null), []);
    assert.deepStrictEqual(filterChatTurns(undefined), []);
    assert.deepStrictEqual(filterChatTurns('not an array'), []);
    assert.deepStrictEqual(filterChatTurns({ role: 'user', content: 'hi' }), []);
  });

  test('keeps only user/assistant turns with string content', () => {
    const input = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'system', content: 'you are a helpful assistant' },
      { role: 'tool', content: 'tool result' },
      { role: 'user', content: 42 },
      { role: 'assistant', content: null },
      null,
      undefined,
      'a bare string turn',
      { content: 'no role at all' },
      { role: 'user' },
    ];
    assert.deepStrictEqual(filterChatTurns(input), [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
  });

  test('an empty array stays empty', () => {
    assert.deepStrictEqual(filterChatTurns([]), []);
  });

  test('does not clamp or truncate — no length/count bound applied', () => {
    const longContent = 'x'.repeat(200000);
    const manyTurns = Array.from({ length: 500 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: longContent,
    }));
    const result = filterChatTurns(manyTurns);
    assert.strictEqual(result.length, 500);
    assert.strictEqual(result[0].content.length, 200000);
  });

  test('preserves extra fields on a kept turn rather than reshaping it', () => {
    const input = [{ role: 'user', content: 'hi', model: 'gpt', cost: 0.01, toolCalls: [] }];
    assert.deepStrictEqual(filterChatTurns(input), [
      { role: 'user', content: 'hi', model: 'gpt', cost: 0.01, toolCalls: [] },
    ]);
  });
});
