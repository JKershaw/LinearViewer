/**
 * Autopilot's order, written once (LIN-4382, piece 4 of LIN-4349).
 *
 * `AUTOPILOT_PRECEDENCE` is the one spelling of what an Autopilot run picks next. The
 * kickoff (lib/prompts/autopilot-kickoff.js) renders it once, in its Orient step, for every
 * run: general, scoped and stepper alike. There is no branching in here, so the text cannot
 * fork into one order per mode again. Before LIN-4382 the kickoff carried two orders, the
 * Orient step's two-level list and a general first act that "superseded" it, and each
 * change since LIN-1829 patched one and pinned the other.
 *
 * A scoped run still carries it, though it stops once its own task is complete (LIN-4415):
 * a scoped run's goal can ask for a Periodical, and rank 1 plus the mint-and-drive sentence
 * below are what tell it how to act on that. LIN-4415 retired the completion Periodical this
 * constant used to give every scoped run, with its budget condition (LIN-4349) and the guard
 * that kept a Periodical's own review run from chaining another reading.
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

Read the lanes with \`GET /periodicals\`. Each template's \`repos[]\` holds one lane per repo with its own \`state\`, so act on a lane's state, not the template's top-level one (\`repo: null\` is the default lane, not "all repos"). A lane of a \`scope: "repo"\` template reading \`never\` (no evidence in the 30-day read window, not "never ran") is the most overdue \`due\`. To act on rank 2 or 4, mint the lane with \`POST /periodicals/{id}/mint\` (\`repo\` set for a named lane), then drive the review task it opens like any task, passing \`periodicalId\` (the template's \`id\`) on the \`POST /recommend-and-dispatch\` that opens that task's chain, and on no later call.`;
