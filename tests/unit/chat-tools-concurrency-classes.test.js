// LIN-3362: every chat tool is classified as concurrent-safe XOR serial-only, so a
// newly added tool fails here until someone decides whether it may run in a batch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_TOOL_SCHEMAS, FOLLOW_UP_TOOL_SCHEMA, REMEMBER_TOOL_SCHEMA,
  CONCURRENT_SAFE_TOOLS, SERIAL_ONLY_TOOLS
} from '../../lib/chat-tools.js';

const ALL = [...CHAT_TOOL_SCHEMAS, FOLLOW_UP_TOOL_SCHEMA, REMEMBER_TOOL_SCHEMA].map(t => t.function.name);

test('every tool is in exactly one concurrency class', () => {
  for (const name of ALL) {
    const n = Number(CONCURRENT_SAFE_TOOLS.has(name)) + Number(SERIAL_ONLY_TOOLS.has(name));
    assert.equal(n, 1, `${name} must be in exactly one of CONCURRENT_SAFE_TOOLS / SERIAL_ONLY_TOOLS`);
  }
  assert.equal(CONCURRENT_SAFE_TOOLS.size + SERIAL_ONLY_TOOLS.size, ALL.length);
});

test('the writing tools are never batched', () => {
  assert.ok(SERIAL_ONLY_TOOLS.has('send_follow_up'));
  assert.ok(SERIAL_ONLY_TOOLS.has('remember'));
  assert.ok(!CONCURRENT_SAFE_TOOLS.has('send_follow_up'));
  assert.ok(!CONCURRENT_SAFE_TOOLS.has('remember'));
});
