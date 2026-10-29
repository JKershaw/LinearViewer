# Proposed prompt text: plan and plan-review

*For John, 29 October 2026. Written against `origin/main` = `f3f3c019` (the local ref, not re-fetched); its plan, plan-review, implementation, review and research templates match the checked-out `64a53753` in everything quoted here. Builds on `plan.md`, `plan-review.md` and `readers.md` in this folder, on John's messages 17–21, and on his two later notes about how lessons are worded. Revised once after a second reader's check (the revision log is at the end).*

**How to read this.** Each prompt describes what finished, good work at its stage looks like, and when it is done. It is not a list of steps to comply with. Where it matters, the agent says how it knows it has met the standard, so the next reader can judge the reasoning instead of searching again. Every reason comes from the work: the code, the change, the person who asked, the builder who comes next. Nothing refers to rounds, loops, costs or bounds. Text that code adds stays as it is, and is marked *(code, unchanged)*: Scope and Authority (apart from one line in plan-review), Formats Later Steps Read, If Blocked, Re-ground the Ticket, the attachment check and the subtask summary.

---

## 0. The completeness lesson: wordings weighed

This lesson carries the most weight: a change that does not reach every place a behaviour lives. John's point was that wording which asks for a search gets a search, while wording that says what a finished change is gets completeness.

**Plan side**

| # | Wording | What it would get | Verdict |
|---|---|---|---|
| A | Today: "**Completeness check.** … verify it is *complete*, not just *correct* … Search for the concept itself … **Name the class, and how you bounded it** … paste its output and record the commit sha" | A procedure and a form. Bounds were treated as contracts and shas recorded for their own sake. When a class was semantic, the form could never be filled (LIN-3827 went four rounds on stale comments) | Replace |
| B | "When you find a missing piece, look for its siblings; a gap rarely comes alone." | A look, but not a complete look (John). It also only fires after a miss has already been found | Reject |
| C | "Look for the behaviour, not only the symbol the ticket cites." | A better search, but still an activity, with no point at which it is finished | Reject |
| D | "List every place the behaviour lives." | A standard for the *list*. It rewards a list that looks complete | Reject |
| E | "A change is finished when the behaviour is right everywhere it lives, not just where the ticket pointed. Say how you know you've found every place." (endorsed by John) | A standard of done, plus reasoning someone can judge. On its own, "say how you know" asks for a proof that a semantic class cannot give | **Keep verbatim, and complete it** |
| F | E, plus three things: (1) name the behaviour plainly enough that anyone who meets one of its places can tell it belongs; (2) the strongest answer is a test of the behaviour that fails wherever it is still wrong; (3) where reading the code cannot tell you, say so and name what will catch the rest | Scope becomes a definition that others can apply, not a list they have to re-hunt. Where possible the proof is a test of the behaviour. The honest exit LIN-3827 needed is kept. The definition is what review's in-scope marking reads (§A3) | **Chosen** |

On (2), the first draft said "a test that fails while any place is left behind". A second reader pointed out that this invites source-grepping tests that pin today's shape. The proof now has to be about the behaviour.

**Plan-review side**

| # | Wording | What it would get | Verdict |
|---|---|---|---|
| a | Today: "argue the class, not the member … re-run the query it cites at the sha it names … One round, whole class" | A procedure for re-checking a bound | Replace |
| b | "Check that the plan reaches each one that matters to the goal." | It leaves the hunt for missing places open, one at a time (reader) | Reject |
| c | "Look for places the plan missed." | The same hunt, one place at a time: the pre-September pattern | Reject |
| d | The same standard as the plan side, then: judge the reasoning. An unlisted place inside a correct description is a note. A place outside the description makes the description the finding: say how it should be described, and give every other place it reaches | The reviewer checks the edge, not the list. "One round, whole class" survives in the work's own terms | **Chosen** |

The same sentence opens the lesson in both prompts, so the planner and the reviewer hold one standard.

---

## 1. The plan prompt

**Goal lead (`STAGE_LEADS.plan`)**

```text
Decide how the change will be made, so it can be built without re-deciding anything. Lead with what the change is for, its cause when it fixes something, and what done looks like to the person who asked.
```

