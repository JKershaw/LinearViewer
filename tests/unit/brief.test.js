/**
 * Unit tests for lib/brief.js (prompt shape + response cleaner).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildBriefMessages, cleanBriefResponse } from '../../lib/brief.js';

const SAMPLE_ISSUE = {
  id: 'uuid-1',
  identifier: 'LIN-1',
  title: 'Sample task',
  description: 'Implement the thing.',
  state: { name: 'In Progress', type: 'started' },
  labels: ['preparing'],
  url: 'https://linear.app/w/issue/LIN-1'
};

const SAMPLE_CONTEXT = {
  issue: SAMPLE_ISSUE,
  project: { name: 'Product' },
  parent: null,
  siblings: [],
  children: [],
  comments: [
    { id: 'c1', body: 'Started research.', createdAt: '2026-04-18T10:00:00Z', user: { name: 'Alice' } }
  ],
  focusedChild: null
};

describe('buildBriefMessages', () => {
  test('returns system + user messages', () => {
    const msgs = buildBriefMessages(SAMPLE_ISSUE, SAMPLE_CONTEXT);
    assert.strictEqual(msgs.length, 2);
    assert.strictEqual(msgs[0].role, 'system');
    assert.strictEqual(msgs[1].role, 'user');
  });

  test('system prompt instructs Markdown with the four fixed sections', () => {
    const msgs = buildBriefMessages(SAMPLE_ISSUE, SAMPLE_CONTEXT);
    assert.match(msgs[0].content, /Markdown/);
    assert.match(msgs[0].content, /## Current/);
    assert.match(msgs[0].content, /## Constraints/);
    assert.match(msgs[0].content, /## Open questions/);
    assert.match(msgs[0].content, /## Changelog/);
  });

  test('user content includes issue details', () => {
    const msgs = buildBriefMessages(SAMPLE_ISSUE, SAMPLE_CONTEXT);
    assert.match(msgs[1].content, /LIN-1/);
    assert.match(msgs[1].content, /Sample task/);
  });
});

describe('cleanBriefResponse', () => {
  test('returns well-formed Markdown unchanged', () => {
    const raw = '## Current\nThe live spec.\n\n## Constraints\n- _None._\n\n## Open questions\n- _None._\n\n## Changelog\n- _None._';
    assert.strictEqual(cleanBriefResponse(raw), raw);
  });

  test('strips an outer markdown code fence', () => {
    const raw = '```markdown\n## Current\nSpec.\n## Changelog\n- _None._\n```';
    const out = cleanBriefResponse(raw);
    assert.ok(out.startsWith('## Current'));
    assert.ok(!out.includes('```'));
  });

  test('drops preamble before the first heading', () => {
    const raw = 'Here is the brief:\n\n## Current\nSpec.';
    const out = cleanBriefResponse(raw);
    assert.ok(out.startsWith('## Current'));
  });

  test('returns empty string on null/undefined/empty input', () => {
    assert.strictEqual(cleanBriefResponse(null), '');
    assert.strictEqual(cleanBriefResponse(undefined), '');
    assert.strictEqual(cleanBriefResponse(''), '');
  });

  test('returns empty string on non-string input', () => {
    assert.strictEqual(cleanBriefResponse(42), '');
    assert.strictEqual(cleanBriefResponse({}), '');
  });

  test('trims surrounding whitespace', () => {
    const out = cleanBriefResponse('\n\n## Current\nSpec.\n\n');
    assert.strictEqual(out, '## Current\nSpec.');
  });
});
