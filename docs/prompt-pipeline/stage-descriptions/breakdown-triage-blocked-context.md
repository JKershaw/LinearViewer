# Breakdown, triage, blocked, context: from rules to briefs

Read against `/home/user/LinearViewer` as checked out on 2026-10-03 (the directory is not a git
checkout, so no SHA). Line numbers are for that tree. Sources for each template:

| Template | `generate()` | aiHint (meta path) | Meta-prompt quality rule | Completion signal |
|---|---|---|---|---|
| blocked | `lib/prompt-template-defs.js:72-121` | `:77-81` | `lib/prompts/meta-prompt-template.js:299` (plus Step 2, `:177-183`) | `lib/completion-signals.js:32-41` |
| triage | `:373-437` | `:378-382` | `:300` | `:78-88` |
| breakdown | `:439-503` | `:444-448` | `:304` (plus `:170`, `:208`, `:216-217`, `:232`) | `:89-98` |
| context | `:787-832` | `:792-796` | **none** | `:139-149` |

Rendered sizes under a small fixture (one parent, one sibling, no comments), including the shared
staleness section that `appendGroundingSections` adds to every template: breakdown 4,647 bytes,
triage 3,203, blocked 2,965, context 1,870.

Shared plumbing all four go through: `formatHeader`, `formatSection`/`formatMultiLineSection`,
`formatProject`, `formatParent`, `formatSiblings`, `formatChildren`, `formatLabels`,
`formatDiscussionReference` ("**Read before acting:** …"), one of `formatWorkflow(UNIVERSAL)` /
`formatReadOnlyWorkflow` / a hand-rolled workflow, then in `generatePrompt()`
(`lib/prompt-templates.js:248-303`) the grounding post-pass (`appendGroundingSections`:
staleness check, terminal-state note, children-complete note, bug-investigated note), the
attachments section, and `applyPromptCapabilities`.

---

## 1. Breakdown

### What it's for

The plan says this work needs more than one session. Split it into pieces that each land on
their own and together finish the job, in an order that reflects what really depends on what, so
whoever picks up a piece can start working instead of re-researching.

### The ideal version