**Scope and Authority** *(code, unchanged)*: the DECIDE line, plus "Default to closing the gap at the cause: a ticket number records a trade-off, it does not pay for routing around it." The body's duplicate of that sentence is dropped.

**Workflow** (replaces today's five steps)

```text
1. **Start**: Set {id} status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for {id} in Linear, comments included
3. **Plan**: Write the plan (see Process below) into {id}'s description in Linear
```

**Process** (replaces everything from "Make no code changes here" to the end of the Plan-review Gate; code still adds the attachment check and the subtask summary after the first line)

```text
Make no code changes here: the next session builds what this plan decides.

### If this pass is a revision

If the comments hold a plan-review verdict (headed `### Plan Review Verdict`), this pass revises the plan already in the description. A finding is usually a sign about the plan, not just a point in it: a missed place means the behaviour was described too narrowly, and the revised description covers that place and whatever else the old one left out; a mechanism that failed review usually means the plan was deciding below its height. So a good revision is usually smaller: a test instead of a longer list, a narrower scope with the rest named as follow-up work, a behaviour and its witness instead of more prescribed code. Removing a step is a valid answer. The newest text has had the least scrutiny, so the revision is done when the whole plan reads true to its builder, not only the part that changed. Every finding is answered: fixed, or disagreed with and why. The description holds one current plan: replace the old block in place (for example through `POST .../description/replace`) and add a line saying what changed and which findings it answers. If the verdict put a question only the person who asked can settle, and no answer is in the comments yet, do not guess around it: park on that question (see If Blocked).

### What a good plan is

The plan's first reader is the person who builds it, starting fresh from it; after them come whoever checks the plan and whoever reviews the finished work against it. A good plan gives them its decisions and the reasons, in plain language, and leaves the code to the code. It is done when the builder could build it without re-deciding anything, and someone holding the finished work beside it could tell whether it was built.

It opens with the problem in the asker's terms and what done will look like to them: the ticket's Done-when or, if it has none, one written from what they asked and marked as the plan's own. If what the ticket asks for has drifted from what it is for, it says so before building on it. It says which way the change goes and why, with the alternatives set aside, a line each. A route around the cause leaves a workaround that every later change here has to work around too, so a plan that takes one says what it leaves unsolved, why the cause cannot be fixed here, and which ticket tracks it.

A change is finished when the behaviour is right everywhere it lives, not just where the ticket pointed. Say how you know you've found every place. The same behaviour often lives under another name, on a parallel path, split between server and client, or in tests and docs that describe today's shape. The plan names the behaviour plainly enough that anyone who meets one of its places can tell it belongs, and puts each place it found in scope or out; a place left out says why, and which ticket will handle it. The strongest answer is a test of the behaviour that fails wherever it is still wrong; next, a search someone else can repeat. Where reading the code cannot tell you, because the places are code not yet written or data in production, say so and name what will catch the rest. A search that finds more than you planned for is a finding, not something to trim: "these are the places I found, and this will catch any others" serves the builder better than a list that looks complete and is not.

Each fact the plan relies on is true at HEAD and read from the source that is authoritative for it, not a summary, a cache or an earlier account. Where research ran, the plan builds on it and cites what it relies on (a comment, file:line or sha) rather than restating it, but the claims are the plan's own: what it takes from research has been checked against the code, everything research found that the change must handle is in the plan or set aside with a reason, and where it disagrees with research it says why. Files that keep changing carry constraints their text does not show; the plan carries the ones that bear on this change, read from `git log --oneline -15 -- <files>`.

The plan names the two or three likeliest ways the change breaks, and gives each behaviour it promises a witness: a test or observation that fails before the change and passes after. Where it loosens a validation, a contract or a guard (a widened input, a dropped check, a softened assertion, a gate made advisory), the witnesses include a test that tries what the guard was there to stop.

It settles what is expensive to change once code exists: the shape, the boundaries and how parts that share a path or state interact, which data each part reads, the order of landing, what is left out. It leaves to the builder what a test settles in minutes, such as an exact regex, a comparison or a function body, stated as the behaviour required and its witness: code written as prose has nothing to run it, so its mistakes stay hidden until it is code. A small change to one place gets a short plan: the file, the change, its witness and a line on scope. A short ticket is not always a small change, though; renaming a shared identifier "everywhere" reaches many places.

If research marked a refactor `refactor required` and named the cause it removes or the line here that uses it, that refactor is its own blocking subtask and lands first, so the change is built on it rather than beside it. One that removes no cause here, that nothing here uses, or that makes other callers pay for this feature's need is folded in, scoped down or noted. The plan says whether the work fits one focused session, meaning one pass at building and verifying it without losing track of its edges. If you can name specific things one session would lose track of, it needs more than one, split at seams where each piece lands and is verified on its own; if you are reaching for examples, it fits one. Some plans deserve a second reader before anything is built: those that need more than one session, route around a cause tracked elsewhere, loosen a validation, contract or guard, or touch credentials, merge rules or the dispatch contract. Mistakes in these are hard to undo, or easy to miss once built. The plan says whether it is one of them; most are not, and go straight to the builder.
```

*(code, unchanged)* If Blocked; Formats Later Steps Read (`## Implementation Plan`, `fits one session` / `needs multiple sessions`, `plan-review due: yes|no`); Re-ground the Ticket.

The plan Process has two headings and no bold labels, so an agent has no form to copy into the description. The order follows the work: revision first, so a revising planner knows from the start; then purpose and approach; the whole of the change; what it stands on; risk and witnesses; height and size; and the routing facts last.

---

## 2. The plan-review prompt

**Goal lead (`STAGE_LEADS['plan-review']`)**

```text
Before it is built, judge whether building this plan will solve the task's problem. Block only on what would make the build go wrong; everything else is a note for the builder.
```

**Scope and Authority** *(code)*: the JUDGE line is unchanged. The plan-review line changes only its first word:

```text
Judge, do not redesign: another reasonable approach is not a finding; a plan aimed at a symptom of a cause this task could fix is.
```

**Workflow** *(code, `formatReadOnlyWorkflow`, unchanged)*

**Process** (replaces "Start by reading…" through "### Completion")

```text
Read the task's goal and Done-when first, then the plan, then the research and comments it rests on. Judge the plan against what the person who asked needs; where the plan wrote its own Done-when, check it against what they asked before holding the plan to it. Read the code the plan depends on as it stands on main now, including what has landed since the plan was written and the recent history of the files it touches (`git log --oneline -15 -- <files>`): code that keeps changing carries constraints its text does not show. Take nothing the build stands on from the plan's word when you can check it yourself.

### What a plan ready to build looks like

**Its premise is true.** The cause it names is the cause, and each fact it inherits, from research, a parent plan, a summary, a cache or a house convention, is true for this use and read from the source that is authoritative for it. A wrong premise survives every later check, because everything after it is built on it.

**It solves the whole problem.** Built as written, the plan leaves no part of the task's problem unsolved and breaks nothing that works today. A change is finished when the behaviour is right everywhere it lives, not just where the ticket pointed, and the plan says how it knows it has found every place. Judge that reasoning. If the plan describes the behaviour rightly, a place inside that description that it did not list is a note: the description already puts it in scope. If you find a place the description leaves out, the finding is the description: say how the behaviour should be described, and give every other place that description reaches that you can find, so the plan is corrected whole rather than one place at a time. Where the places cannot all be found by reading code, a plan that says so and names what will catch the rest has given a sound answer; ask for a search only when you can say what search.

**Its safeguards hold.** A step that loosens a validation, contract or guard, or touches credentials, secrets or production, is ready only when the plan names what keeps it safe: a test that tries what the guard was there to stop, or what else limits the harm. These steps are hard to undo, and often sit where no test runs. Replacing a test that pins the code's text with one that pins its behaviour is not a loosening if the new test lands first and fails with the guard removed; on a ticket about security guards, every loosening is held to the full standard.

**Its shape fits the work.** A refactor the change needs is sequenced first rather than buried among the steps, and a refactor sequenced first is one something here needs. A plan that needs more than one session says so.

### Blocking findings, and notes

Write down everything you find. Then, as a separate step, decide which findings block; everything found is still reported, and deciding is labelling, not dropping. A finding blocks when the builder, following the plan, would build the wrong thing, leave part of the problem unsolved, or do harm before anyone could see it. A wrong detail that the plan's own witnesses would catch when the builder runs them is a note, even when you are sure of it; so is any correction the builder can make without changing what the plan decides, its shape, scope or approach. Write each note so the builder can act on it without you: what to do differently, and where. For example:
- a runbook step that would print a production secret blocks;
- a predicate that compares a string with a date, where the plan's witness test exercises it, is a note;
- one more stale comment of a kind the plan's description already covers is a note.

Do not manufacture doubt about a well-grounded plan. A plan that would build the right thing is approved, and a clean verdict is a few lines: what you checked, and that it holds.

### A revised plan

Start from what the last verdict asked: was each point answered, and does the answer hold? Then read the revised text as new work, because it has had the least scrutiny. When what you find sits in text added to answer an earlier finding, the question is whether the plan should carry that mechanism at all. Name the shape of the problem, such as a rule copied instead of called, a concept with no single owner in the code, or a step deciding detail the builder's test would settle. Then propose the smallest change that settles it, which may be removing the step or moving that piece into its own prerequisite ticket.

### When the question is what the task should deliver

Sometimes the disagreement is not whether the plan works, but what the task should deliver, or how complete is complete enough. That is a question for the person who asked, not a defect in the plan: the verdict is Needs Discussion, with the question put plainly and your recommendation.

### Hand off

You are read-only: post the verdict, and do not edit the plan, build it or file tickets. On Approve, the plan goes to `implementation` with your notes. On Request Changes, say what must change and why it matters to the task; on Request Changes or Needs Discussion, it goes back to `plan`.
```

*(code, unchanged)* Formats Later Steps Read (`### Plan Review Verdict`, `**Verdict:**`, `Blocking findings: <n>`); Re-ground the Ticket. The loop bound stays in code (`reviewLoopStop`) and is never mentioned.

**The blocking line, resolved.** The first draft also said "a note that would change what gets built is a blocking finding". That clashed with the string-vs-date example, since fixing the predicate changes what gets built. The line between blocking and note is now what the plan *decides* (its shape, scope or approach), not what the builder *types*. The block criteria are unchanged: the wrong thing, part of the problem unsolved, or harm before anyone could see it.

### How the two work as a pair

| Plan says | Plan-review holds it to |
|---|---|
| What done looks like to the asker; its own Done-when marked as its own | The asker's needs; a Done-when the plan wrote is checked against what was asked first |
| "A change is finished when the behaviour is right everywhere it lives …"; name the behaviour; say how you know; places left out name their ticket | The same sentence; judge the description and the reasoning, not the list |
| Authoritative sources; research re-checked; research's finds carried or set aside | Its premise is true |
| A loosened guard gets a test that tries what the guard stopped | Its safeguards hold, at the same bar |
| Witnesses for each promised behaviour; detail left to the builder | A wrong detail the witnesses would catch, or any correction within what the plan decides, is a note |
| Refactor as its own subtask only when needed | Its shape fits the work (both halves) |
| Revision first; usually smaller; removing a step is valid; re-read the whole plan | Revised text read as new work; ask whether the mechanism should exist; smallest change |
| Park on an unanswered question from the asker | Needs Discussion for disputes about what to deliver |
| Notes reach the build through implementation's fidelity check (§A2) | Notes written so the builder can act on them without the reviewer |

---

## 3. Where each current rule's lesson went

Rules as they stand on `origin/main`. **Form**: *understanding* (restated as what good work is, in the work's terms), *kept* (still earns its place as it stands), *code/test* (belongs in code, or already lives there), or *retired* (with why).

### Plan template

| # | Current rule | Where its lesson went | Form |
|---|---|---|---|
| P1 | Goal: "built in one session or split at real seams"; purpose and cause | Lead: "built without re-deciding anything"; purpose, cause and the asker's done. Seams go to the session-fit sentence | understanding |
| P2 | Scope and Authority, with "default to closing the gap" | Unchanged | kept (code) |
| P3 | Workflow, five steps | Three steps; assessing scope is part of the plan | kept, trimmed |
| P4 | Plan includes files / key changes in each file / risks / testing | Places in "a change is finished …"; risks and witnesses paragraph. "Key changes in each file" retired: it invites code written as prose (LIN-3846's 41 KB plan) | understanding; one part retired |
| P5 | State what it adds, cite the rest (LIN-3202) | Cite rather than restate; the claims are the plan's own | understanding |
| P6 | After planning, update the description | Workflow step 3 | kept |
| P7 | `refactor required` → its own blocking subtask; otherwise fold in, scope down or note (LIN-397) | The same, with its reason ("built on it rather than beside it") | kept, reasoned |
| P8, P10 | Subtask summary; attachment check | Unchanged | code |
| P9 | Scale to the task (shared `formatScaleToTask`) | Two sentences of the plan's own; research keeps the shared block | understanding |
| P11 | Detect a prior verdict | First section of the Process now, not after the framing | kept, moved earlier |
| P12 | Address every finding, with a list of check types; answer disagreement | "Every finding is answered: fixed, or disagreed with and why." The list of check types is retired (it taught answering by form). Added: a finding is a sign about the plan; prefer a smaller revision; removing a step is valid; re-read the whole plan | understanding |
| P13 | Replace, don't append; one current plan | Kept, with `description/replace` | kept |
| P14 | Record what changed; a repeated finding is answered this pass | One line on what changed and which findings it answers; merged into "every finding is answered" | kept, merged |
| P15 | Strategy Framing: cost of doing / cost of not doing; "workarounds compound … each pays tax on every future change" | "A route around the cause leaves a workaround that every later change here has to work around too", with the alternatives a line each. The scoring axes are retired as form | understanding |
| P16 | NAME the routed-around gap with a ticket identifier or "none identified" | "Says what it leaves unsolved, why the cause cannot be fixed here, and which ticket tracks it." The "none identified" ritual is retired: it changed nothing | kept, reasoned; ritual retired |
| P17 | "Default to closing the gap" repeated in the body | Stated once, in Scope and Authority | kept once |
| P18, P19 | State "single viable strategy"; the strategy feeds the scope assessment | Retired: the first served only the check that it was there, and the second is just the order of the plan | retired |
| P20 | Definition of a focused session | Kept | kept |
| P21 | History signal: `git log -15`; read the commits if a file has 3+ | "Files that keep changing carry constraints their text does not show", with the command. The 3+ threshold is retired | understanding |
| P22 | List surfaces; what a surface is; merge rules | Places of the behaviour, plus the boundaries line. The surface taxonomy is retired as form | understanding |
| P23 | Completeness check: concept not symbol; every instance in or out; single-surface is valid | "A change is finished when the behaviour is right everywhere it lives … Say how you know you've found every place." See §0 | understanding (the key lesson) |
| P24 | Name the class and its bound; work from research's classes; map every member; query + sha; record in the description; mark out-of-scope with a ticket; not sent back for a member inside a bounded class | The class becomes "the behaviour, named plainly". The proof is "a test of the behaviour that fails wherever it is still wrong". Research's finds are "in the plan or set aside with a reason". "A place left out says why, and which ticket will handle it" (restored). The behaviour and its places are still recorded in the description for review (§A3). The sha ritual and "add a class only if research missed it" are retired | understanding; proof moves to tests |
| P25 | No-sweep classes: destinations; production data; the "not in the source tree" criterion | "Where reading the code cannot tell you … say so and name what will catch the rest." The third-shape criterion is retired: "name what will catch the rest" now stops the hatch becoming an opt-out | understanding |
| P26 | Don't manufacture a query; an honest "no sweep" beats a quietly incomplete bound; a mismatch is a result | "A search that finds more … is a finding, not something to trim", and the honest-list sentence | understanding |
| P27, P28 | Dependency arrows per surface; two or three easy-to-miss edges | The boundaries line; "two or three likeliest ways the change breaks" | understanding |
| P29, P30 | Session fit by 2–3 concrete catches; record the answer | The catches kept as a thinking device without the count; recording is the Formats line | kept; code |
| P31 | Gate criteria (a)–(d) | The same four, with the reason (hard to undo, easy to miss once built). The letters are retired: code reads only `plan-review due:` (`lib/recommendation-facts.js:458`) | kept, reasoned |
| P32 | Record which of (a)–(d) fired | Retired: it existed so the decision could be audited, and the router's `when` re-derives the gate from the plan | retired |
| P33 | Gated, not universal; don't volunteer it | "Most are not, and go straight to the builder" | understanding |
| P34–36 | If Blocked; Formats; Re-ground the Ticket | Unchanged | code |
| new | — | Decide at the right height; the plan's own Done-when; drift between the ask and the purpose; when a plan is done; park on an unanswered question | added |

### Plan-review template

| # | Current rule | Where its lesson went | Form |
|---|---|---|---|
| R1 | Goal: "fresh context … do its claims hold when you re-run them? … no requirements of your own" | Will building this plan solve the problem; block only on what makes the build go wrong. "Take nothing … from the plan's word when you can check it"; judge "against what the person who asked needs" | understanding |
| R2 | "Verify, do not redesign: …" | "Judge, do not redesign: …" | kept, one word changed |
| R3 | Read-only workflow | Unchanged | code |
| R4 | "Where the plan makes no such claim, that absence is itself the finding" | Retired: it punished a missing form section whether or not anything was wrong. Silence that matters is still caught, in the safeguards and premise sections | retired |
| R5 | Seven checks, all, in order, each re-run | Four qualities of a plan ready to build | understanding |
| R6, R7 | Check 1: re-derive the bound; found member → class, bound, all members; one round, whole class; argue the bound; not sent back for a member inside a bounded class | "It solves the whole problem": the shared standard; judge the reasoning; an unlisted place inside a correct description is a note; a place outside it makes the description the finding, with every other place it reaches ("corrected whole") | understanding |
| R8 | Un-sweepable: check the reason; demand a sweep only by naming the query | "A plan that says so and names what will catch the rest has given a sound answer; ask for a search only when you can say what search" | kept, reasoned |
| R9 | Check 2: gap ticket identifier; routing around a fixable cause → Request Changes | The second half is in Scope and Authority. The identifier check is retired (form only; 4 of about 91 blocking findings) | half kept, half retired |
| R10 | Check 3: re-run the history signal | Opening paragraph, with its reason (it caught main moving under LIN-4009) | understanding |
| R11 | Check 4: session fit against the catches | "A plan that needs more than one session says so" | kept, reduced |
| R12 | Check 5: relaxation needs an adversarial follow-up; pin-conversion carve-out (LIN-3615); security tickets keep every check | "Its safeguards hold", at the adversarial bar; the carve-out and the security exception in plain words | kept, reasoned |
| R13 | Check 6: refactor necessity, and its converse | "Its shape fits the work", both halves | understanding |
| R14 | Check 7: source-of-truth re-grounding (LIN-1844) | "Its premise is true" | understanding |
| R15 | Cite the check behind each finding | Retired with the checks; "say what must change and why it matters to the task" | retired |
| R16 | Cheap when clean; don't manufacture doubt | "Do not manufacture doubt" kept; a clean verdict is "a few lines". The base-rate wording is dropped | kept, reasoned |
| R17 | Read-only; Approve → implementation, otherwise → plan | Kept, with notes carried | kept |
| R18 | An Approve here is not authorization to close | Retired from the prompt: already structural (review's route `requires`, `lib/prompt-template-defs.js:1053`; the verdict header, `lib/prompt-contract.js`) | code |
| R19–21 | Formats; Re-ground the Ticket; the loop bound | Unchanged | code |
| new | — | Block or note as a separate labelling step; the line drawn at what the plan decides; notes the builder can act on; a revision read as new work; name the shape; Needs Discussion; check a Done-when the plan wrote | added |

---

## Notes (separate from the prompt text)

### A. Code and text that change alongside

Nothing was changed on `origin/main`. The four drafts below are needed for the pair to hold. A1–A4 are prompt text in other templates, and they go in the same ticket.

**A1. Research seam** (`lib/prompt-template-defs.js`, research template). Replace the sentence after "Record each class, its bound, and its members in the description alongside your findings.":

```text
Old: The plan step works from this list: it maps every member you found to in- or out-of-scope, and only adds a class of its own if it can say why you missed it — so the classes you name here are what the plan, and the review that follows, will be held to.
New: The plan builds on this list and re-checks what it relies on: every member you found ends up in or out of its scope, and your list is evidence for the plan, not a contract.
```

The test at `prompt-templates.test.js:1140` pins only the "Record each class …" lead-in, which is kept.

**A2. Implementation's fidelity check** (`formatPlanFidelityCheck()`, `lib/prompt-formatters.js:451`). Replace the body under the unchanged heading:

```text
### Re-ground the Plan (fidelity check)

The approved plan is what you build: it builds on the research and says where it departs from it. Before implementing:

1. If a plan-review approved the plan, read its notes. Each is part of what you build, or you say why not.
2. Read the research and the comment thread for any caution, who-pays note or behaviour to preserve that the plan does not mention.

Where the plan departs from the research and says why, follow the plan. Where it is silent on something the research warned against, follow the warning and say so, or recommend re-planning if it changes the approach.
```

This replaces "a **distillation** of the research … Where the plan and the research disagree, the research's reasoning wins". That line contradicted "the claims are the plan's own" and left approval notes unread (LIN-3772's N1). The prompt-formatters comment at line 485 says the seam is "byte-identical-pinned": the LIN-698 block (`prompt-templates.test.js:3864`) has to move with it.

**A3. Review's in-scope vocabulary** (review template, "Inside or Outside the Ticket's Scope"). One clause, so a plan's named behaviour and its places count as a bounded class:

```text
Old: the ticket's bounded classes — the classes research or the plan named for this ticket and recorded in its issue description (LIN-1871) — citing the specific class an inside item belongs to.
New: the ticket's bounded classes — the classes or behaviours research or the plan named, with their places, in its issue description (LIN-1871) — citing the specific one an inside item belongs to.
```

Everything else in that section, including "the list is evidence of the class, not its edge", then reads the same for a behaviour. That keeps LIN-2825: an inside item is done or dropped, never filed.

**A4. Other code and data**
- `lib/prompt-template-defs.js`: both leads, the plan Workflow and Process, the plan-review Process, and both templates' `description` fields (they name the old checks). The plan stops calling `formatScaleToTask()`.
- `lib/prompts/stage-intent.js`: "Verify" → "Judge".
- `lib/completion-signals.js`: the plan-review signals and `readinessCheck` list the seven checks, and the plan signals name "dependency arrows". `lib/audit.js` reads these, and `tests/judge/audit-report.fixture.json` snapshots them.
- `lib/openrouter.js:791,815`: the overflow notes say "If the Strategy Framing step names a contract gap …". Reword to "If the plan's approach routes around a gap …" (asserted at `tests/unit/openrouter.test.js:370,483`).
- **Routing prompt:** `lib/prompt-templates.js:429` renders the first sentence of each lead, so `tests/fixtures/stage-router-prompts/*.txt` and `scripts/eval/meta-prompt.baseline.txt` must be regenerated (`scripts/eval/regen-baseline.mjs`).

**Tests that pin today's wording** (`tests/unit/prompt-templates.test.js` unless noted)
- `plan template` (from 551): Strategy Framing presence and order, "NAME the routed-around contract gap", the Completeness-check paragraph and its order, "State what it adds", and the Strategy Framing → Scope Assessment → gate ordering. Rewrite them to assert the standard sentence, "Say how you know", the honest exit, places left out naming their ticket, the four gate triggers, and the revision coming first.
- `class-not-member … plan template` (1165) and `… plan-review template` (1263): rewrite against the new wording. Keep the security-guard and pin-conversion assertions, retargeted to "Its safeguards hold".
- `plan-review template + the seven checks` (3034): replace the seven ordered anchors and the old phrases ("Verify, do not redesign", "claims verified", "never be mistaken for authorization") with the four qualities, the block-or-note line, Needs Discussion and the hand-off. The Linear byte-parity tests (e1/e2) stay.
- `plan-review gate + revision half` (3152): keep the substance (one current plan, replace in place, `description/replace`, every finding answered), but change the strings. Its "revision half sits BEFORE Strategy Framing" test becomes "the revision section comes first in the Process".
- `plan-fidelity reconciliation` (3864), for A2; `next-stage-choice.test.js:184` (`**Record what changed**`).
- `Scale to the task` (2193) and the count guard at 205: *not read line by line.*
- `plan-review-round-trips.test.js:545` and `stage-selector-input.test.js:142` hold "(a)–(d)" only as fixture data, so no change is needed.

**Eval harnesses**
- `scripts/eval-completeness-check.mjs` **needs rework, not re-pointing.** Its design compares the prompt with and without one paragraph (it strips `**Completeness check.**`, line 110), and its task tells the model to "Do the 'List the surfaces your plan touches' step ONLY", a step that no longer exists. To test §0 it should compare today's paragraph with the new one on the LIN-295 gold case, with the task reworded to "name the behaviour and its places", and the judge rubric left alone.
- `scripts/eval-plan-review-verdict.mjs`: its three planted defects still map to the new qualities, but parts of its regexes key on check names. Re-run it with the new prompt, plus the offline escape set from `plan-review.md` §7 (the round-1 plans of LIN-3772, 3818, 3827, 3977 and 3983).

**Docs**
`docs/architecture/prompt-system.md` (the class-not-member and Completeness-check paragraphs); `docs/prompt-change-validation.md` (its worked example names the old directive); `docs/prompt-pipeline/stage-descriptions/plan-planreview-design.md`; and a row in `scripts/prompt-template-change-log.md` with the expected direction recorded before the read.

### B. Against the prompt-size ceiling

These figures substitute this file's text into today's rendered output under the budget fixture (`FIXTURE_ISSUE`/`FIXTURE_CONTEXT`), measured at `64a53753`, whose output for these surfaces matches `origin/main`. They are **estimates**, not renders of edited source; expect a few bytes of drift from line joins.

| Surface | Ceiling (`origin/main`) | Today | Proposed (est.) | Δ |
|---|--:|--:|--:|--:|
| `plan` rendered | 15,793 | 15,793 | 9,678 | −6,115 (−39%) |
| `plan-review` rendered | 7,989 | 7,989 | 7,418 | −571 (−7%) |
| `implementation` rendered (A2) | 7,937 | 7,937 | 7,800 | −137 |
| `review` rendered (A3) | 15,165 | 15,153 | 15,156 | +3, under its ceiling |
| `research` rendered (A1) | 11,514 | 11,514 | 11,433 | −81 |
| Stage intent source | 2,912 | 2,912 | 2,911 | −1 |
| Routing prompt (the two purpose sentences) | 9,798 | 183 of it | 167 | −16 |
| `lib/prompt-template-defs.js` source | 110,586 | 109,696 | not measured; several KB lower | — |

Every surface shrinks or stays under its ceiling, so nothing needs a raise. The only growth is review's +3, for A3's clause. Review was 12 bytes under its ceiling (LIN-3903's note), and A3 was trimmed so it fits: a first wording, "named for this ticket", came out 7 bytes over. Implementation's fidelity check pays for itself and more. Plan-review saves less than plan because it gains things the old text lacked: the block-or-note line, Needs Discussion and the revision paragraph. The one new mechanism, a test of the behaviour as the proof of completeness, is asked of the plan as a witness, not added as prompt text, which is what `prompt-size-budget.test.js` asks of a new lesson.

**Lower the ceilings in the same change, not just the caps.** That follows LIN-3300 and LIN-3326, which set every ceiling to its surface's actual size and the total to their sum, so slack never builds up silently. Concretely: set each touched ceiling (plan, plan-review, implementation, research, routing prompt, stage intent, the defs and formatters sources) to its new measured size, lower `FROZEN_TOTAL_BYTES` by the sum, and give each comment the ticket and the bytes shed. Measure with the real test after the edit; these estimates are not a substitute.

### C. What I did not check

- No eval was run on any of the new text.
- The byte figures are substitutions, not renders of edited source.
- I counted test assertions per `describe` block. The `Scale to the task` block and the count guard were not read line by line.
- I did not re-run the record figures cited from `plan.md` and `plan-review.md`. They are used only as reasons in these notes, never in the prompts.
- `origin/main` is the local ref (`f3f3c019`); I did not fetch.

### Revision log (second reader, 29 Oct)

Must-fix: the blocking line now turns on what the plan decides (§2); the implementation, review and research drafts are A1–A3. Should-fix: the proof is a test of the behaviour; the plan has no bold labels and the completeness paragraph is shorter; the workaround and out-of-scope-ticket lessons are restored (P15, P16, P24); the revision section comes first; the ceilings are lowered rather than left as caps; the completeness eval needs rework.
