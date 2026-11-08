I've scoped LIN-4253 and recorded the size, but it needs your ruling on one cut to the ask before the build starts. I changed nothing in the repo. HEAD is the commit both Surveys read (29f14bf6e), so nothing the ticket relies on has moved since.

**Size: consolidate the decision this task touches.** The standing policy ("err larger") set this.

- **"Offered":** already declared once, by whether a template says when to route to it. The three templates with no route are exactly the three names on the hand-kept list, in the same order, so this half is a deletion plus a test that every template declares it.
- **"Read-only":** the code uses it in four ways that don't agree:
  - the preamble's Survey mandate, which is really Survey wording ("your only write is the one comment on the surveyed ticket");
  - the "reading pass" line some stages are given;
  - the read-only workflow in some prompts (plan-review says "You are read-only" while it posts a verdict);
  - the inform-only workflow in others.

  A plain read-only flag would sit on the Survey gate, so when LIN-4251 flips it for triage, which files tickets, triage would be sent the Survey forecast mandate. The first piece of work is therefore to settle and name what the trait means: the mandate a dispatched stage is given. Every prompt stays byte-identical. It may stop once the trait is named and its relation to the other wordings is pinned by a test.

**Cut that needs your ruling:** the ask says *"Everything that asks reads that one declaration: … the dispatch preamble. Then changing a trait is a one-line edit to the template."*

- When a follow-up re-attaches the proxy context, the preamble is never told the stage kind, so it can't read the trait.
- Making it read the trait would change what a Survey follow-up is told today, which *"byte-identical on every entry path"* forbids.
- I recommend accepting the cut here and closing the gap in its own ticket before LIN-4251, since that ticket would give four more stages the same gap.

The feedback triage path doesn't need a cut: it can read the trait with no change to any prompt today, so it's in scope.

Files are in /Users/autopilot/development/simple-dispatcher-workspaces/2e356360-bd5f-4ab6-aa6b-8c241216f56e/scratch-replay/runs/r11/output/:
- description.md
- comment.md
- tracker-actions.md (status Todo -> In Progress)

DECISION: {"decision_id":"lin-4253-followup-cut","question":"A follow-up that re-attaches the proxy context never tells the preamble the stage kind, so it can't read the read-only trait without changing what a Survey follow-up is told today. How should LIN-4253 handle that path?","options":[{"id":"accept-and-ticket","label":"Accept the cut: keep the follow-up path byte-identical and close the gap in its own ticket before LIN-4251"},{"id":"accept-to-4251","label":"Accept the cut: keep it byte-identical and hand the gap to LIN-4251"},{"id":"fix-here","label":"No cut: the follow-up path reads the trait in this ticket, accepting that a Survey follow-up's wording changes"}],"recommended":"accept-and-ticket"}
BLOCKED: need a ruling on the follow-up cut (keep byte-identical and ticket the gap, or change Survey follow-up wording here)
