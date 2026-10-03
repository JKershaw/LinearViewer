# plan, plan-review, design: from rules to briefs

Sources read: `lib/prompt-template-defs.js` (plan L172-329, design L691-744, plan-review L835-917),
`lib/prompt-formatters.js` (every formatter these three call, plus the post-passes
`appendGroundingSections`, `formatAttachmentsSection` and `applyPromptCapabilities`),
`lib/prompt-templates.js` `generatePrompt()` (L248-302), `lib/prompts/meta-prompt-template.js`
(Step 3 routing L190-218, quality rules L303 Plan and L305 Plan-review; **design has no quality
rule**), `lib/completion-signals.js`, and the code that reads their output (cited inline).
Line numbers are from the working tree on 2026-10-03.

Rendered sizes on a bare test issue, handwritten path, all post-passes applied:

| template | bytes | words | of which grounding/attachments tail |
|---|---|---|---|
| plan | 15,105 | 2,505 | staleness check (~110 words) |
| plan-review | 7,626 | 1,276 | staleness check |
| design | 1,902 | 292 | staleness check |

The ideal briefs below come to about 560, 380 and 260 words (including the placeholders).

---

## 0. Things worth knowing before the per-template sections

These cut across all three templates and affect how the two layers split.

1. **`plan` gets a "push and open a PR" block it should never see.** `generatePrompt()` appends
   `formatGitWorkflow()` ("Create a feature branch… Push the branch and create a pull request")
   whenever `featureFlags.featureBranches === true && template.category === PROMPT_CATEGORIES.READY`
   (`lib/prompt-templates.js:273`). `plan` is the only `READY` template (`prompt-template-defs.js:174`).
   So with that toggle on, a plan prompt whose Role says "do not implement code changes" ends with
   instructions to branch, commit and open a PR. I confirmed this by rendering it. The toggle is off
   by default (`lib/feature-defaults.js:56`). The comment at `prompt-formatters.js:347-349` already calls
   the `READY` workflow branch dead; the git append is the other half of that leftover.
2. **The `### Plan Review Verdict` header: the comments say it is optional, but `breakdown` depends on it.**
   `prompt-template-defs.js:903-911` says the header is "never a required format anything keys on…
   a missing header degrades nothing". But the `breakdown` template tells its agent to look for
   "a `### Plan Review Verdict` of **Approve**" before copying plan slices into subtasks
   (`prompt-template-defs.js:446,447,480`; meta-prompt L304). No code reads the header (grep finds no
   reader outside prompt text), but a later stage's model does depend on it. Code should append it
   every time, not leave it to the writer.
3. **`## Implementation Plan` is read by code but no template asks for it.** `lib/file-pointer.js:150`
   (`/^##[ \t]+Implementation Plan\b[^\n]*$/gm`, last match wins) parses it to build the
   implementation file-pointer, and `lib/follow-on-ratio.js:149` uses it as a plan marker. Close-out
   is told to keep it verbatim (meta L309; `autopilot-kickoff.js:581`). The plan template never tells
   the agent to write that heading, so the pointer only works when a planner happens to use it.
   The mechanical layer should require it.
4. **Design has no meta-prompt quality rule.** On the AI path a design prompt is written from the
   `aiHint` (L696-702) and the generic Prompt Structure alone. The handwritten template is also thin
   (292 words). It is the one template here where the brief needs to add guidance, not cut it.
5. **The workflow block is read by machines in both paths.** `applyPromptCapabilities`
   (`prompt-formatters.js:1102`) rewrites the rendered text for non-Linear providers using regexes
   over `## Workflow`, `**Start**`/`**Update…**`, `status to "…"`, `**Subtasks:**`, `in Linear`
   (details in each section 3). In the two-layer design the mechanical layer should own the whole
   workflow/write-back block, so the writer never produces text those regexes must match.
6. **Some descriptive metadata still uses the old shape.** `plan-review`'s `description`
   (L847), `aiHint.goal/workflow` (L851-852) and `COMPLETION_SIGNALS['plan-review']`
   (`completion-signals.js:151-163`, "were all seven of the plan's grounding claims re-run") all
   describe the seven-check form. The meta-prompt feeds aiHints and completion signals to the
   recommender, so changing the brief without changing these leaves the recommender judging
   "done" against the old checklist. The same applies to `COMPLETION_SIGNALS['plan']` and the
   plan aiHint (L177-181).
