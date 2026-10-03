/**
 * LIN-3296: the featureBranches toggle appended a "branch, commit, open a PR"
 * block to the only READY template, plan, whose Role forbids implementing.
 * Implementation carries its own branch and PR steps on both paths, so the
 * block is gone from both.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { buildMetaPromptTemplate } from '../../lib/prompts/meta-prompt-template.js';

const issue = {
  id: 'issue-1',
  identifier: 'TEST-1',
  title: 'A task',
  description: 'Something to plan',
  url: 'https://linear.app/test/issue/TEST-1',
  state: { name: 'Todo', type: 'unstarted' },
  labels: []
};
const context = { parent: null, siblings: [], project: null, children: [], comments: [] };

test('plan has no git workflow with featureBranches on (handwritten path)', () => {
  const p = generatePrompt('plan', issue, context, { featureBranches: true }).prompt;
  assert.ok(!p.includes('Git Workflow'));
  assert.ok(!/create a pull request/i.test(p));
});

test('implementation still branches and opens a PR with featureBranches off', () => {
  const p = generatePrompt('implementation', issue, context, {}).prompt;
  assert.ok(/feature branch/i.test(p));
  assert.ok(/pull request/i.test(p));
});

test('meta-prompt has no git workflow block with featureBranches on', () => {
  const p = buildMetaPromptTemplate({
    issueContext: 'CTX', identifier: 'TEST-1',
    hasSubtasks: false, subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
    hasComments: false, commentCount: 0, aiHints: 'H', actionVocabulary: 'plan, implementation',
    completionSignals: 'S', focusedSubtaskId: null, isTerminal: false, hasOpenChildren: false,
    featureFlags: { featureBranches: true }
  });
  assert.ok(!p.includes('## Git Workflow'));
});