> {task facts: identifier, title, project, parent, existing subtasks}
>
> {plan status: "The plan in the description was approved in plan-review comment {comment id}
> (revision {N})." | "The plan in the description hasn't been through plan-review yet."}
>
> {identifier}'s plan says the work needs more than one session. Turn it into subtasks that each
> land on their own and between them finish the job, so that someone picking one up cold can get
> straight to work.
>
> Read the plan and the comment thread, then check the plan against the code as it is today.
> If things have moved a little (a renamed file, a function that now lives elsewhere), carry the
> correction into the piece it affects and say so. If they've moved enough to change the shape
> of the work, don't split a plan you know is wrong: say what changed and send it back to
> planning.
>
> Make one subtask per piece the plan names, unless a few small ones plainly belong together,
> and reuse any existing subtask that already covers a piece. Give each a title naming its piece
> and a description someone can work from on its own: what the piece is for, what done looks
> like, and, if the plan is approved, the plan's own approach, files and tests for that piece,
> copied rather than summarised, with a link back to {identifier} for the whole design. Present
> it as what it is: a reviewed starting point that doesn't need re-deriving. If the person doing
> the piece finds in the code that it's wrong, they should fix it properly, say why, and note it
> on {identifier} when it changes what other pieces can rely on.
>
> The pieces should cover everything the plan asks for. Don't leave part of the job sitting in
> the parent or in a follow-up for later.
>
> Mark a piece as blocked by another only where it really can't start until the other has landed;
> the plan's dependency arrows show where that is. Unlinked pieces can be picked up straight away,
> maybe at the same time, so if two pieces will edit the same files, say so in both.
>
> Finish with a comment on {identifier} listing the subtasks and how they fit together.

Code then appends the exact subtask fields and description lines (section 3), with the approval
citation already filled in.

**On inheritance.** Today the child is told "the parent's plan is the source of truth for this
surface — do not redesign it here", and that line is written *into the child's description*, so
every later stage on the child (plan, implementation, review) reads it as a standing order. The
ideal keeps what the line was protecting: the approved slice is the starting point, so the child
skips research and plan-review (meta-prompt `:170`, `:208`). It drops the prohibition. The child
inherits the plan as reviewed work it can build on, with permission to change it at the cause
and a duty to say so where siblings would notice. The router already re-derives the gate when a
child's slice "visibly diverges from what the cited parent verdict approved" (`:208`), so letting
the child depart from the plan doesn't weaken the gate. A departure that's recorded is exactly
what that check reads.

### What machines rely on

**Written by the agent, read by code:**

- **Subtask fields** (structured writes through the tracker or proxy). These are read by the tree,
  router and dispatcher:
  - `parentId` = the ticket being decomposed (tree, `selectFocusSubtask`, `defer` descent).
  - `projectId` inherited from the parent. The project decides the dispatch repo:
    `parseRepoFromDescription` reads `/^repo=([^\r\n]+)$/m` from the project description
    (`lib/prompt-formatters.js:196-200`), and then `resolveDispatchRepo` uses it.
  - `stateId` "Todo". `selectFocusSubtask` ranks non-blocked todo after non-blocked in-progress
    (`lib/tree.js:205ff`).
- **`blocked-by` relations between subtasks.** `isBlocked` reads `inverseRelations.nodes` with
  `r.type === 'blocks'` from a non-terminal issue (`lib/tree.js:194-202`). The frontier picker
  and FRONTIER FACTS (`meta-prompt-template.js:96-104`) skip blocked children.
- **`Session fit: fits one session`** in a child's description. It's read by:
  - `extractSessionFit`: `/fits?\s+(?:in\s+)?one\s+(?:focused\s+)?session/i` and
    `/needs?\s+multiple\s+sessions/i` (`lib/recommendation-facts.js:47-52`). This becomes the
    "Plan session-fit answer" in FRONTIER FACTS and the router's fits-one → `implementation`
    rule (`meta-prompt-template.js:202`, `:211`).
  - `PLAN_MARKER = /#{1,4}\s*implementation plan\b|\bfits one session\b|\bneeds multiple sessions\b/i`
    (`lib/follow-on-ratio.js:146`), checked against the description only. A copied session-fit
    line therefore makes a child count as "plan ran" in that metric.
- **`Plan-review due: no — covered by <parent identifier>'s approving plan-review (comment <id>, rev <N>)`**
  (wording at `prompt-template-defs.js:492`). Code reads only the *yes* form:
  `GATE_DUE_MARKER = /plan-review due:\s*yes/i` (`lib/plan-review-round-trips.js:168`). The *no*
  form is read by the router model, which honours it at `meta-prompt-template.js:208` and treats
  it as findings-in-hand at `:170`. Keep the exact shape so the model and the metric keep
  matching.
- **The grounding SHA(s) the plan cited** go into each approved-path child (bullet (d), `:493`).
  The router reads them, not code.

**Read by the agent, and resolvable by code instead:**

- **`### Plan Review Verdict`** headed comment with Approve, on *this* ticket's own trail
  (`:480`, `:446-447`). plan-review is required to emit that heading (`prompt-template-defs.js:912`),
  and the verdict token is already parsed elsewhere:
  `VERDICT_TOKEN = /\b(approve|request changes|needs discussion)\b/i`
  (`lib/plan-review-round-trips.js:167`). `generatePrompt` already receives `context.comments` on
  the dispatch paths (`routes/proxy-dispatch.js:960`, `routes/proxy-compute.js:316`, `:466`,
  `routes/workspace-api.js:601`), though breakdown never renders them. The mechanical layer can
  resolve "approved: yes/no, comment id, revision" and hand the writer a fact. That removes the
  whole F4 "wrong ticket" trap (`:446`, `:480`, test `prompt-templates.test.js:4835-4878`), which
  exists only because the agent has to go and find the verdict. The test's own comment admits
  "the template is static — this pins its presence, not a runtime branch".

**In the prompt text itself (shared by all four templates, see the end):** breakdown has its own
`## Workflow` with `**Start**` / `**Update Linear**` steps and `Set {id} status to "In Progress"`,
plus the `**Existing Subtasks:**` block.

**Template identity:** key `breakdown` → `deriveDispatchKind`, `DISPATCH_KINDS`,
`DISPATCH_DEFAULT_KINDS` (`lib/prompt-templates.js:191-232`), and the meta-prompt action
vocabulary (`→ **breakdown**`, parsed by `/→\s*\*\*(.+?)\*\*/` at `lib/openrouter.js:1677`).

### Rules that tie scope to the ticket

| Where | Text |
|---|---|
| `prompt-template-defs.js:471` | "You have authority to create subtasks and define dependencies, but should preserve the original task's intent and scope." |
| `:473` | "If the plan has drifted, stop and recommend re-planning before decomposing." (Any drift at all, however small, sends it back.) |
| `:484` | "Description with acceptance criteria for just this surface — the parent task carries the full scope and sibling context flows in at runtime, so keep the description focused on this surface alone" |
| `:491` | "(b) … if a surface genuinely does not fit one session, leave this line for a fresh `plan` pass to answer honestly rather than copying a false claim" (fine in itself, but see below) |
| `:494` | "(e) An explicit \"the parent's plan is the source of truth for this surface — do not redesign it here\" line" |
| `meta-prompt-template.js:304` | "…plus the grounding SHA(s) the plan cited and an explicit \"the parent plan is the source of truth; do not redesign\" line." |
| `:480` | "…the subtask is expected to route through `research`/`plan` normally." |

Line `:484` is the subtlest of these. Its justification ("sibling context flows in at runtime")
is mostly not true. A child's prompt gets its parent as one line, `formatParent` → `LIN-x: "title"
(state)` (`lib/prompt-formatters.js:275-278`), and siblings as titles and states. It never gets
the parent's plan. "Read before acting" points the child at *its own* description and thread.
So "focused on this surface alone" plus a one-line parent means the child never sees the whole
design. That's the brittle slice the paper describes, and the ideal fixes it with a link to the
whole design.

### How today's version differs

- **Rule-shaped, should become guidance.** The (a)–(e) bullet list and its "check THIS TICKET'S
  OWN comment trail" precondition are written three times: in the template (`:480-494`), in the
  aiHint goal and workflow (`:446-447`), and in the meta rule (`:304`). Each is long and full of
  exceptions ("from the new subtask's own side, the ticket being decomposed IS its parent, so
  <parent> here is correct"). Once code supplies the approval fact and appends the exact lines,
  the prose only has to say *why* the slice is copied (so the child can start without
  re-researching).
- **Scar tissue that can go.**
  - The F4 grandparent disambiguation (`:446`, `:480`, meta `:304`) is only needed because the
    agent has to locate the verdict. Code resolves it.
  - Bullet (e) / "do not redesign" is the scar from LIN-3049. Its job, stopping a child from
    being re-planned for nothing, is already done by the router (`:170`, `:208`).
  - "A surface with no incoming arrows has no `blocked-by` relations, which is correct: … the
    arrows *are* the structure" (`:475`) explains itself at length. One sentence on why
    over-linking and under-linking both cost something does the same job.
  - "Read the surfaces the plan enumerated…" (`:475`) restates `:473`.
- **Mismatches worth fixing in passing.**
  - The template's `description` says "Break a large or vague task into smaller, actionable
    subtasks… when task scope is unclear" (`:442`), but the aiHint (`:445`) and the body assume
    an existing plan.
  - The router also sends multi-phase tasks *with no formal plan* here (meta `:217`: "EVEN IF
    each phase's micro-scope is not yet pinned"), and then the template opens with "Start by
    reading the plan in the description". The ideal's "plan status" placeholder should also
    cover "phases, no reviewed plan".
  - `formatLabels(issue.labels, ['breakdown'])` excludes a legacy label that no longer exists in
    `WORK_ISSUE_LABELS`.
- **Missing today.** Nothing says the pieces must add up to the whole job. Yet "23 of 40
  unworked filings are the parent's own unfinished scope" (paper §2). The ideal adds one line
  for this.
- **Keep.**
  - Copy the plan's own approach, files and tests into each child, not just acceptance criteria.
    That's what lets a child skip research.
  - Never claim `fits one session` for a surface the plan didn't scope that finely (R6/M13 in
    the tests). This is a real honesty rule, because the router routes on it.
  - Reuse existing subtasks.
  - Relations copied from the plan's arrows.
  - Check the plan against today's code before splitting it.
  - The summary comment on the parent.

---

## 2. Triage

### What it's for

A ticket has arrived, usually a feedback ticket filed through the widget, and needs filing so
the rest of Harbour handles it correctly: in the right project (which decides which repo its work
runs in), at a sensible priority, in the right state, and labelled `bug` if something is behaving
unexpectedly. This is filing, not working the problem.

### The ideal version

> {task facts: identifier, title, current project, state, priority as priorityLevel, labels,
> assignee, parent, siblings}
>
> {identifier} needs filing before anyone works on it. Read it and its thread, then make its
> project, priority, state and labels tell the truth about it, so Harbour routes it correctly.
>
> Get the project right first, because that decides which repository work on this runs in. Look
> at the workspace's projects and put the ticket where its work belongs, moving it if it's
> unfiled or in the wrong place. Set the priority by how much it matters and how urgent it is.
> Set the state to where the ticket really stands. If it describes something behaving
> unexpectedly, label it `bug`. That label stays for the ticket's whole life as the record that
> it was a bug. If it's waiting on another ticket, link it as blocked by that ticket instead of
> labelling it. If it duplicates an existing ticket, link the two and say so.
>
> Keep to filing. The reporter's description is the record of what they asked for, so leave it
> as they wrote it. Whether and how to work on this gets decided after triage, so don't start the
> work or open new tickets for it. If you spotted something useful along the way (a likely area
> of code, a related ticket, a question for the reporter), put it in your comment as a lead
> rather than a conclusion.
>
> Finish with a short comment saying what you changed and why.

Code appends the write fields (section 3).

### What machines rely on

- **`priorityLevel`**, the provider-neutral write field: "ascending, 4 = highest", with 0 =
  unknown/none. It's served by the proxy's PATCH contract (`lib/proxy-instructions.js:701`,
  `:709`) and named three times in the prompt (`:380`, `:407`, `:429`). Tests check which
  priority field each line names (`tests/unit/prompt-templates.test.js` around `:1549-1643`,
  LIN-2315/2316/2317). The **current-priority display** is
  `formatTriagePriority` (`prompt-template-defs.js:54-62`), which renders
  `"{label — }priorityLevel {n} (ascending, 4 = highest)"` or `"Not set"`. It exists because
  triage's main caller passes only a raw native int (`enqueueFeedbackTriage`,
  `routes/workspace-api.js:3642-3654`). Keep it as a mechanical fact.
- **The `bug` label**, by exact name (`WORK_ISSUE_LABELS.BUG`). It's read by:
  - `formatBugInvestigatedNote`: `String(l).toLowerCase() === 'bug'` (`prompt-formatters.js:746`)
  - router Step 2 (`meta-prompt-template.js:181-184`)
  - `getAvailablePrompts`, which makes the bug template available.
- **`blocks`/`blocked-by` relation, never a `blocked` label.** Read by `isBlocked`
  (`lib/tree.js:194-202`) and the frontier picker.
- **Project assignment** (`projectId`). This is the repo source for dispatch through the
  project's `repo=` line (`parseRepoFromDescription`, `prompt-formatters.js:196-200`;
  `resolveDispatchRepo`, `:223-227`). A mis-filed ticket dispatches into the wrong repo, which
  is the real reason project placement matters most.
- **State** (`stateId`). The router reads `state.type` throughout (terminal, started,
  backlog/unstarted).
- **Template identity:** `kind: 'triage'` set explicitly on the feedback dispatch
  (`routes/workspace-api.js:3682`), plus `deriveDispatchKind` and the meta action vocabulary.
- **In the prompt text:** a hand-rolled `## Workflow` whose step 3 is
  `**Update Linear**: Apply recommended changes in Linear` (`:390`). It is gated by
  `gateWorkflowWrites` on a read-only provider.

### Rules that tie scope to the ticket

| Where | Text |
|---|---|
| `prompt-template-defs.js:411` | "Triage is organization, not research: identify what the user is asking for and any evidence needed, but do not conduct or present analysis as completed research — the research step follows separately. Findings are observations and open questions, not conclusions." |
| `:413` | "Triage preserves scope. You may change only labels, priority, state, and project — do not rewrite the task's description or otherwise change its scope, and do not create follow-up tasks or subtasks. Findings stay observations in a comment, never new work items; scope changes belong to the scoping, plan, and breakdown steps." |
| `:407` | "Act as a project coordinator with authority to update task metadata. You can modify labels, state, and priority…" |
| `:417` | "Labels indicate **current state**, not future needs." |
| `meta-prompt-template.js:300` | "Triage prompts must also preserve scope: instruct the agent that triage may change only labels, priority, state, and project — it must not rewrite the task's description or otherwise change its scope, and must not create follow-up tasks or subtasks; findings stay observations, never new work items (scope changes belong to the scoping/plan/breakdown steps)." |

Unlike the others, triage's scope limits mostly have a real reason, and the ideal keeps their
substance. Triage runs automatically on user feedback (`enqueueFeedbackTriage`, behind the
`feedbackTriage` flag), before anyone has decided the ticket is worth working. The reporter's
words are the evidence. Spawning tickets at this point feeds the 2.1-created-per-closed ratio.
What should go is the framing: "preserves scope", "never new work items", and the list of later
stages that own scope. The ideal states the reason (whether to work on it is decided after
triage) and keeps the leads.

### How today's version differs

- **Rule-shaped, should become guidance.**
  - The "Label Selection Guide" (`:415-425`) is a heading, an "Available Labels" list with one
    entry, and a "Label Rules" list repeating that entry. One sentence covers it.
  - "Other Metadata" (`:427-431`) is three questions that read naturally as prose.
  - `priorityLevel` is explained three times (`:380`, `:407`, `:429`). Say it once, and let
    code append the field contract.
- **Restated elsewhere, could go.**
  - "Labels indicate current state, not future needs" is now only true of `bug`, and the `bug`
    sentence already says what the label means.
  - The meta rule (`:300`) restates the template almost word for word.
- **Mismatches.**
  - `description` (`:376`) says "labels, priority, assignee", but nothing in the body lets
    triage set an assignee (the Current State block only shows it).
  - Through the feedback path, project, parent and siblings are all null
    (`routes/workspace-api.js:3654`), so "**Project:** Unknown" is the usual case. That's why the
    ideal opens with the project.
  - The shared grounding post-pass appends the staleness `git log` check to triage, which isn't
    reading code. On a Done ticket it also appends "Task Already Complete … close out", which
    contradicts triage's scope. The mechanical layer should pick grounding sections per stage.
- **New in the ideal (flagging, since it isn't in today's text).** Duplicate linking. It's a
  normal triage act, and it's a state or relation change, so it stays within filing.
- **Keep.**
  - Project placement as part of "done" ("Triage is not done while a task sits in the wrong
    project", meta `:300`).
  - Priority via `priorityLevel`.
  - `bug` stays for the ticket's life (LIN-548).
  - Relations, not a `blocked` label (LIN-357).
  - Don't rewrite the reporter's description.
  - Findings framed as leads, not conclusions (LIN-1136), because a research stage that
    inherits "conclusions" from triage tends not to re-check them.
  - Reasoning for each change.

---

## 3. Blocked

### What it's for

Work on this ticket has stalled. Find out what is really in the way and get it moving again.
Clear it yourself when it's yours to clear, and only when it genuinely needs a person, set up the
decision so John can answer it in one reply.

### The ideal version

> {task facts: identifier, title, project, parent, siblings}
> {blocker facts: each blocking ticket with its current state, or "no blocking links recorded"}
>
> Work on {identifier} has stalled. Find out what is really in the way and get it moving again.
>
> First check whether it's still stuck. If what it was waiting on has landed, or the missing
> answer has turned up, say so and say what should happen next. That's the whole job in that
> case.
>
> If it is still stuck, find the real obstacle, not just the symptom someone wrote down. Most
> blockers are yours to clear. If it's a question about how the code should work, settle it by
> asking what's best for the code and the system as a whole, then record your reasoning.
> Missing information can often be found in the code, its history or a related ticket. If it's
> waiting on another ticket, check whether that ticket is actually moving and say what would
> move it. Record any real dependency as a blocked-by link between the tickets, not a label.
>
> Bring it to John only if it genuinely needs a person now: a product or priority call only he
> can make, or something that would be hard to undo. If it does, make it answerable in one
> reply: what's blocked and why, the decision he needs to make, the options with your
> recommendation and what each costs, and what happens if nobody answers.
>
> Leave a comment saying what you found, what you did about it, and what happens next.

### What machines rely on

- **`blocks`/`blocked-by` relations.** `isBlocked` counts only a `blocks` inverse relation from a
  **non-terminal** issue (`lib/tree.js:194-202`). So a link to a finished blocker already stops
  counting, and nothing has to be cleared for routing. The router's Step 2 detects "blocked" from
  this relation, "NOT from a label" (`meta-prompt-template.js:180`).
- **Blocker facts, which code can supply.** The same `inverseRelations` that `isBlocked` reads
  can be rendered as "{id} ({state})" lines. Today's "**First**: Check the current status of all
  blocking dependencies" (`:101`) and meta Step 2's "First check if blocking dependencies are
  already resolved" (`:183`) both make the agent go and fetch something code already has.
- **The hand-back channel is not in this template.** A real park goes out over the runner
  protocol that `attachProxyContext` / the runner prompt append:
  - `[blocked] …` feedback marker (`lib/proxy-instructions.js:955`; read by `lib/run-view.js`,
    `lib/render-session.js`)
  - `[decision] {json}` parsed by `parseDecision` (`lib/session-telemetry.js:674`), with
    `decision_id`, `options[].{id,label,cost}`, `recommended`, `if_unanswered`, `on_answer`
  - `BLOCKED` vs `PENDING-EXTERNAL` (manual `docs/autopilot-operating-manual.md:452-456`;
    `formatIfBlocked`, `prompt-formatters.js:906-924`, which this template does *not* use).

  The brief should describe what goes into a hand-back and leave the format to that appended
  block. Today's text points at the manual for "the ruling shape" instead.
- **The Principle 0 test sentence.** It's composed into the prompt by `extractPrincipleZeroTest()`
  (`lib/prompts/autopilot-manual.js:99-110`), sliced between the anchors
  `'> Does this genuinely require the human'` and `'\n\nBefore you park BLOCKED'`. Nothing parses
  it out of the prompt. It's there so the wording can't drift from the manual (LIN-2973/2977),
  and tests pin its presence (`prompt-templates.test.js:4333ff` and the blocked block at `:421`).
  It's a lesson, not a machine format. If John wants a single source, the mechanical layer can
  keep inserting it verbatim. Otherwise the ideal carries its substance in plain words ("only if
  it genuinely needs a person now", "settle it by asking what's best for the code").
- **In the prompt text:** `formatWorkflow(UNIVERSAL)` → `## Workflow`, `**Start**`,
  `Set {id} status to "In Progress"`, `**Update Linear**`. See the shared notes at the end.
- **Template identity:** key `blocked` and the action `→ **blocked**`. The meta path also emits
  `blocked` as its escalation verb after a second plan-review send-back (meta `:213`), so this
  brief is sometimes a hand-back with nothing to "unblock" mechanically. The "only bring it to
  John if…" paragraph covers that case.

### Rules that tie scope to the ticket

Blocked has no "stay in your slice" rule as such. Its limit is on *action*: the stage is
analysis-only, so it finds the obstacle and writes it down. That's the "seen, written down, and
left" pattern exactly.

| Where | Text |
|---|---|
| `prompt-template-defs.js:99` | "Act as a technical analyst diagnosing work impediments. You have authority to identify blockers, evaluate options, and recommend solutions, but cannot unilaterally make decisions that require stakeholder input." |
| `:103-107` | "If the blocker is still active, analyze: Blocker Type … Root Cause … Options: 2-3 ways to unblock with tradeoffs … Recommendation: Best path forward with rationale" (output is an analysis, never the unblocking) |
| `:78-79` (aiHint) | goal: "Identify the blocker type and root cause, evaluate options to unblock." workflow: "Fetch details → Analyze blocker → Add comment in Linear" |
| `formatWorkflow` UNIVERSAL, `prompt-formatters.js:330-333` | "4. **Update Linear**: Add findings as a comment on {id}" |
| `completion-signals.js:33-40` | coreOutcome "Path forward identified and unblocking can proceed"; readinessCheck "Can work resume based on this analysis?" |

"Decisions that require stakeholder input" is vaguer than the manual's own line, "Escalate only
what a person's preference alone can settle, or what's irreversible" (manual `:449-450`). Read
loosely, "stakeholder input" covers most engineering choices.

### How today's version differs

- **Rule-shaped, should become guidance.**
  - The four-field analysis rubric (Type / Root Cause / Options "2-3" / Recommendation) turns the
    output into a form to fill in. The ideal asks for the real obstacle and keeps the rubric's
    substance only for a genuine hand-back, where the manual's self-sufficient-ruling list (what
    and why, the decision, options with recommendation and cost, cost of doing nothing) is
    exactly right.
  - The Role line becomes "most blockers are yours to clear", which is the positive half of
    Principle 0 handed down to the stage. The paper says the stages currently lack this.
- **Scar tissue or restated elsewhere, could go.**
  - The pointer "apply the manual's **"The human's edge, and how to hand back"**
    (`docs/autopilot-operating-manual.md`, also served at `GET /api/proxy/autopilot/manual`)
    rather than re-deriving it here" (`:111`), followed by the pasted test (`:112`). That's a file
    path, an endpoint and a section title to send a worker to a 36 KB manual it doesn't need. The
    meta rule (`:299`) then mandates all three plus the verbatim sentence ("a bare pointer with no
    test sentence strands the consumer"). Both exist to make a pointer work. A plain brief needs
    no pointer.
  - The "(not a label)" parenthetical is now enforced by the router (`:180`) and `isBlocked`. A
    short "a link, not a label" is enough.
- **Mismatch.** It's a universal-category template, so it also gets the full staleness section.
  That's useful here, since a blocker claim is a claim about the code, so keep it.
- **Keep.**
  - Check status first and stop short if it's already clear (meta `:183`, `:299`). This saves
    whole runs.
  - "Root cause: what's actually preventing progress".
  - Relations, not labels.
  - Name the cost of doing nothing.
  - The Principle 0 gate itself, in substance.

---

## 4. Context

### What it's for

Someone (a person, or an agent picking the ticket up) is coming to this ticket cold. Read its
whole history and tell them where it actually stands: what's done, what still holds, what's been
overturned, and what should happen next, in a comment they can act on without re-reading
everything.

### The ideal version

> {task facts: identifier, title, project, parent with state, siblings and subtasks with states}
>
> Someone is picking up {identifier} after time away and needs to know where it really stands.
> Read the description, the whole comment thread, the related tickets and the code history for
> this work, then write them a comment they can act on without reading everything you read.
>
> Say what's done and how you know. Merged and visible in the code is different from claimed in
> a comment, so say which it is. Say what's left to do, the decisions that shaped the work and
> why, and anything that has since been overturned. Where a later comment contradicts an earlier
> one, the later one is where things stand, however thorough the earlier one looks. If the
> description and the thread disagree, or the code no longer matches what the ticket says, point
> it out. If the history suggests the real problem lies outside this ticket (the same failure
> coming back, or a fix that didn't hold), say that plainly.
>
> End with what should happen next and why.
>
> This is a reading pass. The comment is the only thing you change.

### What machines rely on

- **Nothing in its output is parsed.** The comment is for people and the next router pass.
- **In the prompt text:** `formatReadOnlyWorkflow` (`prompt-formatters.js:371-381`):
  `## Workflow`, `1. **Fetch details**`, `2. **Analyze**`, `3. **Update Linear**: Add findings as
  a comment on {id}`. On a read-only provider `gateWorkflowWrites` drops step 3
  (`/\*\*(Start|Commit|Complete|Update[^*]*)\*\*/`), which leaves the brief with no instruction
  about where to put its output. The mechanical layer should switch "leave a comment" to "report
  back to the user" when `caps.write` is false, the way the meta path does
  (`meta-prompt-template.js:248-251`).
- **`**Subtasks:**` multi-line block** (`formatMultiLineSection('Subtasks', …)`, `:819`). This is
  read by `stripSubtaskSections` (`prompt-formatters.js:1065-1088`) via
  `/^\*\*(Existing Subtasks|Subtasks):\*\*$/`. See the latent bug in the shared notes.
- **Template identity:** key `context` and the action `→ **context**`. It's in the meta action
  vocabulary because it has an aiHint, but there's **no quality rule** for it at `:297-311`, so
  on the meta path the writing model has only the aiHint (`:792-796`) and the completion signal.

### Rules that tie scope to the ticket

| Where | Text |
|---|---|
| `prompt-template-defs.js:814` | "Act as a project historian synthesizing task state. Your role is to inform and summarize, not to make changes or decisions." |

"Not to make changes" is a real edge. This is a reading pass, and the ideal keeps it as "the
comment is the only thing you change". "Or decisions" undersells the job, though: a good
handover says where the real problem is, even when that's outside the ticket. Today's prompt
has no room for that. It summarises the ticket's frame (Current State / Completed / Remaining /
Key Decisions / Next Steps).

### How today's version differs

- **Rule-shaped, should become guidance.** The two bullet lists ("Gather context from: …",
  "Summarize: Current State / Completed / Remaining / Key Decisions / Next Steps", `:818-828`)
  are a form. Its five headings are also the completion signal's five signals
  (`completion-signals.js:142-147`), so the form ends up graded against itself. The ideal asks
  for the same content in prose and adds the two things that make a handover trustworthy:
  - observed vs claimed. On 3 October a merged, tested fix didn't change production, and the
    autopilot's own close-out was "an inference, not an observation".
  - latest-word-wins.
- **Missing today, worth bringing in.**
  - The divergence lesson the router already learned: "weigh the trail by what still STANDS at
    the end, never by the length or authority of the earliest analysis"
    (`meta-prompt-template.js:186`). A context summary that leads with the long early analysis
    misleads the next agent in exactly the way that veto prevents.
  - Description-vs-thread lag. The "Comments vs Description" convention (meta `:327-332`) means
    the description often trails the thread.
- **Mismatch.** The role says no changes, but the workflow's step 3 writes a comment. The ideal
  says which one is allowed.
- **Keep.**
  - Shortness. It's already the leanest of the four.
  - Read-only.
  - Git history as a source.
  - Next steps.
  - The staleness section that `appendGroundingSections` adds, which is directly useful here.

---

## Shared: what the code relies on in the text of all four prompts

These matter whoever writes the brief, because code post-processes the rendered string. If the
writing layer produces free prose, the mechanical layer must either keep emitting these exact
shapes or the post-passes must move to structured data.

- **`applyPromptCapabilities`** (`lib/prompt-formatters.js:1102-1114`):
  - `gateWorkflowWrites` (`:993-1023`): section start `/^##\s+Workflow\b/`. Write step:
    `/\*\*(Start|Commit|Complete|Update[^*]*)\*\*/` or `/\bSet\b[^\n]*status to/i`. Any `## `
    heading ends the section.
  - `shapeWorkflowStateWording` (`:1046-1056`): `/status to "([^"]+)"/` with the literals
    `"In Progress"` → `started` and `"Done"` → `completed`.
  - `stripSubtaskSections` (`:1065-1088`): `/^\*\*Subtasks:\*\* /`, `/^\*\*Frontier facts:\*\* /`,
    `/^\*\*(Existing Subtasks|Subtasks):\*\*$/`. **The section runs to the next blank line.**
  - Tracker rename `/\bLinear\b/g` → `displayName`. Then `' in ' + displayName` is stripped when
    `includeTracker` is false.
- **`appendGroundingSections`** (`:787-793`) appends `## Re-ground the Ticket (staleness check)`,
  `## Task Already Complete (state: …)`, `## All Subtasks Complete — Close Out the Parent` and
  `## Prior Investigation On Record — Don't Loop` to *every* template, both paths. For triage,
  the staleness and "close out" notes are wrong for the stage. Grounding should be chosen per
  stage by the mechanical layer.
- **Meta path:** the writing model's output is cut by `/## Reasoning\n([\s\S]*?)(?=\n## Prompt|$)/`
  and `/## Prompt\n([\s\S]*?)$/`, and the action by `/→\s*\*\*(.+?)\*\*/`
  (`lib/openrouter.js:1677`, `:1721-1722`). The aiHint `situation/goal/workflow` strings are
  rendered verbatim into the meta-prompt by `formatAIHintsForMetaPrompt`
  (`lib/prompt-templates.js:472-493`). Breakdown's aiHint has grown into a second copy of its
  quality rule.
- **Latent bug found while reading (not live).** Every template builds its lines with
  `.filter(Boolean)`, which also removes the `''` spacer lines. So a rendered `**Subtasks:**` /
  `**Existing Subtasks:**` block is never followed by a blank line, and `stripSubtaskSections`
  deletes everything up to the next blank line. With a `subtasks: false` provider and a non-empty
  `children`, the context template loses its whole `## Goal`. I reproduced this with
  `generatePrompt('context', …, { subtasks: false, displayName: 'GitHub' })`. It isn't reachable
  today because the GitHub providers return no hierarchy (`lib/providers/github/index.js:256`,
  `github-projects/index.js:229`). Any rewrite that keeps that post-pass needs a blank line after
  the block, or a structural strip.
- **Tests that pin wording rather than purpose** (they'll need to follow the new prose):
  - `tests/unit/prompt-templates.test.js`: `describe('blocked template')` `:421`, triage `:1446`
    (including the scope regexes `/preserves? scope/`, `/rewrite the task's description/`,
    `/follow-up tasks or subtasks/` at `:1520-1542`), context `:1650`, breakdown LIN-3049 `:4814ff`
    (including the (a)–(e) order and exact aiHint sentences).
  - `tests/unit/openrouter.test.js:3318` pins "the parent plan is the source of truth; do not
    redesign".
  - The rendered meta-prompt baseline `scripts/eval/meta-prompt.baseline.txt`
    (`rulings-resolution-contract-drift.test.js`).
  - The byte ceilings in `tests/unit/prompt-size-budget.test.js`. The ideal versions above are
    all shorter than today's, so the ceilings only help.
