/**
 * Autopilot's order, written once (LIN-4382, piece 4 of LIN-4349).
 *
 * `AUTOPILOT_PRECEDENCE` is the one spelling of what an Autopilot run picks next, and of
 * the one Periodical a scoped run takes as it finishes (the tail). The kickoff
 * (lib/prompts/autopilot-kickoff.js) renders it once, in its Orient step, for every run:
 * general, scoped and stepper alike. There is no branching in here, so the text cannot
 * fork into one order per mode again. Before LIN-4382 the kickoff carried two orders, the
 * Orient step's two-level list and a general first act that "superseded" it, and each
 * change since LIN-1829 patched one and pinned the other.
 *
 * It is guide text, not a decision engine: the run reads `GET /periodicals` and the stack
 * and applies the order itself. The docs point here rather than restate it, and
 * tests/unit/lin-4382-precedence-written-once.test.js fails when a file in lib/ or routes/
 * spells out the ranks, or when the docs stop naming this constant.
 *
 * A leaf that imports nothing. Paths are relative to the proxy base the kickoff's Setup
 * names, the same way its verb list writes them.
 */

export const AUTOPILOT_PRECEDENCE = `**The precedence policy.** What you pick next is a policy, not a judgment call, so don't improvise it:

1. an explicit goal from the human;
2. a Periodical lane reading \`due\`, the weekly floor;
3. the top of the stack, for work that can move now;
4. a Periodical lane reading \`landed\` (work merged in its repo since its last run), only when no stack work can move now: every remaining task is in Backlog, waiting on a person, blocked or already running. Oldest last run first, with only one in flight.

Read the lanes with \`GET /periodicals\`. Each template's \`repos[]\` holds one lane per repo with its own \`state\`, so act on a lane's state, not the template's top-level one (\`repo: null\` is the default lane, not "all repos"). A lane of a \`scope: "repo"\` template reading \`never\` (no evidence in the 30-day read window, not "never ran") is the most overdue \`due\`. To act on rank 2 or 4, mint the lane with \`POST /periodicals/{id}/mint\` (\`repo\` set for a named lane), then drive the review task it opens like any task, passing \`periodicalId\` (the template's \`id\`) on the \`POST /recommend-and-dispatch\` that opens that task's chain, and on no later call.

**The tail: a scoped run ends with one Periodical.** A run scoped to one task takes nothing else from the stack. Once its task is merged and verified, read \`GET /periodicals\` (after that check, not in the same beat as the Done write: a merge is recorded asynchronously) and take at most one lane of a \`scope: "repo"\` template: \`due\` (including \`never\`) before \`landed\`, then the oldest last run. Mint it with \`POST /periodicals/{id}/mint\` and \`"autopilot": true\` (\`repo\` set for a named lane), so a run of its own drives the review, then stop. No such lane, or a refused mint: say so in a line and stop. A run stopped for the human, or before the merge, takes no tail. Nor does a run whose own task is a Periodical's review (its description carries the \`harbour-periodical-gate\` marker): its merge is not new work, and a tail from it would chain one reading after another.`;
