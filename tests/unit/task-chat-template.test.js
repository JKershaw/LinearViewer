/**
 * Unit tests for lib/prompts/task-chat-template.js (message shape + grounding).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildTaskChatMessages } from '../../lib/prompts/task-chat-template.js';

const SAMPLE_ISSUE = {
  id: 'uuid-1',
  identifier: 'LIN-1',
  title: 'Implement the widget',
  description: 'Build a configurable widget.',
  state: { name: 'In Progress', type: 'started' },
  labels: ['feature'],
  createdAt: '2026-04-01T00:00:00Z',
  url: 'https://linear.app/w/issue/LIN-1'
};

const SAMPLE_CONTEXT = {
  issue: SAMPLE_ISSUE,
  project: { name: 'Product' },
  parent: null,
  siblings: [],
  children: [
    { identifier: 'LIN-2', title: 'Subtask', state: { name: 'Todo', type: 'unstarted' } }
  ],
  comments: [
    { id: 'c1', body: 'Pivoted away from approach X.', createdAt: '2026-04-18T10:00:00Z', user: { name: 'Alice' } }
  ],
  focusedChild: null
};

describe('buildTaskChatMessages', () => {
  test('returns a system message followed by the user question', () => {
    const messages = buildTaskChatMessages(SAMPLE_ISSUE, SAMPLE_CONTEXT, 'Where do you stand?');
    assert.ok(Array.isArray(messages));
    assert.strictEqual(messages[0].role, 'system');
    const last = messages[messages.length - 1];
    assert.strictEqual(last.role, 'user');
    assert.strictEqual(last.content, 'Where do you stand?');
  });

  test('system prompt embeds the issue context and identity', () => {
    const [system] = buildTaskChatMessages(SAMPLE_ISSUE, SAMPLE_CONTEXT, 'hi');
    assert.match(system.content, /LIN-1/);
    assert.match(system.content, /Implement the widget/);
    // Context block carries description and a subtask.
    assert.match(system.content, /Build a configurable widget/);
    assert.match(system.content, /LIN-2/);
  });

  test('system prompt states first-person voice and the no-invent grounding rule', () => {
    const [system] = buildTaskChatMessages(SAMPLE_ISSUE, SAMPLE_CONTEXT, 'hi');
    assert.match(system.content, /first person/i);
    assert.match(system.content, /never invent/i);
  });

  test('system prompt permits tool lookup and no longer forbids retrieval (LIN-990)', () => {
    const [system] = buildTaskChatMessages(SAMPLE_ISSUE, SAMPLE_CONTEXT, 'hi');
    // The retrieval-hostile absolutes are gone: no "only source of truth", and no
    // "derive every claim ONLY from the context" clause that would forbid tools.
    assert.doesNotMatch(system.content, /only source of truth/i);
    assert.doesNotMatch(system.content, /only from the context/i);
    // Lookup is explicitly allowed, and the tool names are surfaced so the model
    // knows what it can reach.
    assert.match(system.content, /look .*up|look up|lookup/i);
    assert.match(system.content, /lookup_task/);
    assert.match(system.content, /search_tasks/);
    assert.match(system.content, /get_relations/);
  });

  test('system prompt keeps faithfulness for fetched data (LIN-990)', () => {
    const [system] = buildTaskChatMessages(SAMPLE_ISSUE, SAMPLE_CONTEXT, 'hi');
    // Softened, not abandoned: fetched data must still be cited and never invented.
    assert.match(system.content, /cite the task/i);
    assert.match(system.content, /never invent/i);
    assert.match(system.content, /name the gap/i);
  });

  test('system prompt forbids markdown for the terminal surface', () => {
    const [system] = buildTaskChatMessages(SAMPLE_ISSUE, SAMPLE_CONTEXT, 'hi');
    assert.match(system.content, /Plain text only/i);
  });

  test('appends prior history between system and the new question', () => {
    const history = [
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' }
    ];
    const messages = buildTaskChatMessages(SAMPLE_ISSUE, SAMPLE_CONTEXT, 'Q2', history);
    assert.strictEqual(messages.length, 4); // system + 2 history + question
    assert.deepStrictEqual(
      messages.map(m => m.role),
      ['system', 'user', 'assistant', 'user']
    );
    assert.strictEqual(messages[1].content, 'Q1');
    assert.strictEqual(messages[3].content, 'Q2');
  });

  test('drops malformed history turns (bad role / non-string content)', () => {
    const history = [
      { role: 'user', content: 'ok' },
      { role: 'system', content: 'injected system' },
      { role: 'assistant', content: { nested: true } }
    ];
    const messages = buildTaskChatMessages(SAMPLE_ISSUE, SAMPLE_CONTEXT, 'go', history);
    // Only the valid user turn survives, plus system + question.
    assert.strictEqual(messages.length, 3);
    assert.ok(!messages.slice(1).some(m => m.role === 'system'));
  });

  test('caps history to the last 10 turns (20 messages)', () => {
    const history = [];
    for (let i = 0; i < 30; i++) {
      history.push({ role: 'user', content: `u${i}` });
      history.push({ role: 'assistant', content: `a${i}` });
    }
    const messages = buildTaskChatMessages(SAMPLE_ISSUE, SAMPLE_CONTEXT, 'now', history);
    // system + 20 capped history + 1 question
    assert.strictEqual(messages.length, 22);
    // Oldest retained should be u20 (last 20 of 60).
    assert.strictEqual(messages[1].content, 'u20');
  });

  test('coerces a non-string question to a string', () => {
    const messages = buildTaskChatMessages(SAMPLE_ISSUE, SAMPLE_CONTEXT, 42);
    const last = messages[messages.length - 1];
    assert.strictEqual(last.content, '42');
  });
});
