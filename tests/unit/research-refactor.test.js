import assert from 'node:assert';
import { test } from 'node:test';
import { TEMPLATE_DEFS } from '../../lib/prompt-template-defs.js';

test('research template includes refactoring and cleanup instructions', () => {
  const mockIssue = { identifier: 'TEST-123', title: 'Research new API' };
  const mockContext = { labels: [] };
  
  const prompt = TEMPLATE_DEFS['research'].generate(mockIssue, mockContext);

  // Assert Workflow includes technical health / refactor check
  // Checking for a step that prompts the user to evaluate the codebase health
  assert.match(
    prompt, 
    /\*\*Refactor Identification\*\*|Health Assessment|refactor-ready/i,
    'Research prompt workflow should mention refactoring or health assessment'
  );

  // Assert Documentation includes refactoring recommendations
  assert.match(
    prompt,
    /Refactoring recommendations|Cleanup/i,
    'Research prompt should include a section for refactoring recommendations'
  );
  
  // Verify it explains WHY (to improve the outcome of the task)
  assert.match(
    prompt,
    /improve the outcome|simplify implementation/i,
    'Research prompt should explain that refactoring targets improved outcomes'
  );
});