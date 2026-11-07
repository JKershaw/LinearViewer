# Plan LIN-998: Auto-populate Brief and Recap on section open
## Workflow
1. **Start**: Set LIN-998 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for LIN-998 in Linear, comments included
3. **Plan**: Write the plan (see Process below) into LIN-998's description in Linear
## Context
**Project:** Harbour
**Read before acting:** This prompt is an instruction, not a copy of the task. It does not restate LIN-998's description or discussion — read the current description and comment thread in Linear first, since they are the source of truth and may have moved on since this prompt was written.
## Goal
Decide how the change will be made, so it can be built without re-deciding anything. Lead with what the change is for, its cause when it fixes something, and what done looks like to the person who asked.

## Scope and Authority

- When this task fixes something, its cause is part of the work, wherever it lives. Engineering choices, fixing at the cause and refactoring included, are yours; state each with its reason. Cutting the `## As asked` block is not yours: any sentence or clause not delivered in full, by scope, assumption, design, size limit or another ticket, is a cut. Quote each where you write and raise them as one ruling, a `DECISION:` before `BLOCKED:`; unanswered, a cut is not agreed. Only a change the team would need to hear about before it happens goes to the human, as one clear question with your recommendation.
- Default to closing the gap at the cause: a ticket number records a trade-off, it does not pay for routing around it.

## Process
Make no code changes here: the next session builds what this plan decides.
### If this pass is a revision
If the comments hold a plan-review verdict (headed `### Plan Review Verdict`), this pass revises the plan already in the description. A finding is usually a sign about the plan, not just a point in it: a missed place means the behaviour was described too narrowly, and the revised description covers that place and whatever else the old one left out; a mechanism that failed review usually means the plan was deciding below its height. So a good revision is usually smaller: a test instead of a longer list, a narrower scope with the rest named as follow-up work, a behaviour and its witness instead of more prescribed code. Removing a step is a valid answer. The newest text has had the least scrutiny, so the revision is done when the whole plan reads true to its builder, not only the part that changed. Every finding is answered: fixed, or disagreed with and why. The description holds one current plan: replace the old block in place (for example through `POST .../description/replace`) and add a line saying what changed and which findings it answers. If the verdict put a question only the person who asked can settle, and no answer is in the comments yet, do not guess around it: park on that question (see If Blocked).
### What a good plan is
The plan's first reader is the person who builds it, starting fresh from it; after them come whoever checks the plan and whoever reviews the finished work against it. A good plan gives them its decisions and the reasons, in plain language, and leaves the code to the code. It is done when the builder could build it without re-deciding anything, and someone holding the finished work beside it could tell whether it was built.
It opens with the problem as the `## As asked` block puts it and what done will look like: the ticket's Done-when or, if it has none, one written from the block and marked as the plan's own. It lists each cut to the block, inherited too, quoted with its ruling, or says none. If what the ticket asks for has drifted from what it is for, it says so before building on it. It says which way the change goes and why, with the alternatives set aside, a line each. A route around the cause leaves a workaround that every later change here has to work around too, so a plan that takes one says what it leaves unsolved, why the cause cannot be fixed here, and which ticket tracks it.
A change is finished when the behaviour is right everywhere it lives, not just where the ticket pointed. Say how you know you've found every place. The same behaviour often lives under another name, on a parallel path, split between server and client, or in tests and docs that describe today's shape. The plan names the behaviour plainly enough that anyone who meets one of its places can tell it belongs, and puts each place it found in scope or out; a place left out says why, and which ticket will handle it. The strongest answer is a test of the behaviour that fails wherever it is still wrong; next, a search someone else can repeat. Where reading the code cannot tell you, because the places are code not yet written or data in production, say so and name what will catch the rest. A search that finds more than you planned for is a finding, not something to trim: "these are the places I found, and this will catch any others" serves the builder better than a list that looks complete and is not.
Each fact the plan relies on is true at HEAD and read from the source that is authoritative for it, not a summary, a cache or an earlier account. Where research ran, the plan builds on it and cites what it relies on (a comment, file:line or sha) rather than restating it, but the claims are the plan's own: what it takes from research has been checked against the code, everything research found that the change must handle is in the plan or set aside with a reason, and where it disagrees with research it says why. Files that keep changing carry constraints their text does not show; the plan carries the ones that bear on this change, read from `git log --oneline -15 -- <files>`.
The plan names the two or three likeliest ways the change breaks, and gives each behaviour it promises a witness: a test or observation that fails before the change and passes after. Where it loosens a validation, a contract or a guard (a widened input, a dropped check, a softened assertion, a gate made advisory), the witnesses include a test that tries what the guard was there to stop.
It settles what is expensive to change once code exists: the shape, the boundaries and how parts that share a path or state interact, which data each part reads, the order of landing, what is left out. It leaves to the builder what a test settles in minutes, such as an exact regex, a comparison or a function body, stated as the behaviour required and its witness: code written as prose has nothing to run it, so its mistakes stay hidden until it is code. A small change to one place gets a short plan: the file, the change, its witness and a line on scope. A short ticket is not always a small change, though; renaming a shared identifier "everywhere" reaches many places.
If research marked a refactor `refactor required` and named the cause it removes or the line here that uses it, that refactor is its own blocking subtask and lands first, so the change is built on it rather than beside it. One that removes no cause here, that nothing here uses, or that makes other callers pay for this feature's need is folded in, scoped down or noted. The plan says whether the work fits one focused session, meaning one pass at building and verifying it without losing track of its edges. If you can name specific things one session would lose track of, it needs more than one, split at seams where each piece lands and is verified on its own; if you are reaching for examples, it fits one. Some plans deserve a second reader before anything is built: those that need more than one session, route around a cause tracked elsewhere, loosen a validation, contract or guard, or touch credentials, merge rules or the dispatch contract. Mistakes in these are hard to undo, or easy to miss once built. The plan says whether it is one of them; most are not, and go straight to the builder.


## If Blocked

**Gate on Principle 0 before you park it as `BLOCKED`.** Attempt local resolution first. If what's actually missing is your parent/orchestrator's own next step rather than something only a person can supply, that's `PENDING-EXTERNAL`, not `BLOCKED` — reserve `BLOCKED:` for what genuinely will not clear without a person.

> Does this genuinely require the human, right now — or is it just something the human might like to
> see?

Its positive half is what makes it actionable: if a question can be answered by asking what's best for
the quality of the code and the coherence of the system, it's yours — answer it and record the
reasoning. Escalate only what a person's preference alone can settle, or what's irreversible.

**When the park is genuine,** comment on the issue with the blocker. Capture the dependency as a `blocks`/`blocked-by` relationship between the tasks, and make the ruling self-sufficient with the manual's **"The human's edge, and how to hand back"** (`docs/autopilot-operating-manual.md`, also served at `GET /api/proxy/autopilot/manual`).

## Formats Later Steps Read

- Put the plan in the description, below any `## As asked` block, under a `## Implementation Plan` heading.
- State session fit there as exactly `fits one session` or `needs multiple sessions`, and use neither phrase elsewhere.
- Add one line: `plan-review due: yes` or `plan-review due: no`.

## Re-ground the Ticket (staleness check)

Treat this ticket, and any solution or limit it proposes, as a **hypothesis**, not ground truth — it may have been accurate when written but invalidated by later commits or by what the code shows. Before relying on what it says about the code:

1. List the files and symbols the ticket references.
2. Check whether any of them have changed since this ticket was created: run `git log --since=<ticket-createdAt> -- <paths>` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.