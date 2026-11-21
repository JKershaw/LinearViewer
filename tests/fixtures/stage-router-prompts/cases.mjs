/**
 * Case matrix for the checked-in router-prompt byte snapshots (LIN-3304, review
 * addendum 1; the stage selector since LIN-3300).
 *
 * These are REAL snapshots of the routing prompt every recommendation call sends,
 * buildRouterPrompt(buildSelectorArgs()) rendered from small fixed tickets, so the
 * view, the facts, the stage options and the rules are all pinned as expected text
 * under this directory and compared byte-for-byte by
 * tests/unit/stage-router-prompt-snapshots.test.js.
 *
 * The matrix varies a provider other than Linear (GitHub Issues, Local, both with the
 * tracker flag off) and the ticket shapes the rules branch on, so a one-character
 * change to the prompt text, or a skipped capability pass, fails. Regenerate
 * intentionally, and review the diff, with:
 *   node scripts/eval/regen-stage-router-snapshots.mjs
 *
 * LIN-4504: plan facts are records, so each case carries its `planFacts` explicitly (folded by
 * lib/records/plan-facts.js from small record sets). The planned leaf keeps an old plan section in its
 * description on purpose, saying the opposite of its records: the selector reads none of it, and the view leaves the
 * section out (its heading is built from the one spelling, lib/legacy-plan-text.js).
 */
import { planFactsOf } from '../../../lib/records/plan-facts.js';
import { PLAN_HEADING_WORDS } from '../../../lib/legacy-plan-text.js';
import { standingFromComments } from '../../helpers/comment-path-frozen.js';

const GITHUB = { providerUi: { displayName: 'GitHub Issues' } };
const LOCAL = { providerUi: { displayName: 'Local' } };

const open = { name: 'In Progress', type: 'started' };
const done = { name: 'Done', type: 'completed' };
const at = (d) => `2026-10-0${d}T10:00:00.000Z`;
const task = (id) => ({ id, kind: 'task', state: 'open', v: 1 });
const NO_PLAN = (id) => planFactsOf({ task: task(id) });
const LEAF = {
  issue: { id: 'leaf', identifier: 'ABC-10', title: 'A leaf task', description: 'Make the thing work.', state: open, labels: [] },
  context: { parent: null, siblings: [], project: { name: 'Project' }, children: [], comments: [], focusedChild: null, planFacts: NO_PLAN('task-abc10') }
};
// A node whose subtasks are all done, with a landed PR and an approving code review.
const COMPLETE_NODE = {
  issue: { id: 'node', identifier: 'ABC-20', title: 'A node whose subtasks are done', description: 'Ship it.', state: open, labels: [] },
  context: {
    parent: null, siblings: [], project: null, focusedChild: null,
    planFacts: planFactsOf({
      task: task('task-abc20'),
      inside: [{ id: 'plan-abc20aa', v: 1, kind: 'plan', state: 'kept', in: 'task-abc20', to: 'breakdown', at: at(1) }],
      findings: [{ id: 'finding-abc20aa', v: 2, kind: 'finding', state: 'done', to: 'plan-review', links: { about: ['plan-abc20aa'] } }]
    }),
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
// A terminal node that still has an open subtask: the frontier facts and the suggested child.
const OPEN_CHILD_NODE = {
  issue: { id: 'term', identifier: 'ABC-30', title: 'A terminal node with an open subtask', description: 'Parent.', state: done, labels: [] },
  context: {
    parent: null, siblings: [], project: null, comments: [], planFacts: NO_PLAN('task-abc30'),
    children: [
      { id: 'c3', identifier: 'ABC-31', title: 'done one', state: done },
      { id: 'c4', identifier: 'ABC-32', title: 'open one', state: open }
    ],
    focusedChild: { issue: { id: 'c4', identifier: 'ABC-32', title: 'open one', state: open } }
  }
};
// A planned leaf whose plan-review asked for changes, a person's comment after it, and its runs.
const PLAN_REVIEWED = {
  issue: { id: 'pr', identifier: 'ABC-40', title: 'A planned leaf', description: `Goal.\n\n## ${PLAN_HEADING_WORDS}\n\nRevision 1, old text.\n\nSession fit: several sessions.\n\nA plan review is owed: no.`, state: open, labels: [] },
  context: {
    parent: null, siblings: [], project: null, children: [], focusedChild: null,
    // The plan record was revised (v2) after the Request Changes verdict; its plan-review finding is still open.
    planFacts: planFactsOf({
      task: task('task-abc40'),
      inside: [{ id: 'plan-abc40aa', v: 2, kind: 'plan', state: 'kept', in: 'task-abc40', to: 'implementation', at: at(3) }],
      findings: [{ id: 'finding-abc40aa', v: 1, kind: 'finding', state: 'open', to: 'plan-review', links: { about: ['plan-abc40aa'] } }]
    }),
    comments: [
      { user: 'Agent', createdAt: at(1), body: '### Plan Review Verdict\n\n**Verdict:** Request Changes.' },
      { user: 'John', createdAt: at(2), body: 'F1 is right; take the narrow revision.' }
    ],
    // The task's recent runs (LIN-3300): the revision after the verdict is a run.
    runs: [{ stage: 'plan-review', at: '2026-10-01T10:00:20.000Z', outcome: 'done' }, { stage: 'plan', at: at(3), outcome: 'done' }]
  }
};

export const CASES = [
  { id: 'router.linear.leaf', ticket: LEAF },
  { id: 'router.linear.complete-no-open', ticket: COMPLETE_NODE },
  { id: 'router.linear.terminal-open-child', ticket: OPEN_CHILD_NODE },
  { id: 'router.linear.plan-reviewed', ticket: PLAN_REVIEWED },
  { id: 'router.github-issues.leaf', ticket: { ...LEAF, ...GITHUB } },
  { id: 'router.local.leaf', ticket: { ...LEAF, ...LOCAL } }
];

export function renderCase(entry, { buildRouterPrompt, buildSelectorArgs }) {
  const t = entry.ticket;
  // LIN-4518 (beat 4): the selector's review facts read the records standing; each case's comments are written as the standing
  // (the comment-trail standing), so the rendered facts are the ones the comments give.
  const context = { ...t.context, standing: standingFromComments(t.context.comments ?? []) };
  return buildRouterPrompt(buildSelectorArgs(t.issue, context, t.featureFlags || {}, t.providerUi || null));
}
