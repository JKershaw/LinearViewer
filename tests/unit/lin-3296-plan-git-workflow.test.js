/**
 * LIN-3296: the old featureBranches toggle appended a "branch, commit, open a
 * PR" block to the only READY template, plan, whose Role forbids implementing.
 * Implementation carries its own branch and PR steps, so the block is gone,
 * and the toggle itself was then removed.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { buildRouterPrompt } from '../../lib/stage-router.js';
import { FEATURE_DEFAULTS, getFeatureFlags, isValidFeatureKey } from '../../lib/feature-defaults.js';
import { renderSettingsPage } from '../../lib/render-settings.js';

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

test('plan has no git workflow (handwritten path)', () => {
  const p = generatePrompt('plan', issue, context, {}).prompt;
  assert.ok(!p.includes('Git Workflow'));
  assert.ok(!/create a pull request/i.test(p));
});

test('implementation still branches and opens a PR', () => {
  const p = generatePrompt('implementation', issue, context, {}).prompt;
  assert.ok(/feature branch/i.test(p));
  assert.ok(/pull request/i.test(p));
});

test('the routing prompt has no git workflow block', () => {
  const p = buildRouterPrompt({
    issueContext: 'CTX', identifier: 'TEST-1',
    hasSubtasks: false, subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
    hasComments: false, commentCount: 0, aiHints: 'H', actionVocabulary: 'plan, implementation',
    completionSignals: 'S', focusedSubtaskId: null, isTerminal: false, hasOpenChildren: false,
    featureFlags: {}
  });
  assert.ok(!p.includes('## Git Workflow'));
});

// A session or stored preference saved before the toggle was removed may still
// carry `featureBranches`. It must be ignored harmlessly: not a valid key (so
// the toggle route 400s it), filtered out of the merged flags, and nothing
// rendered for it in Settings.
test('a stale stored featureBranches value is ignored', () => {
  assert.strictEqual(isValidFeatureKey('featureBranches'), false);
  assert.ok(!('featureBranches' in FEATURE_DEFAULTS));

  const flags = getFeatureFlags({ features: { featureBranches: true, linearMcp: false } });
  assert.ok(!('featureBranches' in flags));
  assert.strictEqual(flags.linearMcp, false, 'valid stored keys still apply');

  const html = renderSettingsPage('Acme', {
    urlKey: 'acme', workspaces: [], currentModel: 'openai/gpt-5.4-mini', availableModels: [],
    featureFlags: { ...flags, featureBranches: true }
  });
  assert.ok(!html.includes('featureBranches'));
  assert.ok(!/feature branch workflow/i.test(html));
  assert.ok(html.includes('data-feature="linearMcp"'), 'the other Workflow toggles still render');
});