7. **Tests pin the wording.** `tests/unit/prompt-templates.test.js` (~129 matching lines) and
   `tests/unit/openrouter.test.js` (~45) pin the plan/plan-review prose on both paths. They will have
   to follow the rewrite.

---

## PLAN

### 1. What it's for

Work out how this change should be made, where it reaches, and in what order, so it can be built
in one go (or split along real seams), and so a reviewer can check the reasoning before code is
written.

### 2. The ideal brief

> You're planning {task: identifier, title}. {relational facts: project, parent, siblings, subtasks}
> Don't change code in this step. The plan is what the build works from and what a reviewer checks.
>
> Start from what's already known. Read the task, its discussion and any research on it first. They
> are the source of truth and may have moved on since this brief was written. The plan adds to the
> research instead of repeating it. Say what you'd build, in what order and how you'll test it, and
> where you disagree with the research and why. Cite the findings you rely on (comment, file:line or
> sha) instead of restating them.
>
> Plan the fix for the problem, not for the ticket's wording. If the symptom comes from a cause
> somewhere else, plan the fix there. If the cleanest route is to refactor first, plan the refactor
> ahead of the change it simplifies. Just don't build a seam that nothing will call. Workarounds
> such as a special case, a second copy of something already modelled, or a branch per runtime make
> every later change cost more, so prefer closing a gap to routing around it. Engineering choices are
> yours. The exceptions are changes {owner} would want to hear about first: product behaviour, a
> published contract, stored data, or another repo's interface. If the right fix needs one of those,
> plan it anyway and put the question to {owner} plainly in the plan. Don't quietly plan around it.
>
> Before you commit to the list of places the change touches, check it's complete. The same
> behaviour is often implemented twice, under another name, or split between server and client, so
> search for the behaviour, not just the symbol the ticket names. Where the change has to hold across
> a whole set (every caller, every provider, every template), show how you know you've found them all:
> the query you ran, its output and the commit you ran it at, or the reasoning. The reviewer will
> re-run that, so it matters more than the list. If the set can't be searched because the code doesn't
> exist yet or the members live in production data, say so and say what you did instead. An honest
> "I couldn't sweep this, and here's why" beats a sweep that looks complete and isn't.
>
> Read the recent history of the files you'll touch. A spot that keeps getting patched usually hides
> a constraint the code doesn't show, or a cause that keeps being worked around. Either belongs in
> the plan.
>
> Size the plan to the work. A one-file change needs a few lines. Then say whether it can be done well
> in one sitting. If you can name specific things you'd expect to lose track of in one pass, it can't,
> and the plan should split along its natural seams and show what depends on what.
>
> Ask for a second look before the build when it's worth it: the work needs several sittings, it
> leaves a known problem in place, it loosens a check, validation or guard, or it touches
> credentials, merge rules or the dispatch contract. Otherwise it goes straight to implementation.
>
> {if a plan-review verdict exists: A review has already read an earlier version of this plan:
> {pointer to verdict comment}. This pass revises that plan rather than starting over. Answer every
> finding, either by folding it in or by explaining why you disagree, and replace the old plan in the
> description instead of adding a second one beside it. Add one line saying what changed. Make it
> count: if the same findings come back again, the task goes to {owner}.}
>
> {if attachments: look at every attachment, images included, before relying on the task text. If one
> you need can't be read, stop and say which one.}
>
> If something blocks you, try to resolve it yourself first. Only a decision that needs a person goes
> to {owner}, as one clear question.
>
> Write the plan into the task description.
>
> {mechanical tail — see section 3}

### 3. What machines rely on

All of these go in the **description** (not a comment). Code that reads them scopes its read to the
description on purpose (`follow-on-ratio.js` limit 7 at L76-98; `plan-review-round-trips.js` limit 3
at L121-124).

| string | read by | how strict |
|---|---|---|
| `fits one session` / `needs multiple sessions` | `lib/recommendation-facts.js:49-50` `extractSessionFit`: `/needs?\s+multiple\s+sessions/i` checked first, then `/fits?\s+(?:in\s+)?one\s+(?:focused\s+)?session/i`; feeds the meta-prompt FRONTIER FACTS line (meta L101). `lib/follow-on-ratio.js:149` `PLAN_MARKER`. Recommender routing reads it as a model (meta L198-218: "fits one session" → `implementation`, "needs multiple sessions" → `breakdown`). Close-out must keep it word for word (meta L309). | code regex, **multiple-sessions wins if both appear**, so the plan must not use the other phrase in prose |
| `plan-review due: yes` / `plan-review due: no` | `lib/plan-review-round-trips.js:168` `GATE_DUE_MARKER = /plan-review due:\s*yes/i` (→ `effort-readout.js`, `render-effort-readout.js:58-60`). Recommender gate (meta L206: "the plan says so itself ('plan-review due: yes'…)", and a plan's own "no" "is taken at face value"). | code regex on `yes`; model reads both |
| `## Implementation Plan` heading (prefix match; suffixes allowed) | `lib/file-pointer.js:150` `/^##[ \t]+Implementation Plan\b[^\n]*$/gm`, **last** match wins, section ends at the next `## `. `lib/follow-on-ratio.js:149` `/#{1,4}\s*implementation plan\b/i`. Close-out must keep it (meta L309). | code regex. **Not currently mandated by the template** (see §0.3) |
| file paths inside that section | `lib/file-pointer.js` `extractPlanPaths`: repo-relative tokens with an extension; `:line` suffixes stripped | code; any repo-relative path with an extension works |
| Revision line, e.g. `Revision 2 — addresses plan-review findings F1–F3: …` (L259) | no code reader. `breakdown` cites "rev <N>" from it (L492; meta L304) | model only; a stable `Revision N` token helps breakdown |
| Class / bound / members recorded in the description (L289) | plan-review (model) and review's inside/outside marking (meta L308 (5a)) | model only, no fixed format |
| Plan-review gate criteria text "(a)–(d)" / "none of (a)–(d)" (L321) | nothing parses the letters; the recommender re-reads the criteria itself (meta L206) | model only, can become prose |
| Template `name: 'plan'` = key | `deriveDispatchKind` via `_DISPATCH_KIND_BY_ALIAS` (`prompt-templates.js:198-231`) | code |

Prompt-side strings the provider post-pass parses (`prompt-formatters.js`), all present in today's
hand-rolled plan workflow (L186-192):

- `^##\s+Workflow\b`: the section `gateWorkflowWrites` scans (L993-1021).
- Step labels matching `/\*\*(Start|Commit|Complete|Update[^*]*)\*\*/` or `/\bSet\b[^\n]*status to/i`
  are dropped for read-only providers. Plan uses `**Start**` and `**Update description**`.
- `/status to "([^"]+)"/g`, where `"In Progress"` is rewritten for `fixedStates` providers (L1046-1057).
- `**Subtasks:**` (summary line), `**Frontier facts:**`, and the `**Subtasks:**` multi-line header
  are stripped when the provider has no subtasks (L1065-1090). Emitted by `formatSubtaskSummary`
  and `formatMultiLineSection('Subtasks', …)`.
- `\bLinear\b` is renamed and ` in Linear` stripped (L1106-1111).
- `formatIfBlocked` (L906) carries the shared `BLOCKED` / `PENDING-EXTERNAL` vocabulary. That belongs
  to the runner protocol, so append it by code and keep it out of the brief.

**What the mechanical tail should append to the plan brief** (exact text is for the implementer to
choose; these are the contracts):

```
Record in the description, under a heading that starts `## Implementation Plan`:
- the plan itself, naming the files it touches by repo-relative path;
- exactly one of: `fits one session` / `needs multiple sessions`;
- exactly one of: `plan-review due: yes` / `plan-review due: no`, with the reason in a few words;
- on a revision, one line `Revision N — <what changed and which findings it answers>`,
  replacing the previous plan block (POST /api/proxy/issues/{id}/description/replace) rather than
  adding a second block.
```

### 4. Rules that tie scope to the ticket

| line | quote | effect |
|---|---|---|
| L227 | "A refactor with no consumer in this task, or one that taxes bystander consumers for this feature's need, does not become a subtask: fold it inline, scope it down, or record it as a note." | A refactor counts only if *this ticket* uses it; otherwise it becomes "a note". |
| L227 | "If a Surface Assessment in prior research comments declares `refactor required` and names the line in this task that consumes it…" | Same consumer test, applied to research's verdict. |
| L269 | "*Cost of doing:* current-ticket session size, blast radius, risk to high-churn files." | Cost is measured against the ticket's session, not against the problem. |
| L269/L271 | "if a strategy routes around a root contract gap already tracked as a future ticket, name the ticket…" / "**NAME the routed-around contract gap** with a ticket identifier (or \"none identified\") — a bare description is not enough" | Makes routing around a known cause legitimate once it has a ticket number (the essay's "[7:271]"). |
| L273 | "For migration / convergence / pre-launch parent epics, default to closing the contract gap unless cost-of-doing is prohibitively higher." | Closing the gap is the default **only** for those epics. Everywhere else the cheap route is implicitly allowed. |
| L255 | "fold in a missed surface or mark it out-of-scope with a named ticket identifier, name the routed-around gap's ticket identifier" | In a revision, filing a ticket is enough to answer a finding. |
| L287 | "List every instance you find and mark each in- or out-of-scope." | Out-of-scope is a free choice with no test of whether the instance is part of the cause. |
| L289 | "map every member research found to in- or out-of-scope" | Same. |
| L299-303 | "If you can name them specifically, the answer is \"needs multiple sessions.\"" | Pushes towards slicing. Any nameable edge triggers a split, and breakdown then hands each slice "do not redesign" (L494). Not a minimal-fix rule, but it produces thin slices. |
| L323 | "do not volunteer it for a plan that meets none of the criteria" | Fine as a throughput guard. Listed only because it reads as a rule. |
| meta L303 | the same three sources (consumer test, "NAME that gap explicitly (ticket identifier or \"none identified\")", "for migration / convergence / pre-launch parent epics, default to closing the gap") | Both paths carry it. |

### 5. How today's version differs

**Rule-shaped, should become guidance**
- *Strategy Framing* (L264-277): a scoring rubric on two axes, with a mandated identifier format and an
  ordering that is "non-negotiable" (meta L303). The kernel worth keeping is that workarounds make
  every later change cost more, so prefer closing the gap. The ideal says that in one sentence and
  turns "route around and name the ticket" into "fix it, or ask {owner} if the fix is one of the
  large kinds".
- *Class bounding* (L287-293, about 600 words; meta L303 repeats it at greater length): two
  sub-rules, two named shapes, a "test for any third shape", and a warning not to fill the slot. The
  lesson is real (LIN-1871: plans went round plan-review member by member, and the bound is what
  converges). It fits in three sentences: search for the behaviour, show how you know the list is
  complete, and say so honestly when it can't be swept.
- *Plan-review gate* (L312-323): lettered criteria (a)-(d) plus a recording format. The criteria
  become one sentence of when a second look is worth it. The `plan-review due:` line moves to the
  mechanical tail.
- *Session-fit* (L281, L299-303): a mini-procedure ("name 2–3 concrete catches"). It becomes one
  sentence, and the phrase moves to the tail.
- *Workflow* (L186-192): five numbered steps, two of them tracker writes. This belongs in the
  mechanical layer.

**Scar tissue or stated elsewhere, can go**
- The *Revising After a Plan Review* section (L251-259, about 330 words) explains the header's
  status, the description-replace endpoint, the one-cycle bound and the changelog format. The
  recommender already enforces the bound (meta L210-213). The endpoint and format go in the tail. The
  brief keeps three sentences, shown only when a verdict exists (today it is always shown and the
  agent is told to skip it).
- The `formatScaleToTask` paragraph (`prompt-formatters.js:898-901`) exists because "a trailing 'keep
  it brief' loses to the scaffold's gravity". Without the scaffold, one sentence ("Size the plan to
  the work") is enough.
- `formatAttachmentPerceptionCheck` (three numbered steps, about 150 words) duplicates the
  attachments section `formatAttachmentsSection` already appends. Keep one conditional sentence, and
  let the mechanical layer add the relay instructions.
- `formatIfBlocked` repeats the Principle 0 manual. One sentence in the brief, with the protocol
  vocabulary appended by code.
- The meta-prompt Plan rule (L303, about 1,900 words) is a third restatement of all of the above.
  In the two-layer design the writer gets the same rules bundle as everything else and does not need
  a second copy written as "the prompt must instruct…".
- The `featureBranches` git workflow append (see §0.1) should be removed.

**What today gets right and the ideal must keep**
- "State what it adds, and cite the rest" (L218, LIN-3202). The plan is an addition, not a copy.
- Search for the *concept*, not the symbol. A clean grep for the cited name is not proof of
  completeness (L287).
- Show the bound so the reviewer re-runs it instead of hunting members one at a time, and the honest
  "no sweep, here's why" (L289-293).
- The history signal (L283), now also read as a sign of a cause that keeps being patched around.
- Workarounds cost every later change (L269).
- Revise, don't restart. Answer every finding, disagree with reasons, replace the plan instead of
  stacking a second one (L255-259).
- Plan-review is gated, not universal (L323): don't spend a second pass on plans that don't need one.
- Don't build seams nothing will call. This is the real lesson behind the consumer test (LIN-397,
  `31aa1ab1`). The ideal keeps the lesson and drops "in this task".
- Scale down for small work, but don't read "small" from a terse ticket. The ideal's "size the plan
  to the work" relies on the completeness paragraph to prevent under-planning a rename that fans out.

---

## PLAN-REVIEW

### 1. What it's for

A second developer reads the plan with fresh eyes before anyone builds it. Will it actually solve
the problem, at its cause, without breaking anything? And do its claims hold up when re-run?

### 2. The ideal brief

> A plan for {task: identifier, title} is written and about to be built. {relational facts} Read it
> with fresh eyes, check it, and say whether it should go ahead.
>
> You're the colleague who checks a plan before the build, not a second planner. The question is
> whether this plan will solve the problem at its cause without breaking something, and whether its
> claims hold up. Preference isn't a finding: if you'd have done it differently but their way also
> works, let it go. If the plan fixes a symptom while the cause sits somewhere it didn't look, or
> works around a problem it could reasonably fix, that *is* a finding. Saying what the right fix is
> counts as review, not redesign.
>
> Don't take the plan's word for anything you can check. Re-run what it ran: its searches at the
> commit it names, the history of the files it touches, its claim that the list of affected places is
> complete. If you find a place it missed, don't stop at that one. Work out what kind of place it is,
> how you'd find all of them, and report the whole set, so the next round doesn't turn up another.
> If you think the plan drew a boundary wrongly, propose yours and show what it finds. If the plan
> says a set can't be searched, check the reason it gives, not just that it gave one.
>
> Look hard at anything the plan loosens, such as a check dropped, an input widened or a gate made
> advisory, and make sure it says what keeps that safe. Look at where it gets its facts. If it relies
> on a copy or summary when the original is right there, name the original. If it says the work
> fits one sitting but names specific things that would be easy to lose track of, say so.
>
> A plan that holds up gets a one-line approval and goes straight on. Clean passes are common, so
> don't manufacture doubt. Otherwise say exactly what must change and why, so the planner can deal
> with it in one pass. Anything you find goes in your verdict for the planner, not into a new ticket.
>
> Record your findings as a comment. Don't edit the plan or start building, because the planner owns
> the plan.
>
> {if attachments: look at every attachment, images included, before judging the plan against it.}
>
> {mechanical tail — see section 3}

### 3. What machines rely on

| string | read by | how strict |
|---|---|---|
| verdict words `Approve` / `Request Changes` / `Needs Discussion` | `lib/plan-review-round-trips.js:167` `VERDICT_TOKEN = /\b(approve\|request changes\|needs discussion)\b/i`, found by `extractVerdict` (L268-277): **anchored on every `/verdict/gi` match, in document order, window `[-80, +120)` chars around it; the first anchor whose window holds a token wins; no unanchored fallback**. Comments are read one at a time and the most recent resolving comment in the dispatch window wins (L60-75). The recommender routes on it (meta L210-213: Approve → session-fit route; first Request Changes/Needs Discussion → `plan`; **second** → `blocked`). The plan revision pass looks for it (L253). | code regex **plus a proximity rule**: the word "verdict" must sit within 80 chars before or 120 after the token. A finding that mentions "approve" near the header can be misread. |
| `### Plan Review Verdict` (comment header) | No code reader. Read as a model by: `breakdown` precondition (L446-447, L480; meta L304, "check … for a `### Plan Review Verdict` of Approve"); close-out exclusion (meta L147, L194: a plan-review Approve is never review evidence); plan revision (L253). | model-read, but **load-bearing for breakdown** despite the "degrades nothing" comment at L903-911 |
| verdict delivered as an **issue comment** | tier A of the round-trip instrument reads issue comments in the row's window (`plan-review-round-trips.js:60-80`); breakdown cites "comment <id>" (L492) | code (location) |
| `DONE:` feedback line containing a verdict | tier B of the same extractor (`DONE_LINE = /^\s*DONE:/i`, L169) | code. Comes from the runner protocol, not this template. |
| template `name: 'plan-review'` must equal its key | `parseRecommendedAction` → `_DISPATCH_KIND_BY_ALIAS` (comment at L835-843; `prompt-templates.js:198-231`) | code |
| workflow block from `formatReadOnlyWorkflow` (`prompt-formatters.js:371-379`): `## Workflow`, `**Update Linear**: Add findings as a comment on {id}` | `gateWorkflowWrites` drops the `**Update…**` step for read-only providers; `in Linear` / `Linear` rename | code |
| `**Subtasks:**` multi-line section (L867) | `stripSubtaskSections` | code |
| "claims verified; proceed to implementation" (L895) | nothing | free text, can go |

**What the mechanical tail should append** (the header and verdict line come first, so the anchor
window can't pick up a token from a finding):

```
Post one comment that starts:

### Plan Review Verdict
**Verdict:** Approve | Request Changes | Needs Discussion — <one line why>

followed by your findings. A plan-review Approve authorizes implementation only; it is not a
review of built work.
```

The last sentence keeps the plan-review/review distinction the close-out gate needs (L912).
It is a fact about the pipeline, so code should carry it rather than the brief.

### 4. Rules that tie scope to the ticket

| line | quote | effect |
|---|---|---|
| L873 | "You have authority to verify, **not** to redesign: check the plan against its own claims and do not add requirements of your own. Plan-review must not become a second planner — a different-but-also-reasonable approach is not a finding." | The reviewer can only check the plan's own slice. "This fixes the symptom; the cause is over there" counts as redesign. The essay quotes it ([8:305]); `review-loops.md` found that of 83 send-backs out of 94 plans, none asked for a different design. |
| L875 | "Every check below re-runs a claim the plan already makes; where the plan makes no such claim, that absence is itself the finding." | The review is scoped to the plan's claims, not to the problem. |
| L881 | "each must be folded in, or explicitly marked out-of-scope with a named ticket identifier" | A ticket number answers a missed class. |
| L884 | "the plan must name it with a ticket identifier, or state an explicit \"none identified\". A bare description of the gap is not enough" | Check 2 checks the *label* on a workaround, not whether the workaround should exist. A plan that routes around the cause passes if the cause has a ticket. |
| L887 | "A loosening is acceptable only where the plan names the adversarial follow-up that re-tightens or bounds it" | A follow-up ticket makes a loosening acceptable. |
| L888 | "A refactor the plan sequences as a separate blocking subtask must name the line in *this* task that consumes it; one with no in-task consumer does not earn a subtask." | The consumer test again, now as a reason to send a plan back. |
| L899 | "You do NOT edit the plan, do NOT implement any part of it, and do NOT file follow-up tickets." | Role separation. Fine, and the ideal keeps it. Not filing tickets is good: findings go to the planner. |
| meta L305 | "with authority to VERIFY and NOT to redesign … never become a second planner — a different-but-also-reasonable approach is not a finding" | Same on the AI path. |

### 5. How today's version differs

**Rule-shaped, should become guidance**
- *The Seven Checks* (L877-889), "Work through all seven, in order", one per plan-template rule, is
  the plan template mirrored as an audit checklist. Each check confirms the plan followed a
  plan-template rule (named the gap's ticket, ran `git log --oneline -15`, named 2–3 catches, named the
  consumer line). The ideal keeps the substance of checks 1, 3, 4, 5 and 7 as things a careful
  reviewer looks at. It drops check 2 (confirming a ticket number) and check 6 (the consumer test) as
  separate items, because those are now covered by the one question that matters: is this fixing
  the cause?
- The verdict format and "cite the check that produced each finding" (L893) move to the mechanical
  tail, without check numbers.

**Scar tissue or stated elsewhere, can go**
- The LIN-1871 aside in check 1 ("which is how four tickets each burned 4+ sessions…", L882) is
  history. The lesson ("argue the bound, report the whole class") stays.
- The paragraph explaining why the header exists (L912) is pipeline plumbing. One sentence goes to
  the mechanical tail.
- "Hand Off to Implementation" (L897-899) tells the agent the routing that the recommender does
  anyway (meta L210-213). One sentence ("the planner owns the plan") is enough.
- The meta-prompt Plan-review rule (L305, about 1,100 words) restates the template line by line.
- The `description`, `aiHint` and `COMPLETION_SIGNALS['plan-review']` text that encodes "seven
  checks" (see §0.6).

**What today gets right and the ideal must keep**
- Fresh context, and reproduce instead of trusting ("do not accept the plan's word for a result you
  can reproduce yourself", L879).
- Preference isn't a finding. "a different-but-also-reasonable approach is not a finding" is the
  right half of L873. Keep it, and add the other half: a plan aimed at the wrong place *is* a
  finding.
- Argue the class, not the member, and argue the bound when you disagree (L881-882). This is the
  thing that actually makes the loop converge.
- Check the *reason* for an un-sweepable claim (L883).
- The relaxation guard (L887): loosening a guard is a real risk worth a hard look.
- Source-of-truth re-grounding (L889): copies and summaries are lossy. A rare, valuable check.
- Cheap when clean (L895): "Do not manufacture doubt about a well-grounded plan."
- Write-only: don't edit the plan, don't build, don't file tickets (L899).

---

## DESIGN

### 1. What it's for

There is more than one sensible way to solve this and nobody has picked one. Weigh the real options
against the actual problem, choose, and explain the choice well enough that a plan can be written
from it without reopening it.

### 2. The ideal brief

> {task: identifier, title} has more than one reasonable shape, and nobody has chosen one yet.
> {relational facts: project, parent, related tasks, existing subtasks} Choose one, and explain it well
> enough that a plan can be written from it.
>
> Start from the problem, not from any solution the ticket proposes. What is actually causing the need,
> and what would a good outcome look like for the code and for the people who use it? Then lay out the
> shapes that are genuinely viable, usually two or three. If there's honestly only one, say so and
> hand on to planning. For each, say how it works, what it would cost to build and to live with, what
> it risks, and how it fits what's already there. Reusing or extending something that exists usually
> beats adding a second way of doing the same thing. If fixing an underlying cause or refactoring is
> the real option, put it on the table even when the ticket asked for something narrower.
>
> Recommend one, say why, and say what would change your mind. Engineering choices are yours. If the
> best shape changes product behaviour, a published contract, stored data or another repo's
> interface, recommend it anyway and put that choice to {owner} as one clear question.
>
> {if attachments: look at every attachment, images included, before weighing the options.}
>
> Post the full comparison as a comment. Put the chosen approach and its key implementation points in
> the description, so the next step plans it instead of reopening the choice.
>
> {mechanical tail — see section 3}

### 3. What machines rely on

No code parses design output. Grep finds no reader of a design heading or verdict. What matters
mechanically:

| string / behaviour | read by | how strict |
|---|---|---|
| `## Workflow` with `**Start**: Set {id} status to "In Progress"…` and `**Update Linear**: …` (L707-712) | `gateWorkflowWrites`, `shapeWorkflowStateWording`, `in Linear` stripping (`prompt-formatters.js:993-1111`) | code |
| `**Existing Subtasks:**` multi-line section (L719) | `stripSubtaskSections` (`prompt-formatters.js:1076`, `/^\*\*(Existing Subtasks\|Subtasks):\*\*$/`) | code |
| template `name: 'design'` = key | `deriveDispatchKind` | code |
| chosen approach recorded in the **description** | the recommender's design hatch reads "the ticket or a comment has already committed to an approach" to stop re-firing `design` and route to `plan` (meta L196, guard (c)) | model only. A stable heading (for example `## Design Decision`) would make this reliable. No such contract exists today, so adding one is optional. |
| `aiHint.whenNot` / `chooseOver` (L700-701) | fed to the recommender's Action Types Reference | routing metadata, not part of the brief |

**Mechanical tail:** the workflow (start status, fetch, comment + description write) and, if adopted,
the decision heading. Nothing else.

### 4. Rules that tie scope to the ticket

The template itself has few scope rules (it has few rules of any kind). The ones that bear on scope:

| line | quote | effect |
|---|---|---|
| L725 | "major architectural decisions may require stakeholder sign-off" | Not minimal-fix, but a vague escalation. It tells the agent neither what is its own call nor what goes to {owner}. The ideal replaces it with the specific "large" list. |
| L727 | "Evaluate 2-3 design approaches" | Produces a formula. The agent invents a third option or compares only the ticket's proposals. It never asks whether the problem sits upstream of all of them. |
| meta L196, guard (c) | "the ticket or a comment has already committed to an approach … a decided shape is a `plan`, never a `design`" | **The strongest scope tie for design.** If the ticket names its fix in advance (the essay §6 records Flight Companion tickets doing this), design never fires, and the ticket's chosen fix is never weighed against the cause. |
| L700 `whenNot` | "the shape is already decided (a committed approach in the ticket/comments, …) — that is `plan`" | Same, on the handwritten path's routing hint. |

### 5. How today's version differs

**Rule-shaped, should become guidance**
- "For each approach, document: High-level architecture / Pros and cons / Implementation complexity /
  Risk factors" (L729-733) is a form to fill. The ideal asks the same questions in prose and adds the
  missing ones: what's the cause, and does it reuse what exists?
- The **Output** block (L737-739) and the four-step Workflow (L707-712) move to the mechanical layer.

**Missing today (the ideal adds)**
- Any pointer to the *problem* or its cause. Today's design weighs solutions only.
- Reuse versus a second representation (research's Surface Assessment has this, meta L302; design
  doesn't).
- "What would change your mind". This makes the decision checkable later.
- A specific escalation boundary in place of "may require stakeholder sign-off".
- Permission to say "there's only one real shape" and hand on, instead of padding to 2-3.
- A meta-prompt quality rule (there is none). In the two-layer design the writer gets this brief's
  intent from the rules bundle like every other template.

**What today gets right and the ideal must keep**
- Several approaches with honest trade-offs, and one clear recommendation with a rationale (L727,
  L735).
- The comment/description split (L738-739): full analysis in a comment, the decision in the
  description. This keeps the description the single source of truth and lets the recommender see a
  committed shape.
- It's short. Design is the one template here that is under-specified rather than over-specified.
  The ideal adds about 100 words of intent, not rules.

---

## Cross-template notes for the two-layer split

- **Shared lessons, written once.** The same few ideas appear in all three templates and in the
  meta-prompt three more times: search for the behaviour, not the symbol; show the bound; the
  history signal; prefer closing a gap; the large-change boundary. In the rules bundle each should be
  written once. The writing layer then picks what applies to this stage and this task.
- **Machine contracts are short and exact.** Across the three templates they come to: the two
  session-fit phrases, the two `plan-review due:` phrases, the `## Implementation Plan` heading, the
  `### Plan Review Verdict` header plus a `Verdict:` line with one of three tokens, comment versus
  description placement, and the workflow/write-back block the provider post-pass rewrites. All of
  them can be appended by code after the brief. None needs to be in the writer's prose.
- **Don't leave a contract only in prose.** `## Implementation Plan` (read by code, never required)
  and `### Plan Review Verdict` (relied on by breakdown, documented as optional) are both
  half-contracts today. The rewrite is the time to make each one either required and appended by
  code, or dropped.
- **The one-revision-cycle bound** is enforced by the recommender (meta L213) and the autopilot
  (`autopilot-kickoff.js:517`), not by the planner. The plan brief needs one sentence about it, not a
  rule.
