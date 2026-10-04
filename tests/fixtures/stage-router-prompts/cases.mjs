/**
 * Case matrix for the checked-in router-prompt byte snapshots (LIN-3304, review
 * addendum 1).
 *
 * These are REAL snapshots of the two prompts the meta call sends, pinned as
 * expected text under this directory and compared byte-for-byte by
 * tests/unit/stage-router-prompt-snapshots.test.js:
 *
 *   - `router`  (writer ON)  = buildRouterPrompt() — the routing-only prompt the
 *                              live writer-on call sends.
 *   - `full`    (writer OFF) = buildMetaPromptTemplate() — the full prompt,
 *                              whose routing sections are the same fragments.
 *
 * The matrix varies a provider other than Linear (GitHub Issues, Local, both with
 * the tracker flag off) and the Step 0 decision-tree branches, so a one-character
 * change to any prompt text, or a capability pass applied on one path only, fails.
 *
 * The snapshot files were generated from base 75b5c924 (before the seam moved),
 * so they witness byte-identity with the pre-change output rather than comparing
 * new code with new code. Regenerate intentionally with:
 *   node scripts/eval/regen-stage-router-snapshots.mjs
 */

// Fixed placeholder inputs: the snapshots pin the prompt scaffolding, not the
// formatters' output (those have their own tests).
export const BASE_ARGS = {
  issueContext: '{{ISSUE_CONTEXT}}',
  identifier: '{{IDENTIFIER}}',
  hasSubtasks: false, subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
  hasComments: false, commentCount: 0,
  aiHints: 'HINTS',
  actionVocabulary: 'plan, review, defer',
  completionSignals: 'SIGNALS'
};

// A node whose children are all terminal and which has no open child: the Step 0
// "substantive work here is already complete" branch.
export const COMPLETE_NO_OPEN_ARGS = {
  ...BASE_ARGS,
  hasSubtasks: true, subtaskCount: 2, completedCount: 2, inProgressCount: 0, remainingCount: 0,
  hasComments: true, commentCount: 3,
  hasOpenChildren: false, isTerminal: false
};

// A terminal node that still has an open child: the Step 0 "terminal but open
// children" branch, plus the frontier facts block.
export const TERMINAL_OPEN_CHILD_ARGS = {
  ...BASE_ARGS,
  hasSubtasks: true, subtaskCount: 2, completedCount: 1, inProgressCount: 1, remainingCount: 1,
  hasComments: true, commentCount: 3, focusedSubtaskId: '{{IDENTIFIER_PREFIX}}-01',
  frontierFacts: {
    openCount: 1, blockedCount: 0,
    openChildren: [{ identifier: '{{IDENTIFIER_PREFIX}}-01', blocked: false }],
    nextChild: '{{IDENTIFIER_PREFIX}}-01', sessionFit: 'fits one session'
  },
  hasOpenChildren: true, isTerminal: true
};

const GITHUB = { featureFlags: { linearMcp: false }, providerUi: { displayName: 'GitHub Issues' } };
const LOCAL = { featureFlags: { linearMcp: false }, providerUi: { displayName: 'Local' } };

export const CASES = [
  // Writer ON — the routing-only prompt (buildRouterPrompt).
  { id: 'writer-on.linear.leaf', mode: 'router', args: BASE_ARGS },
  { id: 'writer-on.linear.complete-no-open', mode: 'router', args: COMPLETE_NO_OPEN_ARGS },
  { id: 'writer-on.linear.terminal-open-child', mode: 'router', args: TERMINAL_OPEN_CHILD_ARGS },
  { id: 'writer-on.github-issues.leaf', mode: 'router', args: { ...BASE_ARGS, ...GITHUB } },
  { id: 'writer-on.local.leaf', mode: 'router', args: { ...BASE_ARGS, ...LOCAL } },

  // Writer OFF — the full prompt (buildMetaPromptTemplate).
  { id: 'writer-off.linear.leaf', mode: 'full', args: BASE_ARGS },
  { id: 'writer-off.linear.terminal-open-child', mode: 'full', args: TERMINAL_OPEN_CHILD_ARGS },
  { id: 'writer-off.github-issues.leaf', mode: 'full', args: { ...BASE_ARGS, ...GITHUB } }
];

export function renderCase(entry, { buildRouterPrompt, buildMetaPromptTemplate }) {
  return entry.mode === 'router' ? buildRouterPrompt(entry.args) : buildMetaPromptTemplate(entry.args);
}
