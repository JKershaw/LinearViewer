I've sized LIN-4253 as **just the task**, decided by the standing size policy ("err larger"), with no cuts to the `## As asked` block.

**Is the ticket still accurate?** Yes. The work starts from 29f14bf6e, the LIN-4248 merge, which is the same commit both Surveys looked at. None of the files the ticket names has changed since, so the Surveys' line references still hold.

**Why nothing larger:**
- **"Offered":** this half is a deletion. The hand-only list in `lib/prompt-templates.js:418` (`retro`, `survey-task`, `survey-place`) is exactly the set of templates with no `route`. Deriving the list from the templates keeps the selector, the router's refusal and the task page's "Another step" list byte-identical.
- **"Read-only":** the Surveys' main finding is that "read-only" means four different things in the code today. The list in `lib/proxy-preamble.js:186` actually switches the preamble to Survey-specific wording ("a read-only forecast", "the surveyed ticket"). The other three meanings sit in prompt-body helpers and in a per-stage table of opening lines. Giving the trait a clear name and docstring is a naming choice inside this task, not a separate piece of work.
  - Merging the four meanings into one trait would mean "consolidate the decision". The sets don't match, so that would change what stages are told, which the ticket rules out ("no behaviour change") and leaves to LIN-4251. That finding is nearby, not binding.
- **The other per-stage tables** (leads, grounding, completion signals, buckets, labels, llm-jobs): folding them in would mean "rebuild the area", and the ticket rules it out by name. It only asks the report to say what folding would take.
- **The policy:** with no binding finding, "err larger" has nothing to weigh, so it doesn't push past "just the task".

**For whoever builds it:**
- **The follow-up/resume path:** it never receives the stage's kind, so a Survey follow-up still gets the ordinary reversible-work mandate, not the read-only one. Keeping that unchanged is part of "byte-identical on every entry path". The feedback-triage dispatch and the collective `custom` path don't pass a kind either.
- **`defer` and stages with no template** (`defer` is offered without one; `custom` and `periodical` must stay unrefused).
- **Layering:** `proxy-preamble.js` deliberately doesn't import the template registry.
- **Tests:** they need one pinned expected list, or a test that loops over the derived set can pass even when the set is empty.
- **Prose list:** `lib/proxy-instructions.js:849` names the two Surveys as "never recommended". That is a hand-written list in prose, and replacing it can't change the instruction bytes.

**What I wrote:**
- Size record: `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-d9c15ccd-54df-486b-80e0-935c0774bacf/d9c15ccd-54df-486b-80e0-935c0774bacf/scratchpad/w/runs/b05/output/description.md`
- Status change to In Progress: `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-d9c15ccd-54df-486b-80e0-935c0774bacf/d9c15ccd-54df-486b-80e0-935c0774bacf/scratchpad/w/runs/b05/output/tracker-actions.md`
- No comment file: this stage's prompt asks only for the description section.
- The code clone is unchanged.

DONE: Sized LIN-4253 as "just the task" under the standing policy, no cuts; size record and In Progress status written.
