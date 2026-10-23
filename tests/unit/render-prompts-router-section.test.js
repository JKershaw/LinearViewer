/**
 * LIN-3745: the Prompts page's last section renders the stage router's routing prompt
 * (LIN-3300 deleted the meta-prompt), so it must not describe itself as the old
 * "AI prompt generator". The `.meta-prompt-section` class is a kept CSS/e2e hook.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPromptsPage } from '../../lib/render-prompts.js';

describe('Prompts page stage-router section (LIN-3745)', () => {
  const html = renderPromptsPage('Test');

  test('is titled Stage Router, not Meta-Prompt', () => {
    assert.ok(html.includes('Stage Router'));
    assert.ok(!html.includes('Meta-Prompt'));
  });

  test('does not claim to generate custom prompts', () => {
    assert.ok(!html.includes('AI prompt generator'));
    assert.ok(!html.includes('View meta-prompt template'));
    assert.ok(html.includes('View routing prompt'));
  });
});
