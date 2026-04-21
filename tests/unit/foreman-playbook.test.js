/**
 * Unit tests for lib/prompts/foreman-playbook.js
 *
 * Run with: node --test tests/unit/foreman-playbook.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildForemanPlaybook } from '../../lib/prompts/foreman-playbook.js';

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

  test('completion branch stays on the task instead of looping', () => {
    const text = buildForemanPlaybook({ baseUrl: BASE_URL, issue });
    assert.ok(text.includes('stay on this task until a stop condition is met'));
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
