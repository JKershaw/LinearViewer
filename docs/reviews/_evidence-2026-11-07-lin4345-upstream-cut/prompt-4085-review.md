# Review LIN-4085: Add an agent onboarding prompt to the homepage getting started section
## Workflow

1. **Fetch details**: Get full issue details for LIN-4085 in Linear
2. **Analyze**: Complete the goal below
3. **Update Linear**: Add findings as a comment on LIN-4085
## Context
**Project:** Harbour
**Read before acting:** This prompt is an instruction, not a copy of the task. It does not restate LIN-4085's description or discussion — read the current description and comment thread in Linear first, since they are the source of truth and may have moved on since this prompt was written.
## Goal
You check the work before it lands: is it complete, does it meet the requirements, and is the evidence that it works real? Verify against the requirements; adding new ones is not review's job.

## Scope and Authority

- When this task fixes something, its cause is part of the work, wherever it lives. Judge the work, or propose the fix, against that cause rather than the ticket's wording. Only a change the team would need to hear about before it happens goes to the human, as one clear question with your recommendation.
- Green CI never settles a ledger item: CI is why it is on the list.

## Process
Start from what was asked (the `## As asked` block), then the plan and any implementation notes in comments. Confirm the scope recorded there matches what has actually changed on disk or in Linear. If implementation overran the plan's places or the plan is stale, flag this as a review finding rather than pressing on.
### Regression Check
Run `git log --oneline -30 -- <files modified in the implementation>`.
For each file, verify:
- This change does not re-introduce a bug that was previously fixed
- If a recent commit message mentions fixing the same property/behaviour this implementation touches, read that commit and confirm the fix is still intact
- If a recent commit reverted a change to this file, verify this implementation does not re-apply what was reverted
### Gap Analysis
Cross-reference the implementation against what was asked and the plan:
- Compare each cross-cutting concern or acceptance criterion against the steps actually followed
- **High-priority items**: Requirements that appear in the plan or cross-cutting concerns but were NOT explicitly addressed in an implementation step — these are the most likely gaps
### Isolated, or One of a Class?
Before approving the close, check whether the verified work is one instance of a class: the same bug, gap, or behavior often has siblings under a different name, in a parallel code path, or split across server and client. Search for the pattern itself, not only the surface the ticket cites. If siblings exist, name the class, then mark each unhandled instance **inside** or **outside** the ticket's bounded classes per the section immediately below — an inside sibling becomes a ledger item there, not a plain review finding, so the remaining work is scoped deliberately — review itself does not fix it. A genuinely isolated change is a valid result; state it explicitly.
### Inside or Outside the Ticket's Scope
A finding inside a bounded class is scope; scope discharges by done or an explicit drop, never by filing (John Kershaw's ruling on LIN-2825). Mark every unhandled class instance above, and every What-CI-Did-Not-Prove ledger item below, **inside** or **outside** the ticket's bounded classes — the classes or behaviours research or the plan named, with their places, in its issue description (LIN-1871) — citing the specific one an inside item belongs to. **Inside**: part of solving this ticket's problem, its cause included wherever it lives, or the same defect or idiom as a class this ticket bounded, whether or not research's enumeration listed it — the list is evidence of the class, not its edge — or a claim this ticket's own change depends on. Record it as a ledger item below rather than a plain review finding, so `close-out` cannot discharge it merely by filing a ticket for it. **Outside**: a different problem — not this ticket's or its cause, and no bounded class covers it; close-out files it, after checking it does not already exist. If a ruling is raised on a finding, an inside item's options are "do it here" or "drop it, with the reason"; "file" is offered only for an outside item. This marking is separate from how each item is settled, below.
**Before raising any `DECISION:`, check it is not already covered (LIN-2991/LIN-3022).** Query `GET /api/proxy/rulings?issueIdentifier=<anchor>&includeResolved=true` and read the prior stage's comments. Do not re-raise a question an open, answered, dismissed, or withdrawn row already covers for the same anchor — note that `includeResolved` covers loop-backed rulings only, never a task-bound one. Ask for every fact the question needs in the one ruling.
### Test Quality Check
Assess whether tests cover the right *level* — not just whether tests exist:
- For behavior crossing module boundaries, user-facing flows, or integration surfaces, verify higher-level tests like e2e or integration exist *where appropriate* rather than only unit tests with mocks
- Flag when a change adds only low-level tests for behavior that needs end-to-end coverage
- Determine the appropriate test level from the change itself (UI/route/cross-module → e2e; pure function → unit); do not enforce a fixed rule
- A test that reads source to show where code sits is no witness for a move; behaviour is (a replay, the seams import map)
- **Mutation-check the load-bearing tests (LIN-2274).** For at least the new/changed tests that pin this deliverable's own claimed behavior, delete or comment out the code path each one claims to cover and confirm it goes red — do not accept "the test exists and asserts something" as proof it asserts the RIGHT thing. A test that stays green with its own claimed code path removed passes for a reason other than the one it names (e.g. a test built from Proxies/spies never actually wired into the call path under test, or a helper that silently slices the wrong block of a shared file) — this is a review finding, not a style nit; name the specific mutation you tried and what you observed. Revert every mutation after checking it.
### Review Checklist
- [ ] Tests cover new/changed behavior
- [ ] Tests verify no unintended side effects (state left clean after each interaction)
- [ ] Where multiple features share a code path or state, their interactions are tested
- [ ] No security vulnerabilities introduced
- [ ] Error handling is appropriate
- [ ] Code style consistent with the codebase
- [ ] No performance regressions
### Manual Verification
For visual or behavioral changes, verify the result directly where possible (run the app, take screenshots, check viewports) rather than relying solely on automated tests.
If something cannot be verified by the agent (external service integration, cross-browser behavior, subjective UX), list it in the ledger as not run, with why.
### What CI Did Not Prove
Before the verdict, write the handoff ledger — the artifact the `close-out` step consumes. Enumerate every claim the deliverable depends on that the green CI run does NOT actually exercise. Common kinds (illustrative, not a checklist): an external contract or API behaviour CI cannot reach; a *producer* that must emit an input this change now *consumes*; a user-reachable entry path no automated test drives; a sibling on a parallel surface; or anything only a human can confirm. For each item, mark it **inside** or **outside** the ticket's bounded classes (see Inside or Outside the Ticket's Scope above) and state how it can be discharged: an **inside** item — this ticket's own unfinished scope — by a real-world check or a manual repro naming its **exact distinguishing precondition**; filing a ticket for it is never a discharge, since it belongs to this ticket, not a neighbour's. An **outside** item — a genuinely different kind of problem — by a routed follow-up ticket that states the problem on its own terms.
A class sibling belongs here ONLY if this deliverable's correctness depends on it, or it is itself marked inside scope; otherwise it stays an outside-scope follow-up, not a ledger item.
**Say how each item will be settled**, keeping each route to what the claim needs:
- **Before the merge**: a check or a repro close-out can run, naming the exact condition that tells right from wrong.
- **After the deploy**: a step that can only run once the change is live, such as a live check or a data clean-up. Record it as a post-deploy step close-out does after the merge, never as a condition on the merge.
- **A named monitor**, for a claim only time in production can show: a log or oplog entry, a metric, or a path that fails loudly, with one line on why no check short of production could prove it. A monitor **fires**; a follow-up ticket does not, so it may sit *beside* a monitor, never *instead* of one. A claim a test could have proven is not unprovable but untested, and usually means **Request Changes**.
- **A named rollback**, for a change that is genuinely reversible: the single commit to revert, or the exact env var / flag and its safe value. A migration, data already persisted in the new shape, or a third party already consuming the change makes it not reversible.
An unnamed monitor or rollback settles nothing. Still enumerate every claim CI does not exercise; only the route changes.
**Cheap when empty:** if green CI genuinely covers the whole deliverable, say so in one explicit line and do not manufacture doubt about a self-contained change. An explicitly empty ledger leaves close-out nothing to settle.
When CI is genuinely absent and the two-branch substitute below stood in for it, its known limits belong here as ledger items too: it has no independent clean environment, no coverage of commits after the one you ran it on, and no flake/regression separation beyond what you observed — do not let a clean substitute run read as "CI covers the deliverable".

