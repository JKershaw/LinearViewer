/**
 * LIN-4504 (slice 2, P4): the words a stage writes a plan with, now that a plan is records. One owner, so the plan and
 * design contracts (lib/prompts/stage-kinds.js), the stage templates (lib/prompt-template-defs.js) and the tests read
 * the same lines. A plan record is `in` the task and addressed by its session fit (lib/records/check.js
 * PLAN_ADDRESSEES); a review is asked for with a finding `to: plan-review` about the plan, which an Approve ends; the
 * selector reads all of it from records (lib/records/plan-facts.js). No stage writes a plan into a description: the
 * proxy refuses a description write that adds a plan heading (routes/proxy-writes.js).
 *
 * A LEAF: it imports nothing, so the stage-kind record and the templates can both import it.
 */

/**
 * Whether the design stage writes the approach it settles as a plan record (and so inherits plan's contract).
 *
 * OPEN RULING (lin4504-design-plan-record, to John): the ask says "Plan and design write plan records", and an
 * unanswered cut is not agreed, so this is `true`. The plan-review (comment 37556002, Q1) recommends `false`: today
 * design writes no plan, and the selector sends design → plan → plan-review; with a design record the task has a plan,
 * so the selector skips `plan`, and goes to plan-review only when a review is owed (a breakdown plan, or the finding the
 * contract asks for), else to implementation. Flipping this one constant restores design → plan → review: design's
 * contract goes back to none and its template to its comment and description summary (no plan heading, so the 422
 * allows it). tests/unit/lin-4504-plan-writes.test.js pins the chosen behaviour and the routing it gives.
 */
export const DESIGN_WRITES_PLAN_RECORDS = true;

/** Where a stage reads the plan: its brief's plan part, never an old description. */
export const PLAN_FROM_BRIEF = 'The plan is records: read its current version in your brief\'s plan part (a piece in full with `GET /api/proxy/records/<id>`). A plan section in an old description is stale display, never the plan.';

/**
 * The contract lines (Formats Later Steps Read) for a stage that writes a plan: plan, and design while
 * DESIGN_WRITES_PLAN_RECORDS holds.
 * @param {string} identifier - the task's ticket
 * @returns {string[]}
 */
export function planRecordContract(identifier) {
  return [
    `Write the plan as one plan record, never into the description: \`POST /api/proxy/records\` with \`"kind": "plan"\`, \`"in": "${identifier}"\`, \`"says"\` the plan, and \`"to": "implementation"\` when one session can build it or \`"to": "breakdown"\` when it needs several.`,
    'Ask for a plan review with a finding: `"kind": "finding"`, `"to": "plan-review"`, `"about": "<the plan id>"`, `"says"` why. A plan addressed to breakdown always gets one.',
    'Revise, never replace: `POST /api/proxy/records/<plan id>/revise` with the new `says` and a `reason` naming what changed and the findings it answers.'
  ];
}

/** Plan-review's contract line for the review finding: Approve ends it; anything else leaves it open. */
export const PLAN_REVIEW_FINDING_LINE = 'On Approve, end the open finding to plan-review about the plan (`POST /api/proxy/records/<finding id>/end`, `"state": "done"`, a `reason` naming this verdict); if there is none, add one about the plan and end it. On Request Changes or Needs Discussion, leave it open (add one if there is none).';
