/**
 * Unit tests for lib/prompts/foreman-playbook.js
 *
 * Run with: node --test tests/unit/foreman-playbook.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildForemanPlaybook, buildMiniForemanStep } from '../../lib/prompts/foreman-playbook.js';

const BASE_URL = 'https://example.com';

describe('buildForemanPlaybook (unparameterized)', () => {
  test('embeds the base URL in every curl example', () => {
    const text = buildForemanPlaybook({ baseUrl: BASE_URL });
    assert.ok(text.includes(`${BASE_URL}/api/proxy/stack`));
    assert.ok(text.includes(`${BASE_URL}/api/proxy/recap`));
    assert.ok(text.includes(`${BASE_URL}/api/proxy/recommend`));
    assert.ok(text.includes(`${BASE_URL}/api/proxy/foreman/status`));
    assert.ok(text.includes(`${BASE_URL}/api/proxy/instructions`));
  });

  test('autonomous mode instructs the agent to fetch the stack', () => {
    const text = buildForemanPlaybook({ baseUrl: BASE_URL });
    assert.ok(text.includes('### 1. Choose a task'));
    assert.ok(text.includes('Fetch the stack'));
    assert.ok(text.includes('/api/proxy/stack?limit=5'));
  });

  test('autonomous mode loops back to step 1 on completion', () => {
    const text = buildForemanPlaybook({ baseUrl: BASE_URL });
    assert.ok(text.includes('go back to step 1'));
  });

  test('autonomous mode stop conditions list "No more tasks in the stack"', () => {
    const text = buildForemanPlaybook({ baseUrl: BASE_URL });
    assert.ok(text.includes('No more tasks in the stack'));
  });

  test('starts with the autonomous-runner header', () => {
    const text = buildForemanPlaybook({ baseUrl: BASE_URL });
    assert.ok(text.startsWith('# Foreman — Autonomous Task Runner'));
  });
});

describe('buildForemanPlaybook (targeted at an issue)', () => {
  const issue = { identifier: 'LIN-42', title: 'Fix login bug' };

  test('header names the issue identifier and title', () => {
    const text = buildForemanPlaybook({ baseUrl: BASE_URL, issue });
    assert.ok(text.startsWith('# Foreman — LIN-42: Fix login bug'));
  });

  test('replaces stack-walk with single-task confirmation step', () => {
    const text = buildForemanPlaybook({ baseUrl: BASE_URL, issue });
    assert.ok(text.includes('### 1. Confirm the task'));
    assert.ok(text.includes('Your task is **LIN-42**'));
    assert.ok(!text.includes('### 1. Choose a task'));
    assert.ok(!text.includes('/api/proxy/stack?limit=5'));
  });

  test('stop conditions reflect single-task completion', () => {
    const text = buildForemanPlaybook({ baseUrl: BASE_URL, issue });
    assert.ok(text.includes('Task LIN-42 is complete'));
    assert.ok(!text.includes('No more tasks in the stack'));
  });

  test('completion branch terminates instead of looping', () => {
    const text = buildForemanPlaybook({ baseUrl: BASE_URL, issue });
    assert.ok(text.includes('STOP — task is complete'));
    assert.ok(!text.includes('post a completion status and go back to step 1'));
  });

  test('status reporting example uses the target identifier', () => {
    const text = buildForemanPlaybook({ baseUrl: BASE_URL, issue });
    assert.ok(text.includes('"taskIdentifier":"LIN-42"'));
  });

  test('handles missing title gracefully', () => {
    const text = buildForemanPlaybook({
      baseUrl: BASE_URL,
      issue: { identifier: 'LIN-99' }
    });
    assert.ok(text.startsWith('# Foreman — LIN-99'));
    assert.ok(!text.includes('LIN-99: '));
  });

  test('falls back to autonomous mode when issue has no identifier', () => {
    const text = buildForemanPlaybook({ baseUrl: BASE_URL, issue: { title: 'Orphan' } });
    assert.ok(text.includes('### 1. Choose a task'));
  });
});

describe('buildForemanPlaybook (feature.linearMcp)', () => {
  const issue = { identifier: 'LIN-42', title: 'Fix login bug' };

  test('defaults to curl for Linear writes when no features passed', () => {
    const text = buildForemanPlaybook({ baseUrl: BASE_URL, issue });
    assert.ok(text.includes('Make those writes using the proxy endpoints'));
    assert.ok(text.includes('/api/proxy/issue/{identifier}/comments'));
    assert.ok(!text.includes('mcp__linear__save_comment'));
  });

  test('defaults to curl when linearMcp is explicitly false', () => {
    const text = buildForemanPlaybook({
      baseUrl: BASE_URL,
      issue,
      features: { linearMcp: false }
    });
    assert.ok(text.includes('Make those writes using the proxy endpoints'));
    assert.ok(!text.includes('mcp__linear__save_comment'));
  });

  test('instructs MCP for Linear writes when linearMcp is true', () => {
    const text = buildForemanPlaybook({
      baseUrl: BASE_URL,
      issue,
      features: { linearMcp: true }
    });
    assert.ok(text.includes('Use the Linear MCP tools for all Linear writes'));
    assert.ok(text.includes('mcp__linear__save_comment'));
    assert.ok(text.includes('mcp__linear__save_issue'));
    assert.ok(text.includes('Make those writes using the Linear MCP tools'));
  });

  test('MCP mode still keeps orchestration calls on curl', () => {
    const text = buildForemanPlaybook({
      baseUrl: BASE_URL,
      issue,
      features: { linearMcp: true }
    });
    assert.ok(text.includes(`${BASE_URL}/api/proxy/stack`) || text.includes('/api/proxy/stack?limit=5') || text.includes('curl'));
    assert.ok(text.includes(`${BASE_URL}/api/proxy/recap`));
    assert.ok(text.includes(`${BASE_URL}/api/proxy/recommend`));
    assert.ok(text.includes(`${BASE_URL}/api/proxy/foreman/status`));
    assert.ok(text.includes('Orchestration endpoints'));
  });

  test('MCP mode omits the curl heredoc write examples', () => {
    const text = buildForemanPlaybook({
      baseUrl: BASE_URL,
      issue,
      features: { linearMcp: true }
    });
    assert.ok(!text.includes('/tmp/comment.json'));
    assert.ok(!text.includes('/api/proxy/issue/{identifier}/comments'));
  });
});

describe('buildMiniForemanStep', () => {
  const issue = { identifier: 'LIN-281', title: 'Mini-foreman prompt button' };

  test('embeds the recommend endpoint with the identifier', () => {
    const text = buildMiniForemanStep({ baseUrl: BASE_URL, issue });
    assert.ok(text.includes(`${BASE_URL}/api/proxy/recommend/LIN-281`));
  });

  test('names the issue in the header', () => {
    const text = buildMiniForemanStep({ baseUrl: BASE_URL, issue });
    assert.ok(text.startsWith('# Mini-foreman — LIN-281: Mini-foreman prompt button'));
  });

  test('handles missing title gracefully', () => {
    const text = buildMiniForemanStep({
      baseUrl: BASE_URL,
      issue: { identifier: 'LIN-99' }
    });
    assert.ok(text.startsWith('# Mini-foreman — LIN-99'));
    assert.ok(!text.includes('LIN-99: '));
  });

  test('references the prompt field from the response', () => {
    const text = buildMiniForemanStep({ baseUrl: BASE_URL, issue });
    assert.ok(text.includes('prompt'));
    assert.ok(text.includes('Extract the `prompt` field'));
  });

  test('instructs the agent to stop on proxy failure (no fallback)', () => {
    const text = buildMiniForemanStep({ baseUrl: BASE_URL, issue });
    assert.ok(/stop|Stop|STOP/.test(text));
    assert.ok(/proxy failure|non-2xx|timeout/.test(text));
  });

  test('does not include a loop or role recitation', () => {
    const text = buildMiniForemanStep({ baseUrl: BASE_URL, issue });
    assert.ok(!text.includes('go back to step 1'));
    assert.ok(!text.includes('Current role:'));
    assert.ok(!text.includes('### 4.'));
  });

  test('is short — roughly a 10-line instruction block', () => {
    const text = buildMiniForemanStep({ baseUrl: BASE_URL, issue });
    const lineCount = text.split('\n').length;
    assert.ok(lineCount <= 15, `expected ≤15 lines, got ${lineCount}`);
  });

  test('uses Authorization Bearer header', () => {
    const text = buildMiniForemanStep({ baseUrl: BASE_URL, issue });
    assert.ok(text.includes('Authorization: Bearer YOUR_TOKEN'));
  });

  test('falls back to {identifier} placeholder when issue has no identifier', () => {
    const text = buildMiniForemanStep({ baseUrl: BASE_URL, issue: {} });
    assert.ok(text.includes(`${BASE_URL}/api/proxy/recommend/{identifier}`));
  });
});
