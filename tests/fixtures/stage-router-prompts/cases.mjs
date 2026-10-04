/**
 * Case matrix for the checked-in router-prompt byte snapshots (LIN-3304, review
 * addendum 1; the selector cases since LIN-3300).
 *
 * These are REAL snapshots of the two prompts a recommendation call can send, pinned
 * as expected text under this directory and compared byte-for-byte by
 * tests/unit/stage-router-prompt-snapshots.test.js:
 *
 *   - `router`  (writer ON)  = the stage selector, buildRouterPrompt(buildSelectorArgs())
 *                              rendered from a small fixed ticket, so the view, the
 *                              facts, the stage options and the rules are all pinned.
 *   - `full`    (writer OFF) = buildMetaPromptTemplate() — the full prompt, with its
 *                              own routing half (unchanged by LIN-3300).
 *
 * The matrix varies a provider other than Linear (GitHub Issues, Local, both with
 * the tracker flag off) and the ticket shapes the rules branch on, so a one-character
 * change to any prompt text, or a capability pass applied on one path only, fails.
 * Regenerate intentionally, and review the diff, with:
 *   node scripts/eval/regen-stage-router-snapshots.mjs
 */

// Writer-off inputs: fixed placeholders, so these pin the full template's scaffolding,
// not the formatters' output (those have their own tests).
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

// Fixed tickets for the selector cases (writer ON).
const open = { name: 'In Progress', type: 'started' };
const done = { name: 'Done', type: 'completed' };
const at = (d) => `2026-10-0${d}T10:00:00.000Z`;
const LEAF = {
  issue: { id: 'leaf', identifier: 'ABC-10', title: 'A leaf task', description: 'Make the thing work.', state: open, labels: [] },
  context: { parent: null, siblings: [], project: { name: 'Project' }, children: [], comments: [], focusedChild: null }
};
const COMPLETE_NODE = {
  issue: { id: 'node', identifier: 'ABC-20', title: 'A node whose subtasks are done', description: 'Ship it.', state: open, labels: [] },
  context: {
    parent: null, siblings: [], project: null, focusedChild: null,
    children: [
      { id: 'c1', identifier: 'ABC-21', title: 'one', state: done },
      { id: 'c2', identifier: 'ABC-22', title: 'two', state: done }
    ],
    comments: [
      { user: 'Agent', createdAt: at(1), body: 'Implementation landed: https://github.com/o/r/pull/7' },
      { user: 'Agent', createdAt: at(2), body: '## Review — ABC-20\n\n### Verdict\nApprove — conditional on close-out.\n\n### What CI Did Not Prove\n- L1 (inside): the live run.' }
    ]
  }
};
const OPEN_CHILD_NODE = {
  issue: { id: 'term', identifier: 'ABC-30', title: 'A terminal node with an open subtask', description: 'Parent.', state: done, labels: [] },
  context: {
    parent: null, siblings: [], project: null, comments: [],
    children: [
      { id: 'c3', identifier: 'ABC-31', title: 'done one', state: done },
      { id: 'c4', identifier: 'ABC-32', title: 'open one', state: open }
    ],
    focusedChild: { issue: { id: 'c4', identifier: 'ABC-32', title: 'open one', state: open } }
  }
};
const PLAN_REVIEWED = {
  issue: { id: 'pr', identifier: 'ABC-40', title: 'A planned leaf', description: 'Goal.\n\n## Implementation Plan\n\nRevision 2 — addresses plan-review F1.\n\nSession fit: fits one session.\n\nplan-review due: yes', state: open, labels: [] },
  context: {
    parent: null, siblings: [], project: null, children: [], focusedChild: null,
    comments: [{ user: 'Agent', createdAt: at(1), body: '### Plan Review Verdict\n\n**Verdict:** Request Changes.' }]
  }
};

export const CASES = [
  // Writer ON — the stage selector.
  { id: 'writer-on.linear.leaf', mode: 'router', ticket: LEAF },
  { id: 'writer-on.linear.complete-no-open', mode: 'router', ticket: COMPLETE_NODE },
  { id: 'writer-on.linear.terminal-open-child', mode: 'router', ticket: OPEN_CHILD_NODE },
  { id: 'writer-on.linear.plan-reviewed', mode: 'router', ticket: PLAN_REVIEWED },
  { id: 'writer-on.github-issues.leaf', mode: 'router', ticket: { ...LEAF, ...GITHUB } },
  { id: 'writer-on.local.leaf', mode: 'router', ticket: { ...LEAF, ...LOCAL } },

  // Writer OFF — the full prompt (buildMetaPromptTemplate).
  { id: 'writer-off.linear.leaf', mode: 'full', args: BASE_ARGS },
  { id: 'writer-off.linear.terminal-open-child', mode: 'full', args: TERMINAL_OPEN_CHILD_ARGS },
  { id: 'writer-off.github-issues.leaf', mode: 'full', args: { ...BASE_ARGS, ...GITHUB } }
];

export function renderCase(entry, { buildRouterPrompt, buildSelectorArgs, buildMetaPromptTemplate }) {
  if (entry.mode === 'full') return buildMetaPromptTemplate(entry.args);
  const t = entry.ticket;
  return buildRouterPrompt(buildSelectorArgs(t.issue, t.context, t.featureFlags || {}, t.providerUi || null));
}
