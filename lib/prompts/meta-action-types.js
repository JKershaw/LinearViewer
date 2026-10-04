/**
 * The writer-off meta prompt's Action Types Reference, frozen (LIN-3300).
 *
 * The stage selector reads each stage's own `route` description; the aiHints this text
 * was rendered from are gone. The full (writer-off) meta path is kept byte-identical
 * until the one-path change deletes it, so it renders this copy of what main rendered
 * (3ad34935, formatAIHintsForMetaPrompt). Do not edit: it leaves with the meta template.
 * tests/unit/writer-off-live-prompt.test.js compares the live writer-off prompt with main.
 */
export const META_ACTION_TYPES = `**blocked** (dependencies, missing info, or stalled):
Goal: "Identify the blocker type and root cause, evaluate options to unblock."
Workflow: Fetch details → Analyze blocker → Add comment in Linear

**bug** (needs investigation, debugging):
Goal: "Identify reproduction steps, hypothesize likely causes, and suggest a debugging approach."
Workflow: Fetch details → Investigate → Add findings as comment in Linear

**plan** (clear requirements, needs documented approach):
Goal: "Create a clear implementation plan, enumerate surfaces with any dependency arrows between them, commit to a session-fit answer (fits one session / needs multiple sessions), and state whether a plan-review pass is due before implementation."
Workflow: Set status to "In Progress" → Analyze requirements → Revise against any prior plan-review verdict → Document plan in description → Enumerate surfaces and draw any dependency arrows → Answer the session-fit question → State whether plan-review is due → Ready for implementation, plan-review, or breakdown

**look into** (understanding what's involved):
Goal: "Summarize what this task involves and how it fits into the broader project context."
Workflow: Fetch details → Analyze → Summarize findings for user

**triage** (missing metadata, unclear priority, wrong or missing project):
Goal: "Review and apply updates to labels, state, and project (confirm the task is in the correct project; move or assign it when unassigned or mis-filed), and priority — set via the provider-neutral \`priorityLevel\` field (ascending, 4 = highest)."
Workflow: Fetch details → Analyze (including project fit) → Apply changes directly in Linear

**breakdown** (plan has answered "needs multiple sessions"):
Goal: "Create one subtask per surface the plan enumerated. Only if this ticket's own comment trail — never its own rendered 'Parent Task' section — records an Approve on the plan, copy each surface's approved slice into its subtask as the breakdown rule says (omitting a false session-fit claim for a surface the plan could not scope to one session). If no such Approve verdict is on this ticket's own comment trail, write a plain acceptance-criteria subtask instead — no session-fit line, no plan-review-due line. Copy any dependency arrows into blocked-by relations."
Workflow: Fetch details → Check this ticket's own comment trail for a recorded \`### Plan Review Verdict\` of Approve → One subtask per surface: its approved slice when that Approve is on record, otherwise write a plain acceptance-criteria subtask → Copy arrows into blocked-by relations → Add summary comment

**research** (unknowns, unfamiliar dependency/API, or an unvalidated assumption to de-risk before planning):
Goal: "Identify key questions, read the relevant docs and prior art, check history, validate feasibility, and provide an actionable recommended approach for the plan that follows."
Workflow: Fetch details → Read docs/prior art, check history, validate feasibility → Add exploration notes as comment, update description with key findings and recommended approach in Linear

**scoping** (ambiguous requirements):
Goal: "Define clear boundaries (in scope vs out), assumptions, success criteria, and open questions."
Workflow: Fetch details → Define scope → Update issue description with finalized scope in Linear
When NOT: the requirements are already clear and only the solution SHAPE is contested (that is \`design\`), or the intent is clear enough to plan/implement directly — do not scope a task whose boundaries are already known.
Choose over: choose \`scoping\` over \`research\`/\`plan\` when the ambiguity is in WHAT to build (boundaries, success criteria, in/out of scope) rather than HOW to build it or how the code behaves today.

**design** (architectural decisions needed):
Goal: "Weigh the viable shapes against the problem and its cause, recommend one, and say what would change your mind."
Workflow: Fetch details → Design → Add full analysis as comment, update description with chosen design in Linear
When NOT: the shape is already decided (a committed approach in the ticket/comments, one obvious shape, or a familiar single-surface change) — that is \`plan\`; or the knowledge to weigh the shapes against is still ungathered — that is \`research\` first; or the work has already landed — that is \`review\`.
Choose over: choose \`design\` over \`plan\` when ≥2 genuinely viable, materially-different solution shapes exist AND the fork is still undecided (do not let the plan pick the architecture silently); choose \`plan\` once the shape is settled and only sequencing the surfaces remains.

**spike** (needs proof-of-concept or feasibility check):
Goal: "Answer the one deciding question by trying it, within a timebox, and give a go/no-go with evidence."
Workflow: Fetch details → Spike → Add findings as comment in Linear
When NOT: the approach is already known to be feasible, or the unknown is broad understanding / track-record rather than one sharp technical question (that is \`research\`), or the solution shape is contested between viable approaches (that is \`design\`).
Choose over: choose \`spike\` over \`research\` when a single, decisive feasibility question can be answered by a small time-boxed proof-of-concept; choose \`research\` when the knowledge gap is broader than one go/no-go probe.

**context** (joining mid-way, returning after gap):
Goal: "Synthesize current state, what's done, what remains, key decisions, and next steps."
Workflow: Fetch details and comments → Analyze → Add summary as comment in Linear

**plan-review** (plan documented, not yet implemented):
Goal: "Independently re-run the plan's grounding claims and issue a verdict (Approve / Request Changes / Needs Discussion) before implementation starts. Plan-review verifies the plan; it does not edit or implement it."
Workflow: Fetch details → Re-run the seven grounding claims → Issue verdict → Add findings + verdict as a comment

**implement** (ready to code, plan exists):
Goal: "Implement the planned changes with test coverage, then land them on a feature-branch PR with CI green (or, in a repo with no CI, the established-absence substitute recorded)."
Workflow: Fetch details → Branch → Implement → Test → Commit & push → Open PR → Confirm CI green (or its substitute) → Add summary comment with PR link in Linear

**review** (implementation complete, awaiting review):
Goal: "Verify the implementation is complete and correct, then issue a verdict (Approve / Request Changes / Needs Discussion) that authorizes the merge. Review does not merge or mark Done."
Workflow: Fetch details → Verify requirements/tests/CI green (or its substitute) on the PR → Issue verdict → Add review findings + verdict as comment in Linear

**close-out** (review approved, PR green (or CI-absence + substitute recorded), ready to land):
Goal: "Consume the review's Not-Proven-by-CI ledger and gate the irreversible finish: block merge/Done until every ledger item is discharged or explicitly accepted, then merge, set Done, post the summary, archive & prune, and file remaining follow-ups."
Workflow: Fetch details + latest review comment → Read the ledger → Gate (discharge or accept each item) → Merge → Set Done → Post summary → Archive & prune → File follow-ups

**retrospective-audit** (work already merged and closed out; an independent post-merge check on its claims and test integrity is wanted):
Goal: "Audit the claims the deliverable rests on and the integrity of the tests that assert them against the landed code, and report findings — never re-verify overall correctness (CI covers that), never re-litigate the decision, never change state."
Workflow: Fetch details → Locate the merged change → Audit claims against the landed code → Audit test integrity → Report findings as a comment
When NOT: the work has not yet merged (that's \`review\`, which is pre-merge framed and authorizes the merge), or the goal is lessons-learned / downstream-effects analysis rather than claim/test-integrity auditing (that's \`retro\`).
Choose over: choose \`retrospective-audit\` over \`review\` once the change is already merged and closed out — \`review\` opens expecting unlanded work; choose it over \`retro\` when the question is specifically whether the claims and the tests hold up, not what should be learned for next time.`;
