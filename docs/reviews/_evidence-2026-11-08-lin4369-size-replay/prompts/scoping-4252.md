# Define scope for LIN-4252: Client unit tests get one fake DOM that can repaint (tidy first, before LIN-4246)
## Workflow

1. **Start**: Set LIN-4252 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for LIN-4252 in Linear
3. **Analyze**: Complete the goal below
4. **Update Linear**: Write the size record into the description, below the `## As asked` block
## Context
**Project:** Harbour
**Read before acting:** This prompt is an instruction, not a copy of the task. It does not restate LIN-4252's description or discussion — read the current description and comment thread in Linear first, since they are the source of truth and may have moved on since this prompt was written.
**Standing size policy:** err larger: take the larger move when the look shows it pays, and when in doubt; it does not mean inflating every ticket, and a small, clear ticket stays just the task (set 2026-11-07).
## Goal
The ticket is unclear about its goal: settle what it should deliver and what done means. Read the code first.

## Scope and Authority

- When this task fixes something, its cause is part of the work, wherever it lives. Engineering choices, fixing at the cause and refactoring included, are yours; state each with its reason. Cutting the `## As asked` block is not yours: any sentence or clause not delivered in full, by scope, assumption, design, size limit or another ticket, is a cut. Quote each where you write and raise them as one ruling, a `DECISION:` before `BLOCKED:`; unanswered, a cut is not agreed. Only a change the team would need to hear about before it happens goes to the human, as one clear question with your recommendation.

## Process
If the ticket is aimed at a symptom of something deeper, say so.
Read, where they exist: the two Survey comments (`## Survey open-0`, `## Survey global`), the comments filed with the ticket, the area's notes and latest Periodical readings, and for a subtask its parent's size record. A person's size comment on the trail is their ruling: record it as decided by a ruling.
Weigh the sizes: just the task / a small tidy / consolidate the decision this task touches / rebuild the area / wrong work. Recommend one. "just the task" is as easy to recommend as any, and is the answer when the Surveys find nothing this task binds on. A larger size names its extra as its own piece, done first, which may stop and say why.
With a standing policy, apply it and say so. Without one, the size is pending a ruling: raise it as a `DECISION:`.
A size smaller than the ask, or wrong work, is a cut; the standing policy never decides one.
Write one `## Size of the move` section (append it, or replace your own): what and why, never how, so no file, code, name to sweep or step; the builder works out the how. It holds the chosen size in plain words, and why; the sizes weighed, as one-line bullets on what each buys this task; the extra, and when it may stop, if larger than the task; its cuts to the ask, or none; open questions, or none; who decided.
Code reads two lines: `**Size:** <size>` and `**Decided by:** a ruling / the standing policy / pending a ruling`.

## Re-ground the Ticket (staleness check)

Treat this ticket, and any solution or limit it proposes, as a **hypothesis**, not ground truth — it may have been accurate when written but invalidated by later commits or by what the code shows. Before relying on what it says about the code:

1. List the files and symbols the ticket references.
2. Check whether any of them have changed since this ticket was created: run `git log --since=<ticket-createdAt> -- <paths>` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.