### Establish CI (or Its Substitute)

Check once whether CI applies: look for CI configuration (e.g. `.github/workflows`) and read `gh pr checks` / `gh pr view --json statusCheckRollup`, allowing one settle if the rollup is empty, since checks register a moment after a push. Do this once — **never** arm a Monitor or other background watch on checks you have not seen exist; that turns a missing signal into an unbounded wait.

- **CI exists:** the ordinary CI-green gate applies, unchanged.
- **CI is genuinely absent:** say so explicitly, then run the substitute as the party asserting it — independence matters here, so re-run both branches yourself rather than citing an earlier stage's numbers: the test suite on the PR branch and on base, diffing failure **names**, not just counts (an equal count can hide a fix landing beside a regression). Record that in place of "CI green", with what it cannot prove (a clean environment, an author-independent run).
### Verdict
Conclude with an explicit verdict: **Approve** / **Request Changes** / **Needs Discussion**, with how the work meets what was asked: take each sentence of the block in order, none skipped or cut short, and say where the work meets it; a sentence met in part or not at all is a narrowing, which only the person's comment or answered ruling agrees to, not a stage's scope or plan, else **Needs Discussion**. When the `### What CI Did Not Prove` ledger above is non-empty, or you name fixes for close-out to make, the verdict is `Approve — conditional on close-out discharging the ledger`, never a bare Approve; only an explicitly empty ledger with nothing to fix may carry a plain **Approve**. Close-out makes the fixes you name itself, however many files they touch, so name each precisely enough to make without guessing: where, and what it should become. When the work still needs a new design or new behaviour, the verdict is **Request Changes** back to `implementation`.
### Hand Off to Close-Out
Review is write-only: your deliverable is the ledger plus the verdict, recorded in the summary comment. You do NOT merge, mark the task Done, or file follow-ups — the `close-out` step does, from the ledger you wrote, after re-checking CI on the exact commit. Before issuing **Approve**, confirm **CI is green on the PR — or, if CI is genuinely absent, that the substitute above has been independently re-run and recorded**; a real CI failure because the work is unfinished is **Request Changes**, handed back to implementation, not a fix loop here.
**Cannot-close branch — when the work has landed but CI is red for a real failure, or verifying it surfaced a bigger problem the fix exposed (a second bug, a prerequisite that must be fixed first):** that is still this task's work, its cause included. Do NOT loop back into another `review`, and do NOT hand to `close-out`. Instead:
- Give **Request Changes** with what you found and where, and name the stage that does it on this task as the next action: `implementation`, `bug` to find the cause first, or `plan` if the approach needs rethinking. File no new ticket for it. If an open task already owns exactly this work, link it as `blocks` and name it next: a `blocks` relation does not make the engine descend.
- Only a fix the team would need to hear about before it happens makes it **Needs Discussion**: one clear question for the human, with your recommendation.
- The task stays open until it is fixed and CI is green (or, with no CI, the two-branch substitute re-run and recorded); then review re-runs, Approves, and `close-out` closes.
### Completion
On **Approve** the task is left for `close-out`; otherwise it stays open, next action named.

## Formats Later Steps Read

- Title the summary comment `## Review — LIN-4085`, and name the head you reviewed as head `<sha>`.
- State CI on one line starting `CI:` (green, red, or absent plus the substitute run).
- Put the ledger under `### What CI Did Not Prove`, one list item per claim, each saying inside or outside. Write "discharged" only for an item already settled. If nothing is left, write `CI covers the deliverable; ledger empty`.
- End with `### Verdict` and one of: `Approve`, `Approve — conditional on close-out discharging the ledger`, `Request Changes`, `Needs Discussion`.

## Re-ground the Ticket (staleness check)

Treat this ticket, and any solution or limit it proposes, as a **hypothesis**, not ground truth — it may have been accurate when written but invalidated by later commits or by what the code shows. Before relying on what it says about the code:

1. List the files and symbols the ticket references.
2. Check whether any of them have changed since this ticket was created: run `git log --since=<ticket-createdAt> -- <paths>` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.